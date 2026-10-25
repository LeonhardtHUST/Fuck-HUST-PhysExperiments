/**
 * Normalised table specifications.
 *
 * A `TableSpec` is the single source of truth for
 *  - the JSONC schema shown in the UI / copied into AI prompts,
 *  - the artifact encoder/decoder,
 *  - the import target of each workspace table.
 *
 * The spec is derived from the authoritative backend config files so the
 * exchange format can never drift away from what the backend validates.
 * Keep this module free of JSX and `@/` aliases so node tests can load it.
 */

import { getInputRange, type InputRangeHint } from "./input-ranges.ts";

export interface ColumnRange {
  min: number;
  max: number;
  note?: string;
}

/** Columns whose value is dictated by the row order (偏光工作台的角度列). */
export interface RowIndexRule {
  start: number;
  step: number;
  /** Wrap the derived value into [0, wrap) — used by 0°–350° angle tables. */
  wrap?: number;
}

export interface TableColumnSpec {
  key: string;
  label: string;
  unit: string;
  kind: "number" | "text";
  range?: ColumnRange;
  rowIndex?: RowIndexRule;
  decimals?: number;
  hint?: string;
}

export interface TableParamSpec {
  key: string;
  label: string;
  unit: string;
  range?: ColumnRange;
  defaultValue?: number | string;
  hint?: string;
}

export interface BackendResultSpec {
  methodId: string;
  key: string;
  label: string;
  unit: string;
}

export interface TableSpec {
  /** Matches the OCR table id so both import paths share one identifier. */
  tableId: string;
  methodId: string;
  title: string;
  note?: string;
  columns: TableColumnSpec[];
  /** Rows rendered before the student edits anything (讲义推荐条数). */
  defaultRows: number;
  /** Lower bound enforced by the backend. */
  minRows: number;
  params: TableParamSpec[];
  /** Values the UI pre-fills, kept for schema comments only. */
  prefill?: Record<string, number[]>;
}

export interface ExperimentSpec {
  id: string;
  name: string;
  category: string;
  description: string;
  tables: TableSpec[];
  /** Parameters shared by every table (偏振光工作台的背景光强、波片角度). */
  setupParams: TableParamSpec[];
  /** Values the backend computes — AI prompts must never ask for these. */
  backendResults: BackendResultSpec[];
}

/* ------------------------------------------------------------------ *
 * Raw backend config shapes (only the fields we consume)
 * ------------------------------------------------------------------ */

interface RawColumn {
  key: string;
  label: string;
  unit?: string;
  type?: string;
  expected_range?: [number, number];
  decimal_places?: number;
  hint?: string;
}

interface RawParam extends RawColumn {
  default?: number | string;
}

interface RawResult {
  key: string;
  label: string;
  unit?: string;
}

interface RawMethod {
  id: string;
  name: string;
  required?: boolean;
  description?: string;
  rowCount?: number;
  minRows?: number;
  columns?: RawColumn[];
  params?: RawParam[];
  prefill?: Record<string, number[]>;
  results?: RawResult[];
}

export interface GenericConfig {
  id: string;
  name: string;
  category?: string;
  description?: string;
  methods?: RawMethod[];
}

function toRange(hint?: InputRangeHint | ColumnRange): ColumnRange | undefined {
  if (!hint) return undefined;
  return { min: hint.min, max: hint.max, ...(hint.note ? { note: hint.note } : {}) };
}

function rangeFor(experimentId: string, methodId: string, fieldKey: string): ColumnRange | undefined {
  return toRange(getInputRange(experimentId, methodId, fieldKey));
}

function buildColumn(
  experimentId: string,
  methodId: string,
  column: RawColumn
): TableColumnSpec {
  const explicit = column.expected_range
    ? { min: column.expected_range[0], max: column.expected_range[1] }
    : rangeFor(experimentId, methodId, column.key);
  const spec: TableColumnSpec = {
    key: column.key,
    label: column.label,
    unit: column.unit ?? "",
    kind: column.type === "text" ? "text" : "number",
  };
  if (explicit) spec.range = explicit;
  if (column.decimal_places !== undefined) spec.decimals = column.decimal_places;
  if (column.hint) spec.hint = column.hint;
  return spec;
}

function buildParam(
  experimentId: string,
  methodId: string,
  param: RawParam
): TableParamSpec {
  const spec: TableParamSpec = {
    key: param.key,
    label: param.label,
    unit: param.unit ?? "",
  };
  const range = param.expected_range
    ? { min: param.expected_range[0], max: param.expected_range[1] }
    : rangeFor(experimentId, methodId, param.key);
  if (range) spec.range = range;
  if (param.default !== undefined) spec.defaultValue = param.default;
  if (param.hint) spec.hint = param.hint;
  return spec;
}

function clampMinRows(minRows: number | undefined, defaultRows: number): number {
  const min = Math.max(1, Math.floor(minRows ?? 1));
  return Math.min(min, Math.max(1, defaultRows));
}

/** Derives one table per method from a generic experiment config. */
export function buildGenericSpec(config: GenericConfig): ExperimentSpec {
  const methods = config.methods ?? [];
  const tables: TableSpec[] = methods.map((method) => {
    const defaultRows = Math.max(1, method.rowCount ?? 1);
    return {
      tableId: method.id,
      methodId: method.id,
      title: method.name,
      ...(method.description ? { note: method.description } : {}),
      columns: (method.columns ?? []).map((column) =>
        buildColumn(config.id, method.id, column)
      ),
      defaultRows,
      minRows: clampMinRows(method.minRows, defaultRows),
      params: (method.params ?? []).map((param) =>
        buildParam(config.id, method.id, param)
      ),
      ...(method.prefill ? { prefill: method.prefill } : {}),
    };
  });

  return {
    id: config.id,
    name: config.name,
    category: config.category ?? "",
    description: config.description ?? "",
    tables,
    setupParams: [],
    backendResults: methods.flatMap((method) =>
      (method.results ?? []).map((result) => ({
        methodId: method.id,
        key: result.key,
        label: result.label,
        unit: result.unit ?? "",
      }))
    ),
  };
}

/** Derives the value of a row-order column (角度列) for a 0-based row index. */
export function rowIndexValue(column: TableColumnSpec, rowIndex: number): number | undefined {
  if (!column.rowIndex) return undefined;
  const raw = column.rowIndex.start + column.rowIndex.step * rowIndex;
  if (column.rowIndex.wrap && column.rowIndex.wrap > 0) {
    return ((raw % column.rowIndex.wrap) + column.rowIndex.wrap) % column.rowIndex.wrap;
  }
  return raw;
}

/** Visible data columns (all declared columns are part of the artifact). */
export function dataColumns(table: TableSpec): TableColumnSpec[] {
  return table.columns;
}

export function findTable(spec: ExperimentSpec, tableId: string): TableSpec | undefined {
  return spec.tables.find((table) => table.tableId === tableId);
}

export function findColumn(table: TableSpec, key: string): TableColumnSpec | undefined {
  return table.columns.find((column) => column.key === key);
}
