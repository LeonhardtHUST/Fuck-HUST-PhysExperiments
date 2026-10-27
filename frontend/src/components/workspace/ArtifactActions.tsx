"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Braces,
  Camera,
  Check,
  ClipboardList,
  Copy,
  Download,
  FileUp,
  StickyNote,
  Upload,
  X,
} from "lucide-react";
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
import { buildPrompt, PROMPT_SOURCE_LABELS, type PromptSource } from "@/lib/experiment-prompt";
import { copyText, downloadText, safeFilePart } from "@/lib/clipboard";
import { scopeExperimentSpec, type ArtifactScope, type DecodeOk } from "@/lib/artifact-scope";
import ArtifactImportPanel from "./ArtifactImportPanel";
import ArtifactRemarks from "./ArtifactRemarks";
import OcrTableImporter from "./OcrTableImporter";

/** 拍照录入的目标表格：由各工作台提供「写回哪张表」的闭包 */
export interface OcrTarget {
  tableId: string;
  title: string;
  expectedCellCount: number;
  apply: (values: string[], overwriteExisting: boolean) => void;
}

/** 两个语义入口：把数据弄进来 / 把数据拿走 */
type Section = "import" | "export";

/** 导入弹窗内的分工：拍照、贴文件、生成 Prompt、看模板、看上次导入的备注 */
type ImportTab = "ocr" | "data" | "prompt" | "schema" | "remarks";

const IMPORT_TABS: { id: ImportTab; label: string; icon: React.ReactNode }[] = [
  { id: "ocr", label: "拍照录入", icon: <Camera className="h-3.5 w-3.5" /> },
  { id: "data", label: "粘贴 / 文件", icon: <FileUp className="h-3.5 w-3.5" /> },
  { id: "prompt", label: "AI Prompt", icon: <ClipboardList className="h-3.5 w-3.5" /> },
  { id: "schema", label: "Schema", icon: <Braces className="h-3.5 w-3.5" /> },
  { id: "remarks", label: "导入备注", icon: <StickyNote className="h-3.5 w-3.5" /> },
];

const PROMPT_SOURCE_ORDER: PromptSource[] = ["photo", "electronic"];

