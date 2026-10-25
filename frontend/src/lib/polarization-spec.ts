/**
 * 偏振光与双折射实验的声明式表格定义。
 *
 * `backend/experiments/polarization/config.json` 只声明了子实验与结果字段，
 * 表格列/行数一直硬编码在工作台组件里。这里把同一份信息声明出来，供
 * artifact 编解码与 Prompt 生成使用；表头顺序与
 * `app/experiments/[id]/workspace/client-page.tsx` 严格一致。
 */

import { getInputRange } from "./input-ranges.ts";
import type {
  BackendResultSpec,
  ExperimentSpec,
  TableColumnSpec,
  TableParamSpec,
  TableSpec,
} from "./table-specs.ts";

interface PolarizationConfig {
  id: string;
  name: string;
  category?: string;
  description?: string;
  setupFields?: { key: string; label: string; unit?: string; default?: number | string }[];
  subExperiments?: {
    id: string;
    name: string;
    required?: boolean;
    description?: string;
    resultFields?: { key: string; label: string; unit?: string }[];
  }[];
}

function polarRange(methodId: string, key: string): TableColumnSpec["range"] {
  const range = getInputRange("polarization", methodId, key);
  return range ? { min: range.min, max: range.max, ...(range.note ? { note: range.note } : {}) } : undefined;
}

function tableColumn(
  methodId: string,
  key: string,
  label: string,
  unit: string,
  rowIndex?: { start: number; step: number; wrap?: number }
): TableColumnSpec {
  const spec: TableColumnSpec = { key, label, unit, kind: "number" };
  const range = polarRange(methodId, key);
  if (range) spec.range = range;
  if (rowIndex) spec.rowIndex = rowIndex;
  return spec;
}

function param(methodId: string, key: string, label: string, unit: string, defaultValue?: number | string): TableParamSpec {
  const spec: TableParamSpec = { key, label, unit };
  const range = polarRange(methodId, key);
  if (range) spec.range = range;
  if (defaultValue !== undefined) spec.defaultValue = defaultValue;
  return spec;
}

const TABLES: TableSpec[] = [
  {
    tableId: "malus",
    methodId: "malus",
    title: "马吕斯定律：I–θ 记录",
    note: "θ 从 90°（消光）到 0°，每 10° 记录左右旋光强 I 左 / I 右（μW）",
    columns: [
      tableColumn("malus", "theta", "偏振片角度 θ", "°", { start: 90, step: -10 }),
      tableColumn("malus", "i_left", "I 左旋", "μW"),
      tableColumn("malus", "i_right", "I 右旋", "μW"),
    ],
    defaultRows: 10,
    minRows: 2,
    params: [],
  },
  {
    tableId: "halfwave",
    methodId: "halfwave",
    title: "半波片：C / P2 读数",
    note: "每次 C 旋转 10°，记录 C 与 P2 刻度盘的度、分读数，共 6 组；初始读数单列在 params 中",
    columns: [
      tableColumn("halfwave", "offset", "C 累计转角", "°", { start: 0, step: 10 }),
      tableColumn("halfwave", "c_deg", "C (度)", "°"),
      tableColumn("halfwave", "c_min", "C (分)", "′"),
      tableColumn("halfwave", "p2_deg", "P2 (度)", "°"),
      tableColumn("halfwave", "p2_min", "P2 (分)", "′"),
    ],
    defaultRows: 6,
    minRows: 2,
    params: [
      param("halfwave", "c_deg", "C 初始 · 度", "°"),
      param("halfwave", "c_min", "C 初始 · 分", "′"),
      param("halfwave", "p2_deg", "P2 初始 · 度", "°"),
      param("halfwave", "p2_min", "P2 初始 · 分", "′"),
    ],
  },
  {
    tableId: "quarterwave",
    methodId: "quarterwave",
    title: "四分之一波片：I–φ 记录",
    note: "P2 每转 10° 记一次光强，φ 从 0° 到 350° 共 36 个数据点",
    columns: [
      tableColumn("quarterwave", "phi", "φ", "°", { start: 0, step: 10, wrap: 360 }),
      tableColumn("quarterwave", "i_raw", "I", "μW"),
    ],
    defaultRows: 36,
    minRows: 3,
    params: [],
  },
  {
    tableId: "circular",
    methodId: "circular",
    title: "圆偏振光：I–P2 记录",
    note: "圆偏振光通过检偏器，P2 每转 10° 记录光强，共 36 点",
    columns: [
      tableColumn("circular", "angle", "P2", "°", { start: 0, step: 10, wrap: 360 }),
      tableColumn("circular", "i_raw", "I", "μW"),
    ],
    defaultRows: 36,
    minRows: 3,
    params: [],
  },
];

export function buildPolarizationSpec(config: PolarizationConfig): ExperimentSpec {
  const setupParams = (config.setupFields ?? []).map((field) =>
    param("setup", field.key, field.label, field.unit ?? "", field.default)
  );

  const backendResults: BackendResultSpec[] = (config.subExperiments ?? []).flatMap((sub) =>
    (sub.resultFields ?? []).map((field) => ({
      methodId: sub.id,
      key: field.key,
      label: field.label,
      unit: field.unit ?? "",
    }))
  );

  // 用配置里的子实验描述补齐表说明（保持表格顺序与组件一致）
  const tables = TABLES.map((table) => {
    const sub = (config.subExperiments ?? []).find((item) => item.id === table.methodId);
    return sub?.description ? { ...table, note: sub.description } : table;
  });

  return {
    id: config.id,
    name: config.name,
    category: config.category ?? "",
    description: config.description ?? "",
    tables,
    setupParams,
    backendResults,
  };
}
