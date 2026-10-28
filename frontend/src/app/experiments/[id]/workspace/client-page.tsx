"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Table2,
  ClipboardList,
  ChartSpline,
  ChartLine,
  Sigma,
  Waves,
  Orbit,
  Download,
  FileDown,
  RefreshCw,
  Loader2,
  FileCode2,
  FileType,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ListChecks,
} from "lucide-react";
import { getExperiment } from "@/lib/experiments";
import {
  API_BASE,
  processPolarization,
  trackEvent,
  downloadRecordSheet,
  previewRecordSheet,
  downloadReport,
  type ProcessRequest,
  type ProcessResponse,
  type ReportFormat,
} from "@/lib/api";
import DataInputTable from "@/components/workspace/DataInputTable";
import ArtifactActions, { type OcrTarget } from "@/components/workspace/ArtifactActions";
import { applyOcrValues, editableCellCount } from "@/lib/ocr-apply";
import ArtifactRemarks from "@/components/workspace/ArtifactRemarks";
import { rowIndexValue } from "@/lib/table-specs";
import { getExperimentSpec } from "@/lib/experiment-specs";
import type { ArtifactInput } from "@/lib/experiment-artifact";
import {
  hasArtifactNotes,
  mergeArtifactNotes,
  type ArtifactNotes,
  type DecodeOk,
} from "@/lib/artifact-scope";
import { trimTrailingEmptyRows } from "@/components/workspace/table-rows";
import { DraftClearMenu, DraftRestoreBanner } from "@/components/workspace/WorkspaceDraftControls";
import DataCollectionConsentOverlays from "@/components/workspace/DataCollectionConsentOverlays";
import DataCollectionOptInRow from "@/components/workspace/DataCollectionOptInRow";
import { useDataCollectionConsent } from "@/hooks/useDataCollectionConsent";
import SoundLightWorkspace from "@/components/workspace/SoundLightWorkspace";
import GenericExperimentWorkspace from "@/components/workspace/GenericExperimentWorkspace";
import { useDataCollection } from "@/hooks/useDataCollection";
import { useWorkspaceDraft } from "@/hooks/useWorkspaceDraft";
import type { DraftPayload } from "@/lib/workspace-draft";
import { POLARIZATION_WORKSPACE_STEPS } from "@/components/workspace/workspace-entry-flow";
import { cn } from "@/lib/utils";
import { getInputRange, isOutsideRange, rangeLabel } from "@/lib/input-ranges";

type Step = (typeof POLARIZATION_WORKSPACE_STEPS)[number];

const STEP_META: Record<Step, { label: string; icon: React.ElementType }> = {
  input: { label: "录入数据", icon: Table2 },
  confirm: { label: "确认数据", icon: ClipboardList },
  results: { label: "结果", icon: ChartSpline },
};

const STEPS = POLARIZATION_WORKSPACE_STEPS.map((id) => ({ id, ...STEP_META[id] }));

const SUB_ICON: Record<string, React.ElementType> = {
  malus: ChartLine,
  halfwave: Sigma,
  quarterwave: Waves,
  circular: Orbit,
};

/** 偏振光的表头/只读角度规则与 artifact 共用同一份声明式定义。 */
const POLARIZATION_SPEC = getExperimentSpec("polarization");

const EMPTY_NOTES: ArtifactNotes = { remarks: null, tableRemarks: {}, computed: {} };

/** 页面默认值：清空与「首次打开」必须完全一致，否则会误判成有草稿。 */
const DEFAULT_SETUP = { bg_uw: "0.0543", theta_qwp: "30" } as const;

function initialHwInit() {
  return { c_deg: "", c_min: "", p2_deg: "", p2_min: "" };
}

function initialMalus(): string[][] {
  return Array.from({ length: 10 }, (_, index) => [String(90 - index * 10), "", ""]);
}

function initialHalfwave(): string[][] {
  return Array.from({ length: 6 }, (_, index) => [String(index * 10), "", "", "", ""]);
}

function initialAngle(): string[][] {
  return Array.from({ length: 36 }, (_, index) => [String(index * 10), ""]);
}

const TABLE_RESET: Record<string, () => string[][]> = {
  malus: initialMalus,
  halfwave: initialHalfwave,
  quarterwave: initialAngle,
  circular: initialAngle,
};

function gridToRecords(tableId: string, grid: string[][]): Record<string, string>[] {
  const table = POLARIZATION_SPEC.tables.find((item) => item.tableId === tableId);
  if (!table) return [];
  return grid.map((row) =>
    Object.fromEntries(table.columns.map((column, index) => [column.key, row[index] ?? ""]))
  );
}

