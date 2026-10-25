import test from "node:test";
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
  assert.equal(strict.tables[table.tableId].rows[0][keyA], 12.345);

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
  assert.equal(result.computed["custom.delta"].value, 4.2);
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
