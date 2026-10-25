/**
 * 声速光速工作台的表格分组（纯数据，无 JSX）。
 *
 * `SoundLightWorkspace` 用它渲染表头分组，artifact 注册表用它生成
 * `{methodId}-{tableIndex}` 形式的 tableId —— 与 OCR 使用的 id 完全一致。
 * 行数 / 单位 / 字段来自 `backend/experiments/soundlight/config.json`。
 */

import { getInputRange } from "./input-ranges.ts";
import type { ExperimentSpec, TableColumnSpec, TableParamSpec, TableSpec } from "./table-specs.ts";

export interface SoundLightLayoutColumn {
  /** 参与计算的数据列；缺省表示自动序号列。 */
  key?: string;
  label: string;
  readOnly?: boolean;
}

export interface SoundLightLayoutTable {
  title?: string;
  note?: string;
  cols: SoundLightLayoutColumn[];
}

export interface SoundLightLayoutMethod {
  id: string;
  name: string;
  desc: string;
  tables: SoundLightLayoutTable[];
}

export const SOUND_LIGHT_LAYOUTS: SoundLightLayoutMethod[] = [
  {
    id: "air_resonance",
    name: "① 共振干涉法（空气）",
    desc: "实验一 · 必做。S2 同方向连续移动，默认记录 12 个驻波共振位置（相邻间距 ≈ λ/2，可自由增删，至少 4 个），逐差法求 Δl̄。",
    tables: [
      {
        note: "温度用于理论声速修正 v = 331.45 × √(1 + t/273.15)",
        cols: [{ label: "序号", readOnly: true }, { label: "空气中共振法 l", key: "l" }],
      },
    ],
  },
  {
    id: "water_phase",
    name: "② 相位比较法（水）",
    desc: "实验一 · 必做。水中移动 S2 至李萨如为直线，默认记录 12 个相位匹配位置（可自由增删，至少 4 个），逐差法处理并计算 A 类不确定度。",
    tables: [
      {
        note: "频率约 1 MHz（以实际为准）",
        cols: [{ label: "序号", readOnly: true }, { label: "水中相位法 l", key: "l" }],
      },
    ],
  },
  {
    id: "tof",
    name: "③ 时差法 · 水",
    desc: "实验一 · 选做。脉冲波模式测水中声速：S2 每次移动等间距 20 mm，连续记录 12 组距离 L 与飞行时间 T，逐点 v = L/T。",
    tables: [
      {
        note: "每次移动 20 mm，共 12 组",
        cols: [
          { label: "序号", readOnly: true },
          { label: "距离 L", key: "L" },
          { label: "飞行时间 T", key: "T" },
        ],
      },
    ],
  },
  {
    id: "light_sine",
    name: "① 相位法（正弦波）",
    desc: "实验二 · 必做。差频正弦相位法：先测 3 组差频周期 T，再移动反射镜记录 3 组相位差 Δt 与位置 x₁→x₂（表 2-1 / 2-2）。",
    tables: [
      {
        title: "表 2-1 周期测量",
        cols: [{ label: "序号", readOnly: true }, { label: "周期 T", key: "T" }],
      },
      {
        title: "表 2-2 相位移动",
        cols: [
          { label: "序号", readOnly: true },
          { label: "相位差 Δt", key: "dt" },
          { label: "x₁", key: "x1" },
          { label: "x₂", key: "x2" },
        ],
      },
    ],
  },
  {
    id: "light_square",
    name: "② 相位法（方波）",
    desc: "实验二 · 选做。示波器换方波挡位，方法与正弦波完全相同：同测差频周期 T 与 3 组相位差 Δt、x₁→x₂。",
    tables: [
      {
        title: "周期测量",
        cols: [{ label: "序号", readOnly: true }, { label: "周期 T", key: "T" }],
      },
      {
        title: "相位移动",
        cols: [
          { label: "序号", readOnly: true },
          { label: "相位差 Δt", key: "dt" },
          { label: "x₁", key: "x1" },
          { label: "x₂", key: "x2" },
        ],
      },
    ],
  },
  {
    id: "light_lissajous",
    name: "③ 李萨如图形法",
    desc: "实验二 · 必做。X-Y 模式：反射镜从直线图形移动到反斜率直线（π 相位差，对应 Δx = λ/4），共 3 组（表 2-3）。",
    tables: [
      {
        cols: [
          { label: "序号", readOnly: true },
          { label: "x₁", key: "x1" },
          { label: "x₂", key: "x2" },
        ],
      },
    ],
  },
];

