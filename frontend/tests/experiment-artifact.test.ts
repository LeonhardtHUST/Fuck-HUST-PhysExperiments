import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsonc } from "../src/lib/jsonc.ts";
import {
  buildArtifact,
  decodeArtifact,
  encodeArtifact,
  sanitizeExperimentRemarks,
} from "../src/lib/experiment-artifact.ts";
import {
  buildExperimentSchemaJsonc,
  buildTableSchemaJsonc,
} from "../src/lib/experiment-schema.ts";
import { buildPrompt } from "../src/lib/experiment-prompt.ts";
import { buildSoundLightSpec } from "../src/lib/soundlight-layouts.ts";
import { buildPolarizationSpec } from "../src/lib/polarization-spec.ts";
import { buildGenericSpec, type ExperimentSpec } from "../src/lib/table-specs.ts";
import {
  mergeArtifactNotes,
  pickScopedResult,
  scopeExperimentSpec,
} from "../src/lib/artifact-scope.ts";
import type { PromptContext } from "../src/lib/prompt-context.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "../../backend/experiments");

function readJson(experimentDir: string, file: string): unknown {
  return JSON.parse(readFileSync(path.join(backendDir, experimentDir, file), "utf8"));
}

const michelson = buildGenericSpec(readJson("michelson", "config.json") as never);
const soundLight = buildSoundLightSpec(readJson("soundlight", "config.json") as never, {
  id: "sound-light",
  name: "声速光速的测量",
  category: "波动",
  description: "声速与光速",
});
const polarization = buildPolarizationSpec(readJson("polarization", "config.json") as never);

const specs: ExperimentSpec[] = [michelson, soundLight, polarization];

test("schema is deterministic, valid JSONC and lists every table", () => {
  for (const spec of specs) {
    const first = buildExperimentSchemaJsonc(spec);
    const second = buildExperimentSchemaJsonc(spec);
    assert.equal(first, second, `${spec.id}: schema not deterministic`);

    const parsed = parseJsonc<{ tables: Record<string, unknown> }>(first);
    assert.deepEqual(Object.keys(parsed.tables), spec.tables.map((table) => table.tableId));
    for (const tableId of Object.keys(parsed.tables)) {
      const table = parsed.tables[tableId] as { rows: unknown[] };
      assert.deepEqual(table.rows, [], `${spec.id}/${tableId}: schema must not fabricate rows`);
    }
  }
});

test("decoding a blank schema yields zero rows instead of an error", () => {
  const result = decodeArtifact(soundLight, buildExperimentSchemaJsonc(soundLight));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stats.tableCount, soundLight.tables.length);
  assert.equal(result.stats.rowCount, 0);
  assert.equal(result.warnings.length, 0);
});

test("single-table schema only contains that table", () => {
  const text = buildTableSchemaJsonc(michelson, michelson.tables[1].tableId);
  const parsed = parseJsonc<{ tables: Record<string, unknown> }>(text);
  assert.deepEqual(Object.keys(parsed.tables), [michelson.tables[1].tableId]);
});

test("table scope narrows both the spec and the decoded artifact", () => {
  const first = michelson.tables[0];
  const target = michelson.tables[1];
  const scope = { kind: "table" as const, tableId: target.tableId, title: target.title };

  const scopedSpec = scopeExperimentSpec(michelson, scope);
  assert.deepEqual(scopedSpec.tables.map((table) => table.tableId), [target.tableId]);
  assert.deepEqual(
    scopedSpec.backendResults.map((result) => result.methodId),
    michelson.backendResults
      .filter((result) => result.methodId === target.methodId)
      .map((result) => result.methodId)
  );

  const artifact = buildArtifact(michelson, {
    tables: {
      [first.tableId]: { rows: [{ [first.columns[0].key]: 1 }] },
      [target.tableId]: { rows: [{ [target.columns[0].key]: 2 }] },
    },
  });
  const decoded = decodeArtifact(michelson, JSON.stringify(artifact));
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;

  const scoped = pickScopedResult(decoded, scope);
  assert.deepEqual(scoped.tables.map((table) => table.tableId), [target.tableId]);
  assert.equal(scoped.stats.tableCount, 1);
  assert.equal(scoped.stats.rowCount, 1);
});

