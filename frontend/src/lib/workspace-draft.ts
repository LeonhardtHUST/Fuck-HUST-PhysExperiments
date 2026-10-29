/**
 * Local draft persistence for the experiment workspaces.
 *
 * Unlike `experiment-artifact.ts` (which trims trailing empty rows and re-shapes
 * cells for export), a draft stores exactly what is on the screen: half-typed
 * strings such as `-` / `1e`, extra blank rows and the imported remarks.
 * Both paths keep measurement cells as strings — 有效数字属于数据本身。
 * One key per experiment:
 *
 *     physlab:draft:v1:<experimentId>
 *
 * `Storage` is injected so node tests can run without a browser. Keep this
 * module free of JSX and `@/` aliases so `node --test` can load it.
 */

import {
  MAX_TABLE_ROWS,
  sanitizeExperimentRemarks,
  sanitizeTableRemarks,
  type ComputedEntry,
  type ExperimentRemarks,
  type TableRemarks,
} from "./experiment-artifact.ts";
import type { ArtifactNotes } from "./artifact-scope.ts";
import { rowIndexValue, type ExperimentSpec, type TableSpec } from "./table-specs.ts";

export const DRAFT_VERSION = 1;
export const DRAFT_KEY_PREFIX = "physlab:draft:v1:";
/** Hard cap for one serialized draft; larger payloads are discarded. */
export const MAX_DRAFT_CHARS = 200_000;
export const MAX_DRAFT_ROWS = MAX_TABLE_ROWS;
export const MAX_DRAFT_CELL_CHARS = 200;
export const MAX_DRAFT_COMPUTED = 200;

export interface DraftTable {
  /** Column-keyed rows, kept verbatim so in-progress input is not lost. */
  rows: Record<string, string>[];
  params: Record<string, string>;
}

export interface DraftPayload {
  setupParams: Record<string, string>;
  tables: Record<string, DraftTable>;
  notes: ArtifactNotes;
}

export interface WorkspaceDraft extends DraftPayload {
  version: number;
  experimentId: string;
  savedAt: number;
}

export interface StorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

export type ReadDraftResult =
  | { status: "empty" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; draft: WorkspaceDraft };

export type WriteDraftResult =
  | { ok: true; savedAt: number }
  | { ok: false; reason: "unavailable" | "quota" | "too-large" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") {
    return value.length > MAX_DRAFT_CELL_CHARS ? value.slice(0, MAX_DRAFT_CELL_CHARS) : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function textRecord(raw: unknown, keys: string[], fallback: (key: string) => string): Record<string, string> {
  const source = isRecord(raw) ? raw : {};
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    result[key] = value === undefined || value === null ? fallback(key) : text(value);
  }
  return result;
}

function buildNotes(raw: unknown): ArtifactNotes {
  const source = isRecord(raw) ? raw : {};

  const remarks = isRecord(source.remarks)
    ? sanitizeExperimentRemarks(source.remarks as ExperimentRemarks)
    : null;

  const tableRemarks: Record<string, TableRemarks> = {};
  if (isRecord(source.tableRemarks)) {
    for (const [tableId, value] of Object.entries(source.tableRemarks)) {
      if (!isRecord(value)) continue;
      const clean = sanitizeTableRemarks(value as TableRemarks);
      if (Object.keys(clean).length > 0) tableRemarks[tableId] = clean;
    }
  }

  const computed: Record<string, ComputedEntry> = {};
  if (isRecord(source.computed)) {
    for (const [key, value] of Object.entries(source.computed).slice(0, MAX_DRAFT_COMPUTED)) {
      if (!isRecord(value)) continue;
      const entry: ComputedEntry = { source: value.source === "backend" ? "backend" : "ai" };
      const label = typeof value.label === "string" ? value.label.trim().slice(0, 80) : "";
      if (label) entry.label = label;
      const unit = typeof value.unit === "string" ? value.unit.trim().slice(0, 40) : "";
      if (unit) entry.unit = unit;
      const note = typeof value.note === "string" ? value.note.trim().slice(0, 300) : "";
      if (note) entry.note = note;
      if (typeof value.value === "number" && Number.isFinite(value.value)) entry.value = value.value;
      else if (typeof value.value === "string" && value.value.trim() !== "") {
        entry.value = text(value.value).trim();
      }
      computed[key] = entry;
    }
  }

  return {
    remarks: remarks && Object.keys(remarks).length > 0 ? remarks : null,
    tableRemarks,
    computed,
  };
}