const PROMPT_SOURCE_HINTS: Record<PromptSource, string> = {
  photo:
    "把记录表拍照或扫描后交给 AI 用这个版本：提示词要求它只依据图片取数、看不清的格子留空，并按纸面分辨率保留读数。",
  electronic:
    "数据来自仪器导出文件、CSV / Excel 或直接贴出的数据表时用这个版本：去掉了照片版的取数约束，改为强调列映射、单位换算、占位符与行数精度。",
};

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
  /** 可拍照录入的表格；有值时导入弹窗会出现「拍照录入」页 */
  ocrTargets?: OcrTarget[];
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
  ocrTargets,
  variant = "toolbar",
}: ArtifactActionsProps) {
  const spec = useMemo(() => tryGetExperimentSpec(experimentId), [experimentId]);
  const context = useMemo(() => getPromptContext(experimentId), [experimentId]);
  const scoped = useMemo(() => (spec ? scopeExperimentSpec(spec, scope) : undefined), [spec, scope]);

  const [section, setSection] = useState<Section | null>(null);
  const [importTab, setImportTab] = useState<ImportTab>("data");
  const [exportJson, setExportJson] = useState("");
  const [promptSource, setPromptSource] = useState<PromptSource>("photo");
  const [ocrTableId, setOcrTableId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: string; ok: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 工作台外层容器带 transform 动画，会把这层 fixed 遮罩锚到容器而不是视口，
  // 弹窗因此会跑到屏幕下半部分——挂到 body 上才能真正常驻居中。
  useEffect(() => setMounted(true), []);

  const targets = ocrTargets ?? [];
  const hasNotes =
    scope.kind === "table"
      ? Boolean(tableRemarks?.[scope.tableId])
      : Boolean(
          remarks ||
            Object.keys(tableRemarks ?? {}).length ||
            Object.keys(computed ?? {}).length
        );

  const importTabs = useMemo(
    () =>
      IMPORT_TABS.filter((item) => {
        if (item.id === "ocr") return targets.length > 0;
        if (item.id === "remarks") return hasNotes || importTab === "remarks";
        return true;
      }),
    [hasNotes, importTab, targets.length]
  );

  const defaultImportTab: ImportTab = targets.length > 0 ? "ocr" : "data";

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!section) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSection(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [section]);

  const prompt = useMemo(
    () =>
      section === "import" && importTab === "prompt" && scoped
        ? buildPrompt(scoped, context, { source: promptSource })
        : "",
    [context, importTab, promptSource, scoped, section]
  );

  const schema = useMemo(() => {
    if (section !== "import" || importTab !== "schema" || !spec || !scoped) return "";
    return scope.kind === "table"
      ? buildTableSchemaJsonc(spec, scope.tableId, context)
      : buildExperimentSchemaJsonc(spec, context);
  }, [context, importTab, scope, scoped, section, spec]);

  const openImport = useCallback(
    (tab?: ImportTab) => {
      if (!spec || !scoped) return;
      setImportTab(tab ?? defaultImportTab);
      setSection("import");
    },
    [defaultImportTab, scoped, spec]
  );

  const openExport = useCallback(() => {
    if (!spec || !scoped) return;
    setExportJson(encodeArtifact(scoped, collect()));
    setSection("export");
  }, [collect, scoped, spec]);

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
  const activeTarget = targets.find((target) => target.tableId === ocrTableId) ?? targets[0];

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
          ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-100 hover:bg-indigo-100"
          : "border border-stone-300 bg-white text-stone-700 hover:border-indigo-300 hover:text-indigo-700"
      )}
    >
      {icon}
      {label}
    </button>
  );

  const linkButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
    >
      {label}
    </button>
  );

  const dialogTitle = section === "export" ? "导出实验数据" : "导入实验数据";

  return (
    <>
      {variant === "toolbar" ? (
        <div className="flex flex-wrap items-center gap-2">
          {barButton("导入数据", <Upload className="h-3.5 w-3.5" />, () => openImport(), "primary")}
          {barButton("导出数据", <Download className="h-3.5 w-3.5" />, openExport, "soft")}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {linkButton("导入此表", () => openImport())}
          {linkButton("导出此表", openExport)}
        </div>
      )}

      {section && mounted &&
        createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-3 sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSection(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${scopeLabel} ${dialogTitle}`}
            className={cn(
              "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl transition-[max-width]",
              section === "import" && importTab === "ocr" ? "max-w-[980px]" : "max-w-[720px]"
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
              <div>
                <h2 className="text-[15px] font-bold text-stone-800">
                  {scope.kind === "table" ? `${dialogTitle}（单表）` : dialogTitle}
                </h2>
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
                onClick={() => setSection(null)}
                aria-label="关闭"
                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {section === "import" && (
              <div className="flex gap-1 overflow-x-auto border-b border-stone-200 px-4">
                {importTabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setImportTab(item.id)}
                    className={cn(
                      "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors",
                      importTab === item.id
                        ? "border-indigo-600 text-indigo-700"
                        : "border-transparent text-stone-400 hover:text-stone-700"
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {section === "export" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-stone-700">
                      导出当前读数（严格 JSON，不含任何计算结果）
                    </p>
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
                    className="h-[52vh] w-full resize-y rounded-lg border border-stone-200 bg-stone-50 p-2.5 font-mono text-[11px] leading-relaxed text-stone-600 outline-none"
                  />
                  <p className="text-[11px] leading-relaxed text-stone-400">
                    文件里出现的表才会被导入覆盖；没提到的表、备注一律保留。这份 JSON 也可以交给 AI 做误差分析或直接存档。
                  </p>
                </div>
              )}

              {section === "import" && importTab === "ocr" && (
                <div className="space-y-3">
                  <p className="text-[11px] leading-relaxed text-stone-500">
                    拍下记录表后框选数据区域，识别结果先在这里逐格复核，确认无误再填入表格；裁剪在浏览器本地完成，只有框选区域会上传。
                  </p>
                  {targets.length > 1 && (
                    <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-600">
                      识别到哪张表
                      <select
                        value={activeTarget?.tableId ?? ""}
                        onChange={(event) => setOcrTableId(event.target.value)}
                        className="h-8 min-w-48 rounded-lg border border-stone-300 bg-white px-2 text-xs font-medium text-stone-700 outline-none focus:border-indigo-400"
                      >
                        {targets.map((target) => (
                          <option key={target.tableId} value={target.tableId}>
                            {target.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {activeTarget ? (
                    <OcrTableImporter
                      key={activeTarget.tableId}
                      embedded
                      experimentId={experimentId}
                      tableId={activeTarget.tableId}
                      expectedCellCount={activeTarget.expectedCellCount}
                      onApply={activeTarget.apply}
                      onApplied={() => setSection(null)}
                    />
                  ) : (
                    <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
                      当前没有可写入的表格。
                    </p>
                  )}
                </div>
              )}

              {section === "import" && importTab === "data" && (
                <div className="space-y-3">
                  <ArtifactImportPanel
                    spec={spec}
                    scope={scope}
                    onImport={onImport}
                    onDone={() => setSection(null)}
                  />
                  <p className="text-[11px] leading-relaxed text-stone-400">
                    还没有数据文件？切到「AI Prompt」生成提示词，交给 AI 读记录表或整理电子数据，再把返回的 jsonc 粘回这里。
                  </p>
                </div>
              )}

              {section === "import" && importTab === "prompt" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      role="tablist"
                      aria-label="AI Prompt 版本"
                      className="inline-flex rounded-lg bg-stone-100 p-0.5"
                    >
                      {PROMPT_SOURCE_ORDER.map((source) => (
                        <button
                          key={source}
                          type="button"
                          role="tab"
                          aria-selected={promptSource === source}
                          onClick={() => setPromptSource(source)}
                          className={cn(
                            "rounded-[7px] px-3 py-1.5 text-[11px] font-bold transition-colors",
                            promptSource === source
                              ? "bg-white text-indigo-700 shadow-sm ring-1 ring-inset ring-indigo-100"
                              : "text-stone-500 hover:text-stone-700"
                          )}
                        >
                          {PROMPT_SOURCE_LABELS[source]}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      {copyButton("prompt", prompt, true)}
                      <button
                        type="button"
                        onClick={() =>
                          downloadText(
                            `${safeFilePart(spec.id)}-prompt-${promptSource}.md`,
                            prompt,
                            "text/markdown;charset=utf-8"
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-600 transition-colors hover:border-indigo-300 hover:text-indigo-700"
                      >
                        <Download className="h-3.5 w-3.5" />
                        下载
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-stone-500">{PROMPT_SOURCE_HINTS[promptSource]}</p>
                  <textarea
                    readOnly
                    value={prompt}
                    spellCheck={false}
                    className="h-[48vh] w-full resize-y rounded-lg border border-stone-200 bg-stone-50 p-2.5 font-mono text-[11px] leading-relaxed text-stone-600 outline-none"
                  />
                  <p className="text-[11px] leading-relaxed text-stone-400">
                    Prompt 已包含来龙去脉、公式与全部表格 Schema；AI 返回 jsonc 后，用「粘贴 / 文件」导入。
                  </p>
                </div>
              )}

              {section === "import" && importTab === "schema" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-stone-700">JSONC 模板（带注释，可直接交给 AI）</p>
                    <div className="flex items-center gap-2">
                      {copyButton("schema", schema)}
                      <button
                        type="button"
                        onClick={() =>
                          downloadText(
                            `${safeFilePart(spec.id)}-${scope.kind === "table" ? scope.tableId : "schema"}.jsonc`,
                            schema,
                            "text/plain;charset=utf-8"
                          )
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
                  <p className="text-[11px] leading-relaxed text-stone-400">
                    这里只有空模板，没有实验背景与填写规则；需要让 AI 一次做对时用「AI Prompt」。
                  </p>
                </div>
              )}

              {section === "import" && importTab === "remarks" && (
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
        </div>,
        document.body
      )}
    </>
  );
}
