"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Loader2, ShieldCheck } from "lucide-react";

export type ConsentDialogIntent = "prompt" | "manage";

export interface ConsentDialogChoice {
  enabled: boolean;
  photo: File | null;
}

/**
 * The one and only place the anonymised-data question is asked.
 *
 * `prompt` is the first report generation: the dialog offers a single
 * "continue" button, because declining is a valid answer that still generates
 * the report. `manage` is the later edit from the report row and has a cancel
 * that writes nothing.
 */
export default function DataCollectionConsentDialog({
  open,
  intent,
  initialEnabled,
  hasPhoto,
  photoName,
  uploading,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  intent: ConsentDialogIntent;
  /** The stored answer, so re-opening never inherits a stale tick. */
  initialEnabled: boolean;
  /** A session already exists for this run, so the photo is attached. */
  hasPhoto: boolean;
  photoName: string | null;
  uploading: boolean;
  onConfirm: (choice: ConsentDialogChoice) => void;
  /** prompt: record a decline and continue; manage: just close. */
  onDismiss: () => void;
}) {
  // Portals need `document`, which does not exist during static export.
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setEnabled(initialEnabled);
    setPhoto(null);
  }, [open, initialEnabled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // The first ask has no dismiss: the answer itself is the way forward,
      // and a stray Escape must not record a permanent "declined".
      if (event.key === "Escape" && intent === "manage") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, intent, onDismiss]);

  if (!open || !mounted) return null;

  const isPrompt = intent === "prompt";
  const photoLabel = photo
    ? photo.name
    : hasPhoto
      ? (photoName ?? "已附上记录表照片")
      : "附上记录表照片（可选）";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isPrompt ? "匿名化数据收集" : "匿名化数据收集设置"}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/50 p-4"
      onClick={(event) => {
        if (!isPrompt && event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl sm:p-7">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight text-stone-900">
              {isPrompt ? "帮助改进 PhysExp Killer（可选）" : "匿名化数据收集"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              勾选后，生成报告时会保存<b>本次确认的实验数值</b>与<b>你自愿附上的记录表照片</b>，
              用于改进表格识别能力。不勾选也能正常生成报告，之后可以在报告区随时更改。
            </p>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs leading-5 text-stone-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-stone-300"
          />
          <span>启用匿名化数据收集以帮助改进服务（不含账号信息）</span>
        </label>

        <div className="mt-3 rounded-xl border border-stone-200 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={
                enabled
                  ? "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700"
                  : "inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 text-xs font-semibold text-stone-400"
              }
            >
              <ImagePlus className="h-4 w-4" />
              <span className="max-w-[16rem] truncate">{photoLabel}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff"
                className="sr-only"
                disabled={!enabled}
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              />
            </label>
            {uploading && <Loader2 className="h-4 w-4 animate-spin text-stone-400" />}
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-stone-500">
            上传前请自行裁掉或遮盖姓名、学号、联系方式、人脸等个人信息；图片保存前会重新编码，
            自动去掉拍摄时间、位置等照片信息。
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {!isPrompt && (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex h-10 items-center rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-50"
            >
              取消
            </button>
          )}
          <button
            type="button"
            onClick={() => onConfirm({ enabled, photo: enabled ? photo : null })}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-900 px-5 text-sm font-bold text-white transition-colors hover:bg-stone-700"
          >
            {isPrompt ? "继续生成报告" : "保存设置"}
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-stone-400">
          完全自愿，随时可以关闭并在提示中撤回；撤回会删除原图与由它生成的数据。
        </p>
      </div>
    </div>,
    document.body,
  );
}