test("importing one table keeps notes of tables the file does not mention", () => {
  const untouched = michelson.tables[0];
  const target = michelson.tables[1];
  const artifact = buildArtifact(michelson, {
    tables: { [target.tableId]: { rows: [] } },
  });
  const decoded = decodeArtifact(michelson, JSON.stringify(artifact));
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;

  const merged = mergeArtifactNotes(
    {
      remarks: { summary: "实验级保留" },
      tableRemarks: { [untouched.tableId]: { status: "ok", summary: "未涉及的表" } },
      computed: { "wavelength.fit_r2": { source: "ai", value: 0.9998 } },
    },
    decoded
  );
  assert.equal(merged.remarks?.summary, "实验级保留");
  assert.equal(merged.tableRemarks[untouched.tableId]?.summary, "未涉及的表");
  assert.equal(merged.computed["wavelength.fit_r2"]?.value, 0.9998);
});

test("artifact round-trips numbers, params and remarks", () => {
  const table = michelson.tables[0];
  const keyA = table.columns[0].key;
  const artifact = buildArtifact(michelson, {
    tables: {
      [table.tableId]: {
        params: { [table.params[0]?.key ?? "temperature"]: "21.5" },
        rows: [{ [keyA]: "12.345" }, { [keyA]: "" }],
        remarks: {
          status: "suspect",
          summary: "第 2 行空缺",
          issues: [
            {
              row: 2,
              column: keyA,
              severity: "warning",
              message: "缺失读数",
              suspectedCause: "漏记",
            },
          ],
        },
      },
    },
  });

  const encoded = JSON.stringify(artifact, null, 2);
  assert.equal(encodeArtifact(michelson, { tables: { [table.tableId]: { rows: [] } } }).includes('"schemaVersion": 1'), true);
  const strict = JSON.parse(encoded);
  assert.equal(strict.experiment.id, michelson.id);
  // 数值单元格一律是字符串：数字会丢末尾 0
  assert.equal(strict.tables[table.tableId].rows[0][keyA], "12.345");

  const decoded = decodeArtifact(michelson, encoded);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  const imported = decoded.tables.find((item) => item.tableId === table.tableId);
  assert.ok(imported);
  assert.equal(imported!.rows[0][keyA], "12.345");
  assert.ok(imported!.remarks);
  assert.equal(imported!.remarks!.issues?.[0].severity, "warning");
  assert.equal(imported!.remarks!.issues?.[0].row, 2);
});

test("significand text survives export and re-import verbatim", () => {
  const table = michelson.tables[0];
  const key = table.columns[table.columns.length - 1].key;
  const samples = ["1.20", "0.000100", "1.20e-3", "12.3456789", "-0.030"];
  const artifact = buildArtifact(michelson, {
    tables: { [table.tableId]: { rows: samples.map((value) => ({ [key]: value })) } },
  });
  const encoded = JSON.stringify(artifact, null, 2);
  for (const sample of samples) {
    assert.ok(encoded.includes(`"${sample}"`), `${sample} 未被原样写出`);
  }
  const decoded = decodeArtifact(michelson, encoded);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.tables[0].rows.map((row) => row[key]), samples);
});

test("one column may keep different decimal places", () => {
  const table = michelson.tables[0];
  const key = table.columns[table.columns.length - 1].key;
  const values = ["1.20", "1.2", "1.200"];
  const artifact = buildArtifact(michelson, {
    tables: { [table.tableId]: { rows: values.map((value) => ({ [key]: value })) } },
  });
  const decoded = decodeArtifact(michelson, JSON.stringify(artifact));
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.tables[0].rows.map((row) => row[key]), values);
});

test("legacy numeric artifacts still import", () => {
  const table = michelson.tables[0];
  const key = table.columns[table.columns.length - 1].key;
  const text = JSON.stringify({
    schemaVersion: 1,
    experiment: { id: michelson.id },
    tables: { [table.tableId]: { rows: [{ [key]: 1.5 }] } },
  });
  const decoded = decodeArtifact(michelson, text);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.tables[0].rows[0][key], "1.5");
});

