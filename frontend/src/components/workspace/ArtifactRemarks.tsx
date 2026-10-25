"use client";

import { AlertTriangle, Info, ShieldAlert, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ArtifactIssue,
  ComputedEntry,
  ExperimentRemarks,
  Severity,
  TableRemarks,
} from "@/lib/experiment-artifact";

const SEVERITY_META: Record<
  Severity,
  { label: string; bar: string; badge: string; icon: React.ElementType }
> = {
  info: {
    label: "信息",
    bar: "bg-indigo-400",
    badge: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    icon: Info,
  },
  warning: {
    label: "警告",
    bar: "bg-amber-400",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
    icon: AlertTriangle,
  },
  error: {
    label: "错误",
    bar: "bg-rose-400",
    badge: "bg-rose-50 text-rose-700 ring-rose-100",
    icon: ShieldAlert,
  },
};

interface Props {
  scope: "experiment" | "table";
  remarks?: ExperimentRemarks | TableRemarks | null;
  computed?: Record<string, ComputedEntry>;
  columns?: { key: string; label: string }[];
  tableLabels?: Record<string, string>;
  onClear?: () => void;
  className?: string;
}

function IssueList({
  issues,
  columns,
  tableLabels,
}: {
  issues: ArtifactIssue[];
  columns?: { key: string; label: string }[];
  tableLabels?: Record<string, string>;
}) {
  return (
    <ul className="mt-2 space-y-2">
      {issues.map((issue, index) => {
        const meta = SEVERITY_META[issue.severity];
        const Icon = meta.icon;
        const columnLabel = issue.column
          ? (columns?.find((column) => column.key === issue.column)?.label ?? issue.column)
          : null;
        return (
          <li
            key={`${issue.severity}-${index}`}
            className="rounded-lg border border-stone-200/80 bg-stone-50/60 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset",
                  meta.badge
                )}
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </span>
              {issue.table && (
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200">
                  {tableLabels?.[issue.table] ?? issue.table}
                </span>
              )}
              {issue.row !== undefined && (
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200">
                  第 {issue.row} 行
                </span>
              )}
              {columnLabel && (
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200">
                  列 {columnLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-stone-700">{issue.message}</p>
            {issue.suspectedCause && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-stone-400">
                可能原因：{issue.suspectedCause}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function ArtifactRemarks({
  scope,
  remarks,
  computed,
  columns,
  tableLabels,
  onClear,
  className,
}: Props) {
  const experiment = scope === "experiment" ? (remarks as ExperimentRemarks | null | undefined) : null;
  const table = scope === "table" ? (remarks as TableRemarks | null | undefined) : null;
  const aiValues = Object.entries(computed ?? {}).filter(
    ([, entry]) => entry.source === "ai" && entry.value !== undefined && entry.value !== null
  );

  const summary = experiment?.summary ?? table?.summary;
  const causes = experiment?.suspectedCauses ?? [];
  const issues = experiment?.issues ?? table?.issues ?? [];
  const hasTableStatus = scope === "table" && Boolean(table?.status);

  if (!summary && causes.length === 0 && issues.length === 0 && aiValues.length === 0 && !hasTableStatus) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            issues.some((issue) => issue.severity === "error")
              ? SEVERITY_META.error.bar
              : issues.some((issue) => issue.severity === "warning")
                ? SEVERITY_META.warning.bar
                : SEVERITY_META.info.bar
          )}
        />
        <div className="flex flex-wrap items-start justify-between gap-2 py-3 pl-4 pr-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-stone-700">
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              {scope === "experiment" ? "实验备注" : "本表备注"}
              {table?.status && (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset",
                    table.status === "ok"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                      : table.status === "incomplete"
                        ? "bg-amber-50 text-amber-700 ring-amber-100"
                        : "bg-rose-50 text-rose-700 ring-rose-100"
                  )}
                >
                  {table.status === "ok" ? "数据完整" : table.status === "incomplete" ? "数据不全" : "可疑"}
                </span>
              )}
            </p>
            {summary && <p className="mt-1 text-xs leading-relaxed text-stone-600">{summary}</p>}
            {causes.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50/70 px-3 py-2 ring-1 ring-inset ring-amber-100">
                <p className="text-[11px] font-bold text-amber-800">可能的操作失误 / 误差来源</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-900/80">
                  {causes.map((cause) => (
                    <li key={cause}>{cause}</li>
                  ))}
                </ul>
              </div>
            )}
            <IssueList issues={issues} columns={columns} tableLabels={tableLabels} />
          </div>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              <X className="h-3 w-3" />
              清除
            </button>
          )}
        </div>
      </div>

      {aiValues.length > 0 && (
        <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3">
          <p className="text-[11px] font-bold text-indigo-700">AI 参考值 · 非提交结果</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500">
            后端不计算这些派生量，以下仅由 AI 依据原始读数给出，正式结果仍以系统计算为准。
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {aiValues.map(([key, entry]) => (
              <div key={key} className="rounded-lg bg-white/80 px-2.5 py-1.5 ring-1 ring-inset ring-indigo-100">
                <p className="text-[10px] font-medium text-stone-400">{entry.label ?? key}</p>
                <p className="font-mono text-sm font-bold text-stone-800">
                  {String(entry.value)}
                  {entry.unit && <span className="ml-1 text-[10px] font-medium text-stone-400">{entry.unit}</span>}
                </p>
                {entry.note && <p className="text-[10px] leading-snug text-stone-400">{entry.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
