import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function source(relative: string): string {
  return readFileSync(path.resolve(here, "..", relative), "utf8");
}

test("数据录入不再用 type=number（会吞掉半成品输入与末尾 0）", () => {
  for (const file of [
    "src/components/workspace/DataInputTable.tsx",
    "src/components/workspace/OcrTableImporter.tsx",
  ]) {
    const text = source(file);
    assert.equal(/type="number"/.test(text), false, `${file} 仍然使用 type="number"`);
    assert.equal(/step="any"/.test(text), false, `${file} 仍然设置 step`);
    assert.equal(/type="text"/.test(text), true, `${file} 应改为 text 输入`);
  }
});

test("输入框保留小数键盘提示，且不自动纠正大小写/拼写", () => {
  const table = source("src/components/workspace/DataInputTable.tsx");
  assert.equal(table.includes("inputMode"), true);
  assert.equal(table.includes("autoComplete=\"off\""), true);
  assert.equal(table.includes("spellCheck={false}"), true);
});
