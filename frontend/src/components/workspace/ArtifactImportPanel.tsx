"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, PencilLine } from "lucide-react";
import { decodeArtifact, MAX_ARTIFACT_CHARS, type DecodeResult } from "@/lib/experiment-artifact";
import type { ExperimentSpec } from "@/lib/table-specs";
import { pickScopedResult, type ArtifactScope, type DecodeOk } from "@/lib/artifact-scope";

interface Props {
  spec: ExperimentSpec;
  scope: ArtifactScope;
  onImport: (result: DecodeOk) => void;
  onDone?: () => void;
}

export default function ArtifactImportPanel({ spec, scope, onImport, onDone }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [reading, setReading] = useState(false);

  const parsed = result?.ok ? result : null;
  const error = result && !result.ok ? result.error : "";

  const parse = (source: string): DecodeResult => {
    const decoded = decodeArtifact(spec, source);
    if (!decoded.ok) return decoded;
    const scoped = pickScopedResult(decoded, scope);
    if (scope.kind === "table" && scoped.tables.length === 0) {
      return { ok: false, error: `文件中没有表格 ${scope.tableId}（${scope.title}），无法导入到本表` };
    }
    return scoped;
  };

  const handleParse = () => {
    if (!text.trim()) {
      setResult({ ok: false, error: "请先粘贴 JSON / JSONC 内容，或选择一个文件" });
      return;
    }
    setResult(parse(text));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setFileName(file.name);
    try {
      const content = await file.text();
      if (content.length > MAX_ARTIFACT_CHARS) {
        setResult({ ok: false, error: `文件超过 ${MAX_ARTIFACT_CHARS / 1000} 千字符上限，已拒绝解析` });
        return;
      }
      setText(content);
      setResult(parse(content));
    } catch (cause) {
      console.error("读取导入文件失败", cause);
      setResult({ ok: false, error: "读取文件失败，请改用粘贴方式" });
    } finally {
      setReading(false);
    }
  };

  const confirm = () => {
    if (!parsed) return;
    onImport(parsed);
    setText("");
    setFileName("");
    setResult(null);
    onDone?.();
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-stone-700">
          <PencilLine className="h-3.5 w-3.5 text-indigo-500" />
          导入（粘贴 AI 回填的 JSONC 或选择导出文件）
        </p>
        <div className="flex items-center gap-2">
          {fileName && <span className="max-w-[180px] truncate text-[11px] text-stone-400">{fileName}</span>}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={reading}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 transition-colors hover:border-indigo-300 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
            选择文件
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.jsonc,.txt,application/json,text/plain"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (result) setResult(null);
        }}
        spellCheck={false}
        placeholder={'把 AI 生成的 ```jsonc 代码块粘贴到这里，例如：\n{\n  "schemaVersion": 1,\n  "experiment": { "id": "' + spec.id + '" },\n  "tables": { ... }\n}'}
        className="mt-2 h-40 w-full resize-y rounded-lg border border-stone-300 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-stone-700 outline-none transition-colors placeholder:text-stone-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-stone-400">
          {text.length.toLocaleString("zh-CN")} 字符 · 上限 {MAX_ARTIFACT_CHARS.toLocaleString("zh-CN")}
        </span>
        <div className="flex items-center gap-2">
          {text && (
            <button
              type="button"
              onClick={() => {
                setText("");
                setFileName("");
                setResult(null);
              }}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              清空
            </button>
          )}
          <button
            type="button"
            onClick={handleParse}
            disabled={reading || !text.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            解析并预览
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
          <p className="text-[11px] leading-relaxed text-rose-700">{error}</p>
        </div>
      )}

      {parsed && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            解析成功 · {parsed.experimentId}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-emerald-800/80">
            共 {parsed.stats.tableCount} 张表 / {parsed.stats.rowCount} 行 · 备注问题{" "}
            {parsed.stats.issueCount} 条 · AI 参考值 {parsed.stats.computedCount} 项
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
            导入将覆盖{" "}
            {parsed.tables.map((table) => table.title).join("、") || "（无表格）"}
            ；未出现在文件中的表保持界面原样。
          </p>
          {parsed.warnings.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-700">
              {parsed.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={confirm}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-indigo-700"
            >
              确认导入并覆盖
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-600 transition-colors hover:border-stone-400"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
