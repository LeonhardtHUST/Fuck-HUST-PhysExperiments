"use client";

import type { DataCollectionController } from "@/hooks/useDataCollection";
import type { ConsentGate } from "@/hooks/useDataCollectionConsent";

/**
 * The permanent one-liner in the report area.
 *
 * The photo entry lives here, not only in the dialog: the dialog is shown once
 * per browser, while every experiment produces its own record sheet. Without a
 * persistent picker the second experiment onward would have no session at all
 * and the confirmed values would silently have nowhere to go.
 */
export default function DataCollectionOptInRow({
  collection,
  gate,
}: {
  collection: DataCollectionController;
  gate: ConsentGate;
}) {
  if (!gate.hydrated || !gate.ready || !gate.enabled) return null;

  const granted = gate.preference === "granted";
  const label = granted ? "已开启" : gate.preference === "declined" ? "已关闭" : "未设置";
  const uploaded = Boolean(collection.sessionId);

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