function defaultRows(table: TableSpec): Record<string, string>[] {
  const count = Math.min(Math.max(1, table.defaultRows), MAX_DRAFT_ROWS);
  return Array.from({ length: count }, (_, rowIndex) =>
    Object.fromEntries(
      table.columns.map((column) => {
        const derived = rowIndexValue(column, rowIndex);
        if (derived !== undefined) return [column.key, String(derived)];
        const prefill = table.prefill?.[column.key]?.[rowIndex];
        return [column.key, prefill === undefined || prefill === null ? "" : String(prefill)];
      })
    )
  );
}

function defaultParams(table: TableSpec): Record<string, string> {
  return Object.fromEntries(
    table.params.map((param) => [
      param.key,
      param.defaultValue === undefined || param.defaultValue === null ? "" : String(param.defaultValue),
    ])
  );
}

/** The state a workspace shows before the student touches anything. */
export function emptyDraft(spec: ExperimentSpec): DraftPayload {
  const tables: Record<string, DraftTable> = {};
  for (const table of spec.tables) {
    tables[table.tableId] = { rows: defaultRows(table), params: defaultParams(table) };
  }
  return {
    setupParams: Object.fromEntries(
      spec.setupParams.map((param) => [
        param.key,
        param.defaultValue === undefined || param.defaultValue === null ? "" : String(param.defaultValue),
      ])
    ),
    tables,
    notes: { remarks: null, tableRemarks: {}, computed: {} },
  };
}

/**
 * Normalises any payload against the spec: unknown tables/columns are dropped,
 * every cell becomes a bounded string, and missing tables fall back to defaults.
 * Used both when saving live state and when reading back untrusted storage.
 */
export function buildDraft(spec: ExperimentSpec, raw: unknown): DraftPayload {
  const source = isRecord(raw) ? raw : {};
  const rawTables = isRecord(source.tables) ? source.tables : {};

  const tables: Record<string, DraftTable> = {};
  for (const table of spec.tables) {
    const provided = isRecord(rawTables[table.tableId]) ? (rawTables[table.tableId] as Record<string, unknown>) : {};
    const rawRows = Array.isArray(provided.rows) ? provided.rows : [];
    const columnKeys = table.columns.map((column) => column.key);

    const rows = rawRows.slice(0, MAX_DRAFT_ROWS).map((rawRow) => {
      const row = isRecord(rawRow) ? rawRow : {};
      return Object.fromEntries(columnKeys.map((key) => [key, text(row[key])]));
    });

    tables[table.tableId] = {
      rows: rows.length > 0 ? rows : defaultRows(table),
      params: textRecord(provided.params, table.params.map((param) => param.key), (key) =>
        defaultParams(table)[key] ?? ""
      ),
    };
  }

  return {
    setupParams: textRecord(
      source.setupParams,
      spec.setupParams.map((param) => param.key),
      (key) => {
        const param = spec.setupParams.find((item) => item.key === key);
        return param?.defaultValue === undefined || param.defaultValue === null
          ? ""
          : String(param.defaultValue);
      }
    ),
    tables,
    notes: buildNotes(source.notes),
  };
}

/** Stable JSON for equality checks and storage. */
export function serializeDraft(spec: ExperimentSpec, raw: unknown): string {
  return JSON.stringify(buildDraft(spec, raw));
}

