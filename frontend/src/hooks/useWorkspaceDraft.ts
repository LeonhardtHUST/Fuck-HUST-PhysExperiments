"use client";

/**
 * Bridges a workspace's in-memory state and its localStorage draft.
 *
 * Invariants:
 *  - Nothing is written before `spec` is available and hydration finished,
 *    otherwise the not-yet-loaded state would overwrite a real draft.
 *  - The draft key is deleted (not written) when the state equals the pristine
 *    default, so merely opening an experiment never creates a draft.
 *  - A failed write (quota / storage disabled) never blocks typing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ExperimentSpec } from "@/lib/table-specs";
import {
  buildDraft,
  clearAllDrafts,
  getBrowserStorage,
  listDraftExperimentIds,
  readDraft,
  removeDraft,
  writeDraft,
  type DraftPayload,
  type StorageLike,
} from "@/lib/workspace-draft";

export type WorkspaceDraftStatus = "idle" | "saved" | "blocked" | "unavailable";

export interface UseWorkspaceDraftOptions {
  experimentId: string;
  /** `undefined` while the experiment config is still loading. */
  spec: ExperimentSpec | undefined;
  /** Current workspace state as a draft payload. */
  snapshot: () => DraftPayload;
  /** Applies a parsed draft back onto the workspace state. */
  restore: (draft: DraftPayload) => void;
  debounceMs?: number;
}

export interface WorkspaceDraftController {
  /** False until the stored draft has been applied (or proven absent). */
  hydrated: boolean;
  /** Timestamp of the draft restored on this visit, `null` if none. */
  restoredAt: number | null;
  dismissRestored: () => void;
  savedAt: number | null;
  status: WorkspaceDraftStatus;
  /** Deletes this experiment's draft; call together with resetting its state. */
  forget: () => void;
  /** Deletes every experiment's draft; call together with resetting the state. */
  forgetAllExperiments: () => void;
  draftExperimentIds: string[];
  refreshDrafts: () => void;
}

const DEFAULT_DEBOUNCE_MS = 400;

export function useWorkspaceDraft({
  experimentId,
  spec,
  snapshot,
  restore,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseWorkspaceDraftOptions): WorkspaceDraftController {
  const [hydrated, setHydrated] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<WorkspaceDraftStatus>("idle");
  const [draftExperimentIds, setDraftExperimentIds] = useState<string[]>([]);

  const hydratedRef = useRef(false);
  const storageRef = useRef<StorageLike | null | undefined>(undefined);
  const pristineRef = useRef<string>("");
  const lastWrittenRef = useRef<string | null>(null);
  /** Pre-clear snapshot that must never be written back. */
  const skipWriteRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<(() => void) | null>(null);

  const serialized = spec ? JSON.stringify(buildDraft(spec, snapshot())) : null;

  const refreshDrafts = useCallback(() => {
    setDraftExperimentIds(listDraftExperimentIds(storageRef.current ?? null));
  }, []);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingWriteRef.current = null;
  }, []);

  // Hydrate once, after the experiment spec (and therefore the initial state)
  // is available. `snapshot()` here still describes the untouched workspace.
  useEffect(() => {
    if (!spec || hydratedRef.current) return;
    hydratedRef.current = true;

    const storage = getBrowserStorage();
    storageRef.current = storage;
    const pristine = JSON.stringify(buildDraft(spec, snapshot()));
    pristineRef.current = pristine;

    if (!storage) {
      setStatus("unavailable");
      setHydrated(true);
      return;
    }

    setDraftExperimentIds(listDraftExperimentIds(storage));

    const read = readDraft(storage, spec);
    if (read.status === "invalid") {
      removeDraft(storage, spec.id);
      setHydrated(true);
      return;
    }
    if (read.status === "ok") {
      const incoming = JSON.stringify(buildDraft(spec, read.draft));
      if (incoming !== pristine) {
        restore(read.draft);
        lastWrittenRef.current = incoming;
        setRestoredAt(read.draft.savedAt > 0 ? read.draft.savedAt : Date.now());
        setSavedAt(read.draft.savedAt > 0 ? read.draft.savedAt : null);
        setStatus("saved");
        setHydrated(true);
        return;
      }
      // 存储里的内容与初始界面完全一致：没有可恢复的东西。
      removeDraft(storage, spec.id);
      setDraftExperimentIds(listDraftExperimentIds(storage));
    }
    setHydrated(true);
    // snapshot/restore 只在本次挂载的首次调用中取用，故不放入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  // Debounced write whenever the serialized state changes.
  useEffect(() => {
    if (!spec || serialized === null || !hydrated) return;
    const storage = storageRef.current;
    if (storage === undefined || storage === null) return;

    if (skipWriteRef.current !== null) {
      // 清空动作本身不应写盘：跳过一次清空前的快照，把清空后的状态直接当基线。
      if (serialized === skipWriteRef.current) return;
      skipWriteRef.current = null;
      lastWrittenRef.current = serialized;
      pristineRef.current = serialized;
      return;
    }
    if (serialized === lastWrittenRef.current) return;

    const write = () => {
      timerRef.current = null;
      pendingWriteRef.current = null;
      if (serialized === pristineRef.current) {
        removeDraft(storage, spec.id);
        lastWrittenRef.current = serialized;
        setSavedAt(null);
        setStatus("idle");
        refreshDrafts();
        return;
      }
      const result = writeDraft(storage, spec.id, buildDraft(spec, JSON.parse(serialized)));
      if (result.ok) {
        lastWrittenRef.current = serialized;
        setSavedAt(result.savedAt);
        setStatus("saved");
        refreshDrafts();
        return;
      }
      setStatus(result.reason === "unavailable" ? "unavailable" : "blocked");
    };

    pendingWriteRef.current = write;
    timerRef.current = setTimeout(write, debounceMs);
    return cancelPending;
  }, [spec, serialized, hydrated, debounceMs, refreshDrafts, cancelPending]);

  // Closing the tab must not lose the last keystrokes still inside the debounce.
  useEffect(() => {
    if (!hydrated) return;
    const flush = () => {
      const write = pendingWriteRef.current;
      if (!write) return;
      cancelPending();
      write();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [hydrated, cancelPending]);

  const forget = useCallback(() => {
    cancelPending();
    removeDraft(storageRef.current ?? null, experimentId);
    skipWriteRef.current = serialized;
    lastWrittenRef.current = null;
    setRestoredAt(null);
    setSavedAt(null);
    refreshDrafts();
    setStatus((previous) => (previous === "unavailable" ? "unavailable" : "idle"));
  }, [cancelPending, experimentId, refreshDrafts, serialized]);

  const forgetAllExperiments = useCallback(() => {
    cancelPending();
    clearAllDrafts(storageRef.current ?? null);
    skipWriteRef.current = serialized;
    lastWrittenRef.current = null;
    setDraftExperimentIds([]);
    setRestoredAt(null);
    setSavedAt(null);
    setStatus("idle");
  }, [cancelPending, serialized]);

  const dismissRestored = useCallback(() => setRestoredAt(null), []);

  return {
    hydrated,
    restoredAt,
    dismissRestored,
    savedAt,
    status,
    forget,
    forgetAllExperiments,
    draftExperimentIds,
    refreshDrafts,
  };
}
