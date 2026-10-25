/**
 * Scope helpers shared by the artifact toolbar and its import panel.
 *
 * A "table" scope reuses the very same codec: the spec is narrowed to one
 * table, so the export file only contains that table and the prompt only lists
 * that table's schema. Pure functions, no JSX — safe for node tests.
 */

import type { ExperimentSpec } from "./table-specs.ts";
import type {
  ComputedEntry,
  DecodeResult,
  ExperimentRemarks,
  TableRemarks,
} from "./experiment-artifact.ts";

export type ArtifactScope =
  | { kind: "experiment" }
  | { kind: "table"; tableId: string; title: string };

export type DecodeOk = Extract<DecodeResult, { ok: true }>;

/** Everything imported alongside the numbers, kept for read-only display. */
export interface ArtifactNotes {
  remarks: ExperimentRemarks | null;
  tableRemarks: Record<string, TableRemarks>;
  computed: Record<string, ComputedEntry>;
}

/** True when the notes carry anything worth keeping (import / draft restore). */
export function hasArtifactNotes(notes: ArtifactNotes | null | undefined): boolean {
  if (!notes) return false;
  return (
    Boolean(notes.remarks) ||
    Object.keys(notes.tableRemarks).length > 0 ||
    Object.keys(notes.computed).length > 0
  );
}

export function notesFromArtifact(result: DecodeOk): ArtifactNotes {
  const tableRemarks: Record<string, TableRemarks> = {};
  for (const table of result.tables) {
    if (table.remarks) tableRemarks[table.tableId] = table.remarks;
  }
  return { remarks: result.remarks, tableRemarks, computed: result.computed };
}

/**
 * Import overwrites only the tables present in the file; notes for untouched
 * tables (and experiment-level remarks a table-scope file does not carry) stay.
 */
export function mergeArtifactNotes(
  previous: ArtifactNotes | null,
  result: DecodeOk
): ArtifactNotes {
  const incoming = notesFromArtifact(result);
  const imported = new Set(result.tables.map((table) => table.tableId));
  const tableRemarks = { ...(previous?.tableRemarks ?? {}) };
  for (const tableId of imported) {
    if (incoming.tableRemarks[tableId]) tableRemarks[tableId] = incoming.tableRemarks[tableId];
    else delete tableRemarks[tableId];
  }
  return {
    remarks: incoming.remarks ?? previous?.remarks ?? null,
    tableRemarks,
    computed: { ...(previous?.computed ?? {}), ...incoming.computed },
  };
}

/** Narrow an experiment spec to the selected scope (unknown table ids return the full spec). */
export function scopeExperimentSpec(spec: ExperimentSpec, scope: ArtifactScope): ExperimentSpec {
  if (scope.kind === "experiment") return spec;
  const table = spec.tables.find((item) => item.tableId === scope.tableId);
  if (!table) return spec;
  return {
    ...spec,
    tables: [table],
    backendResults: spec.backendResults.filter((result) => result.methodId === table.methodId),
  };
}

/** Keep only the scoped table when a full-artifact file is pasted into a single table. */
export function pickScopedResult(result: DecodeOk, scope: ArtifactScope): DecodeOk {
  if (scope.kind === "experiment") return result;
  const tables = result.tables.filter((table) => table.tableId === scope.tableId);
  return {
    ...result,
    tables,
    stats: {
      ...result.stats,
      tableCount: tables.length,
      rowCount: tables.reduce((total, table) => total + table.rows.length, 0),
      issueCount: tables.reduce((total, table) => total + (table.remarks?.issues?.length ?? 0), 0),
    },
  };
}
