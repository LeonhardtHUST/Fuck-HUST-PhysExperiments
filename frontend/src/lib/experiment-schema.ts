/**
 * Deterministic JSONC templates for the artifact exchange format.
 *
 * The same generator feeds the in-app "Schema" tab and the AI prompt, so the
 * contract students hand to an assistant is byte-identical to the one the
 * decoder validates. No dates, no randomness: same spec → same text.
 */

import { jsoncComment } from "./jsonc.ts";
import type { PromptContext } from "./prompt-context.ts";
import type { ExperimentSpec, TableColumnSpec, TableParamSpec, TableSpec } from "./table-specs.ts";

export const ARTIFACT_SCHEMA_VERSION = 1;

export function computedKey(methodId: string, key: string): string {
  return `${methodId}.${key}`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function comment(label: string): string {
  return jsoncComment(label);
}

function unitSuffix(unit: string): string {
  return unit ? ` (${unit})` : "";
}

function rangeLabel(range?: { min: number; max: number; note?: string }): string {
  if (!range) return "";
  const base = `范围 ${range.min}–${range.max}`;
  return range.note ? `${base}，${range.note}` : base;
}

function columnComment(column: TableColumnSpec): string {
  const parts = [`${column.key}：${column.label}${unitSuffix(column.unit)}`];
  const range = rangeLabel(column.range);
  if (range) parts.push(range);
  if (column.kind === "text") parts.push("文本");
  if (column.rowIndex) {
    parts.push(
      `由行序自动推导（起始 ${column.rowIndex.start}°，步长 ${column.rowIndex.step}°${
        column.rowIndex.wrap ? `，${column.rowIndex.wrap}° 取模` : ""
      }），可按记录纸填写实际值`
    );
  }
  if (column.hint) parts.push(column.hint);
  const example = JSON.stringify({ [column.key]: 0 });
  return `${parts.join(" · ")}　示例 ${example}`;
}

function paramsComment(params: TableParamSpec[]): string {
  if (params.length === 0) return "本表不需要额外参数，保留空对象即可";
  const list = params.map((param) => {
    const range = rangeLabel(param.range);
    const fallback =
      param.defaultValue !== undefined ? `默认 ${JSON.stringify(param.defaultValue)}` : "必填";
    return `${param.key}=${param.label}${unitSuffix(param.unit)}（${[range, fallback].filter(Boolean).join("，")}）`;
  });
  return `参数：${list.join("；")}`;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function tableBlock(table: TableSpec, rowLines: string[]): string {
  const header = [
    comment(
      `表 ${table.tableId} ｜ ${table.title} ｜ 最少 ${table.minRows} 行，推荐 ${table.defaultRows} 行`
    ),
  ];
  if (table.note) header.push(comment(table.note));
  header.push(comment(paramsComment(table.params)));

  const params = table.params.length
    ? `"params": {\n${table.params
        .map((param) => `  ${quoted(param.key)}: null`)
        .join(",\n")}\n}`
    : `"params": {}`;

  const rows = rowLines.length ? `"rows": [\n${indent(rowLines.join("\n"), 4)}\n    ]` : `"rows": []`;

  const body = [
    `"${table.tableId}": {`,
    `${indent(params, 2)},`,
    `${indent(rows, 2)},`,
    indent(tableRemarksBlock(), 2),
    `}`,
  ].join("\n");

  return [...header, body].join("\n");
}

function tableRowHints(table: TableSpec): string[] {
  return [
    comment("每行一个对象，按记录纸顺序排列；缺失值写 null，不要编造；单位见列注释"),
    table.columns.map((column) => comment(columnComment(column))).join("\n"),
    comment(
      `至少 ${table.minRows} 行；超出推荐行数（${table.defaultRows}）也允许，系统不会截断`
    ),
  ];
}

function tableRemarksBlock(): string {
  return [
    comment("表级 remarks：status 可取 ok | incomplete | suspect"),
    comment("issues[] 的 row 为 1 基行号，column 为列键，severity 可取 info | warning | error"),
    `"remarks": {`,
    indent(
      [
        `"status": "ok",`,
        `"summary": null,`,
        `"issues": []`,
      ].join("\n"),
      2
    ),
    `}`,
  ].join("\n");
}

function setupParamsBlock(spec: ExperimentSpec): string | null {
  if (spec.setupParams.length === 0) return null;
  return [
    comment(paramsComment(spec.setupParams)),
    `"setupParams": {`,
    indent(
      spec.setupParams.map((param) => `${quoted(param.key)}: null`).join(",\n"),
      2
    ),
    `}`,
  ].join("\n");
}

function computedBlock(spec: ExperimentSpec, context?: PromptContext): string | null {
  const backend = spec.backendResults;
  const aiEntries = (context?.methods ?? []).flatMap((method) =>
    (method.aiComputed ?? []).map((entry) => ({ methodId: method.id, ...entry }))
  );
  if (backend.length === 0 && aiEntries.length === 0) return null;

  const lines: string[] = [];
  if (backend.length > 0) {
    lines.push(
      comment("以下字段由系统计算，请勿填写，也不要修改 source（保持 backend 即可）")
    );
    for (const result of backend) {
      const key = computedKey(result.methodId, result.key);
      lines.push(
        `${quoted(key)}: { "source": "backend", "label": ${quoted(result.label)}, "unit": ${quoted(result.unit)} }`
      );
    }
  }
  if (aiEntries.length > 0) {
    lines.push(comment("以下派生量后端不计算，可由 AI 填写并把 source 标为 ai；前端只作参考值展示"));
    for (const entry of aiEntries) {
      const key = computedKey(entry.methodId, entry.key);
      const hint = entry.hint ? `，${entry.hint}` : "";
      lines.push(
        `${quoted(key)}: { "source": "ai", "label": ${quoted(entry.label)}, "unit": ${quoted(entry.unit ?? "")}, "value": null } /*${hint}*/`
      );
    }
  }
  return `"computed": {\n${indent(lines.join(",\n"), 2)}\n}`;
}

function rootRemarksBlock(): string {
  return [
    comment("实验级备注：summary 写总体结论，suspectedCauses 写可能来源"),
    comment("issues[] 支持 {\"table\": \"表 id\", \"row\": 3, \"column\": \"l\", \"severity\": \"warning\", \"message\": \"…\", \"suspectedCause\": \"…\"}"),
    `"remarks": {`,
    indent([`"summary": null,`, `"suspectedCauses": [],`, `"issues": []`].join("\n"), 2),
    `}`,
  ].join("\n");
}

interface SchemaOptions {
  /** 只导出指定表（单表 Schema / 单表导出）。 */
  tableIds?: string[];
  context?: PromptContext;
  /** 单表模式下不打印 setupParams。 */
  includeSetup?: boolean;
}

function buildDocument(spec: ExperimentSpec, tables: TableSpec[], options: SchemaOptions): string {
  const blocks: string[] = [];
  blocks.push(
    [
      `"schemaVersion": ${ARTIFACT_SCHEMA_VERSION},`,
      `"experiment": {`,
      indent(
        [`"id": ${quoted(spec.id)},`, `"name": ${quoted(spec.name)},`, `"category": ${quoted(spec.category)}`].join(
          "\n"
        ),
        2
      ),
      `},`,
    ].join("\n")
  );

  if (options.includeSetup !== false) {
    const setup = setupParamsBlock(spec);
    if (setup) blocks.push(`${setup},`);
  }

  const tableText = tables
    .map((table) => indent(tableBlock(table, tableRowHints(table)), 2))
    .join(",\n\n");
  blocks.push(`"tables": {\n${tableText}\n},`);

  blocks.push(`${rootRemarksBlock()},`);

  const computed = computedBlock(spec, options.context);
  blocks.push(computed ? `${computed}` : comment("计算结果均由系统生成，无需在此填写"));

  const head = [
    comment(`===== ${spec.name}（${spec.id}）JSONC 数据模板 · schemaVersion ${ARTIFACT_SCHEMA_VERSION} =====`),
    comment(spec.description || "按表填写原始数据；remarks 用于把数据问题反馈给前端"),
    comment("允许 // 与 /* */ 注释以及尾随逗号；tableId 必须使用下列键名，未列出的表会被忽略"),
    "{",
  ].join("\n");

  return `${head}\n${indent(blocks.join("\n"), 2)}\n}`;
}

/** Full-experiment schema (all tables) — the canonical contract for prompts. */
export function buildExperimentSchemaJsonc(spec: ExperimentSpec, context?: PromptContext): string {
  return buildDocument(spec, spec.tables, { context });
}

/** Schema restricted to one table id. */
export function buildTableSchemaJsonc(
  spec: ExperimentSpec,
  tableId: string,
  context?: PromptContext
): string {
  const table = spec.tables.find((item) => item.tableId === tableId);
  if (!table) throw new Error(`未知表格：${spec.id}/${tableId}`);
  return buildDocument(spec, [table], { tableIds: [tableId], context, includeSetup: false });
}
