/**
 * Builds the one-click AI prompt: experiment background + formulas + the
 * complete JSONC schema of every table + filling rules + remarks contract.
 *
 * Two variants share the same skeleton and differ only in the data-source
 * assumption:
 * - `photo`（默认）：用户会喂给 AI 记录纸的照片/扫描件，读数不确定，
 *   所以规则围绕「看不清就留空、按纸面分辨率保留、异常要标出来」展开；
 * - `electronic`：数据来自仪器导出文件 / CSV / Excel，数值本身是确定的，
 *   照片时代那些「防臆造」的约束不再适用，换成映射、单位换算、占位符、
 *   行数与精度这类电子数据特有的坑。
 *
 * Pure string assembly so the workspace can `useMemo` it and node tests can
 * assert its content without touching the DOM.
 */

import { buildExperimentSchemaJsonc, computedKey } from "./experiment-schema.ts";
import type { PromptContext } from "./prompt-context.ts";
import type { ExperimentSpec } from "./table-specs.ts";

/** 数据来源假设：记录纸照片 / 电子数据 */
export type PromptSource = "photo" | "electronic";

export interface PromptOptions {
  source?: PromptSource;
}

export const PROMPT_SOURCE_LABELS: Record<PromptSource, string> = {
  photo: "记录纸照片",
  electronic: "电子数据",
};

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

function derivedColumns(spec: ExperimentSpec): string[] {
  return spec.tables.flatMap((table) =>
    table.columns.filter((column) => column.rowIndex).map((column) => `${table.tableId}.${column.key}`)
  );
}

