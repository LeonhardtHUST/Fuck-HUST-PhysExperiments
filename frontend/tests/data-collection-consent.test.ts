import assert from "node:assert/strict";
import { test } from "vite-plus/test";

import {
  CONSENT_KEY,
  browserConsentStorage,
  clearConsent,
  readConsent,
  shouldPrompt,
  writeConsent,
  type StorageLike,
} from "../src/lib/data-collection-consent.ts";

/**
 * The preference is the only memory of the one-time question, so the "asked
 * once, never again" guarantee has to be provable without a browser.
 */

function memoryStorage(map = new Map<string, string>()): StorageLike {
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const READY = { hydrated: true, ready: true, enabled: true };

test("the key never collides with the draft sweep prefix", () => {
  assert.equal(CONSENT_KEY.startsWith("physlab:draft:v1:"), false);
  assert.equal(CONSENT_KEY, "physlab:data-collection-consent:v1");
});

test("no stored answer means the user has not been asked", () => {
  assert.deepEqual(readConsent(memoryStorage()), { status: "unset" });
  assert.deepEqual(readConsent(null), { status: "unset" });
  assert.equal(browserConsentStorage(), null, "no window during node tests");
});

test("granted and declined both round-trip", () => {
  const storage = memoryStorage();

  assert.deepEqual(writeConsent(storage, "granted", 1), { ok: true });
  const granted = readConsent(storage);
  assert.equal(granted.status, "ok");
  assert.deepEqual(granted.status === "ok" && granted.preference, {
    version: 1,
    status: "granted",
    decidedAt: 1,
  });

  writeConsent(storage, "declined", 2);
  const declined = readConsent(storage);
  assert.equal(declined.status, "ok");
  assert.equal(declined.status === "ok" && declined.preference.status, "declined");
});

test("corrupt, stale or unknown payloads are treated as unasked", () => {
  const cases = [
    "{not json",
    JSON.stringify({ v: 99, status: "granted" }),
    JSON.stringify({ v: 1, status: "maybe" }),
    JSON.stringify(["granted"]),
    JSON.stringify("granted"),
  ];
  for (const raw of cases) {
    const storage = memoryStorage(new Map([[CONSENT_KEY, raw]]));
    const result = readConsent(storage);
    assert.equal(result.status, "invalid", raw);
    // invalid is not a decision, so the question may be asked once more
    assert.equal(shouldPrompt(null, READY), true);
  }
});

test("a hostile storage never throws out of the module", () => {
  const hostile: StorageLike = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceededError"); },
    removeItem() { throw new Error("SecurityError"); },
  };
  assert.equal(readConsent(hostile).status, "invalid");
  assert.deepEqual(writeConsent(hostile, "granted"), { ok: false, reason: "quota" });
  assert.deepEqual(writeConsent(null, "granted"), { ok: false, reason: "unavailable" });
  assert.doesNotThrow(() => clearConsent(hostile));
  assert.doesNotThrow(() => clearConsent(memoryStorage()));
});

test("the question is asked once: only an unasked, ready, enabled workspace prompts", () => {
  assert.equal(shouldPrompt(null, READY), true);
  // already answered either way — this is the regression guard against
  // "the dialog comes back on every report"
  assert.equal(shouldPrompt("granted", READY), false);
  assert.equal(shouldPrompt("declined", READY), false);
  // backend off, status unknown, storage not read yet: never prompt
  assert.equal(shouldPrompt(null, { ...READY, enabled: false }), false);
  assert.equal(shouldPrompt(null, { ...READY, ready: false }), false);
  assert.equal(shouldPrompt(null, { ...READY, hydrated: false }), false);
});