export function draftStorageKey(experimentId: string): string {
  return `${DRAFT_KEY_PREFIX}${experimentId}`;
}

/** `localStorage` when the browser lets us touch it, otherwise null. */
export function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    const probe = "__physlab_draft_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function readDraft(storage: StorageLike | null, spec: ExperimentSpec): ReadDraftResult {
  if (!storage) return { status: "empty" };
  let raw: string | null = null;
  try {
    raw = storage.getItem(draftStorageKey(spec.id));
  } catch {
    return { status: "empty" };
  }
  if (raw === null) return { status: "empty" };
  if (raw.length > MAX_DRAFT_CHARS) return { status: "invalid", reason: "草稿过大" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "草稿不是合法 JSON" };
  }
  if (!isRecord(parsed)) return { status: "invalid", reason: "草稿顶层不是对象" };
  if (Number(parsed.version) !== DRAFT_VERSION) {
    return { status: "invalid", reason: "草稿版本不受支持" };
  }
  if (parsed.experimentId !== spec.id) {
    return { status: "invalid", reason: "草稿属于其他实验" };
  }

  const savedAt = Number(parsed.savedAt);
  return {
    status: "ok",
    draft: {
      version: DRAFT_VERSION,
      experimentId: spec.id,
      savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0,
      ...buildDraft(spec, parsed),
    },
  };
}

export function writeDraft(
  storage: StorageLike | null,
  experimentId: string,
  payload: DraftPayload,
  savedAt = Date.now()
): WriteDraftResult {
  if (!storage) return { ok: false, reason: "unavailable" };
  const body = JSON.stringify({ version: DRAFT_VERSION, experimentId, savedAt, ...payload });
  if (body.length > MAX_DRAFT_CHARS) return { ok: false, reason: "too-large" };
  try {
    storage.setItem(draftStorageKey(experimentId), body);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    // 隐私模式/配额耗尽：不阻塞录入，由界面提示「未保存」。
    return { ok: false, reason: name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" ? "quota" : "unavailable" };
  }
  return { ok: true, savedAt };
}

export function removeDraft(storage: StorageLike | null, experimentId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(draftStorageKey(experimentId));
  } catch {
    /* 存储被禁用时静默忽略 */
  }
}

/** Experiments that currently hold a saved draft. */
export function listDraftExperimentIds(storage: StorageLike | null): string[] {
  if (!storage) return [];
  const ids: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      ids.push(key.slice(DRAFT_KEY_PREFIX.length));
    }
  } catch {
    return [];
  }
  return ids.sort();
}

/** Removes every draft key; unrelated keys (`physlab:admin-key` 等) stay. */
export function clearAllDrafts(storage: StorageLike | null): string[] {
  const ids = listDraftExperimentIds(storage);
  if (!storage) return ids;
  for (const experimentId of ids) removeDraft(storage, experimentId);
  return ids;
}

/* ------------------------------------------------------------------ *
 * Grid <-> record mapping (the workspaces render `string[][]`)
 * ------------------------------------------------------------------ */

/** `grid` rows → column-keyed records. `startIndex` skips a leading serial column. */
export function gridToRows(table: TableSpec, grid: string[][], startIndex = 0): Record<string, string>[] {
  return grid.slice(0, MAX_DRAFT_ROWS).map((row) =>
    Object.fromEntries(
      table.columns.map((column, offset) => [column.key, text(row[startIndex + offset] ?? "")])
    )
  );
}

/** Column-keyed records → `grid`, optionally re-adding the自动序号 column. */
export function rowsToGrid(
  table: TableSpec,
  rows: Record<string, string>[],
  options: { serial?: boolean } = {}
): string[][] {
  return rows.map((row, rowIndex) => {
    const values = table.columns.map((column) => {
      const derived = rowIndexValue(column, rowIndex);
      if (derived !== undefined) return String(derived);
      return text(row[column.key] ?? "");
    });
    return options.serial ? [String(rowIndex + 1), ...values] : values;
  });
}
