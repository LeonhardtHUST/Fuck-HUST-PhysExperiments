import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPolarizationSpec } from "../src/lib/polarization-spec.ts";
import { buildSoundLightSpec } from "../src/lib/soundlight-layouts.ts";
import { buildGenericSpec, rowIndexValue } from "../src/lib/table-specs.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "../../backend/experiments");

function readJson(experimentDir: string, file: string): unknown {
  return JSON.parse(readFileSync(path.join(backendDir, experimentDir, file), "utf8"));
}

const GENERIC_DIRS = [
  "multimeter",
  "bridge",
  "photoelectric",
  "franck_hertz",
  "solar_cell",
  "gmr",
  "nmr",
  "viscosity",
  "surface_tension",
  "thermal_conductivity",
  "michelson",
  "photoelectric_franck_hertz",
];

test("generic configs produce one well-formed table per method", () => {
  for (const dir of GENERIC_DIRS) {
    const config = readJson(dir, "config.json") as {
      id: string;
      methods: { id: string; rowCount: number; columns: { key: string }[]; params?: { key: string }[] }[];
    };
    const spec = buildGenericSpec(config as never);
    assert.equal(spec.id, config.id, `${dir}: id mismatch`);
    assert.equal(spec.tables.length, config.methods.length, `${dir}: methods != tables`);

    for (const method of config.methods) {
      const table = spec.tables.find((item) => item.tableId === method.id);
      assert.ok(table, `${dir}/${method.id}: missing table`);
      assert.deepEqual(
        table!.columns.map((column) => column.key),
        method.columns.map((column) => column.key),
        `${dir}/${method.id}: columns drifted`
      );
      assert.deepEqual(
        table!.params.map((param) => param.key),
        (method.params ?? []).map((param) => param.key),
        `${dir}/${method.id}: params drifted`
      );
      assert.equal(table!.defaultRows, method.rowCount, `${dir}/${method.id}: default rows`);
      assert.ok(table!.minRows >= 1 && table!.minRows <= table!.defaultRows, `${dir}/${method.id}: minRows`);
      for (const column of table!.columns) {
        assert.equal(typeof column.label, "string");
        assert.notEqual(column.label.trim(), "", `${dir}/${method.id}: empty label`);
      }
    }
  }
});

test("sound-light exposes the eight OCR table ids", () => {
  const spec = buildSoundLightSpec(readJson("soundlight", "config.json") as never, {
    id: "sound-light",
    name: "声速光速的测量",
    category: "波动",
    description: "声速与光速",
  });
  assert.deepEqual(
    spec.tables.map((table) => table.tableId),
    [
      "air_resonance-0",
      "water_phase-0",
      "tof-0",
      "light_sine-0",
      "light_sine-1",
      "light_square-0",
      "light_square-1",
      "light_lissajous-0",
    ]
  );
  for (const table of spec.tables) {
    assert.ok(table.columns.length > 0, `${table.tableId}: no data columns`);
    assert.ok(table.minRows >= 1 && table.minRows <= table.defaultRows);
  }
  assert.equal(spec.backendResults.some((result) => result.key === "v_exp"), true);
});

test("polarization declares the four workspace tables and derived angle columns", () => {
  const spec = buildPolarizationSpec(readJson("polarization", "config.json") as never);
  assert.deepEqual(
    spec.tables.map((table) => table.tableId),
    ["malus", "halfwave", "quarterwave", "circular"]
  );
  const malus = spec.tables[0];
  const theta = malus.columns[0];
  assert.deepEqual(theta.rowIndex, { start: 90, step: -10 });
  assert.equal(rowIndexValue(theta, 0), 90);
  assert.equal(rowIndexValue(theta, 2), 70);

  const halfwave = spec.tables[1];
  assert.deepEqual(
    halfwave.params.map((param) => param.key),
    ["c_deg", "c_min", "p2_deg", "p2_min"]
  );
  const phi = spec.tables[2].columns[0];
  assert.equal(rowIndexValue(phi, 35), 350);
  assert.equal(rowIndexValue(phi, 36), 0);
  assert.equal(spec.setupParams.length, 2);
  assert.equal(spec.backendResults.length > 0, true);
});

test("every experiment ships a prompt context aligned with its methods", () => {
  const source = readFileSync(path.resolve(here, "../src/lib/experiment-contexts.ts"), "utf8");
  const dirs = readdirSync(backendDir).filter(
    (entry) => existsSync(path.join(backendDir, entry, "config.json"))
  );
  for (const dir of dirs) {
    const context = readJson(dir, "prompt_context.json") as {
      experimentId: string;
      background: string;
      methods: { id: string; formulas: string[] }[];
    };
    const config = readJson(dir, "config.json") as
      | { id: string; methods?: { id: string }[]; subExperiments?: { id: string }[] }
      | { id: string }[];
    const id = Array.isArray(config) ? "sound-light" : config.id;
    assert.equal(context.experimentId, id, `${dir}: experimentId drifted`);
    assert.equal(context.background.trim().length >= 60, true, `${dir}: background too short`);
    const methods = Array.isArray(config)
      ? config
      : config.methods ?? config.subExperiments ?? [];
    assert.deepEqual(
      context.methods.map((method) => method.id).sort(),
      methods.map((method) => method.id).sort(),
      `${dir}: prompt context methods drifted from config`
    );
    for (const method of context.methods) {
      assert.ok(method.formulas.length > 0, `${dir}/${method.id}: no formulas`);
    }
    assert.equal(
      source.includes(`"${id}"`) || source.includes(`${id}:`),
      true,
      `experiment-contexts.ts is missing ${id}`
    );
  }
});

test("every backend experiment directory is wired into the runtime registry", () => {
  const source = readFileSync(path.resolve(here, "../src/lib/experiment-specs.ts"), "utf8");
  const dirs = readdirSync(backendDir).filter(
    (entry) => existsSync(path.join(backendDir, entry, "config.json"))
  );
  assert.equal(dirs.length >= 14, true);
  for (const dir of dirs) {
    const config = readJson(dir, "config.json") as { id?: string };
    // soundlight 的配置是数组，没有顶层 id
    const id = config.id ?? "sound-light";
    assert.equal(
      source.includes(`"${id}"`) || source.includes(`${id}:`),
      true,
      `registry is missing ${id}`
    );
  }
});
