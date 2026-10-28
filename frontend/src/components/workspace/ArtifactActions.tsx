"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Braces,
  Camera,
  Check,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileDown,
  FileText,
  FileType,
  FileUp,
  Loader2,
  StickyNote,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportFormat } from "@/lib/api";
import type { DataCollectionController } from "@/hooks/useDataCollection";
import type { ConsentGate } from "@/hooks/useDataCollectionConsent";
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
import DataCollectionOptInRow from "./DataCollectionOptInRow";
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

/** 导出弹窗里的分工：报告、纸质记录表、读数 JSON 都从这一个入口拿 */
export type ExportTab = "report" | "record" | "data";

/** 导入弹窗内的分工：拍照、贴文件、生成 Prompt、看模板、看上次导入的备注 */
type ImportTab = "ocr" | "data" | "prompt" | "schema" | "remarks";

const IMPORT_TABS: { id: ImportTab; label: string; icon: React.ReactNode }[] = [
  { id: "ocr", label: "拍照录入", icon: <Camera className="h-3.5 w-3.5" /> },
  { id: "data", label: "粘贴 / 文件", icon: <FileUp className="h-3.5 w-3.5" /> },
  { id: "prompt", label: "AI Prompt", icon: <ClipboardList className="h-3.5 w-3.5" /> },
  { id: "schema", label: "Schema", icon: <Braces className="h-3.5 w-3.5" /> },
  { id: "remarks", label: "导入备注", icon: <StickyNote className="h-3.5 w-3.5" /> },
];

const EXPORT_TAB_LABELS: Record<ExportTab, string> = {
  report: "完整报告",
  record: "纸质记录表",
  data: "读数 JSON",
};

const EXPORT_TAB_ICONS: Record<ExportTab, React.ReactNode> = {
  report: <FileText className="h-3.5 w-3.5" />,
  record: <FileDown className="h-3.5 w-3.5" />,
  data: <Braces className="h-3.5 w-3.5" />,
};

const REPORT_BUTTONS: {
  format: ReportFormat;
  label: string;
  hint: string;
  icon: React.ReactNode;
  tone: "solid" | "primary" | "soft";
}[] = [
  { format: "docx", label: "Word", hint: "排版稿，可直接提交", icon: <FileText className="h-3.5 w-3.5" />, tone: "solid" },
  { format: "pdf", label: "PDF", hint: "排版稿，版式固定", icon: <Download className="h-3.5 w-3.5" />, tone: "primary" },
  { format: "md", label: "Markdown", hint: "文本稿，图片内嵌", icon: <FileType className="h-3.5 w-3.5" />, tone: "soft" },
  { format: "jsonc", label: "JSONC", hint: "文本稿，带注释结构", icon: <FileCode2 className="h-3.5 w-3.5" />, tone: "soft" },
];

/** 完整报告导出：回调由工作台提供，弹窗只负责摆放与忙碌态 */
export interface ExperimentReportExport {
  download: (format: ReportFormat) => Promise<void> | void;
  /** 必做数据未齐时整组禁用，并说明还差什么 */
  disabled?: boolean;
  disabledHint?: string;
  /** 报告包含哪些内容的说明 */
  description?: string;
  /** 匿名化数据收集入口：常驻在报告页签，导出前一定看得到 */
  collection?: { collection: DataCollectionController; gate: ConsentGate };
}

/** 纸质记录表导出 */
export interface RecordSheetExport {
  preview: () => Promise<void> | void;
  download: (format: "docx" | "pdf") => Promise<void> | void;
}

