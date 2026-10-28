/**
 * Local preference for the optional anonymised data collection.
 *
 * Only one thing is stored — "the user made a decision once" — never a photo,
 * experiment data or a session id:
 *
 *     physlab:data-collection-consent:v1
 *     { "v": 1, "status": "granted" | "declined", "decidedAt": 1750000000000 }
 *
 * "Has the user been asked?" is `key exists`; `status` is the answer itself.
 * Two independent booleans (`asked` + `granted`) would allow states like
 * `asked=false, granted=true` that the UI cannot represent.
 *
 * The key deliberately does not start with `physlab:draft:v1:`: clearing drafts
 * sweeps by that prefix and must never delete the user's decision.
 *
 * `Storage` is injected so node tests can run without a browser. Keep this
 * module free of JSX and `@/` aliases so `node --test` can load it.
 */

export const CONSENT_KEY = "physlab:data-collection-consent:v1";
export const CONSENT_VERSION = 1;

export type ConsentStatus = "granted" | "declined";

export interface ConsentPreference {
  version: number;
  status: ConsentStatus;
  decidedAt: number;
}

/** Minimal surface shared by `window.localStorage` and the test double. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ReadConsentResult =
  | { status: "unset" }
  | { status: "invalid"; reason: "unavailable" | "malformed" | "shape" | "version" | "answer" }
  | { status: "ok"; preference: ConsentPreference };

export type WriteConsentResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "quota" };

/** Browser storage, or `null` during static export / in private mode. */
export function browserConsentStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readConsent(storage: StorageLike | null): ReadConsentResult {
  if (!storage) return { status: "unset" };

  let raw: string | null;
  try {
    raw = storage.getItem(CONSENT_KEY);
  } catch {
    return { status: "invalid", reason: "unavailable" };
  }
  if (!raw) return { status: "unset" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", reason: "shape" };
  }

  const value = parsed as Record<string, unknown>;
  if (value.v !== CONSENT_VERSION) return { status: "invalid", reason: "version" };
  const answer = value.status;
  if (answer !== "granted" && answer !== "declined") {
    return { status: "invalid", reason: "answer" };
  }
  const decidedAt =
    typeof value.decidedAt === "number" && Number.isFinite(value.decidedAt) ? value.decidedAt : 0;

  return {
    status: "ok",
    preference: { version: CONSENT_VERSION, status: answer, decidedAt },
  };
}

export function writeConsent(
  storage: StorageLike | null,
  status: ConsentStatus,
  now: number = Date.now(),
): WriteConsentResult {
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, status, decidedAt: now }));
    return { ok: true };
  } catch {
    return { ok: false, reason: "quota" };
  }
}

export function clearConsent(storage: StorageLike | null): void {
  try {
    storage?.removeItem(CONSENT_KEY);
  } catch {
    // Not fatal: the next read simply returns the same stale answer.
  }
}

/** Everything the prompt decision depends on besides the stored answer. */
export interface PromptContext {
  /** localStorage has been read (first paint is `false` to avoid hydration drift). */
  hydrated: boolean;
  /** `/api/data-collection/status` has answered, successfully or not. */
  ready: boolean;
  /** The backend has data collection turned on. */
  enabled: boolean;
}

/**
 * The single place that decides whether the one-time dialog may appear.
 * "Asked once, never again" lives here — the test pins every branch.
 */
export function shouldPrompt(preference: ConsentStatus | null, ctx: PromptContext): boolean {
  if (!ctx.hydrated || !ctx.ready || !ctx.enabled) return false;
  return preference === null;
}
