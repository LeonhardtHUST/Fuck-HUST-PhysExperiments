"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  commitDataCollectionSession,
  createDataCollectionSession,
  deleteDataCollectionSession,
  fetchDataCollectionStatus,
} from "@/lib/api";

export type ContributionState = "idle" | "uploading" | "pending" | "confirmed" | "error";

export interface DataCollectionController {
  /** The backend has data collection turned on. */
  enabled: boolean;
  /** The `/status` probe has answered — the consent gate must wait for this. */
  statusReady: boolean;
  consent: boolean;
  setConsent: (value: boolean) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  state: ContributionState;
  sessionId: string | null;
  revision: number;
  /** Estimated OCR samples this contribution can produce. */
  estimatedSamples: number | null;
  /** Human-readable experiment name reported by the API. */
  experimentName: string | null;
  /** True right after a contribution was committed: drives the thank-you dialog. */
  showThanks: boolean;
  dismissThanks: () => void;
  error: string | null;
  /** `file` defaults to the picker state; pass one explicitly to upload right away. */
  upload: (file?: File | null) => Promise<void>;
  commit: (data: object) => Promise<void>;
  withdraw: () => Promise<void>;
}

export function useDataCollection(experimentId: string): DataCollectionController {
  const [enabled, setEnabled] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const [templateVersion, setTemplateVersion] = useState("2.0");
  const [consent, setConsentState] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<ContributionState>("idle");
  const [revision, setRevision] = useState(0);
  const [estimatedSamples, setEstimatedSamples] = useState<number | null>(null);
  const [experimentName, setExperimentName] = useState<string | null>(null);
  const [showThanks, setShowThanks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `commit` runs right after `await upload(...)`, before React re-renders the
  // state that was just set. Reading the mirrors keeps the freshly created
  // session from being silently dropped (the label would never be committed).
  const consentRef = useRef(false);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchDataCollectionStatus()
      .then((status) => {
        if (!active) return;
        setEnabled(status.enabled);
        setTemplateVersion(status.template_version);
      })
      .catch(() => {
        if (active) setEnabled(false);
      })
      .finally(() => {
        // A failed probe means "not available", exactly like `enabled: false`.
        if (active) setStatusReady(true);
      });
    return () => { active = false; };
  }, []);

  const setConsent = useCallback((value: boolean) => {
    consentRef.current = value;
    setConsentState(value);
  }, []);

  const upload = useCallback(async (override?: File | null) => {
    const target = override ?? file;
    if (!enabled || !consentRef.current || !target || sessionRef.current) return;
    setState("uploading");
    setError(null);
    try {
      const response = await createDataCollectionSession(experimentId, templateVersion, target);
      sessionRef.current = response.session_id;
      setSessionId(response.session_id);
      setRevision(response.revision);
      setEstimatedSamples(response.estimated_samples ?? null);
      setExperimentName(response.experiment_name ?? null);
      setState("pending");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "原始记录表上传失败");
      setState("error");
    }
  }, [enabled, file, experimentId, templateVersion]);

  const commit = useCallback(async (data: object) => {
    if (!enabled || !consentRef.current) return;
    const sid = sessionRef.current;
    if (!sid) return;
    try {
      const response = await commitDataCollectionSession(
        sid,
        experimentId,
        templateVersion,
        data,
      );
      setRevision(response.revision);
      if (typeof response.estimated_samples === "number") setEstimatedSamples(response.estimated_samples);
      if (response.experiment_name) setExperimentName(response.experiment_name);
      setState("confirmed");
      // The experiment itself is finished at this point, so this is the moment
      // to thank the contributor — and to offer the withdrawal.
      setShowThanks(true);
      setError(null);
    } catch (reason) {
      // Data contribution is always best-effort and must not turn a successful
      // report download into an experiment failure.
      setError(reason instanceof Error ? reason.message : "确认数据未保存");
      setState("error");
    }
  }, [enabled, experimentId, templateVersion]);

  const withdraw = useCallback(async () => {
    const sid = sessionRef.current;
    if (sid) {
      try {
        await deleteDataCollectionSession(sid);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "撤回失败");
        return;
      }
    }
    sessionRef.current = null;
    consentRef.current = false;
    setSessionId(null);
    setConsentState(false);
    setFile(null);
    setRevision(0);
    setEstimatedSamples(null);
    setShowThanks(false);
    setState("idle");
    setError(null);
  }, []);

  const dismissThanks = useCallback(() => setShowThanks(false), []);

  return {
    enabled,
    statusReady,
    consent,
    setConsent,
    file,
    setFile,
    state,
    sessionId,
    revision,
    estimatedSamples,
    experimentName,
    showThanks,
    dismissThanks,
    error,
    upload,
    commit,
    withdraw,
  };
}
