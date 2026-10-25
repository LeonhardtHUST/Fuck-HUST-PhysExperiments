/**
 * Builds the one-click AI prompt: experiment background + formulas + the
 * complete JSONC schema of every table + filling rules + remarks contract.
 *
 * Pure string assembly so the workspace can `useMemo` it and node tests can
 * assert its content without touching the DOM.
 */

import { buildExperimentSchemaJsonc, computedKey } from "./experiment-schema.ts";
import type { PromptContext } from "./prompt-context.ts";
import type { ExperimentSpec } from "./table-specs.ts";

function theorySection(spec: ExperimentSpec, context?: PromptContext): string {
  const lines: string[] = ["## 一、实验来龙去脉", ""];
  lines.push(context?.background?.trim() || spec.description || `${spec.name}的测量实验。`);
  lines.push("");

  if (!context || context.methods.length === 0) return lines.join("\n");

  lines.push("## 二、计算公式与判据", "");
  const ordered = [...context.methods];
  ordered.sort((a, b) => {
    const indexA = spec.tables.findIndex((table) => table.methodId === a.id);
    const indexB = spec.tables.findIndex((table) => table.methodId === b.id);
    return (indexA < 0 ? 999 : indexA) - (indexB < 0 ? 999 : indexB);
  });

  ordered.forEach((method, index) => {
    lines.push(`### ${index + 1}. ${method.name ?? method.id}（methodId = \`${method.id}\`）`);
    for (const formula of method.formulas) lines.push(`- 公式：${formula}`);
    for (const criterion of method.criteria ?? []) lines.push(`- 判据：${criterion}`);
    for (const tip of method.tips ?? []) lines.push(`- 要点：${tip}`);
    if ((method.aiComputed ?? []).length > 0) {
      const list = (method.aiComputed ?? [])
        .map((entry) => `${entry.key}（${entry.label}${entry.unit ? ` / ${entry.unit}` : ""}）`)
        .join("、");
      lines.push(`- 允许你计算的派生量：${list}（后端不会计算这些值）`);
    }
    lines.push("");
  });

  if ((context.commonMistakes ?? []).length > 0) {
    lines.push("## 三、常见操作失误（用于误差分析，不要臆造）", "");
    for (const mistake of context.commonMistakes ?? []) lines.push(`- ${mistake}`);
    lines.push("");
  }

  return lines.join("\n");
}

function tableOverview(spec: ExperimentSpec): string {
  const lines: string[] = ["## 四、本实验的数据表", ""];
  lines.push(`共 ${spec.tables.length} 张数据表，tableId 必须与下表完全一致：`, "");
  spec.tables.forEach((table, index) => {
    const columns = table.columns.map((column) => `${column.key}=${column.label}`).join("、");
    lines.push(`${index + 1}. \`${table.tableId}\` — ${table.title}（${columns}）`);
    if (table.note) lines.push(`   - 说明：${table.note}`);
    lines.push(`   - 行数：至少 ${table.minRows} 行，推荐 ${table.defaultRows} 行`);
    if (table.params.length > 0) {
      const params = table.params
        .map((param) => `${param.key}=${param.label}${param.unit ? `/${param.unit}` : ""}`)
        .join("、");
      lines.push(`   - 附加参数：${params}`);
    }
  });
  lines.push("");
  return lines.join("\n");
}

function forbiddenResults(spec: ExperimentSpec): string {
  if (spec.backendResults.length === 0) return "";
  const groups = new Map<string, string[]>();
  for (const result of spec.backendResults) {
    const list = groups.get(result.methodId) ?? [];
    list.push(`${result.key}（${result.label}${result.unit ? ` / ${result.unit}` : ""}）`);
    groups.set(result.methodId, list);
  }
  const lines: string[] = ["## 六、禁止填写的结果字段（系统会自动计算）", ""];
  for (const [methodId, list] of groups) {
    lines.push(`- \`${methodId}\`：${list.join("、")}`);
  }
  lines.push("");
  lines.push(
    "这些量由系统在提交后计算并用于报告，你不必计算、也不要把它们写进 computed；即使你算了也不算数。"
  );
  lines.push("");
  return lines.join("\n");
}