/** 只读角度列按行序重建，与导入/增行的规则一致。 */
function recordsToGrid(tableId: string, records: Record<string, string>[]): string[][] {
  const table = POLARIZATION_SPEC.tables.find((item) => item.tableId === tableId);
  if (!table) return [];
  return records.map((record, rowIndex) =>
    table.columns.map((column) => {
      const derived = rowIndexValue(column, rowIndex);
      return derived !== undefined ? String(derived) : (record[column.key] ?? "");
    })
  );
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function PolarizationWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const experiment = getExperiment(id);
  const collection = useDataCollection("polarization");
  const gate = useDataCollectionConsent(collection);
  useEffect(() => {
    void trackEvent("workspace_start", id);
  }, [id]);

  const [step, setStep] = useState<Step>(POLARIZATION_WORKSPACE_STEPS[0]);
  const [activeTab, setActiveTab] = useState("malus");

  // Setup
  const [bgUw, setBgUw] = useState<string>(DEFAULT_SETUP.bg_uw);
  const [thetaQwp, setThetaQwp] = useState<string>(DEFAULT_SETUP.theta_qwp);

  // Malus data: 90,80,...,0
  const [malusData, setMalusData] = useState<string[][]>(initialMalus);

  // HalfWave initial
  const [hwInit, setHwInit] = useState(initialHwInit);
  // HalfWave rows
  const [hwData, setHwData] = useState<string[][]>(initialHalfwave);

  // QuarterWave: 36 rows
  const [qwData, setQwData] = useState<string[][]>(initialAngle);

  // Circular: 36 rows
  const [circData, setCircData] = useState<string[][]>(initialAngle);

  // Results
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const [notes, setNotes] = useState<ArtifactNotes | null>(null);

  const runDownload = async (key: string, action: () => Promise<void>) => {
    if (busyKey) return;
    setBusyKey(key);
    setDlError(null);
    try {
      await action();
    } catch (e) {
      setDlError(e instanceof Error ? e.message : "下载失败");
    } finally {
      setBusyKey(null);
    }
  };

  const buildRequest = useCallback((): ProcessRequest => {
    // 首列是角度/偏移量，不参与“空行”判断；只裁末尾空行，行数由实际录入决定
    const trim = (rows: string[][]) => trimTrailingEmptyRows(rows, { ignoreColumns: [0] });
    const malusRows = trim(malusData);
    const hwRows = trim(hwData);
    const qwRows = trim(qwData);
    const circRows = trim(circData);
    return {
      bg_uw: parseFloat(bgUw) || 0,
      theta_qwp: numberOrNull(thetaQwp) ?? 30,
      malus: {
        rows: malusRows.map((r) => ({
          theta: parseFloat(r[0]) || 0,
          i_left: r[1] ? parseFloat(r[1]) : null,
          i_right: r[2] ? parseFloat(r[2]) : null,
        })),
      },
      halfwave: {
        initial: {
          c_deg: numberOrNull(hwInit.c_deg),
          c_min: parseFloat(hwInit.c_min) || 0,
          p2_deg: numberOrNull(hwInit.p2_deg),
          p2_min: parseFloat(hwInit.p2_min) || 0,
        },
        rows: hwRows.map((r) => ({
          offset: parseFloat(r[0]) || 0,
          c_deg: numberOrNull(r[1]),
          c_min: parseFloat(r[2]) || 0,
          p2_deg: numberOrNull(r[3]),
          p2_min: parseFloat(r[4]) || 0,
        })),
      },
      quarterwave: {
        rows: qwRows.map((r) => ({
          phi: parseFloat(r[0]) || 0,
          i_raw: r[1] ? parseFloat(r[1]) : null,
        })),
      },
      circular: {
        rows: circRows.map((r) => ({
          angle: parseFloat(r[0]) || 0,
          i_raw: r[1] ? parseFloat(r[1]) : null,
        })),
      },
    };
  }, [bgUw, thetaQwp, malusData, hwInit, hwData, qwData, circData]);

  const downloadFinalReport = async (format: ReportFormat) => {
    // One-time consent question before the first report; already answered,
    // backend disabled or status still loading all pass straight through.
    if (!(await gate.ensureDecided())) return;
    const data = buildRequest();
    await downloadReport(format, data);
    await collection.commit(data);
  };

  const collectArtifact = (): ArtifactInput => {
    const trim = (rows: string[][], keep: number) =>
      trimTrailingEmptyRows(rows, { keep, ignoreColumns: [0] });
    return {
      setupParams: { bg_uw: bgUw, theta_qwp: thetaQwp },
      tables: {
        malus: {
          rows: trim(malusData, 2).map((row) => ({
            theta: row[0],
            i_left: row[1] ?? "",
            i_right: row[2] ?? "",
          })),
          remarks: notes?.tableRemarks.malus,
        },
        halfwave: {
          params: hwInit,
          rows: trim(hwData, 2).map((row) => ({
            offset: row[0],
            c_deg: row[1] ?? "",
            c_min: row[2] ?? "",
            p2_deg: row[3] ?? "",
            p2_min: row[4] ?? "",
          })),
          remarks: notes?.tableRemarks.halfwave,
        },
        quarterwave: {
          rows: trim(qwData, 3).map((row) => ({ phi: row[0], i_raw: row[1] ?? "" })),
          remarks: notes?.tableRemarks.quarterwave,
        },
        circular: {
          rows: trim(circData, 3).map((row) => ({ angle: row[0], i_raw: row[1] ?? "" })),
          remarks: notes?.tableRemarks.circular,
        },
      },
      remarks: notes?.remarks ?? undefined,
      computed: notes?.computed,
    };
  };

  /** 只读角度列按行序重建（与 onAddRow 的规则一致），避免行序与角度错位。 */
  const applyArtifact = (decoded: DecodeOk) => {
    for (const table of decoded.tables) {
      const specTable = POLARIZATION_SPEC.tables.find((item) => item.tableId === table.tableId);
      if (!specTable) continue;
      const rowCount = Math.max(table.rows.length, specTable.minRows);
      const next = Array.from({ length: rowCount }, (_, rowIndex) => {
        const imported = table.rows[rowIndex] ?? {};
        return specTable.columns.map((column) => {
          const derived = rowIndexValue(column, rowIndex);
          if (derived !== undefined) return String(derived);
          const value = imported[column.key];
          return value === null || value === undefined ? "" : String(value);
        });
      });
      if (table.tableId === "malus") setMalusData(next);
      else if (table.tableId === "halfwave") setHwData(next);
      else if (table.tableId === "quarterwave") setQwData(next);
      else if (table.tableId === "circular") setCircData(next);

      if (table.tableId === "halfwave") {
        const patch: Partial<typeof hwInit> = {};
        (["c_deg", "c_min", "p2_deg", "p2_min"] as const).forEach((key) => {
          const value = table.params[key];
          if (value !== undefined && value !== null) patch[key] = String(value);
        });
        if (Object.keys(patch).length > 0) setHwInit((previous) => ({ ...previous, ...patch }));
      }
    }

    const setup = decoded.setupParams ?? {};
    if (setup.bg_uw !== undefined && setup.bg_uw !== null) setBgUw(String(setup.bg_uw));
    if (setup.theta_qwp !== undefined && setup.theta_qwp !== null) setThetaQwp(String(setup.theta_qwp));

    setNotes((previous) => mergeArtifactNotes(previous, decoded));
    setResult(null);
    setError(null);
  };

  const clearTableNotes = (tableId: string) => {
    setNotes((previous) => {
      if (!previous) return previous;
      const tableRemarks = { ...previous.tableRemarks };
      delete tableRemarks[tableId];
      return { ...previous, tableRemarks };
    });
  };

  // ---- local draft (localStorage) ----
  const applyDraftPayload = (payload: DraftPayload) => {
    setMalusData(recordsToGrid("malus", payload.tables.malus?.rows ?? []));
    setHwData(recordsToGrid("halfwave", payload.tables.halfwave?.rows ?? []));
    setQwData(recordsToGrid("quarterwave", payload.tables.quarterwave?.rows ?? []));
    setCircData(recordsToGrid("circular", payload.tables.circular?.rows ?? []));

    const halfwaveParams = payload.tables.halfwave?.params ?? {};
    setHwInit({
      c_deg: halfwaveParams.c_deg ?? "",
      c_min: halfwaveParams.c_min ?? "",
      p2_deg: halfwaveParams.p2_deg ?? "",
      p2_min: halfwaveParams.p2_min ?? "",
    });
    setBgUw(payload.setupParams.bg_uw ?? DEFAULT_SETUP.bg_uw);
    setThetaQwp(payload.setupParams.theta_qwp ?? DEFAULT_SETUP.theta_qwp);

    setNotes(hasArtifactNotes(payload.notes) ? payload.notes : null);
    setResult(null);
    setError(null);
  };

  const snapshotDraft = (): DraftPayload => ({
    setupParams: { bg_uw: bgUw, theta_qwp: thetaQwp },
    tables: {
      malus: { rows: gridToRecords("malus", malusData), params: {} },
      halfwave: { rows: gridToRecords("halfwave", hwData), params: { ...hwInit } },
      quarterwave: { rows: gridToRecords("quarterwave", qwData), params: {} },
      circular: { rows: gridToRecords("circular", circData), params: {} },
    },
    notes: notes ?? EMPTY_NOTES,
  });

  const resetTable = (tableId: string) => {
    const factory = TABLE_RESET[tableId];
    if (!factory) return;
    if (tableId === "malus") setMalusData(factory());
    else if (tableId === "halfwave") {
      setHwData(factory());
      setHwInit(initialHwInit());
    } else if (tableId === "quarterwave") setQwData(factory());
    else setCircData(factory());
    clearTableNotes(tableId);
    setResult(null);
    setError(null);
  };

  const resetAll = () => {
    setBgUw(DEFAULT_SETUP.bg_uw);
    setThetaQwp(DEFAULT_SETUP.theta_qwp);
    setHwInit(initialHwInit());
    setMalusData(initialMalus());
    setHwData(initialHalfwave());
    setQwData(initialAngle());
    setCircData(initialAngle());
    setNotes(null);
    setResult(null);
    setError(null);
    setStep("input");
  };

  const draftStore = useWorkspaceDraft({
    experimentId: POLARIZATION_SPEC.id,
    spec: POLARIZATION_SPEC,
    snapshot: snapshotDraft,
    restore: applyDraftPayload,
  });

  // ---- derived fill stats (same per-sub heuristics as submission) ----
  const fills = {
    malus: malusData.filter((r) => r[1] || r[2]).length,
    halfwave: hwData.filter((r) => r[1] && r[3]).length,
    quarterwave: qwData.filter((r) => r[1]).length,
    circular: circData.filter((r) => r[1]).length,
  };
  // 行数可自由增删，进度分母按当前实际行数统计（默认仍是讲义条数）
  const totals = {
    malus: Math.max(1, malusData.length),
    halfwave: Math.max(1, hwData.length),
    quarterwave: Math.max(1, qwData.length),
    circular: Math.max(1, circData.length),
  };
  const filledSum = Object.values(fills).reduce((a, b) => a + b, 0);
  const totalSum = Object.values(totals).reduce((a, b) => a + b, 0);

  // 首列是角度/偏移量（由行序按 10° 推导），增行时按步长补齐，删行时保留其余行角度
  const addAngleRow = (rows: string[][], step: number, start: number) => [
    ...rows.map((row) => [...row]),
    [String(start + rows.length * step), ...Array.from({ length: Math.max(0, (rows[0]?.length ?? 1) - 1) }, () => "")],
  ];
  const addMalusRow = (rows: string[][]) => {
    const last = Number(rows[rows.length - 1]?.[0] ?? "100");
    const next = Math.max(0, Number.isFinite(last) ? last - 10 : 0);
    return [
      ...rows.map((row) => [...row]),
      [String(next), "", ""],
    ];
  };

  if (!experiment) {
    return (
      <div className="container-x py-24 text-center">
        <p className="font-semibold text-stone-500">实验未找到</p>
        <Link href="/experiments" className="mt-3 inline-block text-sm text-indigo-600">
          返回实验库
        </Link>
      </div>
    );
  }

  const currentStepIndex = STEPS.findIndex((s) => s.id === step);
  const polarTable = (tableId: string) => POLARIZATION_SPEC.tables.find((table) => table.tableId === tableId);

  /** 拍照录入：可填格按行优先排序，跳过首列（角度/序号由行序推导，不参与识别） */
  const tableOcrTarget = (
    tableId: string,
    data: string[][],
    setData: (updater: (previous: string[][]) => string[][]) => void,
    readOnlyColumns: boolean[]
  ): OcrTarget => ({
    tableId,
    title: polarTable(tableId)?.title ?? tableId,
    expectedCellCount: editableCellCount(data, readOnlyColumns),
    apply: (values, overwriteExisting) =>
      setData((previous) => applyOcrValues(previous, values, { readOnlyColumns, overwriteExisting })),
  });

  const ocrTargetFor = (tableId: string): OcrTarget => {
    if (tableId === "halfwave") {
      return tableOcrTarget(tableId, hwData, setHwData, [true, false, false, false, false]);
    }
    if (tableId === "quarterwave") {
      return tableOcrTarget(tableId, qwData, setQwData, [true, false]);
    }
    if (tableId === "circular") {
      return tableOcrTarget(tableId, circData, setCircData, [true, false]);
    }
    return tableOcrTarget("malus", malusData, setMalusData, [true, false, false]);
  };
  const allOcrTargets = ["malus", "halfwave", "quarterwave", "circular"].map(ocrTargetFor);

  const tableActions = (tableId: string) => (
    <ArtifactActions
      experimentId={experiment.id}
      scope={{ kind: "table", tableId, title: polarTable(tableId)?.title ?? tableId }}
      collect={collectArtifact}
      onImport={applyArtifact}
      tableRemarks={notes?.tableRemarks}
      onClearRemarks={() => clearTableNotes(tableId)}
      ocrTargets={[ocrTargetFor(tableId)]}
      variant="table"
    />
  );

  const tableNotes = (tableId: string) => {
    const remarks = notes?.tableRemarks[tableId];
    if (!remarks) return null;
    return (
      <ArtifactRemarks
        scope="table"
        remarks={remarks}
        columns={polarTable(tableId)?.columns}
        onClear={() => clearTableNotes(tableId)}
        className="mt-3"
      />
    );
  };

  const handleProcess = async () => {
    setLoading(true);
    setError(null);
    try {
      const req = buildRequest();
      const res = await processPolarization(req);
      if (res.status === "validation_error") {
        setError(res.errors?.join("；") || "数据校验失败");
        return;
      }
      if (res.status === "calculation_error") {
        setError(res.error || "计算过程出错");
        return;
      }
      setResult(res);
      setStep("results");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(
        `计算未完成：${detail}。服务地址 ${API_BASE}，首次访问可能有约 10 秒冷启动，稍等后重试即可。` +
          "已录入的数据仍保留在本页，不需要重新输入。"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setStep("input");
  };

  const downloadPlot = (plotKey: string) => {
    if (!result?.plots[plotKey]) return;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${result.plots[plotKey]}`;
    link.download = `${experiment.id}_${plotKey}.png`;
    link.click();
  };

  const downloadAllPlots = () => {
    if (!result?.plots) return;
    Object.keys(result.plots).forEach((key) => downloadPlot(key));
  };

  const plotCount = result ? Object.keys(result.plots).length : 0;

  return (
    <div className="min-h-screen">
      <DataCollectionConsentOverlays collection={collection} gate={gate} experimentName={experiment.name} />
      {/* ===== Top bar ===== */}
      <div className="border-b border-stone-200/70 bg-white">
        <div className="container-x flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/experiments/${id}`}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <span aria-hidden className="h-4 w-px shrink-0 bg-stone-200" />
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate text-sm font-bold text-stone-900">{experiment.name}</h1>
              <span className="hidden shrink-0 text-xs font-medium text-stone-400 sm:inline">
                数据处理工作台
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {step === "results" && result?.status === "success" && (
              <button
                onClick={downloadAllPlots}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[13px] font-semibold text-white shadow-sm shadow-indigo-600/25 transition-colors hover:bg-indigo-700"
              >
                <Download className="h-3.5 w-3.5" />
                导出全部
                <span className="rounded bg-white/20 px-1 text-[11px] tabular-nums">{plotCount}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===== Stepper ===== */}
      <div className="border-b border-stone-200/60 bg-white/70 backdrop-blur">
        <div className="container-x flex items-center py-4">
          {STEPS.map((s, i) => {
            const isActive = s.id === step;
            const isCompleted = i < currentStepIndex;
            const Icon = s.icon;
            return (
              <div key={s.id} className={cn("flex items-center", i > 0 && "flex-1")}>
                {i > 0 && (
                  <div className="relative mx-3 h-[2px] flex-1 overflow-hidden rounded-full bg-stone-200 sm:mx-4">
                    {isCompleted && (
                      <div className="absolute inset-0 origin-left rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" />
                    )}
                  </div>
                )}
                <button
                  onClick={() => {
                    if (isCompleted) setStep(s.id);
                  }}
                  disabled={!isCompleted && !isActive}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-full transition-colors",
                    (isCompleted || isActive) && "cursor-pointer"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all",
                      isCompleted &&
                        "bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/25",
                      isActive &&
                        "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-4 ring-indigo-500/20",
                      !isCompleted && !isActive && "bg-stone-100 text-stone-400"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.4} />
                    ) : (
                      <Icon className="h-[17px] w-[17px]" strokeWidth={2.1} />
                    )}
                  </span>
                  <span
                    className={cn(
                      "hidden text-sm font-semibold sm:inline",
                      isActive ? "text-stone-900" : isCompleted ? "text-stone-600" : "text-stone-400"
                    )}
                  >
                    {s.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== Content ===== */}
      <div className="container-x py-8 sm:py-10">
        {/* ---------- STEP 1 · input ---------- */}
        {step === "input" && (
          <div className="mx-auto max-w-5xl animate-rise-in">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.24em] text-indigo-500">
                  Step 01 · 录入数据
                </p>
                <h2 className="text-2xl font-extrabold tracking-tight text-stone-900">
                  把纸质读数逐格敲进来
                </h2>
              </div>
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-400">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                  <ListChecks className="h-3.5 w-3.5" />
                </span>
                已录入 {filledSum}/{totalSum} 组
              </p>
            </div>

            <DraftRestoreBanner
              restoredAt={draftStore.restoredAt}
              onDismiss={draftStore.dismissRestored}
              controller={draftStore}
              onReset={resetAll}
              className="mb-4"
            />

            <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
              <ArtifactActions
                experimentId={experiment.id}
                scope={{ kind: "experiment" }}
                collect={collectArtifact}
                onImport={applyArtifact}
                remarks={notes?.remarks}
                tableRemarks={notes?.tableRemarks}
                computed={notes?.computed}
                onClearRemarks={() => setNotes(null)}
                ocrTargets={allOcrTargets}
                error={dlError}
                recordSheet={{
                  preview: () => runDownload("preview", previewRecordSheet),
                  download: (format) => runDownload(`record-${format}`, () => downloadRecordSheet(format)),
                }}
              />
              <DraftClearMenu
                tables={POLARIZATION_SPEC.tables.map((table) => ({
                  id: table.tableId,
                  title: table.title,
                }))}
                controller={draftStore}
                onClearTable={resetTable}
                onReset={resetAll}
              />
            </div>

            {notes && (
              <ArtifactRemarks
                scope="experiment"
                remarks={notes.remarks}
                computed={notes.computed}
                tableLabels={Object.fromEntries(
                  POLARIZATION_SPEC.tables.map((table) => [table.tableId, table.title])
                )}
                onClear={() => setNotes(null)}
                className="mb-6"
              />
            )}

            {/* Setup params */}
            <div className="card mb-6 flex flex-col gap-5 p-6 shadow-soft sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[15px] font-bold text-stone-900">实验参数设置</h3>
                <p className="mt-0.5 text-xs text-stone-400">整场实验共用的条件参数</p>
              </div>
              <div className="flex flex-wrap gap-4 sm:gap-6">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-stone-500">背景光强 I₀</span>
                  <span className="text-[10px] font-medium text-amber-600">{rangeLabel(getInputRange("polarization", "setup", "bg_uw"), "μW")}</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="number"
                      step="any"
                      value={bgUw}
                      onChange={(e) => setBgUw(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      aria-invalid={isOutsideRange(bgUw, getInputRange("polarization", "setup", "bg_uw")) || undefined}
                      className={cn("h-9 w-28 rounded-lg border bg-white px-3 pr-9 text-right text-sm font-medium tabular-nums shadow-sm outline-none transition-all", isOutsideRange(bgUw, getInputRange("polarization", "setup", "bg_uw")) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-200 text-stone-800 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10")}
                    />
                    <span className="pointer-events-none absolute right-3 text-xs text-stone-400">
                      μW
                    </span>
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-stone-500">1/4 波片快轴 θ_qwp</span>
                  <span className="text-[10px] font-medium text-amber-600">{rangeLabel(getInputRange("polarization", "setup", "theta_qwp"), "°")}</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={thetaQwp}
                      onChange={(e) => setThetaQwp(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      aria-label="1/4 波片快轴角度"
                      aria-invalid={isOutsideRange(thetaQwp, getInputRange("polarization", "setup", "theta_qwp")) || undefined}
                      className={cn("h-9 w-28 rounded-lg border bg-white px-3 pr-7 text-right text-sm font-medium tabular-nums shadow-sm outline-none transition-all", isOutsideRange(thetaQwp, getInputRange("polarization", "setup", "theta_qwp")) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-200 text-stone-800 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10")}
                    />
                    <span className="pointer-events-none absolute right-3 text-xs text-stone-400">
                      °
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Sub-experiment tabs */}
            <div className="mb-2 flex items-center justify-between gap-4 overflow-x-auto">
              <div className="flex gap-1" role="tablist" aria-label="子实验数据">
                {experiment.subExperiments.map((sub) => {
                  const isActive = activeTab === sub.id;
                  return (
                    <button
                      key={sub.id}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(sub.id)}
                      className={cn(
                        "relative flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm transition-colors",
                        isActive
                          ? "font-bold text-stone-900"
                          : "font-medium text-stone-400 hover:text-stone-600"
                      )}
                    >
                      {sub.name}
                      {sub.required && (
                        <span
                          className={cn(
                            "text-[11px] font-bold",
                            isActive ? "text-red-500" : "text-stone-300"
                          )}
                        >
                          必
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-full bg-gradient-to-r from-indigo-600 to-violet-600" />
                      )}
                    </button>
                  );
                })}
              </div>
              <span className="hidden shrink-0 text-[11px] text-stone-300 md:inline">
                Tab / Enter 切换单元格 · 支持整列粘贴
              </span>
            </div>

            {/* Tab panels */}
            {activeTab === "malus" && (
              <div className="animate-fade-in">
                <p className="mb-3 rounded-xl bg-indigo-50/80 px-4 py-2.5 text-[13px] leading-relaxed text-indigo-900/80 ring-1 ring-inset ring-indigo-100">
                  θ 从 <b>90°（消光）</b>到 <b>0°</b>，每 10° 记录左右旋光强 I 左 / I 右（μW）。
                </p>
                <DataInputTable
                  headers={[
                    { label: "θ (°)", readOnly: true },
                    { label: "I 左旋 (μW)", unit: "μW", range: getInputRange("polarization", "malus", "i_left") },
                    { label: "I 右旋 (μW)", unit: "μW", range: getInputRange("polarization", "malus", "i_right") },
                  ]}
                  data={malusData}
                  onChange={setMalusData}
                  resizable
                  minRows={2}
                  onAddRow={addMalusRow}
                  actions={tableActions("malus")}
                />
                {tableNotes("malus")}
              </div>
            )}

            {activeTab === "halfwave" && (
              <div className="animate-fade-in">
                <div className="card mb-3 p-5">
                  <h4 className="mb-4 flex items-center gap-2 text-[13px] font-bold text-stone-700">
                    <Sigma className="h-4 w-4 text-indigo-600" />
                    初始读数（度 + 分）
                  </h4>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {[
                      { key: "c_deg", label: "C 初始 · 度" },
                      { key: "c_min", label: "C 初始 · 分" },
                      { key: "p2_deg", label: "P2 初始 · 度" },
                      { key: "p2_min", label: "P2 初始 · 分" },
                    ].map((f) => {
                      const range = getInputRange("polarization", "halfwave", f.key);
                      const unit = f.key.endsWith("_min") ? "′" : "°";
                      const value = hwInit[f.key as keyof typeof hwInit];
                      return (
                      <label key={f.key} className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-stone-400">{f.label}</span>
                        <span className="text-[10px] font-medium text-amber-600">{rangeLabel(range, unit)}</span>
                        <input
                          type="number"
                          value={hwInit[f.key as keyof typeof hwInit]}
                          onChange={(e) =>
                            setHwInit((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                          onWheel={(e) => e.currentTarget.blur()}
                          aria-invalid={isOutsideRange(value, range) || undefined}
                          className={cn("h-9 rounded-lg border bg-white px-3 text-sm font-medium tabular-nums shadow-sm outline-none transition-all", isOutsideRange(value, range) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-200 text-stone-800 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10")}
                        />
                      </label>
                    )})}
                  </div>
                </div>
                <p className="mb-3 rounded-xl bg-indigo-50/80 px-4 py-2.5 text-[13px] leading-relaxed text-indigo-900/80 ring-1 ring-inset ring-indigo-100">
                  每次 C 旋转 <b>10°</b>，记录 C 与 P2 刻度盘的度、分读数，共 6 组。
                </p>
                <DataInputTable
                  headers={[
                    { label: "序号", readOnly: true },
                    { label: "C (度)", unit: "°", range: getInputRange("polarization", "halfwave", "c_deg") },
                    { label: "C (分)", unit: "′", range: getInputRange("polarization", "halfwave", "c_min") },
                    { label: "P2 (度)", unit: "°", range: getInputRange("polarization", "halfwave", "p2_deg") },
                    { label: "P2 (分)", unit: "′", range: getInputRange("polarization", "halfwave", "p2_min") },
                  ]}
                  data={hwData}
                  onChange={setHwData}
                  resizable
                  minRows={2}
                  onAddRow={(rows) => addAngleRow(rows, 10, 0)}
                  actions={tableActions("halfwave")}
                />
                {tableNotes("halfwave")}
              </div>
            )}

            {activeTab === "quarterwave" && (
              <div className="animate-fade-in">
                <p className="mb-3 rounded-xl bg-indigo-50/80 px-4 py-2.5 text-[13px] leading-relaxed text-indigo-900/80 ring-1 ring-inset ring-indigo-100">
                  P2 每转 <b>10°</b> 记一次光强，φ 从 0° 到 350° 共 <b>36</b> 个数据点。
                </p>
                <DataInputTable
                  headers={[
                    { label: "φ (°)", readOnly: true },
                    { label: "I (μW)", unit: "μW", range: getInputRange("polarization", "quarterwave", "i_raw") },
                  ]}
                  data={qwData}
                  onChange={setQwData}
                  compact
                  resizable
                  minRows={3}
                  onAddRow={(rows) => addAngleRow(rows, 10, 0)}
                  actions={tableActions("quarterwave")}
                />
                {tableNotes("quarterwave")}
              </div>
            )}

            {activeTab === "circular" && (
              <div className="animate-fade-in">
                <p className="mb-3 rounded-xl bg-indigo-50/80 px-4 py-2.5 text-[13px] leading-relaxed text-indigo-900/80 ring-1 ring-inset ring-indigo-100">
                  圆偏振光通过检偏器，P2 每转 <b>10°</b> 记录光强，共 <b>36</b> 点。
                </p>
                <DataInputTable
                  headers={[
                    { label: "P2 (°)", readOnly: true },
                    { label: "I (μW)", unit: "μW", range: getInputRange("polarization", "circular", "i_raw") },
                  ]}
                  data={circData}
                  onChange={setCircData}
                  compact
                  resizable
                  minRows={3}
                  onAddRow={(rows) => addAngleRow(rows, 10, 0)}
                  actions={tableActions("circular")}
                />
                {tableNotes("circular")}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="mt-8 flex justify-end">
              <button
                onClick={() => {
                  setError(null);
                  setStep("confirm");
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-7 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:-translate-y-0.5 hover:bg-indigo-700"
              >
                确认数据
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ---------- STEP 3 · confirm ---------- */}
        {step === "confirm" && (
          <div className="mx-auto max-w-3xl animate-rise-in">
            <div className="mb-7 text-center">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.24em] text-indigo-500">
                Step 02 · 确认数据
              </p>
              <h2 className="text-2xl font-extrabold tracking-tight text-stone-900">
                核对无误后，开始计算
              </h2>
              <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-stone-500">
                请对照纸质记录表逐项检查。带「必」的模块若为空，计算会被拒绝。
              </p>
            </div>

            <div className="card mb-5 flex items-center justify-between gap-4 px-6 py-4">
              <span className="shrink-0 text-sm font-semibold text-stone-600">整体进度</span>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                <div className="h-2 w-full max-w-56 overflow-hidden rounded-full bg-stone-200/70">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      filledSum === totalSum
                        ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                        : "bg-gradient-to-r from-indigo-500 to-violet-500"
                    )}
                    style={{ width: `${Math.round((filledSum / totalSum) * 100)}%` }}
                  />
                </div>
                <span className="shrink-0 text-sm font-extrabold tabular-nums text-stone-900">
                  {filledSum}
                  <span className="mx-0.5 font-medium text-stone-300">/</span>
                  {totalSum}
                </span>
                <span className="shrink-0 text-xs text-stone-400">组读数</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {experiment.subExperiments.map((sub) => {
                const filled = fills[sub.id as keyof typeof fills];
                const total = totals[sub.id as keyof typeof totals];
                const pct = total ? Math.round((filled / total) * 100) : 0;
                const done = filled === total;
                const none = filled === 0;
                const state = done ? "done" : none ? (sub.required ? "empty" : "idle") : "partial";
                const Icon = SUB_ICON[sub.id] ?? Table2;
                return (
                  <div
                    key={sub.id}
                    className={cn(
                      "card p-5 transition-shadow hover:shadow-soft",
                      state === "empty" && "border-red-200"
                    )}
                  >
                    <div className="mb-4 flex items-start gap-3.5">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          state === "done" && "bg-emerald-50 text-emerald-600",
                          state === "partial" && "bg-amber-50 text-amber-600",
                          state === "empty" && "bg-red-50 text-red-500",
                          state === "idle" && "bg-stone-100 text-stone-400"
                        )}
                      >
                        <Icon className="h-5 w-5" strokeWidth={1.9} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[15px] font-bold text-stone-900">{sub.name}</p>
                          {sub.required ? (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                              必
                            </span>
                          ) : (
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-400">
                              选
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-stone-400">{sub.description}</p>
                      </div>
                    </div>

                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center text-xs font-semibold",
                          state === "done" && "text-emerald-600",
                          state === "partial" && "text-amber-600",
                          state === "empty" && sub.required && "text-red-500",
                          (state === "idle" || (state === "empty" && !sub.required)) &&
                            "text-stone-400"
                        )}
                      >
                        {state === "done" && (
                          <>
                            已录完
                            <CheckCircle2 className="ml-1 h-3.5 w-3.5" />
                          </>
                        )}
                        {state === "partial" && `已录入 ${filled}/${total}`}
                        {state === "empty" && sub.required && "未填写 · 必做"}
                        {state === "empty" && !sub.required && "未填写 · 可跳过"}
                        {state === "idle" && "未填写 · 可跳过"}
                      </span>
                      <span className="text-[11px] font-medium tabular-nums text-stone-400">
                        {filled}/{total}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-stone-200/60">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          state === "done" && "bg-emerald-500",
                          state === "partial" && "bg-amber-400",
                          state === "empty" && "bg-red-300",
                          state === "idle" && "bg-stone-200"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-8 flex flex-col-reverse items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <button
                onClick={() => setStep("input")}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-6 text-sm font-semibold text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-900 sm:justify-start"
              >
                <ArrowLeft className="h-4 w-4" />
                返回修改
              </button>
              <button
                onClick={handleProcess}
                disabled={loading}
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 text-[15px] font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在计算…
                  </>
                ) : (
                  <>
                    生成实验结果
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ---------- STEP 4 · results ---------- */}
        {step === "results" && result?.status === "success" && (
          <div className="mx-auto max-w-5xl animate-rise-in">
            <div className="mb-8 flex flex-col items-start justify-between gap-4 rounded-2xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 via-white to-emerald-50/50 p-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-lg font-extrabold tracking-tight text-stone-900">
                    数据处理完成
                  </p>
                  <p className="mt-0.5 text-sm text-stone-500">
                    4 个子实验 · {plotCount} 张拟合图，可逐张下载或一键导出
                  </p>
                </div>
              </div>
              <button
                onClick={downloadAllPlots}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-stone-900 px-5 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-stone-700"
              >
                <Download className="h-4 w-4" />
                导出全部图像
              </button>
            </div>

            {/* Unified four-section report */}
            <div className="card mb-8 overflow-hidden shadow-soft">
              <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/60 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-600/25">
                    <FileDown className="h-[18px] w-[18px]" strokeWidth={2} />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-bold text-stone-900">报告交付文件</h3>
                    <p className="text-xs text-stone-400">
                      一份完整报告：表格 → 图片 → 详细数据处理 → 拓展、误差与总结
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-5 sm:p-6">
                <div className="flex flex-col justify-between gap-3 rounded-xl border border-stone-200/80 p-4">
                  <div>
                    <p className="text-sm font-bold text-stone-900">完整实验报告</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-stone-400">
                      A4 纵向紧凑排版，四部分强制分页；表格整表保留，公式以 LaTeX 风格展示
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => runDownload("report-docx", () => downloadFinalReport("docx"))}
                      disabled={busyKey !== null}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-900 text-xs font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
                    >
                      {busyKey === "report-docx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                      Word 版
                    </button>
                    <button
                      onClick={() => runDownload("report-pdf", () => downloadFinalReport("pdf"))}
                      disabled={busyKey !== null}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busyKey === "report-pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      紧凑 PDF
                    </button>
                    <button
                      onClick={() => runDownload("report-md", () => downloadFinalReport("md"))}
                      disabled={busyKey !== null}
                      title="下载 Markdown 版完整报告"
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-700 transition-colors hover:border-stone-400 disabled:opacity-50"
                    >
                      {busyKey === "report-md" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileType className="h-3.5 w-3.5" />}
                      Markdown
                    </button>
                    <button
                      onClick={() => runDownload("report-jsonc", () => downloadFinalReport("jsonc"))}
                      disabled={busyKey !== null}
                      title="下载 JSONC 版完整报告，结构见 docs/schemas/report.schema.json"
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-700 transition-colors hover:border-stone-400 disabled:opacity-50"
                    >
                      {busyKey === "report-jsonc" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCode2 className="h-3.5 w-3.5" />}
                      JSONC
                    </button>
                  </div>
                  <div className="mt-3">
                    <DataCollectionOptInRow collection={collection} gate={gate} />
                  </div>
                </div>
              </div>
              {dlError && (
                <p className="px-6 pb-4 text-xs font-medium text-red-500" role="alert">
                  {dlError}
                </p>
              )}
            </div>

            <div className="space-y-6">
              {experiment.subExperiments.map((sub) => {
                const subResult = result.results[sub.id];
                if (!subResult) return null;
                const plotKey = sub.id;
                const plotData = result.plots[plotKey];
                const Icon = SUB_ICON[sub.id] ?? Table2;

                return (
                  <div key={sub.id} className="card overflow-hidden shadow-soft">
                    {/* header */}
                    <div className="flex items-center gap-3 border-b border-stone-100 bg-stone-50/60 px-6 py-4">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-600/25">
                        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-bold text-stone-900">{sub.name}</h3>
                        <p className="truncate text-xs text-stone-400">{sub.description}</p>
                      </div>
                      {plotData && (
                        <button
                          onClick={() => downloadPlot(plotKey)}
                          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          下载 PNG
                        </button>
                      )}
                    </div>

                    {/* metrics */}
                    <div className="grid grid-cols-2 gap-px bg-stone-100 sm:grid-cols-3 xl:grid-cols-5">
                      {sub.resultFields.map((field) => (
                        <div key={field.key} className="bg-white px-5 py-4">
                          <p className="mb-1.5 truncate text-[11px] font-medium text-stone-400">
                            {field.label}
                          </p>
                          <p className="text-lg font-extrabold tracking-tight tabular-nums text-stone-900">
                            {typeof subResult[field.key] === "number"
                              ? formatNumber(subResult[field.key])
                              : (subResult[field.key] ?? "—")}
                            {field.unit && (
                              <span className="ml-1.5 text-xs font-medium text-stone-400">
                                {field.unit}
                              </span>
                            )}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* plot */}
                    {plotData && (
                      <div className="border-t border-stone-100 bg-stone-50/40 p-5 sm:p-6">
                        <div className="flex justify-center rounded-xl border border-stone-200/70 bg-white p-3 sm:p-5">
                          <img
                            src={`data:image/png;base64,${plotData}`}
                            alt={`${sub.name} 拟合图像`}
                            className="max-h-[420px] w-auto object-contain"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={handleReset}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-6 text-sm font-semibold text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-900 sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                重新修改数据
              </button>
              <Link
                href="/experiments"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-7 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:-translate-y-0.5 hover:bg-indigo-700 sm:w-auto"
              >
                返回实验库
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatNumber(n: number | null | undefined): string {
  // Non-finite results (e.g. an extinction ratio when a reading sits at or below
  // the background I0) reach the UI as null; show a dash rather than crashing.
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toString();
  if (Math.abs(n) >= 100) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  if (Math.abs(n) >= 0.01) return n.toFixed(4);
  return n.toExponential(4);
}

// Route dispatch: the first two experiments retain their specialized guided
// workspaces; later experiments share the configuration-driven workspace.
export default function ExperimentWorkspaceRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  if (id === "sound-light") {
    return <SoundLightWorkspace />;
  }
  if (id === "polarization") {
    return <PolarizationWorkspace params={params} />;
  }
  return <GenericExperimentWorkspace id={id} />;
}
