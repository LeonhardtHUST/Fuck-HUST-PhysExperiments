/**
 * 把 OCR 复核后的线性数值序列写回二维表格。
 *
 * 序列顺序 = 「可编辑单元格」的行优先顺序（跳过只读列，如自动序号、按行序推导的角度列），
 * 与 OCR 面板提示的「按纸面从左到右、从上到下」一致。
 *
 * 每个工作台的表格状态形状不同（二维字符串数组 / 记录对象），
 * 但它们都用这份逻辑，避免三处各写一份导致填格错位。
 */

export interface OcrApplyOptions {
  /** 每列是否只读；只读列不参与填值，也不占用 values 的位置 */
  readOnlyColumns?: boolean[];
  /** 覆盖已有手动数据；为 false 时只填空格 */
  overwriteExisting: boolean;
}

export function applyOcrValues(
  data: string[][],
  values: string[],
  { readOnlyColumns, overwriteExisting }: OcrApplyOptions
): string[][] {
  let index = 0;
  return data.map((row) =>
    row.map((cell, columnIndex) => {
      if (readOnlyColumns?.[columnIndex]) return cell;
      const value = values[index++]?.trim();
      if (!value) return cell;
      if (!overwriteExisting && cell.trim()) return cell;
      return value;
    })
  );
}

/** 可填格数量，用于告诉 OCR 面板应该识别出多少格 */
export function editableCellCount(data: string[][], readOnlyColumns?: boolean[]): number {
  return data.reduce(
    (total, row) => total + row.filter((_, columnIndex) => !readOnlyColumns?.[columnIndex]).length,
    0
  );
}