/** 页面内其它入口（报告横幅等）复用它打开同一个弹窗 */
export interface ArtifactActionsHandle {
  /** 打开导出弹窗；不传页签则落在第一个可用页签 */
  openExport: (tab?: ExportTab) => void;
  openImport: () => void;
}

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
  /** 完整报告导出：有值时导出弹窗出现「完整报告」页签 */
  report?: ExperimentReportExport | null;
  /** 纸质记录表导出：有值时导出弹窗出现「纸质记录表」页签 */
  recordSheet?: RecordSheetExport | null;
  /** 工作台展示下载错误的那一行文案，弹窗里同步显示 */
  error?: string | null;
  /** 页面内其它按钮（横幅、结果卡）通过它打开同一个弹窗 */
  ref?: React.Ref<ArtifactActionsHandle>;
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
  report,
  recordSheet,
  error,
  ref,
  variant = "toolbar",
}: ArtifactActionsProps) {
  const spec = useMemo(() => tryGetExperimentSpec(experimentId), [experimentId]);
  const context = useMemo(() => getPromptContext(experimentId), [experimentId]);
  const scoped = useMemo(() => (spec ? scopeExperimentSpec(spec, scope) : undefined), [spec, scope]);

  const [section, setSection] = useState<Section | null>(null);
  const [importTab, setImportTab] = useState<ImportTab>("data");
  const [exportTab, setExportTab] = useState<ExportTab>("data");
  const [exportJson, setExportJson] = useState("");
  const [promptSource, setPromptSource] = useState<PromptSource>("photo");
  const [ocrTableId, setOcrTableId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 工作台外层容器带 transform 动画，会把这层 fixed 遮罩锚到容器而不是视口，
  // 弹窗因此会跑到屏幕下半部分——挂到 body 上才能真正常驻居中。
  useEffect(() => setMounted(true), []);

  /** 页签顺序固定：报告 → 记录表 → 读数；没有的页签不出现 */
  const exportTabs = useMemo<ExportTab[]>(() => {
    const tabs: ExportTab[] = [];
    if (report) tabs.push("report");
    if (recordSheet) tabs.push("record");
    tabs.push("data");
    return tabs;
  }, [recordSheet, report]);

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

  const openExport = useCallback(
    (tab?: ExportTab) => {
      if (!spec || !scoped) return;
      setExportJson(encodeArtifact(scoped, collect()));
      setExportTab(tab && exportTabs.includes(tab) ? tab : (exportTabs[0] ?? "data"));
      setLocalError(null);
      setSection("export");
    },
    [collect, exportTabs, scoped, spec]
  );

  // 页面内的横幅按钮不自己实现下载，只把同一个弹窗打开到对应页签。
  useImperativeHandle(ref, () => ({ openExport, openImport }), [openExport, openImport]);

  /** 弹窗内的下载：忙碌态与错误都留在这里，页面上的 busyKey 仍由调用方管理 */
  const run = async (key: string, action: () => Promise<void> | void) => {
    if (pending) return;
    setPending(key);
    setLocalError(null);
    try {
      await action();
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setPending(null);
    }
  };

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

  const barButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    tone: "primary" | "soft",
    title = label
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
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

  const dialogTitle = section === "export" ? "导出" : "导入实验数据";

  return (
    <>
      {variant === "toolbar" ? (
        <div className="flex flex-wrap items-center gap-2">
          {barButton("导入数据", <Upload className="h-3.5 w-3.5" />, () => openImport(), "primary")}
          {barButton("导出", <Download className="h-3.5 w-3.5" />, () => openExport(), "soft", "导出报告 / 记录表 / 读数")}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {linkButton("导入此表", () => openImport())}
          {linkButton("导出此表", () => openExport())}
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

            {section === "export" && exportTabs.length > 1 && (
              <div className="flex gap-1 overflow-x-auto border-b border-stone-200 px-4">
                {exportTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setExportTab(tab)}
                    className={cn(
                      "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors",
                      exportTab === tab
                        ? "border-indigo-600 text-indigo-700"
                        : "border-transparent text-stone-400 hover:text-stone-700"
                    )}
                  >
                    {EXPORT_TAB_ICONS[tab]}
                    {EXPORT_TAB_LABELS[tab]}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {section === "export" && exportTab === "report" && report && (
                <div className="space-y-4">
                  <p className="text-xs leading-relaxed text-stone-500">
                    {report.description ??
                      "完整报告按四部分排列：全部表格 → 全部图片 → 详细数据处理 → 拓展、建议、误差分析与总结。"}
                  </p>

                  {report.collection && (
                    <DataCollectionOptInRow
                      variant="panel"
                      collection={report.collection.collection}
                      gate={report.collection.gate}
                    />
                  )}

                  {report.disabled && report.disabledHint && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 font-medium text-amber-700">
                      {report.disabledHint}
                    </p>
                  )}

                  <div className="grid gap-2 sm:grid-cols-2">
                    {REPORT_BUTTONS.map((item) => (
                      <button
                        key={item.format}
                        type="button"
                        title={item.hint}
                        disabled={!!pending || !!report.disabled}
                        onClick={() => void run(`report-${item.format}`, () => report.download(item.format))}
                        className={cn(
                          "inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                          item.tone === "solid" && "bg-stone-900 text-white hover:bg-stone-700",
                          item.tone === "primary" && "bg-indigo-600 text-white hover:bg-indigo-700",
                          item.tone === "soft" &&
                            "border border-stone-300 bg-white text-stone-700 hover:border-indigo-300 hover:text-indigo-700"
                        )}
                      >
                        {pending === `report-${item.format}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          item.icon
                        )}
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <p className="text-[11px] leading-relaxed text-stone-400">
                    Word / PDF 是排版稿，可直接提交；Markdown / JSONC 是文本稿。报告取自当前全部已填数据，
                    未填的选做方法自动跳过，必做缺项会在正文中标注。
                  </p>
                </div>
              )}

              {section === "export" && exportTab === "record" && recordSheet && (
                <div className="space-y-4">
                  <p className="text-xs leading-relaxed text-stone-500">
                    标准记录表与页面里的表格一致，打印后手写读数；也可以先下载空白表，写完再拍照录回来。
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => void run("record-preview", recordSheet.preview)}
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-700 transition-colors hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40"
                    >
                      {pending === "record-preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                      预览
                    </button>
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => void run("record-docx", () => recordSheet.download("docx"))}
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-stone-900 text-xs font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-40"
                    >
                      {pending === "record-docx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                      Word
                    </button>
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => void run("record-pdf", () => recordSheet.download("pdf"))}
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {pending === "record-pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      PDF
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-stone-400">
                    预览会在新标签页打开 PDF；下载的是当前实验的标准记录表，不含已录入的读数。
                  </p>
                </div>
              )}

              {section === "export" && exportTab === "data" && (
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

              {section === "export" && (localError || error) && (
                <p className="mt-3 text-[11px] font-medium text-red-600" role="alert">
                  {localError ?? error}
                </p>
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