function rulesSection(spec: ExperimentSpec, context?: PromptContext): string {
  const lines: string[] = ["## 五、填写规则", ""];
  lines.push(
    "1. 只填写记录纸上能直接读到的量（刻度、示数、时间、角度等）；读数分辨率按记录纸保留，不要四舍五入成「好看」的数。"
  );
  lines.push("2. 单位为表内标注单位；换算出错比不填更糟，拿不准就在 remarks 里说明。");
  lines.push(
    `3. rows 按记录纸顺序，每行一个对象；缺失值写 null，不要编造、不要外推、不要补零；每表至少 ${Math.min(
      ...spec.tables.map((table) => table.minRows)
    )} 行（各表要求见第四节）。`
  );
  const derived = spec.tables.flatMap((table) =>
    table.columns.filter((column) => column.rowIndex).map((column) => `${table.tableId}.${column.key}`)
  );
  if (derived.length > 0) {
    lines.push(
      `4. 以下列由行序自动推导，若记录纸上有明确读数就填实际值，读不清可以省略（系统会按起始值/步长补全）：${derived.join("、")}。`
    );
  } else {
    lines.push("4. 自动序号列不需要填写。");
  }
  lines.push(
    "5. params 填表头/环境参数（温度、频率、背景光强等）；记录纸上没有的写 null，不要用理论默认值冒充实测。"
  );
  lines.push(
    "6. 如果某张表数据不足以作图（行数不足、整列空缺、数值明显越界），仍要输出该表，但在表级 remarks 里写 status: \"incomplete\" 或 \"suspect\" 并说明原因。"
  );
  if (spec.setupParams.length > 0) {
    lines.push(
      `7. setupParams 为实验级参数：${spec.setupParams
        .map((param) => param.key)
        .join("、")}，有读数就填。`
    );
  }
  lines.push("");
  const aiComputed = (context?.methods ?? []).flatMap((method) =>
    (method.aiComputed ?? []).map((entry) => computedKey(method.id, entry.key))
  );
  lines.push(
    aiComputed.length > 0
      ? `8. computed 仅允许填这些后端不计算的派生量：${aiComputed.join("、")}，并保留 source: "ai"。`
      : "8. computed 里的字段全部由系统计算，请保持原样，不要填写任何计算结果。"
  );
  lines.push("");
  return lines.join("\n");
}

function remarksSection(): string {
  return [
    "## 七、remarks：把数据问题反馈给用户",
    "",
    "remarks 是本任务的重点之一，前端会把它们渲染成提示卡片。请在三种固定位置填写：",
    "",
    "- 表级 `tables.<tableId>.remarks`：`status`（ok / incomplete / suspect）、`summary`（一句话结论）、`issues[]`。",
    "- 行级 `issues[]`：`row` 为 1 基行号、`column` 为列键、`severity` 为 info / warning / error、`message` 写清楚现象、`suspectedCause` 写可能的操作失误。",
    "- 实验级 `remarks`：跨表问题写进 `issues[]`（可带 `table`），整体结论写 `summary`，可能来源写进 `suspectedCauses[]`。",
    "",
    "示例（不要照抄数值）：",
    "```jsonc",
    `"remarks": {
  "summary": "第 2 张表后 3 行与前段趋势不连续，可能是移动反射镜时回程差",
  "suspectedCauses": ["读数前未等示波器波形稳定", "游标卡尺未归零"],
  "issues": [
    { "table": "light_sine-1", "row": 4, "column": "dt", "severity": "warning", "message": "Δt 约为相邻行的 3 倍", "suspectedCause": "相位差读数时误将 2π 周期记为一个周期" }
  ]
}`,
    "```",
    "",
    "只写有依据的判断：没有把握时用 info，不要虚构不存在的问题。",
    "",
  ].join("\n");
}

function outputSection(spec: ExperimentSpec): string {
  return [
    "## 八、输出格式",
    "",
    "1. 只输出一个 ```jsonc 代码块，代码块外不要写任何解释。",
    "2. 严格使用第四节的 JSONC 模板结构：`schemaVersion`、`experiment`、`tables`、`remarks`，有 setupParams/computed 时一并保留。",
    "3. tableId 与列键必须逐字一致；不要新增表、不要新增列、不要改名。",
    "4. 允许保留 // 注释；尾随逗号也可以，前端会容错解析。",
    `5. 如果记录纸只能支撑部分表格，就只填这些表，其余表可以省略（前端会保持对应表格原样并在导入后提示）。`,
    "",
    "## 九、自检清单",
    "",
    "- 每张表行数是否达到最少行数？缺失行是否如实留空而不是补零？",
    "- 数值单位是否与表头一致？角度/位移的数量级是否合理？",
    "- 是否误填了第六节列出的结果字段？",
    "- 数据异常处是否都在 remarks 中给出位置与可能原因？",
    "- 输出是否是单个 jsonc 代码块、且能被 JSONC 解析器解析？",
    "",
    `（本模板对应实验：${spec.name} · ${spec.id} · schemaVersion 1）`,
    "",
  ].join("\n");
}

export function buildPrompt(spec: ExperimentSpec, context?: PromptContext): string {
  const header = [
    `# 大学物理实验数据录入任务：${spec.name}`,
    "",
    "你是一名物理实验数据录入与检查助手。我会上传本次实验记录纸的照片或扫描件；请提取读数，按下面的 JSONC 模板输出一份可直接导入前端工作台的数据 artifact。",
    "",
    "要求：",
    "- 只依据图片内容，不臆造数据；看不清的格子写 null。",
    "- 所有表格都用第四节的 tableId 与列键。",
    "- 数据异常、无法作图、疑似操作失误，一律写进 remarks（第七节）。",
    "- 不要计算系统会负责的结果（第六节）。",
    "",
  ].join("\n");

  const schemaSection = [
    "## 十、JSONC 模板（填写目标）",
    "",
    "```jsonc",
    buildExperimentSchemaJsonc(spec, context),
    "```",
    "",
  ].join("\n");

  return [
    header,
    theorySection(spec, context),
    tableOverview(spec),
    rulesSection(spec, context),
    forbiddenResults(spec),
    remarksSection(),
    outputSection(spec),
    schemaSection,
  ]
    .filter(Boolean)
    .join("\n");
}
