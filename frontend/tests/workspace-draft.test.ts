import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPolarizationSpec } from "../src/lib/polarization-spec.ts";
import { buildGenericSpec } from "../src/lib/table-specs.ts";
import {
  DRAFT_KEY_PREFIX,
  MAX_DRAFT_CELL_CHARS,
  MAX_DRAFT_ROWS,
  buildDraft,
  clearAllDrafts,
  draftStorageKey,
  emptyDraft,
  gridToRows,
  listDraftExperimentIds,
  readDraft,
  removeDraft,
  rowsToGrid,
  serializeDraft,
  writeDraft,
  type DraftPayload,
  type StorageLike,
} from "../src/lib/workspace-draft.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "../../backend/experiments");

function readJson(experimentDir: string): unknown {
  return JSON.parse(readFileSync(path.join(backendDir, experimentDir, "config.json"), "utf8"));
}

const polarization = buildPolarizationSpec(readJson("polarization") as never);
const generic = buildGenericSpec(readJson("michelson") as never);

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  failNextSet: Error | null = null;

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failNextSet) {
      const error = this.failNextSet;
      this.failNextSet = null;
      throw error;
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function payloadOf(spec = generic): DraftPayload {
  return emptyDraft(spec);
}

test("emptyDraft mirrors the pristine workspace state", () => {
  const draft = emptyDraft(polarization);
  assert.deepEqual(Object.keys(draft.tables).sort(), ["circular", "halfwave", "malus", "quarterwave"]);
  assert.equal(draft.tables.malus.rows.length, 10);
  assert.equal(draft.tables.halfwave.rows.length, 6);
  assert.equal(draft.tables.quarterwave.rows.length, 36);
  // 角度列由行序推导，初始就要和界面一致
  assert.equal(draft.tables.malus.rows[0].theta ?? Object.values(draft.tables.malus.rows[0])[0], "90");
  assert.equal(draft.setupParams.theta_qwp, "30");
  assert.equal(draft.notes.remarks, null);

  const table = generic.tables[0];
  const empty = emptyDraft(generic).tables[table.tableId];
  assert.equal(empty.rows.length, table.defaultRows);
  assert.deepEqual(
    Object.keys(empty.params).sort(),
    table.params.map((param) => param.key).sort()
  );
});

test("buildDraft keeps half-typed strings and trailing blank rows", () => {
  const table = generic.tables[0];
  const key = table.columns[0].key;
  const draft = buildDraft(generic, {
    tables: {
      [table.tableId]: {
        rows: [{ [key]: "-" }, { [key]: "1e" }, { [key]: "" }],
        params: {},
      },
    },
  });
  assert.equal(draft.tables[table.tableId].rows.length, 3);
  assert.equal(draft.tables[table.tableId].rows[0][key], "-");
  assert.equal(draft.tables[table.tableId].rows[1][key], "1e");
});

test("buildDraft drops unknown tables/columns and caps sizes", () => {
  const table = generic.tables[0];
  const key = table.columns[0].key;
  const longCell = "x".repeat(MAX_DRAFT_CELL_CHARS + 50);
  const draft = buildDraft(generic, {
    setupParams: { nope: "1" },
    tables: {
      ghost: { rows: [{ a: "1" }], params: {} },
      [table.tableId]: {
        rows: Array.from({ length: MAX_DRAFT_ROWS + 20 }, () => ({ [key]: longCell, ghost: "1" })),
        params: { ghost: "1" },
      },
    },
  });
  assert.equal(draft.tables.ghost, undefined);
  assert.equal(draft.tables[table.tableId].rows.length, MAX_DRAFT_ROWS);
  assert.equal(draft.tables[table.tableId].rows[0][key].length, MAX_DRAFT_CELL_CHARS);
  assert.equal(draft.tables[table.tableId].rows[0].ghost, undefined);
  assert.equal(draft.tables[table.tableId].params.ghost, undefined);
  assert.deepEqual(draft.setupParams, {});
});

test("buildDraft sanitises imported notes", () => {
  const draft = buildDraft(generic, {
    notes: {
      remarks: { summary: "  多次测量偏小  " },
      tableRemarks: { nope: { summary: "x" }, [generic.tables[0].tableId]: { status: "suspect", summary: "漏测" } },
      computed: {
        good: { source: "ai", label: " 折射率 ", value: 1.5, unit: "1" },
        bad: { source: "ai", label: "空值" },
      },
    },
  });
  assert.deepEqual(draft.notes.remarks, { summary: "多次测量偏小" });
  assert.deepEqual(draft.notes.tableRemarks[generic.tables[0].tableId], {
    status: "suspect",
    summary: "漏测",
  });
  assert.equal(draft.notes.computed.good.value, 1.5);
  assert.equal(draft.notes.computed.good.label, "折射率");
  assert.deepEqual(draft.notes.computed.bad, { source: "ai", label: "空值" });
});

test("writeDraft / readDraft round-trip through one key per experiment", () => {
  const storage = new MemoryStorage();
  const payload = buildDraft(generic, {
    tables: {
      [generic.tables[0].tableId]: {
        rows: [{ [generic.tables[0].columns[0].key]: "42" }],
        params: {},
      },
    },
  });
  const result = writeDraft(storage, generic.id, payload, 1_700_000_000_000);
  assert.equal(result.ok, true);
  assert.ok(storage.getItem(`${DRAFT_KEY_PREFIX}${generic.id}`));
  assert.equal(storage.getItem(`${DRAFT_KEY_PREFIX}${generic.id}`)?.includes('"version":1'), true);

  const read = readDraft(storage, generic);
  assert.equal(read.status, "ok");
  if (read.status !== "ok") return;
  assert.equal(read.draft.experimentId, generic.id);
  assert.equal(read.draft.savedAt, 1_700_000_000_000);
  assert.equal(read.draft.tables[generic.tables[0].tableId].rows[0][generic.tables[0].columns[0].key], "42");
  assert.equal(serializeDraft(generic, read.draft), serializeDraft(generic, payload));
});

test("readDraft rejects stale, foreign and broken drafts", () => {
  const storage = new MemoryStorage();
  const key = draftStorageKey(generic.id);

  storage.setItem(key, "{not json");
  assert.equal(readDraft(storage, generic).status, "invalid");

  storage.setItem(key, JSON.stringify({ version: 99, experimentId: generic.id, tables: {} }));
  assert.equal(readDraft(storage, generic).status, "invalid");

  storage.setItem(key, JSON.stringify({ version: 1, experimentId: "someone-else", tables: {} }));
  assert.equal(readDraft(storage, generic).status, "invalid");

  storage.setItem(key, JSON.stringify({ version: 1, experimentId: generic.id, tables: "nope" }));
  const coerced = readDraft(storage, generic);
  assert.equal(coerced.status, "ok");
  if (coerced.status === "ok") {
    assert.equal(coerced.draft.tables[generic.tables[0].tableId].rows.length, generic.tables[0].defaultRows);
  }

  assert.equal(readDraft(new MemoryStorage(), generic).status, "empty");
  assert.equal(readDraft(null, generic).status, "empty");
});

test("writeDraft degrades instead of throwing", () => {
  const payload = payloadOf();
  assert.deepEqual(writeDraft(null, generic.id, payload), { ok: false, reason: "unavailable" });

  const storage = new MemoryStorage();
  const quota = new Error("quota");
  quota.name = "QuotaExceededError";
  storage.failNextSet = quota;
  assert.deepEqual(writeDraft(storage, generic.id, payload), { ok: false, reason: "quota" });

  const huge = payloadOf();
  huge.notes.remarks = { summary: "x".repeat(200) };
  const table = generic.tables[0];
  huge.tables[table.tableId].rows = Array.from({ length: MAX_DRAFT_ROWS }, () => {
    const row: Record<string, string> = {};
    for (const column of table.columns) row[column.key] = "9".repeat(MAX_DRAFT_CELL_CHARS);
    return row;
  });
  const tooLarge = writeDraft(storage, generic.id, huge);
  if (table.columns.length >= 2) assert.deepEqual(tooLarge, { ok: false, reason: "too-large" });
});

test("draft key scanning only touches draft keys", () => {
  const storage = new MemoryStorage();
  storage.setItem("physlab:admin-key", "secret");
  storage.setItem("physicslab-anonymous-session", "anon");
  writeDraft(storage, generic.id, payloadOf());
  writeDraft(storage, polarization.id, payloadOf(polarization));

  assert.deepEqual(listDraftExperimentIds(storage), [generic.id, polarization.id].sort());

  removeDraft(storage, generic.id);
  assert.deepEqual(listDraftExperimentIds(storage), [polarization.id]);

  const cleared = clearAllDrafts(storage);
  assert.deepEqual(cleared, [polarization.id]);
  assert.equal(listDraftExperimentIds(storage).length, 0);
  assert.equal(storage.getItem("physlab:admin-key"), "secret");
  assert.equal(storage.getItem("physicslab-anonymous-session"), "anon");
});

test("grid <-> rows keeps row-order columns authoritative", () => {
  const table = polarization.tables.find((item) => item.tableId === "malus");
  assert.ok(table);
  if (!table) return;

  const rows = gridToRows(table, [
    ["90", "1", "1"],
    ["80", "2", "2"],
  ]);
  assert.equal(rows[0][table.columns[0].key], "90");
  assert.equal(rows[1][table.columns[1].key], "2");

  const grid = rowsToGrid(table, [{ ...rows[0], [table.columns[1].key]: "9" }, rows[1]]);
  assert.deepEqual(grid[0], ["90", "9", "1"]);
  assert.deepEqual(grid[1], ["80", "2", "2"]);

  const soundLightTable = generic.tables[0];
  const withSerial = rowsToGrid(soundLightTable, [{ [soundLightTable.columns[0].key]: "5" }], { serial: true });
  assert.deepEqual(withSerial[0][0], "1");
  assert.deepEqual(withSerial[0][1], "5");
  assert.equal(withSerial[0].length, soundLightTable.columns.length + 1);

  const stripped = gridToRows(soundLightTable, [["1", "5"]], 1);
  assert.equal(stripped.length, 1);
  assert.equal(Object.values(stripped[0])[0], "5");
});
