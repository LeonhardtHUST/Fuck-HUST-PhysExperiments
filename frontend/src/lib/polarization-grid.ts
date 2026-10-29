/**
 * 偏振光工作台的角度列：文件里写了的实测值优先，缺失才按行序推导。
 *
 * 历史实现无条件用 ``rowIndexValue`` 覆盖，导致 89.5° 这样的实测角度在导入后
 * 被改写成 90°，而且改写发生在导入、草稿恢复两条路径上。这里把规则收敛成一处，
 * 便于单测锁定。
 */

import { rowIndexValue } from "./table-specs.ts";
import type { TableColumnSpec, TableSpec } from "./table-specs.ts";

/** 单个单元格：文件有非空值就用值，缺失才按行序补。 */
export function applyImportedRow(
  column: TableColumnSpec,
  imported: string | null | undefined,
  rowIndex: number
): string {
  const text = (imported ?? "").trim();
  if (text) return text;
  const derived = rowIndexValue(column, rowIndex);
  return derived === undefined ? "" : String(derived);
}

/** 整张表：按列把记录转成网格，只读角度列同样遵守「有值用值」。 */
export function recordsToGrid(table: TableSpec, records: Record<string, string>[]): string[][] {
  return records.map((record, rowIndex) =>
    table.columns.map((column) => applyImportedRow(column, record[column.key], rowIndex))
  );
}
