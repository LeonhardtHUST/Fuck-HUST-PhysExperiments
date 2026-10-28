"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DataCollectionController } from "@/hooks/useDataCollection";
import {
  browserConsentStorage,
  readConsent,
  shouldPrompt,
  writeConsent,
  type ConsentStatus,
} from "@/lib/data-collection-consent";

export type ConsentIntent = "prompt" | "manage" | null;

export interface ConsentChoice {
  enabled: boolean;
  /** Only uploaded when `enabled`; the backend needs an image to open a session. */
  photo: File | null;
}

export interface ConsentGate {
  hydrated: boolean;
  ready: boolean;
  enabled: boolean;
  /** `null` means the user has never been asked. */
  preference: ConsentStatus | null;
  intent: ConsentIntent;
  /** Await this before generating a report. `false` only when the gate unmounted. */
  ensureDecided: () => Promise<boolean>;
  openSettings: () => void;
  /** Closing without saving must leave no trace in storage. */
  closeSettings: () => void;
  choose: (choice: ConsentChoice) => Promise<void>;
  /** Esc / backdrop / withdrawal: record a decline and let the caller continue. */
  decline: () => void;
}

/**
 * The one-time "enable anonymised data collection" gate.
 *
 * The gate is a Promise rather than a stored callback: the caller (`downloadFinalReport`)
 * awaits it inline, so the existing busy/error chain in each workspace keeps working
 * and no second state machine is introduced.
 */
export function useDataCollectionConsent(collection: DataCollectionController): ConsentGate {
  const [hydrated, setHydrated] = useState(false);
  const [preference, setPreference] = useState<ConsentStatus | null>(null);
  const [intent, setIntent] = useState<ConsentIntent>(null);

  // A ref, not state: `setPending(fn)` would make React treat the function as
  // an updater, and repeated clicks must share one promise instead of opening
  // the dialog twice.
  const pendingRef = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);
  // Storage can fail (private mode). Remember the answer for this session anyway
  // so the dialog does not reappear on every report.
  const decidedInMemoryRef = useRef(false);

  const { setConsent, upload, withdraw, sessionId } = collection;

  useEffect(() => {
    const result = readConsent(browserConsentStorage());
    const stored = result.status === "ok" ? result.preference.status : null;
    setPreference(stored);
    setHydrated(true);
    // `commit` guards on consent; without this every page refresh would stop
    // committed values from ever being reported.
    if (stored === "granted") setConsent(true);
    return () => {
      // Release a suspended download instead of leaving its promise pending.
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, [setConsent]);

  const ensureDecided = useCallback((): Promise<boolean> => {
    if (decidedInMemoryRef.current) return Promise.resolve(true);
    const ctx = { hydrated, ready: collection.statusReady, enabled: collection.enabled };
    if (!shouldPrompt(preference, ctx)) return Promise.resolve(true);
    if (pendingRef.current) return pendingRef.current.promise;

    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((settle) => { resolve = settle; });
    pendingRef.current = { promise, resolve };
    setIntent("prompt");
    return promise;
  }, [collection.enabled, collection.statusReady, hydrated, preference]);

  const settle = useCallback((ok: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.resolve(ok);
  }, []);

  const persist = useCallback((status: ConsentStatus) => {
    decidedInMemoryRef.current = true;
    // A failed write only costs one extra prompt next session; never block on it.
    writeConsent(browserConsentStorage(), status);
    setPreference(status);
  }, []);

  const choose = useCallback(async (choice: ConsentChoice) => {
    const wasPrompt = intent === "prompt";
    persist(choice.enabled ? "granted" : "declined");
    setConsent(choice.enabled);

    if (choice.enabled && choice.photo) {
      // Best-effort: a failed upload must never block the report itself.
      await upload(choice.photo);
    } else if (!choice.enabled && sessionId) {
      await withdraw();
    }

    setIntent(null);
    // Both answers proceed: declining is not a cancel of the report.
    if (wasPrompt) settle(true);
  }, [intent, persist, sessionId, setConsent, settle, upload, withdraw]);

  const decline = useCallback(() => {
    persist("declined");
    setConsent(false);
    if (sessionId) void withdraw();
    setIntent(null);
    settle(true);
  }, [persist, sessionId, setConsent, settle, withdraw]);

  const openSettings = useCallback(() => setIntent("manage"), []);
  const closeSettings = useCallback(() => setIntent(null), []);

  return {
    hydrated,
    ready: collection.statusReady,
    enabled: collection.enabled,
    preference,
    intent,
    ensureDecided,
    openSettings,
    closeSettings,
    choose,
    decline,
  };
}
