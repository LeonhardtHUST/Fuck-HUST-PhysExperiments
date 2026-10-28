"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataCollectionController } from "@/hooks/useDataCollection";
import type { ConsentGate } from "@/hooks/useDataCollectionConsent";

/**
 * The only place the anonymised-data choice is shown by default.
 *
 * `row` is the compact one-liner still kept beside a report banner;
 * `panel` is the version inside the export dialog's report tab — the place a
 * student actually passes through before every report. The panel never
 * returns null on an unavailable backend: disappearing is exactly how the
 * option got "lost" before, so it states why the switch is off instead.
 *
 * The photo entry lives here, not only in the dialog: the dialog is shown once
 * per browser, while every experiment produces its own record sheet. Without a
 * persistent picker the second experiment onward would have no session at all
 * and the confirmed values would silently have nowhere to go.
 */
export default function DataCollectionOptInRow({
  collection,
  gate,
  variant = "row",
}: {
  collection: DataCollectionController;
  gate: ConsentGate;
  variant?: "row" | "panel";
}) {
  const [busy, setBusy] = useState(false);
  if (!gate.hydrated) return null;

  // 紧凑行只在真正可参与时出现：后端没开就整行不显示，避免页面上多一条
  // 点了也没用的「更改」。弹窗里的 panel 变体则必须常驻并说明原因。
  if (variant === "row" && (!gate.ready || !gate.enabled)) return null;

  const granted = gate.preference === "granted";
  const uploaded = Boolean(collection.sessionId);
  const available = gate.ready && gate.enabled;
  const label = granted ? "已开启" : gate.preference === "declined" ? "已关闭" : "未设置";

  const toggle = async () => {
    if (!available || busy) return;
    setBusy(true);
    try {
      // Both answers are final answers: turning it off withdraws a session that
      // already exists, exactly like the settings dialog does.
      await gate.choose({ enabled: !granted, photo: null });
    } finally {
      setBusy(false);
    }
  };

  const photoPicker = uploaded ? (
    <span>· 已附上记录表照片</span>
  ) : (
    <label className="cursor-pointer font-semibold text-indigo-600 underline-offset-2 hover:underline">
      · {collection.state === "uploading" ? "正在上传…" : "附上记录表照片"}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff"
        className="sr-only"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) void collection.upload(picked);
        }}
      />
    </label>
  );

  if (variant === "panel") {
    const status = !gate.ready ? "正在检查服务状态…" : !gate.enabled ? "当前部署未开放" : granted ? "已开启" : "未开启";

    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-bold text-stone-800">
              <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
              匿名分享本次实验数据（可选）
            </p>
            <p className="mt-1 text-[11px] leading-5 text-stone-500">
              只上传本次确认的实验数值，不含姓名、学号与账号信息；不开启也照常生成报告，之后随时可以撤回。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={granted}
            aria-label="匿名分享本次实验数据"
            disabled={!available || busy}
            onClick={() => void toggle()}
            className={cn(
              "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
              granted && available ? "bg-indigo-600" : "bg-stone-300",
              (!available || busy) && "cursor-not-allowed opacity-50"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                granted ? "left-[22px]" : "left-0.5"
              )}
            />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-stone-500">
          {busy && <Loader2 className="h-3 w-3 animate-spin text-stone-400" />}
          <span className={cn("font-semibold", granted && available ? "text-emerald-600" : "text-stone-400")}>
            {status}
          </span>
          {granted && available && photoPicker}
          {available && (
            <button
              type="button"
              onClick={gate.openSettings}
              className="font-semibold text-indigo-600 underline-offset-2 hover:underline"
            >
              设置
            </button>
          )}
          {collection.error && <span className="text-red-600">（{collection.error}；不影响报告）</span>}
        </div>

        {!available && gate.ready && (
          <p className="mt-1.5 text-[11px] leading-5 text-amber-600">
            服务端没有开启数据共建，开关暂不可用；报告生成与下载完全不受影响。
          </p>
        )}
      </div>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-stone-500">
      <span>匿名化数据收集：{label}</span>
      {granted && (
        <>
          <span aria-hidden>·</span>
          {uploaded ? (
            <span>已附上记录表照片</span>
          ) : (
            <label className="cursor-pointer font-semibold text-indigo-600 underline-offset-2 hover:underline">
              {collection.state === "uploading" ? "正在上传…" : "附上记录表照片"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff"
                className="sr-only"
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  event.target.value = "";
                  if (picked) void collection.upload(picked);
                }}
              />
            </label>
          )}
        </>
      )}
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={gate.openSettings}
        className="font-semibold text-indigo-600 underline-offset-2 hover:underline"
      >
        更改
      </button>
      {collection.error && (
        <span className="text-red-600">（{collection.error}；不影响报告）</span>
      )}
    </p>
  );
}
