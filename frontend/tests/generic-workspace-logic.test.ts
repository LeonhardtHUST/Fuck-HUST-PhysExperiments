import { test } from "vite-plus/test";
import assert from "node:assert/strict";

import {
  appendDraftRow,
  completionState,
  isMethodComplete,
  nextGridCell,
  removeDraftRowAt,
  trimDraftRows,
  type CompletionMethod,
} from "../src/components/workspace/generic-workspace-logic.ts";

const methods: CompletionMethod[] = [
  {
    id: "required-a",
    name: "必做 A",
    required: true,
    paramKeys: ["gain"],
    columnKeys: ["x", "y"],
  },
  {
    id: "optional-b",
    name: "选做 B",
    required: false,
    paramKeys: [],
    columnKeys: ["x"],
  },
];

test("required method is incomplete until every param and table cell is filled", () => {
  const draft = {
    "required-a": {
      params: { gain: "2" },
      rows: [
        { x: "1", y: "2" },
        { x: "3", y: "" },
      ],
    },
    "optional-b": { params: {}, rows: [{ x: "" }] },
  };

  assert.deepEqual(completionState(methods, draft), {
    requiredCount: 1,
    completedRequiredCount: 0,
    requiredAllComplete: false,
    missingRequiredNames: ["必做 A"],
    completedMethodIds: [],
  });

  draft["required-a"].rows[1].y = "4";
  assert.equal(completionState(methods, draft).requiredAllComplete, true);

  draft["required-a"].params.gain = "";
  assert.equal(completionState(methods, draft).requiredAllComplete, false);
});

test("optional methods never block required report readiness", () => {
  const draft = {
    "required-a": {
      params: { gain: "2" },
      rows: [
        { x: "1", y: "2" },
        { x: "3", y: "4" },
      ],
    },
    "optional-b": { params: {}, rows: [{ x: "" }] },
  };
  const state = completionState(methods, draft);
  assert.equal(state.requiredAllComplete, true);
  assert.deepEqual(state.completedMethodIds, ["required-a"]);
});

test("trailing blank rows do not block completion when enough rows are filled", () => {
  // 默认渲染 3 行的表格，学生只录了 2 行（第 3 行留空）也应算完成
  const method: CompletionMethod = {
    id: "m",
    name: "M",
    required: true,
    paramKeys: [],
    columnKeys: ["x"],
    minRows: 2,
  };
  const draft = {
    m: {
      params: {},
      rows: [{ x: "1" }, { x: "2" }, { x: "" }],
    },
  };
  assert.equal(isMethodComplete(method, draft), true);
  assert.equal(trimDraftRows(draft.m.rows, ["x"]).length, 2);
});

test("fewer rows than minRows is incomplete and rows can be added back", () => {
  const method: CompletionMethod = {
    id: "m",
    name: "M",
    required: true,
    paramKeys: [],
    columnKeys: ["x", "y"],
    minRows: 4,
  };
  const draft = { m: { params: {}, rows: [{ x: "1", y: "1" }] } };
  assert.equal(isMethodComplete(method, draft), false);

  const added = appendDraftRow(draft.m.rows, ["x", "y"]);
  assert.deepEqual(added, [
    { x: "1", y: "1" },
    { x: "", y: "" },
  ]);
});

test("removeDraftRowAt drops a row but never below minRows", () => {
  const rows = [{ x: "1" }, { x: "2" }, { x: "3" }];
  assert.deepEqual(removeDraftRowAt(rows, 1, 1), [{ x: "1" }, { x: "3" }]);
  assert.equal(removeDraftRowAt(rows, 0, 3).length, 3);
});

test("arrow keys move in four directions and stop at table boundaries", () => {
  assert.deepEqual(nextGridCell("ArrowUp", 1, 1, 3, 3), [0, 1]);
  assert.deepEqual(nextGridCell("ArrowDown", 1, 1, 3, 3), [2, 1]);
  assert.deepEqual(nextGridCell("ArrowLeft", 1, 1, 3, 3), [1, 0]);
  assert.deepEqual(nextGridCell("ArrowRight", 1, 1, 3, 3), [1, 2]);
  assert.equal(nextGridCell("ArrowUp", 0, 1, 3, 3), null);
  assert.equal(nextGridCell("ArrowRight", 2, 2, 3, 3), null);
  assert.equal(nextGridCell("Enter", 1, 1, 3, 3), null);
});
