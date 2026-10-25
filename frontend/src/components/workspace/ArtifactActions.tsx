"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, Check, ClipboardList, Copy, Download, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPromptContext } from "@/lib/experiment-contexts";
import { tryGetExperimentSpec } from "@/lib/experiment-specs";
import {
  encodeArtifact,
  type ArtifactInput,
  type ComputedEntry,
  type ExperimentRemarks,
  type TableRemarks,
} from "@/lib/experiment-artifact";
import { buildExperimentSchemaJsonc, buildTableSchemaJsonc } from "@/lib/experiment-schema";
import { buildPrompt } from "@/lib/experiment-prompt";
import { copyText, downloadText, safeFilePart } from "@/lib/clipboard";
import { scopeExperimentSpec, type ArtifactScope, type DecodeOk } from "@/lib/artifact-scope";
import ArtifactImportPanel from "./ArtifactImportPanel";
import ArtifactRemarks from "./ArtifactRemarks";

type Tab = "data" | "schema" | "prompt" | "remarks";

const TABS: { id: Tab; label: string }[] = [
  { id: "data", label: "数据" },
  { id: "schema", label: "Schema" },
  { id: "prompt", label: "AI Prompt" },
  { id: "remarks", label: "备注" },
];

export interface ArtifactActionsProps {
  experimentId: string;
  scope: ArtifactScope;
  /** Snapshot of the live workspace state (all tables; scope narrows the output). */
  collect: () => ArtifactInput;
  onImport: (result: DecodeOk) => void;
  remarks?: ExperimentRemarks | null;
  tableRemarks?: Record<string, TableRemarks>;
  computed?: Record<string, ComputedEntry>;
  onClearRemarks?: () => void;
  variant?: "toolbar" | "table";
}

