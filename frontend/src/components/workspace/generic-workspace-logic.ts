export interface CompletionMethod {
  id: string;
  name: string;
  required: boolean;
  paramKeys: string[];
  columnKeys: string[];
  /** 最少行数（缺省 1）；行数可以超过讲义默认条数 */
  minRows?: number;
}

export type DraftRow = Record<string, string>;

export type CompletionDraft = Record<
  string,
  { rows: DraftRow[]; params: Record<string, string> }
>;

function filled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function rowEmpty(row: DraftRow, columnKeys: string[]): boolean {
  return columnKeys.every((key) => !filled(row[key]));
}

/** 在末尾追加一行空白行（列 key 取自表头定义） */
export function appendDraftRow(rows: DraftRow[], columnKeys: string[]): DraftRow[] {
  return [...rows.map((row) => ({ ...row })), Object.fromEntries(columnKeys.map((key) => [key, ""]))];
}

/** 删除指定行；低于 minRows 时返回原数组副本 */
export function removeDraftRowAt(
  rows: DraftRow[],
  index: number,
  minRows = 1
): DraftRow[] {
  if (index < 0 || index >= rows.length || rows.length <= Math.max(0, minRows)) {
    return rows.map((row) => ({ ...row }));
  }
  const next = rows.map((row) => ({ ...row }));
  next.splice(index, 1);
  return next;
}

/** 只裁掉末尾整行空白，内部空洞保留给后端逐行校验 */
export function trimDraftRows(rows: DraftRow[], columnKeys: string[]): DraftRow[] {
  let end = rows.length;
  while (end > 0 && rowEmpty(rows[end - 1], columnKeys)) end -= 1;
  return rows.slice(0, end).map((row) => ({ ...row }));
}

export function isMethodComplete(
  method: CompletionMethod,
  draft: CompletionDraft
): boolean {
  const source = draft[method.id];
  if (!source) return false;
  // 末尾没填的空行不参与判断：录入 10 行（默认 12 行）同样可以算完成
  const rows = trimDraftRows(source.rows, method.columnKeys);
  if (rows.length < Math.max(1, method.minRows ?? 1)) return false;
  return (
    method.paramKeys.every((key) => filled(source.params[key])) &&
    rows.every((row) => method.columnKeys.every((key) => filled(row[key])))
  );
}

export function completionState(
  methods: CompletionMethod[],
  draft: CompletionDraft
) {
  const completedMethodIds = methods
    .filter((method) => isMethodComplete(method, draft))
    .map((method) => method.id);
  const required = methods.filter((method) => method.required);
  const missing = required.filter((method) => !completedMethodIds.includes(method.id));
  return {
    requiredCount: required.length,
    completedRequiredCount: required.length - missing.length,
    requiredAllComplete: missing.length === 0,
    missingRequiredNames: missing.map((method) => method.name),
    completedMethodIds,
  };
}

export function nextGridCell(
  key: string,
  row: number,
  column: number,
  rowCount: number,
  columnCount: number
): [number, number] | null {
  const delta: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const movement = delta[key];
  if (!movement) return null;
  const nextRow = row + movement[0];
  const nextColumn = column + movement[1];
  if (
    nextRow < 0 ||
    nextRow >= rowCount ||
    nextColumn < 0 ||
    nextColumn >= columnCount
  ) {
    return null;
  }
  return [nextRow, nextColumn];
}
