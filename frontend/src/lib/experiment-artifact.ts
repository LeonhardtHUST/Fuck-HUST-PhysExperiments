/**
 * Artifact codec: the single structure used both for exported files and for
 * the JSONC an AI returns after reading the lab record sheet.
 *
 * Export = strict JSON. Schema / prompt = JSONC (see experiment-schema.ts).
 * Decoding is intentionally forgiving: unknown tables/columns become warnings,
 * broken rows never abort the whole import.
 *
 * 数值单元格以**字符串**写出（"1.20"、"0.000100"、"1.20e-3"）：有效数字是数据的一部分，
 * 转成 JSON number 会丢掉末尾 0 与写法。旧的数字型文件仍然可以导入（解码时 String()）。
 */

import { stringifyJson, tryParseJsonc } from "./jsonc.ts";
import { ARTIFACT_SCHEMA_VERSION, computedKey } from "./experiment-schema.ts";
import type { ExperimentSpec, TableSpec } from "./table-specs.ts";
import { rowIndexValue } from "./table-specs.ts";

export const MAX_ARTIFACT_CHARS = 1_000_000;
export const MAX_TABLE_ROWS = 500;
export const MAX_ISSUES = 50;
export const MAX_TEXT_CHARS = 600;

export type Severity = "info" | "warning" | "error";
export type CellValue = string | number | null;

export interface ArtifactIssue {
  table?: string;
  row?: number;
  column?: string;
  severity: Severity;
  message: string;
  suspectedCause?: string;
}

export interface TableRemarks {
  status?: "ok" | "incomplete" | "suspect";
  summary?: string;
  issues?: ArtifactIssue[];
}

export interface ExperimentRemarks {
  summary?: string;
  suspectedCauses?: string[];
  issues?: ArtifactIssue[];
}

export interface ComputedEntry {
  source: "ai" | "backend";
  label?: string;
  unit?: string;
  value?: CellValue;
  note?: string;
}

export interface ExperimentArtifact {
  schemaVersion: number;
  experiment: { id: string; name: string; category?: string };
  setupParams?: Record<string, CellValue>;
  tables: Record<
    string,
    {
      params?: Record<string, CellValue>;
      rows: Record<string, CellValue>[];
      remarks?: TableRemarks;
    }
  >;
  remarks?: ExperimentRemarks;
  computed?: Record<string, ComputedEntry>;
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

export interface ArtifactTableInput {
  params?: Record<string, CellValue>;
  rows: Record<string, CellValue>[];
  remarks?: TableRemarks;
}

export interface ArtifactInput {
  tables: Record<string, ArtifactTableInput>;
  setupParams?: Record<string, CellValue>;
  remarks?: ExperimentRemarks;
  computed?: Record<string, ComputedEntry>;
}

function isEmptyCell(value: CellValue | undefined): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function encodeCell(value: CellValue | undefined): CellValue {
  if (isEmptyCell(value)) return null;
  // 单元格一律按原样字符串写出：JSON number 存不了 "1.20" 的末尾 0，也存不了 "1.20e-3" 的写法，
  // 而这两者都是有效数字的一部分。数值合法性由后端校验，不在序列化时做归一化。
  return typeof value === "string" ? value.trim() : String(value);
}

function trimTrailingEmptyRows(
  rows: Record<string, CellValue>[],
  keys: string[]
): Record<string, CellValue>[] {
  let end = rows.length;
  while (end > 1) {
    const row = rows[end - 1];
    const empty = keys.every((key) => isEmptyCell(row[key]));
    if (!empty) break;
    end -= 1;
  }
  return rows.slice(0, end);
}

function encodeTable(table: TableSpec, input: ArtifactTableInput): ExperimentArtifact["tables"][string] {
  const keys = table.columns.map((column) => column.key);
  const rows = input.rows.map((row) => {
    const encoded: Record<string, CellValue> = {};
    for (const column of table.columns) {
      encoded[column.key] = encodeCell(row[column.key]);
    }
    return encoded;
  });
  const params: Record<string, CellValue> = {};
  for (const param of table.params) {
    const value = input.params?.[param.key];
    if (!isEmptyCell(value)) params[param.key] = encodeCell(value);
  }
  const result: ExperimentArtifact["tables"][string] = {
    rows: trimTrailingEmptyRows(rows, keys),
  };
  if (Object.keys(params).length > 0) result.params = params;
  if (input.remarks) result.remarks = sanitizeTableRemarks(input.remarks);
  return result;
}

export function buildArtifact(spec: ExperimentSpec, input: ArtifactInput): ExperimentArtifact {
  const tables: ExperimentArtifact["tables"] = {};
  for (const table of spec.tables) {
    const provided = input.tables[table.tableId];
    if (!provided) continue;
    tables[table.tableId] = encodeTable(table, provided);
  }

  const setupParams: Record<string, CellValue> = {};
  for (const param of spec.setupParams) {
    const value = input.setupParams?.[param.key];
    if (!isEmptyCell(value)) setupParams[param.key] = encodeCell(value);
  }

  const artifact: ExperimentArtifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    experiment: { id: spec.id, name: spec.name, category: spec.category },
    tables,
  };
  if (Object.keys(setupParams).length > 0) artifact.setupParams = setupParams;
  if (input.remarks) artifact.remarks = sanitizeExperimentRemarks(input.remarks);
  if (input.computed && Object.keys(input.computed).length > 0) {
    artifact.computed = input.computed;
  }
  return artifact;
}

