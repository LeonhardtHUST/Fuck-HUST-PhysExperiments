"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  FileDown,
  FlaskConical,
  Loader2,
  Play,
  Table2,
} from "lucide-react";
import {
  downloadGenericReport,
  downloadRecordSheet,
  fetchGenericConfig,
  previewRecordSheet,
  processGenericExperiment,
  trackEvent,
  type GenericExperimentConfig,
  type GenericExperimentData,
  type GenericProcessResponse,
  type ReportFormat,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { getInputRange, isOutsideRange, rangeLabel } from "@/lib/input-ranges";
import DataCollectionConsentOverlays from "./DataCollectionConsentOverlays";
import DataCollectionOptInRow from "./DataCollectionOptInRow";
import { useDataCollectionConsent } from "@/hooks/useDataCollectionConsent";
import ArtifactActions, {
  type ArtifactActionsHandle,
  type OcrTarget,
} from "./ArtifactActions";
import ArtifactRemarks from "./ArtifactRemarks";
import { DraftClearMenu, DraftRestoreBanner } from "./WorkspaceDraftControls";
import type { ArtifactInput } from "@/lib/experiment-artifact";
import {
  hasArtifactNotes,
  mergeArtifactNotes,
  type ArtifactNotes,
  type DecodeOk,
} from "@/lib/artifact-scope";
import { tryGetExperimentSpec } from "@/lib/experiment-specs";
import { useDataCollection } from "@/hooks/useDataCollection";
import { useWorkspaceDraft } from "@/hooks/useWorkspaceDraft";
import type { DraftPayload } from "@/lib/workspace-draft";
import {
  appendDraftRow,
  completionState,
  nextGridCell,
  removeDraftRowAt,
  trimDraftRows,
  type CompletionMethod,
} from "./generic-workspace-logic";

type Draft = Record<string, { rows: Record<string, string>[]; params: Record<string, string> }>;

function rangeFor(id: string, methodId: string, field: { expected_range?: [number, number] }) {
  return field.expected_range
    ? { min: field.expected_range[0], max: field.expected_range[1] }
    : getInputRange(id, methodId, (field as { key?: string }).key ?? "");
}

function makeDraft(config: GenericExperimentConfig): Draft {
  return Object.fromEntries(
    config.methods.map((method) => [
      method.id,
      {
        params: Object.fromEntries((method.params ?? []).map((parameter) => [
          parameter.key,
          parameter.default === undefined || parameter.default === null
            ? ""                      // 实测参数（室温、预平衡 Rn）不预填，必须学生填
            : String(parameter.default),
        ])),
        rows: Array.from({ length: method.rowCount }, (_, rowIndex) =>
          Object.fromEntries(
            method.columns.map((column) => {
              const values = method.prefill?.[column.key] ?? [];
              return [column.key, rowIndex < values.length ? String(values[rowIndex]) : ""];
            })
          )
        ),
      },
    ])
  );
}

const EMPTY_NOTES: ArtifactNotes = { remarks: null, tableRemarks: {}, computed: {} };

/** 本机草稿 → 表格状态。草稿已按 spec 归一化，缺表时回落到默认行。 */
function draftFromPayload(config: GenericExperimentConfig, payload: DraftPayload): Draft {
  return Object.fromEntries(
    config.methods.map((method) => {
      const table = payload.tables[method.id];
      return [
        method.id,
        {
          rows: (table?.rows ?? []).map((row) => ({ ...row })),
          params: { ...(table?.params ?? {}) },
        },
      ];
    })
  );
}

function numeric(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatValue(value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e5 || (value !== 0 && Math.abs(value) < 1e-4)) {
    return value.toExponential(5);
  }
  return value.toFixed(6).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

export default function GenericExperimentWorkspace({ id }: { id: string }) {
  const collection = useDataCollection(id);
  const gate = useDataCollectionConsent(collection);
  const [config, setConfig] = useState<GenericExperimentConfig | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [active, setActive] = useState("");
  const [result, setResult] = useState<GenericProcessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<ArtifactNotes | null>(null);
  /** 完成度横幅与结果卡指向同一个导出弹窗 */
  const dialogRef = useRef<ArtifactActionsHandle>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[][]>([]);

  useEffect(() => {
    let alive = true;
    void trackEvent("workspace_start", id);
    fetchGenericConfig(id)
      .then((loaded) => {
        if (!alive) return;
        setConfig(loaded);
        setDraft(makeDraft(loaded));
        setActive(loaded.methods[0]?.id ?? "");
      })
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "配置加载失败"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  const payload = useCallback((methodIds?: string[]): GenericExperimentData => {
    if (!config) return {};
    const included = methodIds ? new Set(methodIds) : null;
    return Object.fromEntries(config.methods
      .filter((method) => !included || included.has(method.id))
      .map((method) => {
      const source = draft[method.id];
      const parameters: Record<string, number> = {};
      for (const parameter of method.params ?? []) {
        const value = numeric(source?.params[parameter.key] ?? "") ?? parameter.default;
        // 实测参数（室温 t、预平衡 Rn）没有 default，学生不填就不发送，由后端点名，绝不替学生编一个值
        if (value !== undefined && value !== null) parameters[parameter.key] = value;
      }
      const columnKeys = method.columns.map((column) => column.key);
      return [method.id, {
        params: parameters,
        // 末尾整行空白不计入提交：录入 10 行不会被默认的 12 行模板拖成 12 行
        rows: trimDraftRows(source?.rows ?? [], columnKeys).map((row) =>
          Object.fromEntries(columnKeys.map((key) => [key, numeric(row[key] ?? "")]))
        ),
      }];
    }));
  }, [config, draft]);

  /** Snapshot for artifact export: strings stay strings so the schema shapes the file. */
  const collectArtifact = useCallback((): ArtifactInput => {
    if (!config) return { tables: {} };
    return {
      tables: Object.fromEntries(
        config.methods.map((method) => [
          method.id,
          {
            rows: draft[method.id]?.rows ?? [],
            params: draft[method.id]?.params ?? {},
            remarks: notes?.tableRemarks[method.id],
          },
        ])
      ),
      remarks: notes?.remarks ?? undefined,
      computed: notes?.computed,
    };
  }, [config, draft, notes]);

  const applyArtifact = (decoded: DecodeOk) => {
    if (!config) return;
    setDraft((previous) => {
      const next = { ...previous };
      for (const table of decoded.tables) {
        const method = config.methods.find((item) => item.id === table.tableId);
        const source = previous[table.tableId];
        if (!method || !source) continue;
        const rowCount = Math.max(table.rows.length, method.minRows ?? 1);
        const rows = Array.from({ length: rowCount }, (_, index) => {
          const imported = table.rows[index] ?? {};
          return Object.fromEntries(
            method.columns.map((column) => [column.key, imported[column.key] ?? ""])
          );
        });
        const params = { ...source.params };
        for (const parameter of method.params ?? []) {
          const value = table.params[parameter.key];
          if (value !== undefined) params[parameter.key] = value;
        }
        next[table.tableId] = { params, rows };
      }
      return next;
    });
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

  const resetToDefault = () => {
    if (!config) return;
    setDraft(makeDraft(config));
    setNotes(null);
    setResult(null);
    setError(null);
  };

  const applyDraftPayload = (payload: DraftPayload) => {
    if (!config) return;
    setDraft(draftFromPayload(config, payload));
    setNotes(hasArtifactNotes(payload.notes) ? payload.notes : null);
    setResult(null);
    setError(null);
  };

  const snapshotDraft = (): DraftPayload => ({
    setupParams: {},
    tables: Object.fromEntries(
      (config?.methods ?? []).map((method) => [
        method.id,
        { rows: draft[method.id]?.rows ?? [], params: draft[method.id]?.params ?? {} },
      ])
    ),
    notes: notes ?? EMPTY_NOTES,
  });

  const clearTable = (tableId: string) => {
    if (!config) return;
    const defaults = makeDraft(config)[tableId];
    if (!defaults) return;
    setDraft((previous) => ({
      ...previous,
      [tableId]: { rows: defaults.rows.map((row) => ({ ...row })), params: { ...defaults.params } },
    }));
    clearTableNotes(tableId);
    setResult(null);
  };

  const spec = useMemo(() => tryGetExperimentSpec(id), [id]);
  const draftStore = useWorkspaceDraft({
    experimentId: id,
    spec: config ? spec : undefined,
    snapshot: snapshotDraft,
    restore: applyDraftPayload,
  });

  const current = useMemo(() => config?.methods.find((method) => method.id === active), [config, active]);
  const completionMethods = useMemo<CompletionMethod[]>(
    () => (config?.methods ?? []).map((method) => ({
      id: method.id,
      name: method.name,
      required: method.required,
      paramKeys: (method.params ?? []).map((parameter) => parameter.key),
      columnKeys: method.columns.map((column) => column.key),
      minRows: method.minRows ?? 1,
    })),
    [config]
  );
  const completion = useMemo(
    () => completionState(completionMethods, draft),
    [completionMethods, draft]
  );
  const basicReady = completion.requiredAllComplete;

  const handleGridKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number
  ) => {
    if (!current || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const destination = nextGridCell(
      event.key,
      rowIndex,
      columnIndex,
      draft[current.id]?.rows.length ?? 0,
      current.columns.length
    );
    if (destination) inputRefs.current[destination[0]]?.[destination[1]]?.focus();
  };

  const updateCell = (methodId: string, rowIndex: number, key: string, value: string) => {
    setDraft((previous) => ({
      ...previous,
      [methodId]: {
        ...previous[methodId],
        rows: previous[methodId].rows.map((row, index) => index === rowIndex ? { ...row, [key]: value } : row),
      },
    }));
    setResult(null);
  };

  const addRow = (methodId: string) => {
    const method = config?.methods.find((item) => item.id === methodId);
    if (!method) return;
    const columnKeys = method.columns.map((column) => column.key);
    setDraft((previous) => ({
      ...previous,
      [methodId]: {
        ...previous[methodId],
        rows: appendDraftRow(previous[methodId].rows, columnKeys),
      },
    }));
    setResult(null);
  };

  const removeRow = (methodId: string, rowIndex: number) => {
    const method = config?.methods.find((item) => item.id === methodId);
    if (!method) return;
    setDraft((previous) => ({
      ...previous,
      [methodId]: {
        ...previous[methodId],
        rows: removeDraftRowAt(previous[methodId].rows, rowIndex, method.minRows ?? 1),
      },
    }));
    setResult(null);
  };

  const updateParam = (methodId: string, key: string, value: string) => {
    setDraft((previous) => ({
      ...previous,
      [methodId]: { ...previous[methodId], params: { ...previous[methodId].params, [key]: value } },
    }));
    setResult(null);
  };

  const applyOCRTo = useCallback(
    (methodId: string, values: string[], overwriteExisting: boolean) => {
      const method = config?.methods.find((item) => item.id === methodId);
      if (!method) return;
      setDraft((previous) => {
        let valueIndex = 0;
        const rows = previous[methodId].rows.map((row) => {
          const next = { ...row };
          method.columns.forEach((column) => {
            const value = values[valueIndex++]?.trim();
            if (!value) return;
            if (!overwriteExisting && (next[column.key] ?? "").trim()) return;
            next[column.key] = value;
          });
          return next;
        });
        return { ...previous, [methodId]: { ...previous[methodId], rows } };
      });
      setResult(null);
    },
    [config]
  );

  /** 每张表都能从「导入 → 拍照录入」识别，写回仍走各表自己的草稿 */
  const ocrTargets = useMemo<OcrTarget[]>(
    () =>
      (config?.methods ?? []).map((method) => ({
        tableId: method.id,
        title: method.name,
        expectedCellCount: (draft[method.id]?.rows.length ?? 0) * method.columns.length,
        apply: (values, overwriteExisting) => applyOCRTo(method.id, values, overwriteExisting),
      })),
    [applyOCRTo, config, draft]
  );

  const act = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key); setError(null);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setBusy(null); }
  };

  const process = () => act("process", async () => {
    const response = await processGenericExperiment(id, payload());
    setResult(response);
    if (response.status !== "success") setError(response.errors.join("；") || "没有足够的有效数据");
  });

  const reportPayload = (): GenericExperimentData => payload(completion.completedMethodIds);
  const downloadFinalReport = async (format: ReportFormat) => {
    // One-time consent question before the first report; already answered,
    // backend disabled or status still loading all pass straight through.
    if (!(await gate.ensureDecided())) return;
    const data = reportPayload();
    await downloadGenericReport(id, format, data);
    await collection.commit(data);
  };

  if (loading) return <div className="container-x flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>;
  if (!config || !current) return <div className="container-x py-16 text-center text-red-600">{error ?? "实验配置不存在"}</div>;

  return (
    <div className="container-x py-8 sm:py-12">
      <DataCollectionConsentOverlays collection={collection} gate={gate} experimentName={config.name} />
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link href={`/experiments/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-stone-400 hover:text-stone-700"><ArrowLeft className="h-4 w-4" />实验说明</Link>
          <h1 className="text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">{config.name}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-500">{config.description}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <ArtifactActions
            ref={dialogRef}
            experimentId={id}
            scope={{ kind: "experiment" }}
            collect={collectArtifact}
            onImport={applyArtifact}
            remarks={notes?.remarks}
            tableRemarks={notes?.tableRemarks}
            computed={notes?.computed}
            onClearRemarks={() => setNotes(null)}
            ocrTargets={ocrTargets}
            error={error}
            recordSheet={{
              preview: () => previewRecordSheet(id),
              download: (format) => downloadRecordSheet(format, id),
            }}
            report={{
              download: (format) => act(format, () => downloadFinalReport(format)),
              collection: { collection, gate },
            }}
          />
          <DraftClearMenu
            tables={config.methods.map((method) => ({ id: method.id, title: method.name }))}
            controller={draftStore}
            onClearTable={clearTable}
            onReset={resetToDefault}
          />
        </div>
      </div>

      <DraftRestoreBanner
        restoredAt={draftStore.restoredAt}
        onDismiss={draftStore.dismissRestored}
        controller={draftStore}
        onReset={resetToDefault}
      />

      {notes && (
        <ArtifactRemarks
          scope="experiment"
          remarks={notes.remarks}
          computed={notes.computed}
          tableLabels={Object.fromEntries(config.methods.map((method) => [method.id, method.name]))}
          onClear={() => setNotes(null)}
          className="mb-6"
        />
      )}

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {config.methods.map((method, index) => (
          <button key={method.id} onClick={() => setActive(method.id)} className={cn("shrink-0 rounded-xl border px-4 py-2.5 text-left transition-colors", active === method.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-300")}>
            <span className="block text-xs font-bold">{index + 1}. {method.name}</span>
            <span className={cn("mt-0.5 block text-[10px]", active === method.id ? "text-indigo-100" : "text-stone-400")}>
              {method.required ? "必做" : "选做"}{completion.completedMethodIds.includes(method.id) ? " · 已填" : ""}
            </span>
          </button>
        ))}
      </div>

      <section className="card overflow-hidden shadow-soft">
        <div className="border-b border-stone-100 bg-stone-50/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white"><Table2 className="h-4.5 w-4.5" /></span><div><h2 className="font-bold text-stone-900">{current.name}</h2><p className="text-xs text-stone-400">{current.description}</p></div></div>
        </div>
        <div className="p-5 sm:p-6">
          {!!current.params?.length && (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {current.params.map((parameter) => (
                <label key={parameter.key} className="text-xs font-semibold text-stone-500">
                  {parameter.label} {parameter.unit && `(${parameter.unit})`}
                  <span className="mt-0.5 block text-[10px] font-medium text-amber-600">
                    {rangeLabel(rangeFor(id, current.id, parameter), parameter.unit)}
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={draft[current.id]?.params[parameter.key] ?? ""}
                    onChange={(event) => updateParam(current.id, parameter.key, event.target.value)}
                    onWheel={(event) => event.currentTarget.blur()}
                    aria-invalid={isOutsideRange(draft[current.id]?.params[parameter.key] ?? "", rangeFor(id, current.id, parameter)) || undefined}
                    className={cn("mt-1.5 h-10 w-full rounded-lg border px-3 text-right font-mono text-sm outline-none", isOutsideRange(draft[current.id]?.params[parameter.key] ?? "", rangeFor(id, current.id, parameter)) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-200 focus:border-indigo-400")}
                  />
                </label>
              ))}
            </div>
          )}
          {!!current.params?.some((parameter) => parameter.hint) && (
            <ul className="mb-6 space-y-1 rounded-lg bg-stone-50 px-3 py-2">
              {current.params.filter((parameter) => parameter.hint).map((parameter) => (
                <li key={parameter.key} className="text-[10px] leading-snug text-stone-400">
                  {parameter.label}{parameter.unit ? `（${parameter.unit}）` : ""}：{parameter.hint}
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-hidden rounded-xl border border-stone-200">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead><tr>{current.columns.map((column) => <th key={column.key} className="whitespace-nowrap border-b border-stone-200 bg-stone-50 px-3 py-3 text-xs font-bold text-stone-500">{column.label}{column.unit && <span className="ml-1 font-normal text-stone-400">({column.unit})</span>}<span className="mt-0.5 block text-[10px] font-normal text-amber-600">{rangeLabel(rangeFor(id, current.id, column), column.unit)}</span></th>)}<th className="w-10 border-b border-stone-200 bg-stone-50 px-2 py-3 text-center text-[10px] font-normal text-stone-400" title={`至少 ${current.minRows ?? 1} 行`}>行</th></tr></thead>
              <tbody>
                {draft[current.id]?.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-indigo-50/30">
                    {current.columns.map((column, columnIndex) => (
                      <td key={column.key} className="border-b border-stone-100 p-0">
                        <input
                          ref={(element) => {
                            inputRefs.current[rowIndex] ??= [];
                            inputRefs.current[rowIndex][columnIndex] = element;
                          }}
                          type="number"
                          step="any"
                          value={row[column.key] ?? ""}
                          onChange={(event) => updateCell(current.id, rowIndex, column.key, event.target.value)}
                          onKeyDown={(event) => handleGridKeyDown(event, rowIndex, columnIndex)}
                          onWheel={(event) => event.currentTarget.blur()}
                          aria-invalid={isOutsideRange(row[column.key] ?? "", rangeFor(id, current.id, column)) || undefined}
                          title={isOutsideRange(row[column.key] ?? "", rangeFor(id, current.id, column)) ? `${rangeLabel(rangeFor(id, current.id, column), column.unit)}；当前值可能需要检查` : rangeLabel(rangeFor(id, current.id, column), column.unit)}
                          className={cn("h-9 w-full min-w-24 border-0 px-3 text-right font-mono text-[13px] outline-none", isOutsideRange(row[column.key] ?? "", rangeFor(id, current.id, column)) ? "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-300" : "bg-transparent focus:bg-indigo-50")}
                        />
                      </td>
                    ))}
                    <td className="border-b border-stone-100 p-0 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(current.id, rowIndex)}
                        disabled={(draft[current.id]?.rows.length ?? 0) <= (current.minRows ?? 1)}
                        aria-label={`删除第 ${rowIndex + 1} 行`}
                        title={(draft[current.id]?.rows.length ?? 0) <= (current.minRows ?? 1) ? `至少需要保留 ${current.minRows ?? 1} 行` : `删除第 ${rowIndex + 1} 行`}
                        className={cn(
                          "mx-auto flex h-7 w-7 items-center justify-center rounded-md text-base leading-none transition-colors",
                          (draft[current.id]?.rows.length ?? 0) <= (current.minRows ?? 1)
                            ? "cursor-not-allowed text-stone-200"
                            : "text-stone-400 hover:bg-rose-50 hover:text-rose-600"
                        )}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 bg-stone-50/60 px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => addRow(current.id)}
                  className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-indigo-300 hover:text-indigo-700"
                >
                  + 添加一行
                </button>
                <ArtifactActions
                  experimentId={id}
                  scope={{ kind: "table", tableId: current.id, title: current.name }}
                  collect={collectArtifact}
                  onImport={applyArtifact}
                  tableRemarks={notes?.tableRemarks}
                  onClearRemarks={() => clearTableNotes(current.id)}
                  ocrTargets={ocrTargets.filter((target) => target.tableId === current.id)}
                  variant="table"
                />
              </div>
              <span className="text-[11px] text-stone-400">
                共 {draft[current.id]?.rows.length ?? 0} 行 · 默认 {current.rowCount} 行，至少 {current.minRows ?? 1} 行，可自由增删
              </span>
            </div>
          </div>
          {notes?.tableRemarks[current.id] && (
            <ArtifactRemarks
              scope="table"
              remarks={notes.tableRemarks[current.id]}
              columns={current.columns.map((column) => ({ key: column.key, label: column.label }))}
              onClear={() => clearTableNotes(current.id)}
              className="mt-4"
            />
          )}
        </div>
      </section>

      <div className={cn(
        "mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center",
        completion.requiredAllComplete ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"
      )}>
        <div className="flex items-start gap-3">
          {completion.requiredAllComplete
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            : <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
          <div>
            <p className="text-sm font-bold text-stone-900">
              必做实验完成度：{completion.completedRequiredCount}/{completion.requiredCount}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              {completion.requiredAllComplete
                ? "必做数据已填完整，可直接生成完整报告；选做实验填完整后自动并入。"
                : `缺项：${completion.missingRequiredNames.join("、")}。仍可直接生成报告，缺项会在正文中标注。`}
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              onClick={process}
              disabled={!!busy}
              title="预览当前已填写子实验的计算结果"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "process" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              预览结果
            </button>
            <button
              onClick={() => dialogRef.current?.openExport("report")}
              disabled={!!busy}
              title={basicReady ? "生成完整报告" : "必做缺项会在报告中标注为缺项"}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && ["docx", "pdf", "md", "jsonc"].includes(busy) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
              生成完整报告
            </button>
          </div>
          <p className="text-[11px] leading-4 text-stone-400 sm:text-right">
            纸质记录表与读数 JSON 也在「导出」里
          </p>
          <div className="sm:text-right">
            <DataCollectionOptInRow collection={collection} gate={gate} />
          </div>
        </div>
      </div>

      {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {result?.warnings?.length ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-bold">数据合理性提醒</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          <p className="mt-2 text-xs">范围仅用于提醒，不会自动修改或阻止你的真实测量值。</p>
        </div>
      ) : null}

      {result && Object.keys(result.results).length > 0 && (
        <div className="mt-8 space-y-6">
          <div className={cn("flex flex-col justify-between gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center", result.status === "success" ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60")}>
            <div className="flex items-center gap-3">
              {result.status === "success" ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertCircle className="h-6 w-6 text-amber-600" />}
              <div>
                <p className="font-bold text-stone-900">{result.status === "success" ? "计算完成" : "部分计算完成"}</p>
                <p className="text-xs text-stone-500">{Object.keys(result.results).length} 个子实验已生成结果{result.status !== "success" ? "；缺项与未纳入的数据会在报告中标注" : ""}</p>
              </div>
            </div>
            {result.status === "success" && <div className="flex flex-wrap gap-2">
              <button
                onClick={() => dialogRef.current?.openExport("report")}
                disabled={!!busy}
                title={basicReady ? "生成完整报告" : "必做缺项会在报告中标注为缺项"}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              ><FileDown className="h-4 w-4" />生成完整报告</button>
            </div>}
          </div>
          {!basicReady && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              必做项缺项：{completion.missingRequiredNames.join("、")}。仍可生成报告，缺项会在正文中标注。
            </div>
          )}
          {result.errors.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">部分数据未纳入：{result.errors.join("；")}</div>}
          {config.methods.map((method) => {
            const values = result.results[method.id]; if (!values) return null;
            return <section key={method.id} className="card overflow-hidden shadow-soft"><div className="flex items-center gap-3 border-b border-stone-100 bg-stone-50/70 px-5 py-4"><BarChart3 className="h-5 w-5 text-indigo-600" /><h3 className="font-bold text-stone-900">{method.name}</h3></div><div className="grid gap-px bg-stone-100 sm:grid-cols-2 lg:grid-cols-4">{method.results.map((field) => <div key={field.key} className="bg-white p-4"><p className="text-xs text-stone-400">{field.label}</p><p className="mt-1 font-mono text-lg font-bold text-stone-900">{formatValue(values[field.key])}<span className="ml-1 text-xs font-medium text-stone-400">{field.unit}</span></p></div>)}</div>{result.plots[method.id] && <div className="border-t border-stone-100 p-5"><img src={`data:image/png;base64,${result.plots[method.id]}`} alt={`${method.name}结果图`} className="mx-auto max-h-[460px] max-w-full" /></div>}</section>;
          })}
        </div>
      )}
    </div>
  );
}