test("import tolerates JSONC fences, trailing commas and unknown fields", () => {
  const table = soundLight.tables[0];
  const column = table.columns[0].key;
  const text = `\`\`\`jsonc
{
  "schemaVersion": 1,
  // 从聊天窗口直接粘贴
  "experiment": { "id": "sound-light" },
  "tables": {
    "${table.tableId}": {
      "rows": [ { "${column}": 123.4, "ghost": 1 }, ],
      "params": { "unknown_param": 3 },
      "remarks": { "status": "ok", "summary": "ok" },
    },
  },
}
\`\`\``;
  const result = decodeArtifact(soundLight, text);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stats.tableCount, 1);
  assert.equal(result.tables[0].rows[0][column], "123.4");
  assert.equal(result.warnings.some((warning) => warning.includes("ghost")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("unknown_param")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("未出现在文件中")), true);
});

test("import rejects mismatched experiment, unsupported version and empty payloads", () => {
  const wrongExperiment = decodeArtifact(
    michelson,
    JSON.stringify({ schemaVersion: 1, experiment: { id: "gmr" }, tables: { a: { rows: [] } } })
  );
  assert.equal(wrongExperiment.ok, false);

  const wrongVersion = decodeArtifact(
    michelson,
    JSON.stringify({ schemaVersion: 9, experiment: { id: michelson.id }, tables: {} })
  );
  assert.equal(wrongVersion.ok, false);

  assert.equal(decodeArtifact(michelson, "  ").ok, false);
  assert.equal(decodeArtifact(michelson, "not json").ok, false);
  assert.equal(
    decodeArtifact(michelson, JSON.stringify({ schemaVersion: 1, experiment: { id: michelson.id }, tables: {} })).ok,
    false
  );
});

test("polarization import derives angle columns when they are omitted", () => {
  const malus = polarization.tables[0];
  const text = JSON.stringify({
    schemaVersion: 1,
    experiment: { id: "polarization" },
    setupParams: { bg_uw: 0.0543 },
    tables: { malus: { rows: [{ i_left: 10 }, { i_left: 20 }, { i_left: 30 }] } },
  });
  const result = decodeArtifact(polarization, text);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.tables[0].rows.map((row) => row.theta), ["90", "80", "70"]);
  assert.equal(result.setupParams.bg_uw, "0.0543");
  assert.ok(malus.columns[0].rowIndex);
});

test("backend computed values are ignored, ai values are kept", () => {
  const backendKey = `${michelson.tables[0].tableId}.${michelson.backendResults[0].key}`;
  const text = JSON.stringify({
    schemaVersion: 1,
    experiment: { id: michelson.id },
    tables: { [michelson.tables[0].tableId]: { rows: [] } },
    computed: {
      [backendKey]: { source: "backend", value: 123 },
      "custom.delta": { source: "ai", value: 4.2, note: "中间量" },
    },
  });
  const result = decodeArtifact(michelson, text);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.computed[backendKey], undefined);
  assert.equal(result.computed["custom.delta"].value, "4.2");
  assert.equal(result.warnings.some((warning) => warning.includes(backendKey)), true);
});

test("remarks sanitiser truncates long text and drops broken entries", () => {
  const remarks = sanitizeExperimentRemarks({
    summary: "x".repeat(900),
    suspectedCauses: ["a", "", "   "],
    issues: [
      { severity: "fatal" as never, message: "越界读数", row: 3 },
      { severity: "warning", message: "" },
    ],
  } as never);
  assert.equal(remarks.summary!.length <= 601, true);
  assert.deepEqual(remarks.suspectedCauses, ["a"]);
  assert.equal(remarks.issues?.length, 1);
  assert.equal(remarks.issues?.[0].severity, "info");
  assert.equal(remarks.issues?.[0].row, 3);
});