export function encodeArtifact(spec: ExperimentSpec, input: ArtifactInput): string {
  return stringifyJson(buildArtifact(spec, input));
}

/* ------------------------------------------------------------------ *
 * Sanitising
 * ------------------------------------------------------------------ */

export function cleanText(value: unknown, max = MAX_TEXT_CHARS): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function cleanSeverity(value: unknown): Severity {
  return value === "error" || value === "warning" ? value : "info";
}

function sanitizeIssues(raw: unknown, limit = MAX_ISSUES): ArtifactIssue[] {
  if (!Array.isArray(raw)) return [];
  const issues: ArtifactIssue[] = [];
  for (const item of raw.slice(0, limit)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const message = cleanText(source.message);
    if (!message) continue;
    const issue: ArtifactIssue = { severity: cleanSeverity(source.severity), message };
    const table = cleanText(source.table, 80);
    if (table) issue.table = table;
    const column = cleanText(source.column, 80);
    if (column) issue.column = column;
    const row = Number(source.row);
    if (Number.isFinite(row) && row > 0) issue.row = Math.floor(row);
    const cause = cleanText(source.suspectedCause, 300);
    if (cause) issue.suspectedCause = cause;
    issues.push(issue);
  }
  return issues;
}

export function sanitizeTableRemarks(raw: TableRemarks): TableRemarks {
  const remarks: TableRemarks = {};
  if (raw.status === "ok" || raw.status === "incomplete" || raw.status === "suspect") {
    remarks.status = raw.status;
  }
  const summary = cleanText(raw.summary);
  if (summary) remarks.summary = summary;
  const issues = sanitizeIssues(raw.issues);
  if (issues.length > 0) remarks.issues = issues;
  return remarks;
}

export function sanitizeExperimentRemarks(raw: ExperimentRemarks): ExperimentRemarks {
  const remarks: ExperimentRemarks = {};
  const summary = cleanText(raw.summary);
  if (summary) remarks.summary = summary;
  const causes = Array.isArray(raw.suspectedCauses)
    ? raw.suspectedCauses.map((cause) => cleanText(cause, 300)).filter(Boolean).slice(0, 20)
    : [];
  if (causes.length > 0) remarks.suspectedCauses = causes;
  const issues = sanitizeIssues(raw.issues);
  if (issues.length > 0) remarks.issues = issues;
  return remarks;
}

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

