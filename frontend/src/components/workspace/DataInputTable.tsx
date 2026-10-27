"use client";

import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { isOutsideRange, rangeLabel, type InputRangeHint } from "@/lib/input-ranges";
import { appendRow, removeRowAt } from "./table-rows";

interface Header {
  label: string;
  readOnly?: boolean;
  range?: InputRangeHint;
  unit?: string;
}

interface Props {
  headers: Header[];
  data: string[][];
  onChange: (data: string[][]) => void;
  compact?: boolean;
  /** 允许自由增删数据行（未传时渲染与固定表格完全一致） */
  resizable?: boolean;
  /** 最少保留行数，删除到下限时禁用删除按钮 */
  minRows?: number;
  /** 自定义“添加一行”的行内容（缺省按表头列数补空行，首列自动编号） */
  onAddRow?: (rows: string[][]) => string[][];
  /** 底部工具条右侧的附加操作（导入/导出），未传时保持原有渲染 */
  actions?: React.ReactNode;
}

export default function DataInputTable({
  headers,
  data,
  onChange,
  compact,
  resizable,
  minRows = 1,
  onAddRow,
  actions,
}: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[][]>([]);
  const autoIndexColumn = headers[0]?.readOnly ? 0 : undefined;
  const canRemove = resizable === true && data.length > Math.max(1, minRows);

  const addRow = useCallback(() => {
    const next = onAddRow
      ? onAddRow(data)
      : appendRow(data, { indexColumn: autoIndexColumn, columns: headers.length });
    onChange(next);
  }, [autoIndexColumn, data, headers.length, onAddRow, onChange]);

  const removeRow = useCallback(
    (rowIndex: number) => {
      onChange(
        removeRowAt(data, rowIndex, {
          indexColumn: autoIndexColumn,
          minRows: Math.max(1, minRows),
        })
      );
    },
    [autoIndexColumn, data, minRows, onChange]
  );

  const handleChange = useCallback(
    (row: number, col: number, value: string) => {
      const next = data.map((r) => [...r]);
      next[row][col] = value;
      onChange(next);
    },
    [data, onChange]
  );

  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      row: number,
      col: number
    ) => {
      // 方向键在表格内移动焦点（跳过“自动/只读”列，到边界即停）
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const [dr, dc] =
          e.key === "ArrowUp"
            ? [-1, 0]
            : e.key === "ArrowDown"
              ? [1, 0]
              : e.key === "ArrowLeft"
                ? [0, -1]
                : [0, 1];
        if (dr !== 0) {
          const tr = row + dr;
          const el = inputRefs.current[tr]?.[col];
          if (el && !headers[col]?.readOnly) el.focus();
        } else {
          let tc = col + dc;
          while (tc >= 0 && tc < headers.length) {
            if (!headers[tc]?.readOnly) {
              inputRefs.current[row]?.[tc]?.focus();
              break;
            }
            tc += dc;
          }
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const nextCol = col + (e.shiftKey ? -1 : 1);
        if (nextCol >= 0 && nextCol < headers.length) {
          inputRefs.current[row]?.[nextCol]?.focus();
        } else if (!e.shiftKey && row + 1 < data.length) {
          const firstEditable = headers.findIndex((h) => !h.readOnly);
          inputRefs.current[row + 1]?.[firstEditable >= 0 ? firstEditable : 0]?.focus();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (row + 1 < data.length) {
          inputRefs.current[row + 1]?.[col]?.focus();
        }
      }
    },
    [data.length, headers]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent, startRow: number, startCol: number) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      const rows = text
        .split(/[\r\n]+/)
        .map((line) => line.split(/[\t,]/));
      if (rows.length <= 1 && rows[0].length <= 1) return;

      const next = data.map((r) => [...r]);
      for (let i = 0; i < rows.length; i++) {
        const targetRow = startRow + i;
        if (targetRow >= next.length) break;
        for (let j = 0; j < rows[i].length; j++) {
          const targetCol = startCol + j;
          if (targetCol >= headers.length) break;
          if (headers[targetCol].readOnly) continue;
          next[targetRow][targetCol] = rows[i][j].trim();
        }
      }
      onChange(next);
    },
    [data, headers, onChange]
  );

  const addRowButton = (
    <button
      type="button"
      onClick={addRow}
      className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-indigo-300 hover:text-indigo-700"
    >
      + 添加一行
    </button>
  );

  return (
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap border-b border-stone-200 bg-stone-50 text-left text-xs font-bold text-stone-500",
                    compact ? "px-3 py-2.5" : "px-4 py-3",
                    i === 0 && "pl-5"
                  )}
                >
                  {h.label}
                  {rangeLabel(h.range, h.unit) && (
                    <span className="mt-0.5 block text-[10px] font-normal text-amber-600">
                      {rangeLabel(h.range, h.unit)}
                    </span>
                  )}
                  {h.readOnly && (
                    <span className="ml-1.5 font-normal text-stone-300" aria-hidden>
                      · 自动
                    </span>
                  )}
                </th>
              ))}
              {resizable && (
                <th
                  scope="col"
                  className="w-10 border-b border-stone-200 bg-stone-50 px-2 py-3 text-center text-[10px] font-normal text-stone-400"
                  title={`至少 ${Math.max(1, minRows)} 行`}
                >
                  行
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row, ri) => (
              <tr
                key={ri}
                className="transition-colors hover:bg-indigo-50/40"
              >
                {row.map((cell, ci) => {
                  const readonly = headers[ci]?.readOnly;
                  const outside = !readonly && isOutsideRange(cell, headers[ci]?.range);
                  const hint = rangeLabel(headers[ci]?.range, headers[ci]?.unit);
                  return (
                    <td
                      key={ci}
                      className={cn(
                        "border-b border-stone-100 p-0 last:border-b-0",
                        ri === data.length - 1 && "border-b-0"
                      )}
                    >
                      <input
                        ref={(el) => {
                          if (!inputRefs.current[ri]) inputRefs.current[ri] = [];
                          inputRefs.current[ri][ci] = el;
                        }}
                        type={readonly ? "text" : "number"}
                        step="any"
                        inputMode={readonly ? undefined : "decimal"}
                        readOnly={readonly}
                        aria-readonly={readonly || undefined}
                        aria-invalid={outside || undefined}
                        title={outside ? `${hint}；当前值可能需要检查` : hint}
                        value={cell}
                        onChange={(e) => handleChange(ri, ci, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, ri, ci)}
                        onWheel={(e) => {
                          // 滚动页面时禁止滚轮改值（防误触）
                          e.currentTarget.blur();
                        }}
                        onPaste={(e) => handlePaste(e, ri, ci)}
                        className={cn(
                          "w-full border-0 bg-transparent outline-none transition-colors",
                          compact ? "py-1.5 text-[13px]" : "py-2.5 text-sm",
                          readonly
                            ? "cursor-default bg-stone-50/70 text-center font-mono font-medium text-stone-400"
                            : outside
                              ? "bg-amber-50 px-3.5 text-right font-medium tabular-nums text-amber-900 ring-1 ring-inset ring-amber-300 focus:bg-amber-50"
                              : "px-3.5 text-right font-medium tabular-nums text-stone-800 focus:bg-indigo-50/70",
                          !readonly && compact && "px-2.5",
                          readonly && (compact ? "px-1 text-xs" : "px-1")
                        )}
                      />
                    </td>
                  );
                })}
                {resizable && (
                  <td
                    className={cn(
                      "border-b border-stone-100 p-0 text-center",
                      ri === data.length - 1 && "border-b-0"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => removeRow(ri)}
                      disabled={!canRemove}
                      aria-label={`删除第 ${ri + 1} 行`}
                      title={
                        canRemove
                          ? `删除第 ${ri + 1} 行`
                          : `至少需要保留 ${Math.max(1, minRows)} 行`
                      }
                      className={cn(
                        "mx-auto flex h-7 w-7 items-center justify-center rounded-md text-base leading-none transition-colors",
                        canRemove
                          ? "text-stone-400 hover:bg-rose-50 hover:text-rose-600"
                          : "cursor-not-allowed text-stone-200"
                      )}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 bg-stone-50/60 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {resizable && addRowButton}
            {actions}
          </div>
          {resizable && (
            <span className="text-[11px] text-stone-400">
              共 {data.length} 行 · 至少 {Math.max(1, minRows)} 行，可自由增删
            </span>
          )}
        </div>
      ) : (
        resizable && (
          <div className="flex items-center justify-between gap-3 border-t border-stone-100 bg-stone-50/60 px-4 py-2">
            {addRowButton}
            <span className="text-[11px] text-stone-400">
              共 {data.length} 行 · 至少 {Math.max(1, minRows)} 行，可自由增删
            </span>
          </div>
        )
      )}
    </div>
  );
}