interface SoundLightSourceColumn {
  key: string;
  label: string;
  unit: string;
  count: number;
  min_rows?: number;
  note?: string;
}

export interface SoundLightMethodConfig {
  id: string;
  name: string;
  type: "required" | "optional" | string;
  purpose?: string;
  table_cols: SoundLightSourceColumn[];
  params: { key: string; label: string; unit: string; default: number }[];
  outputs: { key: string; label: string; unit?: string }[];
}

function buildColumns(
  method: SoundLightMethodConfig,
  layout: SoundLightLayoutMethod,
  tableIndex: number
): TableColumnSpec[] {
  const source = new Map(method.table_cols.map((column) => [column.key, column]));
  const layoutTable = layout.tables[tableIndex];
  return layoutTable.cols
    .filter((column): column is SoundLightLayoutColumn & { key: string } => Boolean(column.key))
    .map((column) => {
      const config = source.get(column.key);
      const range = getInputRange("sound-light", method.id, column.key);
      const spec: TableColumnSpec = {
        key: column.key,
        label: config?.label ?? column.label,
        unit: config?.unit ?? "",
        kind: "number",
      };
      if (range) spec.range = { min: range.min, max: range.max, ...(range.note ? { note: range.note } : {}) };
      if (config?.note) spec.hint = config.note;
      return spec;
    });
}

function buildParams(method: SoundLightMethodConfig): TableParamSpec[] {
  return method.params.map((param) => {
    const range = getInputRange("sound-light", method.id, param.key);
    const spec: TableParamSpec = {
      key: param.key,
      label: param.label,
      unit: param.unit,
      defaultValue: param.default,
    };
    if (range) spec.range = { min: range.min, max: range.max, ...(range.note ? { note: range.note } : {}) };
    return spec;
  });
}

function buildTable(method: SoundLightMethodConfig, layout: SoundLightLayoutMethod, tableIndex: number): TableSpec {
  const layoutTable = layout.tables[tableIndex];
  const configs = method.table_cols.filter((column) =>
    layoutTable.cols.some((layoutColumn) => layoutColumn.key === column.key)
  );
  const defaultRows = Math.max(1, ...configs.map((column) => column.count));
  const minRows = Math.min(
    defaultRows,
    Math.max(1, ...configs.map((column) => column.min_rows ?? 1))
  );
  return {
    tableId: `${method.id}-${tableIndex}`,
    methodId: method.id,
    title: layoutTable.title ?? method.name,
    ...(layoutTable.note ? { note: layoutTable.note } : {}),
    columns: buildColumns(method, layout, tableIndex),
    defaultRows,
    minRows,
    params: buildParams(method),
  };
}

/** Builds the artifact spec for `sound-light` from its method array config. */
export function buildSoundLightSpec(
  config: SoundLightMethodConfig[],
  metadata: { id: string; name: string; category: string; description: string }
): ExperimentSpec {
  const tables: TableSpec[] = [];
  const missing: string[] = [];

  for (const method of config) {
    const layout = SOUND_LIGHT_LAYOUTS.find((item) => item.id === method.id);
    if (!layout) {
      missing.push(method.id);
      continue;
    }
    layout.tables.forEach((_table, tableIndex) => {
      tables.push(buildTable(method, layout, tableIndex));
    });
  }

  if (missing.length > 0) {
    throw new Error(`声速光速实验缺少表格分组定义：${missing.join("、")}`);
  }

  return {
    ...metadata,
    tables,
    setupParams: [],
    backendResults: config.flatMap((method) =>
      method.outputs.map((output) => ({
        methodId: method.id,
        key: output.key,
        label: output.label,
        unit: output.unit ?? "",
      }))
    ),
  };
}
