import { test } from "vite-plus/test";
import assert from "node:assert/strict";

import {
  appendRow,
  blankRow,
  filledRowCount,
  isRowEmpty,
  removeRowAt,
  trimTrailingEmptyRows,
} from "../src/components/workspace/table-rows.ts";

const rows = [
  ["1", "100.11"],
  ["2", "108.62"],
  ["3", "117.04"],
];

test("appendRow keeps the width and continues the serial column", () => {
  const next = appendRow(rows, { indexColumn: 0 });
  assert.equal(next.length, 4);
  assert.deepEqual(next[3], ["4", ""]);
  // 原数组不被修改
  assert.equal(rows.length, 3);
});

test("appendRow falls back to the requested width for an empty table", () => {
  assert.deepEqual(appendRow([], { columns: 3 }), [["", "", ""]]);
  assert.deepEqual(blankRow(2), ["", ""]);
});

test("removeRowAt renumbers the serial column and keeps the data order", () => {
  const next = removeRowAt(rows, 1, { indexColumn: 0 });
  assert.deepEqual(next, [
    ["1", "100.11"],
    ["2", "117.04"],
  ]);
});

test("removeRowAt refuses to go below minRows", () => {
  const two = removeRowAt(
    [
      ["1", "1"],
      ["2", "2"],
    ],
    0,
    { indexColumn: 0, minRows: 2 }
  );
  assert.equal(two.length, 2);
  assert.deepEqual(two[0], ["1", "1"]);
  // 越界删除同样被忽略
  assert.equal(removeRowAt(rows, 9, { indexColumn: 0 }).length, 3);
});

test("removeRowAt does not touch a non-numeric auto column", () => {
  // 偏振光实验首列是角度（由 10° 步长推导），不能被当成序号重排
  const angles = [
    ["0", "1.2"],
    ["10", "2.4"],
    ["20", "3.6"],
  ];
  const next = removeRowAt(angles, 0, { indexColumn: 0 });
  assert.deepEqual(next, [
    ["10", "2.4"],
    ["20", "3.6"],
  ]);
});

test("trimTrailingEmptyRows only trims the tail and keeps inner gaps", () => {
  const matrix = [
    ["1", "100.11"],
    ["2", ""],
    ["3", "117.04"],
    ["4", ""],
    ["5", ""],
  ];
  assert.deepEqual(trimTrailingEmptyRows(matrix, { ignoreColumns: [0] }), [
    ["1", "100.11"],
    ["2", ""],
    ["3", "117.04"],
  ]);
});

test("trimTrailingEmptyRows respects keep and the ignored serial column", () => {
  const matrix = [
    ["1", "100.11"],
    ["2", ""],
    ["3", ""],
  ];
  // 序号列不算“内容”，否则永远裁不掉
  assert.equal(trimTrailingEmptyRows(matrix, { ignoreColumns: [0] }).length, 1);
  assert.equal(trimTrailingEmptyRows(matrix, { ignoreColumns: [0], keep: 2 }).length, 2);
  assert.equal(trimTrailingEmptyRows(matrix).length, 3);
});

test("isRowEmpty / filledRowCount ignore the requested columns", () => {
  assert.equal(isRowEmpty(["7", "  "], { ignoreColumns: [0] }), true);
  assert.equal(isRowEmpty(["7", "1"], { ignoreColumns: [0] }), false);
  assert.equal(
    filledRowCount(
      [
        ["1", "1"],
        ["2", ""],
        ["3", "3"],
      ],
      { ignoreColumns: [0] }
    ),
    2
  );
});