export interface DecodedTable {
  tableId: string;
  title: string;
  rows: Record<string, string>[];
  params: Record<string, string>;
  remarks?: TableRemarks;
}

export interface DecodeStats {
  tableCount: number;
  rowCount: number;
  issueCount: number;
  computedCount: number;
}

export type DecodeResult =
  | {
      ok: true;
      experimentId: string;
      tables: DecodedTable[];
      setupParams: Record<string, string>;
      remarks: ExperimentRemarks | null;
      computed: Record<string, ComputedEntry>;
      warnings: string[];
      stats: DecodeStats;
    }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeRows(
  table: TableSpec,
  rawRows: unknown,
  warnings: string[]
): Record<string, string>[] {
  if (!Array.isArray(rawRows)) {
    warnings.push(`表 ${table.tableId} 的 rows 不是数组，已跳过`);
    return [];
  }
  if (rawRows.length > MAX_TABLE_ROWS) {
    warnings.push(`表 ${table.tableId} 行数超过 ${MAX_TABLE_ROWS}，已截断`);
  }
  const rows: Record<string, string>[] = [];
  rawRows.slice(0, MAX_TABLE_ROWS).forEach((raw, rowIndex) => {
    const source = isRecord(raw) ? raw : {};
    const row: Record<string, string> = {};
    for (const column of table.columns) {
      const value = source[column.key];
      if (value === null || value === undefined || String(value).trim() === "") {
        const derived = rowIndexValue(column, rowIndex);
        row[column.key] = derived === undefined ? "" : String(derived);
      } else if (typeof value === "object") {
        row[column.key] = "";
      } else {
        row[column.key] = String(value).trim();
      }
    }
    rows.push(row);
  });
  return rows;
}

function collectUnknownKeys(table: TableSpec, rawRows: unknown, warnings: string[]): void {
  if (!Array.isArray(rawRows)) return;
  const known = new Set(table.columns.map((column) => column.key));
  const unknown = new Set<string>();
  for (const raw of rawRows) {
    if (!isRecord(raw)) continue;
    for (const key of Object.keys(raw)) if (!known.has(key)) unknown.add(key);
  }
  if (unknown.size > 0) {
    warnings.push(`表 ${table.tableId} 存在未定义的列：${[...unknown].join("、")}（已忽略）`);
  }
}

function decodeTableParams(
  table: TableSpec,
  raw: unknown,
  warnings: string[]
): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) {
    warnings.push(`表 ${table.tableId} 的 params 不是对象，已忽略`);
    return {};
  }
  const params: Record<string, string> = {};
  const known = new Set(table.params.map((param) => param.key));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      warnings.push(`表 ${table.tableId} 存在未定义的参数：${key}（已忽略）`);
      continue;
    }
    const value = raw[key];
    if (value === null || value === undefined || String(value).trim() === "") continue;
    params[key] = String(value).trim();
  }
  return params;
}

function decodeComputed(
  spec: ExperimentSpec,
  raw: unknown,
  warnings: string[]
): Record<string, ComputedEntry> {
  if (!isRecord(raw)) return {};
  const backendKeys = new Set(spec.backendResults.map((item) => computedKey(item.methodId, item.key)));
  const computed: Record<string, ComputedEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const source = value.source === "backend" ? "backend" : "ai";
    const hasValue =
      value.value !== null && value.value !== undefined && String(value.value).trim() !== "";
    if (source === "backend" || backendKeys.has(key)) {
      if (hasValue) warnings.push(`计算结果 ${key} 由系统负责，已忽略导入值`);
      continue;
    }
    if (!hasValue) continue;
    const entry: ComputedEntry = { source: "ai" };
    const label = cleanText(value.label, 80);
    if (label) entry.label = label;
    const unit = cleanText(value.unit, 40);
    if (unit) entry.unit = unit;
    // AI 参考值同样保留原始写法（"6.62e-34"、"1.20"），不转 number
    if (value.value !== null && value.value !== undefined && String(value.value).trim() !== "") {
      entry.value = cleanText(value.value, 120);
    }
    const note = cleanText(value.note, 300);
    if (note) entry.note = note;
    computed[key] = entry;
  }
  return computed;
}