export default function ArtifactActions({
  experimentId,
  scope,
  collect,
  onImport,
  remarks,
  tableRemarks,
  computed,
  onClearRemarks,
  variant = "toolbar",
}: ArtifactActionsProps) {
  const spec = useMemo(() => tryGetExperimentSpec(experimentId), [experimentId]);
  const context = useMemo(() => getPromptContext(experimentId), [experimentId]);
  const scoped = useMemo(() => (spec ? scopeExperimentSpec(spec, scope) : undefined), [spec, scope]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [exportJson, setExportJson] = useState("");
  const [schema, setSchema] = useState("");
  const [prompt, setPrompt] = useState("");
  const [feedback, setFeedback] = useState<{ kind: string; ok: boolean } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!tab) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTab(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab]);

  const open = useCallback(
    (next: Tab) => {
      if (!spec || !scoped) return;
      if (next === "data") setExportJson(encodeArtifact(scoped, collect()));
      if (next === "schema") {
        setSchema(
          scope.kind === "table"
            ? buildTableSchemaJsonc(spec, scope.tableId, context)
            : buildExperimentSchemaJsonc(spec, context)
        );
      }
      if (next === "prompt") setPrompt(buildPrompt(scoped, context));
      setTab(next);
    },
    [collect, context, scope, scoped, spec]
  );

  const download = useCallback(() => {
    if (!spec || !scoped) return;
    const suffix = scope.kind === "table" ? scope.tableId : "experiment";
    downloadText(
      `${safeFilePart(spec.id)}-${safeFilePart(suffix)}.json`,
      encodeArtifact(scoped, collect())
    );
  }, [collect, scope, scoped, spec]);

  const copy = async (kind: string, value: string) => {
    const ok = await copyText(value);
    setFeedback({ kind, ok });
  };

  if (!spec || !scoped) return null;

  const scopeLabel = scope.kind === "table" ? scope.title : spec.name;
  const tableSpec = scope.kind === "table" ? spec.tables.find((item) => item.tableId === scope.tableId) : undefined;
  const tableLabels = Object.fromEntries(spec.tables.map((table) => [table.tableId, table.title]));

  const copyButton = (kind: string, value: string, primary = false) => (
    <button
      type="button"
      onClick={() => {
        void copy(kind, value);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors",
        primary
          ? "bg-indigo-600 text-white hover:bg-indigo-700"
          : "border border-stone-300 bg-white text-stone-600 hover:border-indigo-300 hover:text-indigo-700"
      )}
    >
      {feedback?.kind === kind && feedback.ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {feedback?.kind === kind ? (feedback.ok ? "已复制" : "复制失败，请手动选中") : primary ? "一键复制" : "复制"}
    </button>
  );

  const barButton = (label: string, icon: React.ReactNode, onClick: () => void, tone: "primary" | "soft") => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
        tone === "primary"
          ? "border border-stone-300 bg-white text-stone-700 hover:border-indigo-300 hover:text-indigo-700"
          : "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-100 hover:bg-indigo-100"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <>
      {variant === "toolbar" ? (
        <div className="flex flex-wrap items-center gap-2">
          {barButton("导出实验数据", <Download className="h-3.5 w-3.5" />, download, "primary")}
          {barButton("导入实验数据", <Upload className="h-3.5 w-3.5" />, () => open("data"), "primary")}
          {barButton("复制 AI Prompt", <ClipboardList className="h-3.5 w-3.5" />, () => open("prompt"), "soft")}
          {barButton("查看 Schema", <Braces className="h-3.5 w-3.5" />, () => open("schema"), "soft")}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={download}
            className="rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
          >
            导出此表
          </button>
          <button
            type="button"
            onClick={() => open("data")}
            className="rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
          >
            导入此表
          </button>
          <button
            type="button"
            onClick={() => open("schema")}
            className="rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
          >
            Schema
          </button>
        </div>
      )}

      {tab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-3 sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTab(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${scopeLabel} 数据交换`}
            className="flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
              <div>
                <h2 className="text-[15px] font-bold text-stone-800">{scope.kind === "table" ? "表格数据交换" : "实验数据交换"}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-400">
                  {scopeLabel}
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">
                    {scope.kind === "table" ? "单表" : "整实验"}
                  </span>
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setTab(null)}
                aria-label="关闭"
                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-1 border-b border-stone-200 px-4">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => open(item.id)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors",
                    tab === item.id
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-stone-400 hover:text-stone-700"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === "data" && (
                <div className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-stone-700">导出（严格 JSON）</p>
                      <div className="flex items-center gap-2">
                        {copyButton("data", exportJson)}
                        <button
                          type="button"
                          onClick={download}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-indigo-700"
                        >
                          <Download className="h-3.5 w-3.5" />
                          下载 JSON
                        </button>
                      </div>
                    </div>
                    <textarea
                      readOnly
                      value={exportJson}
                      spellCheck={false}
                      className="h-44 w-full resize-y rounded-lg border border-stone-200 bg-stone-50 p-2.5 font-mono text-[11px] leading-relaxed text-stone-600 outline-none"
                    />
                  </div>
                  <ArtifactImportPanel spec={spec} scope={scope} onImport={onImport} onDone={() => setTab(null)} />
                </div>
              )}

              {tab === "schema" && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-stone-700">JSONC 模板（带注释，可直接交给 AI）</p>
                    <div className="flex items-center gap-2">
                      {copyButton("schema", schema)}
                      <button
                        type="button"
                        onClick={() =>
                          downloadText(`${safeFilePart(spec.id)}-${scope.kind === "table" ? scope.tableId : "schema"}.jsonc`, schema, "text/plain;charset=utf-8")
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-600 transition-colors hover:border-indigo-300 hover:text-indigo-700"
                      >
                        <Download className="h-3.5 w-3.5" />
                        下载
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    value={schema}
                    spellCheck={false}
                    className="h-[52vh] w-full resize-y rounded-lg border border-stone-200 bg-stone-50 p-2.5 font-mono text-[11px] leading-relaxed text-stone-600 outline-none"
                  />
                </div>
              )}

              {tab === "prompt" && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-stone-700">一键复制 Prompt（含来龙去脉、公式与全部表格 Schema）</p>
                    {copyButton("prompt", prompt, true)}
                  </div>
                  <textarea
                    readOnly
                    value={prompt}
                    spellCheck={false}
                    className="h-[52vh] w-full resize-y rounded-lg border border-stone-200 bg-stone-50 p-2.5 font-mono text-[11px] leading-relaxed text-stone-600 outline-none"
                  />
                </div>
              )}

              {tab === "remarks" && (
                <div className="space-y-3">
                  <p className="text-[11px] leading-relaxed text-stone-400">
                    备注来自导入的 artifact：AI 可指出某组数据无法作图、明显异常或疑似操作失误，均只作展示，不会改动你的原始读数。
                  </p>
                  <ArtifactRemarks
                    scope={scope.kind === "table" ? "table" : "experiment"}
                    remarks={scope.kind === "table" ? tableRemarks?.[scope.tableId] : remarks}
                    computed={scope.kind === "table" ? undefined : computed}
                    columns={tableSpec?.columns}
                    tableLabels={tableLabels}
                    onClear={onClearRemarks}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
