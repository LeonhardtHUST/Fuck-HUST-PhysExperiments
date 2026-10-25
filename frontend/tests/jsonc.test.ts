import test from "node:test";
import assert from "node:assert/strict";

import {
  JsoncParseError,
  normalizeJsonc,
  parseJsonc,
  removeTrailingCommas,
  stripCodeFence,
  stripJsoncComments,
  stringifyJson,
  tryParseJsonc,
} from "../src/lib/jsonc.ts";

test("stripCodeFence unwraps jsonc/json fences and keeps plain text", () => {
  assert.equal(stripCodeFence("```jsonc\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(stripCodeFence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(stripCodeFence("{\"a\":1}"), "{\"a\":1}");
  assert.equal(stripCodeFence("\uFEFF{\"a\":1}"), "{\"a\":1}");
});

test("stripJsoncComments removes line and block comments", () => {
  const source = `{
    // 表级备注
    "a": 1, /* 行内注释 */
    "b": 2
  }`;
  assert.equal(stripJsoncComments(source).includes("表级备注"), false);
  assert.equal(stripJsoncComments(source).includes("行内注释"), false);
  assert.equal(parseJsonc(source) instanceof Object, true);
  assert.deepEqual(parseJsonc(source), { a: 1, b: 2 });
});

test("stripJsoncComments leaves // and /* */ inside strings untouched", () => {
  const value = { url: "http://example.com//path", note: "a /* b */ c", slash: "//" };
  const source = JSON.stringify(value, null, 2);
  assert.deepEqual(parseJsonc(source), value);

  const commented = `{"url":"http://x//y","note":"/* not a comment */"}`;
  assert.deepEqual(parseJsonc(commented), { url: "http://x//y", note: "/* not a comment */" });
});

test("stripJsoncComments handles escaped quotes before a comment", () => {
  const source = `{"q":"say \\"hi\\" // still text","n":1}`;
  assert.deepEqual(parseJsonc(source), { q: 'say "hi" // still text', n: 1 });
});

test("removeTrailingCommas drops commas only before closers", () => {
  assert.equal(removeTrailingCommas('{"a":1,}'), '{"a":1 }');
  assert.equal(removeTrailingCommas('{"a":1,"b":2}'), '{"a":1,"b":2}');
  assert.deepEqual(parseJsonc('{"rows":[1,2,3,],"note":"x, }",}'), {
    rows: [1, 2, 3],
    note: "x, }",
  });
});

test("normalizeJsonc handles fence + comments + trailing commas together", () => {
  const text = "```jsonc\n{\n  // 说明\n  \"rows\": [\n    {\"l\": 1},\n  ],\n}\n```";
  assert.deepEqual(parseJsonc(text), { rows: [{ l: 1 }] });
  assert.equal(normalizeJsonc(text).includes("//"), false);
});

test("parseJsonc reports a line number for broken input", () => {
  const broken = '{\n  "a": 1\n  "b": 2\n}';
  assert.throws(
    () => parseJsonc(broken),
    (error: unknown) =>
      error instanceof JsoncParseError && error.line >= 2 && error.message.includes("解析失败")
  );
});

test("parseJsonc rejects empty input", () => {
  assert.throws(() => parseJsonc("   \n// only a comment\n"), /内容为空/);
});

test("tryParseJsonc returns ok/error instead of throwing", () => {
  const good = tryParseJsonc<{ rows: number[] }>('{"rows":[1,2]}');
  assert.equal(good.ok, true);
  if (good.ok) assert.deepEqual(good.value.rows, [1, 2]);

  const bad = tryParseJsonc("{oops}");
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(typeof bad.line, "number");
    assert.equal(bad.column >= 1, true);
  }
});

test("stringifyJson round-trips strict JSON with a trailing newline", () => {
  const value = { schemaVersion: 1, tables: { "air-0": { rows: [{ l: 1.5 }] } } };
  const text = stringifyJson(value);
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text), value);
});
