import { test } from "vite-plus/test";
import assert from "node:assert/strict";

import { applyImportedRow, recordsToGrid } from "../src/lib/polarization-grid.ts";
import type { TableColumnSpec, TableSpec } from "../src/lib/table-specs.ts";

const theta: TableColumnSpec = {
  key: "theta",
  label: "θ",
  unit: "°",
  kind: "number",
  rowIndex: { start: 90, step: -10 },
};
const intensity: TableColumnSpec = { key: "i_left", label: "I 左", unit: "μW", kind: "number" };

const table: TableSpec = {
  tableId: "malus",
  methodId: "malus",
  title: "马吕斯定律",
  columns: [theta, intensity],
  defaultRows: 10,
  minRows: 1,
  params: [],
};

test("文件里的实测角度优先于行序推导", () => {
  assert.equal(applyImportedRow(theta, "89.5", 0), "89.5");
  assert.equal(applyImportedRow(theta, " 80.0 ", 1), "80.0");
});

test("缺失的角度才按行序补", () => {
  assert.equal(applyImportedRow(theta, "", 1), "80");
  assert.equal(applyImportedRow(theta, undefined, 2), "70");
  assert.equal(applyImportedRow(theta, null, 3), "60");
});

test("普通列不做任何推导", () => {
  assert.equal(applyImportedRow(intensity, "1.20", 0), "1.20");
  assert.equal(applyImportedRow(intensity, "", 0), "");
});

test("整表转换保留每格原始位数", () => {
  const grid = recordsToGrid(table, [
    { theta: "89.5", i_left: "1.20" },
    { theta: "", i_left: "0.000100" },
    { theta: "70.0", i_left: "" },
  ]);
  assert.deepEqual(grid, [
    ["89.5", "1.20"],
    ["80", "0.000100"],
    ["70.0", ""],
  ]);
});