/** Parses pasted/uploaded artifact text and normalises it for the workspace. */
export function decodeArtifact(spec: ExperimentSpec, text: string): DecodeResult {
  if (!text || !text.trim()) return { ok: false, error: "内容为空，请粘贴 JSON/JSONC 数据" };
  if (text.length > MAX_ARTIFACT_CHARS) {
    return { ok: false, error: `内容超过 ${MAX_ARTIFACT_CHARS} 字符上限，请删除多余部分后重试` };
  }

  const parsed = tryParseJsonc<unknown>(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!isRecord(parsed.value)) return { ok: false, error: "顶层必须是 JSON 对象" };

  const root = parsed.value;
  const version = Number(root.schemaVersion);
  if (!Number.isFinite(version) || version !== ARTIFACT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schemaVersion 不受支持（期望 ${ARTIFACT_SCHEMA_VERSION}）`,
    };
  }

  const experiment = isRecord(root.experiment) ? root.experiment : {};
  const experimentId = cleanText(experiment.id, 80);
  if (experimentId && experimentId !== spec.id) {
    return { ok: false, error: `实验不匹配：文件属于 ${experimentId}，当前页面是 ${spec.id}` };
  }

  const warnings: string[] = [];
  const tables: DecodedTable[] = [];
  const rawTables = isRecord(root.tables) ? root.tables : {};

  for (const [tableId, rawTable] of Object.entries(rawTables)) {
    const table = spec.tables.find((item) => item.tableId === tableId);
    if (!table) {
      warnings.push(`未知表格 ${tableId}（当前实验没有这张表，已忽略）`);
      continue;
    }
    if (!isRecord(rawTable)) {
      warnings.push(`表 ${tableId} 的内容不是对象，已忽略`);
      continue;
    }
    collectUnknownKeys(table, rawTable.rows, warnings);
    const rows = decodeRows(table, rawTable.rows, warnings);
    const params = decodeTableParams(table, rawTable.params, warnings);
    const remarks = isRecord(rawTable.remarks)
      ? sanitizeTableRemarks(rawTable.remarks as TableRemarks)
      : undefined;
    const decoded: DecodedTable = { tableId, title: table.title, rows, params };
    if (remarks && Object.keys(remarks).length > 0) decoded.remarks = remarks;
    tables.push(decoded);
  }

  if (tables.length === 0) {
    return { ok: false, error: "没有找到本实验可导入的表格数据（tables 为空）" };
  }

  for (const table of spec.tables) {
    if (!rawTables[table.tableId]) {
      warnings.push(`表 ${table.tableId}（${table.title}）未出现在文件中，保持界面原样`);
    }
  }

  const setupParams: Record<string, string> = {};
  if (isRecord(root.setupParams)) {
    for (const param of spec.setupParams) {
      const value = root.setupParams[param.key];
      if (value === null || value === undefined || String(value).trim() === "") continue;
      setupParams[param.key] = String(value).trim();
    }
  }

  const remarks = isRecord(root.remarks)
    ? sanitizeExperimentRemarks(root.remarks as ExperimentRemarks)
    : null;
  const computed = decodeComputed(spec, root.computed, warnings);

  const issueCount =
    tables.reduce((sum, table) => sum + (table.remarks?.issues?.length ?? 0), 0) +
    (remarks?.issues?.length ?? 0);

  return {
    ok: true,
    experimentId: spec.id,
    tables,
    setupParams,
    remarks: remarks && Object.keys(remarks).length > 0 ? remarks : null,
    computed,
    warnings,
    stats: {
      tableCount: tables.length,
      rowCount: tables.reduce((sum, table) => sum + table.rows.length, 0),
      issueCount,
      computedCount: Object.keys(computed).length,
    },
  };
}