function rulesSection(spec: ExperimentSpec, context: PromptContext | undefined, source: PromptSource): string {
  const electronic = source === "electronic";
  const minRows = Math.min(...spec.tables.map((table) => table.minRows));
  const rules: string[] = [];

  if (electronic) {
    rules.push(
      "只填写电子数据里实际存在的测量量；原始列名与表内列名不一致时按物理含义对应，并在 remarks 里记录对应关系（例如 `I(μW)` → `i_left`）。"
    );
    rules.push(
      "单位为表内标注单位；电子数据的单位常写在列名或文件头里，换算错比不填更糟，做过换算就在 remarks 里写清算式（如 mA → A 乘 1e-3）。"
    );
    rules.push(
      `rows 按原始数据的记录顺序，每行一个对象；缺失值写 null，不要编造、不要外推、不要补零；每表至少 ${minRows} 行（各表要求见第四节）。同一个文件里分段或多 sheet 存放的数据，按内容拆到对应 tableId。`
    );
    rules.push(
      "占位符与无效值（空单元格、`--`、`N/A`、`NaN`、`#DIV/0!`、`∞`）一律写 null；带千分位逗号、全角符号或单位后缀的数值先规范化为纯数字。"
    );
  } else {
    rules.push(
      "只填写记录纸上能直接读到的量（刻度、示数、时间、角度等）；读数分辨率按记录纸保留，不要四舍五入成「好看」的数。"
    );
    rules.push("单位为表内标注单位；换算出错比不填更糟，拿不准就在 remarks 里说明。");
    rules.push(
      `rows 按记录纸顺序，每行一个对象；缺失值写 null，不要编造、不要外推、不要补零；每表至少 ${minRows} 行（各表要求见第四节）。`
    );
  }

  rules.push(
    "所有数值（含 params 与 computed.value）都写成字符串，逐位照抄原始读数：保留末尾 0、前导 0、估读位和科学计数法写法（如 \"1.20\"、\"0.000100\"、\"1.20e-3\"）。不要补位、不要截位，也不要把同一列的数字统一成相同位数——同列出现 \"1.20\" 与 \"1.2\" 是正常的，那是两格各自真实的读数。"
  );

  const derived = derivedColumns(spec);
  if (derived.length > 0) {
    rules.push(
      electronic
        ? `以下列由行序自动推导，原始数据里有该列就填原始值，缺失时省略（系统会按起始值/步长补全）：${derived.join("、")}。`
        : `以下列由行序自动推导，若记录纸上有明确读数就填实际值，读不清可以省略（系统会按起始值/步长补全）：${derived.join("、")}。`
    );
  } else {
    rules.push("自动序号列不需要填写。");
  }

  rules.push(
    electronic
      ? "params 填电子数据或文件头里的环境/设备参数（温度、频率、采样率、背景光强等）；数据里没有的写 null，不要用理论默认值冒充实测。"
      : "params 填表头/环境参数（温度、频率、背景光强等）；记录纸上没有的写 null，不要用理论默认值冒充实测。"
  );

  rules.push(
    "如果某张表数据不足以作图（行数不足、整列空缺、数值明显越界），仍要输出该表，但在表级 remarks 里写 status: \"incomplete\" 或 \"suspect\" 并说明原因。"
  );

  if (spec.setupParams.length > 0) {
    rules.push(`setupParams 为实验级参数：${spec.setupParams.map((param) => param.key).join("、")}，有读数就填。`);
  }

  if (electronic) {
    rules.push(
      "行数按实际数据条数输出，不要截断或补齐到记录表的默认行数；精度按原始数据保留，不要按记录表的分辨率取整。"
    );
  }

  const aiComputed = (context?.methods ?? []).flatMap((method) =>
    (method.aiComputed ?? []).map((entry) => computedKey(method.id, entry.key))
  );

  const lines: string[] = ["## 五、填写规则", ""];
  rules.forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));
  lines.push("");
  lines.push(
    aiComputed.length > 0
      ? `${rules.length + 1}. computed 仅允许填这些后端不计算的派生量：${aiComputed.join("、")}，并保留 source: "ai"。`
      : `${rules.length + 1}. computed 里的字段全部由系统计算，请保持原样，不要填写任何计算结果。`
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

function outputSection(spec: ExperimentSpec, source: PromptSource): string {
  const electronic = source === "electronic";
  const partial = electronic
    ? "5. 如果原始数据只覆盖部分表格，就只填这些表，其余表可以省略（前端会保持对应表格原样并在导入后提示）。"
    : "5. 如果记录纸只能支撑部分表格，就只填这些表，其余表可以省略（前端会保持对应表格原样并在导入后提示）。";

  const checklist = electronic
    ? [
        "- 每张表行数是否等于原始数据条数、且不少于最少行数？",
        "- 所有数值是否都写成了字符串，且末尾 0 与科学计数法写法没被改掉？",
        "- 同一列是否被擅自补零/截位、统一成了相同位数？",
        "- 占位符（`--`、`NaN`、空单元格）是否都写成了 null，而不是 0 或空字符串？",
        "- 单位是否已换算成表头单位？换算关系是否写进了 remarks？",
        "- 原始数据里多出来的列（时间戳、设备编号、重复列）是否被误塞进表内列？",
        "- 是否误填了第六节列出的结果字段？",
        "- 数据异常处是否都在 remarks 中给出位置与可能原因？",
        "- 输出是否是单个 jsonc 代码块、且能被 JSONC 解析器解析？",
      ]
    : [
        "- 每张表行数是否达到最少行数？缺失行是否如实留空而不是补零？",
        "- 所有数值是否都写成了字符串，估读位与末尾 0 是否逐位照抄、没有被四舍五入？",
        "- 同一列是否被擅自补零/截位、统一成了相同位数？",
        "- 数值单位是否与表头一致？角度/位移的数量级是否合理？",
        "- 是否误填了第六节列出的结果字段？",
        "- 数据异常处是否都在 remarks 中给出位置与可能原因？",
        "- 输出是否是单个 jsonc 代码块、且能被 JSONC 解析器解析？",
      ];

  return [
    "## 八、输出格式",
    "",
    "1. 只输出一个 ```jsonc 代码块，代码块外不要写任何解释。",
    "2. 严格使用第四节的 JSONC 模板结构：`schemaVersion`、`experiment`、`tables`、`remarks`，有 setupParams/computed 时一并保留。",
    "3. tableId 与列键必须逐字一致；不要新增表、不要新增列、不要改名。",
    "4. 允许保留 // 注释；尾随逗号也可以，前端会容错解析。",
    partial,
    "",
    "## 九、自检清单",
    "",
    ...checklist,
    "",
    `（本模板对应实验：${spec.name} · ${spec.id} · schemaVersion 1 · 数据来源：${PROMPT_SOURCE_LABELS[source]}）`,
    "",
  ].join("\n");
}

function headerSection(spec: ExperimentSpec, source: PromptSource): string {
  if (source === "electronic") {
    return [
      `# 大学物理实验数据录入任务：${spec.name}`,
      "",
      "你是一名物理实验数据录入与检查助手。我会提供本次实验的电子数据——仪器导出文件、CSV / Excel 表格，或直接贴出的数据表；数值本身是确定的，你的任务是把它们按下面的 JSONC 模板整理成一份可直接导入前端工作台的数据 artifact，并指出其中不自洽的地方。",
      "",
      "要求：",
      "- 只依据我给的数据与其表头（列名、单位）映射，不臆造缺失值；数据里没有的格子写 null。",
      "- 数值按原始数据原样保留（有效数字、科学计数法、小数位都不要改），不要为了「好看」四舍五入。",
      "- **所有数值（含 params、computed.value）一律写成字符串**：`\"1.20\"` 不要写成 `\"1.2\"`，`\"0.000100\"` 不要写成 `\"0.0001\"`，`\"1.20e-3\"` 不要展开。JSON number 存不了末尾 0，写成数字等于丢掉有效数字。",
      "- 单位以表内标注为准；原始数据的单位常写在列名或文件头里，不一致时必须换算，并在 remarks 里写明换算关系。",
      "- 数据异常、无法作图、疑似仪器漂移或操作失误，一律写进 remarks（第七节）。",
      "- 不要计算系统会负责的结果（第六节）。",
      "",
      "（若我给的是表格文本或表格截图，按行列对应关系机械读取即可；被省略的行不要靠推测补全。）",
      "",
    ].join("\n");
  }

  return [
    `# 大学物理实验数据录入任务：${spec.name}`,
    "",
    "你是一名物理实验数据录入与检查助手。我会上传本次实验记录纸的照片或扫描件；请提取读数，按下面的 JSONC 模板输出一份可直接导入前端工作台的数据 artifact。",
    "",
    "要求：",
    "- 只依据图片内容，不臆造数据；看不清的格子写 null。",
    "- **所有数值一律写成字符串**，逐位照抄记录纸：`\"1.20\"` 不要写成 `\"1.2\"`，`\"0.000100\"` 不要写成 `\"0.0001\"`，带估读位的读数不要截掉最后一位。JSON number 存不了末尾 0，写成数字等于丢掉有效数字。",
    "- 不要补记录纸上没有的位，也不要把同一列的数字统一成相同位数：每格该几位就几位，同列出现 `\"1.20\"` 与 `\"1.2\"` 是正常的。",
    "- 所有表格都用第四节的 tableId 与列键。",
    "- 数据异常、无法作图、疑似操作失误，一律写进 remarks（第七节）。",
    "- 不要计算系统会负责的结果（第六节）。",
    "",
  ].join("\n");
}

export function buildPrompt(
  spec: ExperimentSpec,
  context?: PromptContext,
  options: PromptOptions = {}
): string {
  const source = options.source ?? "photo";

  const schemaSection = [
    "## 十、JSONC 模板（填写目标）",
    "",
    "```jsonc",
    buildExperimentSchemaJsonc(spec, context),
    "```",
    "",
  ].join("\n");

  return [
    headerSection(spec, source),
    theorySection(spec, context),
    tableOverview(spec),
    rulesSection(spec, context, source),
    forbiddenResults(spec),
    remarksSection(),
    outputSection(spec, source),
    schemaSection,
  ]
    .filter(Boolean)
    .join("\n");
}
