"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Eraser, History, ShieldAlert, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspaceDraftController } from "@/hooks/useWorkspaceDraft";

export interface DraftTableOption {
  id: string;
  title: string;
}

function formatStamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusText(controller: WorkspaceDraftController): { label: string; tone: "calm" | "warn" } {
  if (controller.status === "unavailable") {
    return { label: "本机存储不可用，草稿不会保存", tone: "warn" };
  }
  if (controller.status === "blocked") {
    return { label: "本机存储空间不足，草稿未保存", tone: "warn" };
  }
  if (controller.savedAt) {
    return { label: `已自动保存 · ${formatStamp(controller.savedAt)}`, tone: "calm" };
  }
  return { label: "输入会自动保存在本机", tone: "calm" };
}

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => void;
}

function ConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  if (!mounted) return null;

  // 门户挂到 body：工作台卡片带有 backdrop-blur 等样式，会拦截 fixed 定位。
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <ShieldAlert className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 id={titleId} className="text-sm font-bold text-stone-900">
              {request.title}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">{request.description}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-lg border border-stone-300 bg-white px-3.5 text-xs font-semibold text-stone-700 hover:border-stone-400"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * 工具栏入口：一档 = 单张表格，二档 = 该实验，三档 = 所有实验。
 * 每一档都先弹确认，危险按钮默认不聚焦。
 */
export function DraftClearMenu({
  tables,
  controller,
  onClearTable,
  onReset,
  className,
}: {
  tables: DraftTableOption[];
  controller: WorkspaceDraftController;
  onClearTable: (tableId: string) => void;
  /** 把当前工作台状态恢复到初始值（调用方负责，hook 已删掉对应的 key）。 */
  onReset: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placeUp, setPlaceUp] = useState(false);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const status = statusText(controller);
  const otherDrafts = controller.draftExperimentIds.length;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const askTable = (table: DraftTableOption) => {
    close();
    setRequest({
      title: `清空「${table.title}」？`,
      description: "这张表的数值、表内参数与该表备注会恢复为默认状态，计算结果也会失效。不可撤销。",
      confirmLabel: "清空这张表",
      run: () => onClearTable(table.id),
    });
  };

  const askExperiment = () => {
    close();
    setRequest({
      title: "清空该实验的全部数据？",
      description: "当前实验所有表格、参数、备注都会恢复为初始状态，已保存的本机草稿一并删除。不可撤销。",
      confirmLabel: "清空该实验",
      run: () => {
        controller.forget();
        onReset();
      },
    });
  };

  const askAll = () => {
    close();
    setRequest({
      title: "清空所有实验的本机数据？",
      description: `本机保存的 ${Math.max(otherDrafts, 1)} 个实验草稿都会被删除，并重置当前页面。已下载的文件与服务器数据不受影响。不可撤销。`,
      confirmLabel: "全部清空",
      run: () => {
        controller.forgetAllExperiments();
        onReset();
      },
    });
  };

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => {
          if (!open) {
            controller.refreshDrafts();
            const rect = wrapperRef.current?.getBoundingClientRect();
            // 下方放不下整块面板时向上展开，避免被视口底部裁掉。
            setPlaceUp(Boolean(rect) && window.innerHeight - rect!.bottom < 420);
          }
          setOpen((previous) => !previous);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 hover:border-stone-400"
      >
        <Eraser className="h-4 w-4" />
        清空数据
        <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="清空数据"
          style={{ maxHeight: "min(26rem, calc(100dvh - 7rem))" }}
          className={cn(
            "absolute right-0 z-30 flex w-[300px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white text-left shadow-xl",
            placeUp ? "bottom-full mb-2" : "top-full mt-2"
          )}
        >
          <div className="shrink-0 border-b border-stone-100 px-3 py-2.5">
            <p
              className={cn(
                "flex items-center gap-1.5 text-[11px] font-semibold",
                status.tone === "warn" ? "text-amber-700" : "text-stone-600"
              )}
            >
              <History className="h-3.5 w-3.5" />
              {status.label}
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-stone-400">草稿只存在这台设备的浏览器里，不会上传。</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <p className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-stone-400">单张表格</p>
            {tables.length === 0 && <p className="px-2 py-1 text-[11px] text-stone-400">当前实验没有可清空的表格</p>}
            {tables.map((table) => (
              <button
                key={table.id}
                type="button"
                role="menuitem"
                onClick={() => askTable(table)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-stone-700 hover:bg-stone-100"
              >
                <span className="truncate">{table.title}</span>
                <span className="shrink-0 text-[10px] text-stone-400">清空</span>
              </button>
            ))}
          </div>

          <div className="shrink-0 border-t border-stone-100 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={askExperiment}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-stone-700 hover:bg-stone-100"
            >
              <Trash2 className="h-3.5 w-3.5 text-stone-400" />
              清空该实验的全部数据
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={askAll}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              清空所有实验的数据
              <span className="ml-auto shrink-0 text-[10px] font-normal text-rose-400">
                {otherDrafts > 0 ? `${otherDrafts} 个` : "无草稿"}
              </span>
            </button>
          </div>
        </div>
      )}

      {request && (
        <ConfirmDialog
          request={request}
          onCancel={() => setRequest(null)}
          onConfirm={() => {
            request.run();
            setRequest(null);
          }}
        />
      )}
    </div>
  );
}

/** 首次进入时说明“这些是上次的输入”，并提供就地清空。 */
export function DraftRestoreBanner({
  restoredAt,
  onDismiss,
  controller,
  onReset,
  className,
}: {
  restoredAt: number | null;
  onDismiss: () => void;
  controller: WorkspaceDraftController;
  onReset: () => void;
  className?: string;
}) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  if (restoredAt === null) return null;

  return (
    <>
      <div
        role="status"
        className={cn(
          "mb-6 flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-indigo-900 sm:flex-row sm:items-center sm:justify-between",
          className
        )}
      >
        <p className="flex items-start gap-2 text-xs leading-relaxed">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          <span>
            已恢复上次输入 · 保存于 {formatStamp(restoredAt)}
            <span className="ml-1 text-indigo-700/70">（本机草稿，可继续填写）</span>
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setRequest({
                title: "清空该实验的全部数据？",
                description: "本次恢复的所有表格、参数与备注都会恢复为初始状态，本机草稿一并删除。不可撤销。",
                confirmLabel: "清空该实验",
                run: () => {
                  controller.forget();
                  onReset();
                },
              })
            }
            className="inline-flex h-8 items-center rounded-lg border border-indigo-300 bg-white px-2.5 text-[11px] font-semibold text-indigo-700 hover:border-indigo-400"
          >
            清空该实验
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-8 items-center rounded-lg px-2.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            知道了
          </button>
        </div>
      </div>

      {request && (
        <ConfirmDialog
          request={request}
          onCancel={() => setRequest(null)}
          onConfirm={() => {
            request.run();
            setRequest(null);
          }}
        />
      )}
    </>
  );
}