test("prompt embeds background, formulas, every table id and forbidden results", () => {
  const context: PromptContext = {
    experimentId: michelson.id,
    background: "迈克尔逊干涉仪用分光板把一束光分成两束，光程差改变时条纹移动。",
    methods: michelson.tables.map((table) => ({
      id: table.methodId,
      name: table.title,
      formulas: [`${table.methodId} 的公式：λ = 2Δd / N`],
    })),
    commonMistakes: ["读数前未预热激光器"],
  };
  const prompt = buildPrompt(michelson, context);
  assert.equal(prompt, buildPrompt(michelson, context));
  assert.equal(prompt.includes("迈克尔逊干涉仪用分光板"), true);
  assert.equal(prompt.includes("λ = 2Δd / N"), true);
  assert.equal(prompt.includes("读数前未预热激光器"), true);
  for (const table of michelson.tables) assert.equal(prompt.includes(table.tableId), true);
  for (const result of michelson.backendResults) {
    assert.equal(prompt.includes(result.key), true);
  }
  assert.equal(prompt.includes("```jsonc"), true);
  assert.equal(prompt.includes("remarks"), true);
});

test("prompt without context still contains the schema and rules", () => {
  const prompt = buildPrompt(polarization);
  assert.equal(prompt.includes("schemaVersion"), true);
  assert.equal(prompt.includes("malus"), true);
  assert.equal(prompt.includes("本实验的数据表"), true);
});

test("prompt defaults to the photo variant and references the record sheet", () => {
  const prompt = buildPrompt(polarization);
  assert.equal(prompt.includes("记录纸的照片或扫描件"), true);
  assert.equal(prompt.includes("看不清的格子写 null"), true);
  assert.equal(prompt.includes("数据来源：记录纸照片"), true);
});

test("electronic prompt drops the photo-only constraints", () => {
  const prompt = buildPrompt(michelson, undefined, { source: "electronic" });
  // 照片版的取数约束不应出现
  assert.equal(prompt.includes("记录纸的照片或扫描件"), false);
  assert.equal(prompt.includes("看不清的格子"), false);
  assert.equal(prompt.includes("只依据图片内容"), false);
  assert.equal(prompt.includes("读数分辨率按记录纸保留"), false);
  // 换成电子数据特有的约束
  assert.equal(prompt.includes("数据来源：电子数据"), true);
  assert.equal(prompt.includes("仪器导出文件"), true);
  assert.equal(prompt.includes("占位符与无效值"), true);
  assert.equal(prompt.includes("按实际数据条数输出"), true);
  // 骨架（表 id / schema / 禁止字段 / 输出格式）仍然完整
  for (const table of michelson.tables) assert.equal(prompt.includes(table.tableId), true);
  assert.equal(prompt.includes("```jsonc"), true);
  assert.equal(prompt.includes("## 十、JSONC 模板（填写目标）"), true);
});

test("schema and both prompt variants demand string readouts", () => {
  const schema = buildExperimentSchemaJsonc(michelson);
  assert.equal(schema.includes('示例 {"fringe_count":"1.20"}'), true);
  assert.equal(schema.includes("数值一律写成字符串"), true);

  for (const source of ["photo", "electronic"] as const) {
    const prompt = buildPrompt(michelson, undefined, { source });
    assert.equal(prompt.includes("写成字符串"), true, `${source}: 缺少字符串要求`);
    assert.equal(prompt.includes("末尾 0"), true, `${source}: 缺少末尾 0 要求`);
    assert.equal(prompt.includes("统一成相同位数"), true, `${source}: 缺少「不要统一位数」`);
  }
});

test("the two prompt variants differ but stay deterministic", () => {
  const context: PromptContext = {
    experimentId: polarization.id,
    background: "偏振光通过检偏器，光强随角度按马吕斯定律变化。",
    methods: [{ id: "malus", name: "马吕斯定律", formulas: ["I = I0 cos²θ"] }],
  };
  const photo = buildPrompt(polarization, context, { source: "photo" });
  const electronic = buildPrompt(polarization, context, { source: "electronic" });
  assert.notEqual(photo, electronic);
  assert.equal(electronic, buildPrompt(polarization, context, { source: "electronic" }));
  // 共用章节两边都在，且公式不会因为换版本而丢失
  for (const shared of ["## 一、实验来龙去脉", "## 四、本实验的数据表", "## 七、remarks", "I = I0 cos²θ"]) {
    assert.equal(photo.includes(shared), true);
    assert.equal(electronic.includes(shared), true);
  }
});
