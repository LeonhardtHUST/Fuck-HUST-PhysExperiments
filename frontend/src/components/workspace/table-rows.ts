/**
 * 数据表行的纯函数工具：增行、删行、裁剪末尾空行。
 *
 * 这些函数只处理 `string[][]`（与 DataInputTable / 通用工作台的行结构一致），
 * 不依赖 React、JSX 或路径别名，因此可以被 `node --test`（--experimental-strip-types）直接加载。
 */

export interface RowShape {
  /** 每行的列数；缺省沿用最后一行的长度（空表时为 0） */
  columns?: number;
  /**
   * 自动编号列（如首列“序号”）的下标。给出时：
   * - 新增行填 `行序 + 1`；
   * - 删除行后按新的行序重排该列（仅重排原本就是数字的单元格）。
   */
  indexColumn?: number;
}

export interface TrimOptions {
  /** 至少保留的行数（默认 0） */
  keep?: number;
  /** 判断“整行是否为空”时忽略的列（通常是被忽略的自动编号列） */
  ignoreColumns?: number[];
}

function cloneRows(rows: string[][]): string[][] {
  return rows.map((row) => [...row]);
}

function rowWidth(rows: string[][], fallback: number): number {
  return rows.length > 0 ? rows[rows.length - 1].length : fallback;
}

/**
 * 该列是否“本来就是序号”（1,2,3… 连续）。
 * 偏振光的首列是 0°、10°、20° 这类角度，虽然也是数字，但不能被当成序号重排。
 */
function looksSerial(rows: string[][], indexColumn: number): boolean {
  if (rows.length === 0) return true;
  return rows.every((row, rowIndex) => {
    const value = String(row[indexColumn] ?? "").trim();
    if (value === "") return true;
    return Number.isFinite(Number(value)) && Number(value) === rowIndex + 1;
  });
}

function renumber(rows: string[][], indexColumn: number | undefined): string[][] {
  if (indexColumn === undefined) return rows;
  return rows.map((row, rowIndex) => {
    const next = [...row];
    next[indexColumn] = String(rowIndex + 1);
    return next;
  });
}

/** 生成一行空白单元格 */
export function blankRow(columns: number): string[] {
  return Array.from({ length: Math.max(0, columns) }, () => "");
}

/** 在末尾追加一行，并按需写入序号列 */
export function appendRow(rows: string[][], shape: RowShape = {}): string[][] {
  const next = cloneRows(rows);
  const added = blankRow(rowWidth(rows, shape.columns ?? 0));
  if (shape.indexColumn !== undefined) added[shape.indexColumn] = String(rows.length + 1);
  next.push(added);
  return next;
}

/** 删除指定行；保留 `minRows` 行时拒绝删除（返回原数组副本） */
export function removeRowAt(
  rows: string[][],
  index: number,
  shape: RowShape & { minRows?: number } = {}
): string[][] {
  const minRows = Math.max(0, shape.minRows ?? 1);
  const serial = shape.indexColumn !== undefined && looksSerial(rows, shape.indexColumn);
  if (index < 0 || index >= rows.length || rows.length <= minRows) return cloneRows(rows);
  const next = cloneRows(rows);
  next.splice(index, 1);
  return serial ? renumber(next, shape.indexColumn) : next;
}

/** 整行（忽略指定列后）是否没有任何内容 */
export function isRowEmpty(row: string[], options: TrimOptions = {}): boolean {
  const ignore = new Set(options.ignoreColumns ?? []);
  return row.every((cell, index) => ignore.has(index) || String(cell ?? "").trim() === "");
}

/**
 * 裁掉末尾的整行空白（只裁末尾，内部空洞保留给后端逐行校验报错）。
 * 至少保留 `keep` 行。
 */
export function trimTrailingEmptyRows(rows: string[][], options: TrimOptions = {}): string[][] {
  const keep = Math.max(0, options.keep ?? 0);
  let end = rows.length;
  while (end > keep && isRowEmpty(rows[end - 1], options)) end -= 1;
  return rows.slice(0, end).map((row) => [...row]);
}

/** 表格中实际有内容的数据行数（忽略自动编号列，用于完成度判断） */
export function filledRowCount(rows: string[][], options: TrimOptions = {}): number {
  const keepIgnore = new Set(options.ignoreColumns ?? []);
  let count = 0;
  rows.forEach((row) => {
    const hasValue = row.some(
      (cell, index) => !keepIgnore.has(index) && String(cell ?? "").trim() !== ""
    );
    if (hasValue) count += 1;
  });
  return count;
}
