import { test } from "vite-plus/test";
import assert from "node:assert/strict";

import { applyOcrValues, editableCellCount } from "../src/lib/ocr-apply.ts";

test("applyOcrValues 按行优先填值，跳过只读列", () => {
  const data = [
    ["0", "", ""],
    ["10", "", ""],
  ];
  const next = applyOcrValues(data, ["12.5", "13.5", "22.5", "23.5"], {
    readOnlyColumns: [true, false, false],
    overwriteExisting: true,
  });
  assert.deepEqual(next, [
    ["0", "12.5", "13.5"],
    ["10", "22.5", "23.5"],
  ]);
  // 原数组不被改写
  assert.equal(data[0][1], "");
});

test("applyOcrValues 默认不覆盖已有手动数据，空格才填", () => {
  const data = [["0", "11", ""]];
  const next = applyOcrValues(data, ["99", "12"], {
    readOnlyColumns: [true, false, false],
    overwriteExisting: false,
  });
  assert.deepEqual(next, [["0", "11", "12"]]);
});

test("applyOcrValues 忽略空识别值，保留原格子", () => {
  const data = [["1", "2"]];
  const next = applyOcrValues(data, ["", "  "], { overwriteExisting: true });
  assert.deepEqual(next, [["1", "2"]]);
});

test("editableCellCount 与只读列一致", () => {
  const data = [
    ["0", "", ""],
    ["10", "", ""],
  ];
  assert.equal(editableCellCount(data), 6);
  assert.equal(editableCellCount(data, [true, false, false]), 4);
  assert.equal(editableCellCount(data, [true, true, true]), 0);
});
