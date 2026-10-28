import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vite-plus/test";

/**
 * Guards the two regressions this refactor is most likely to reintroduce:
 *   1. a second "AI co-build" entry coming back (home button / URL flag /
 *      explainer card / permanent upload panel);
 *   2. the consent dialog being asked again on every report instead of once.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const exists = (relative: string) => existsSync(fileURLToPath(new URL(relative, import.meta.url)));
const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const home = read("../src/app/page.tsx");
const list = read("../src/app/experiments/page.tsx");
const detail = read("../src/app/experiments/[id]/client-page.tsx");
const generic = read("../src/components/workspace/GenericExperimentWorkspace.tsx");
const soundLight = read("../src/components/workspace/SoundLightWorkspace.tsx");
const polarization = read("../src/app/experiments/[id]/workspace/client-page.tsx");
const overlays = read("../src/components/workspace/DataCollectionConsentOverlays.tsx");
const dialog = read("../src/components/workspace/DataCollectionConsentDialog.tsx");
const row = read("../src/components/workspace/DataCollectionOptInRow.tsx");
const thanks = read("../src/components/workspace/ContributionThanksDialog.tsx");
const gateHook = read("../src/hooks/useDataCollectionConsent.ts");
const collectionHook = read("../src/hooks/useDataCollection.ts");
const api = read("../src/lib/api.ts");

test("the old dual entry is gone for good", () => {
  for (const relative of [
    "../src/lib/collection-mode.ts",
    "../src/hooks/useCollectionMode.ts",
    "../src/components/workspace/CoBuildIntroCard.tsx",
    "../src/components/workspace/DataContributionPanel.tsx",
  ]) {
    assert.equal(exists(relative), false, `${relative} must stay deleted`);
  }

  for (const file of walk(srcRoot)) {
    const source = readFileSync(file, "utf8");
    const name = path.relative(srcRoot, file);
    assert.equal(source.includes("mode=collection"), false, `${name} still links the old mode`);
    assert.equal(/useCollectionMode|withCollectionMode|CoBuildIntroCard/.test(source), false,
      `${name} still references the old mode machinery`);
    assert.equal(source.includes("AI 实验共建"), false, `${name} still advertises the old entry`);
  }
});

test("the home page has one entry and links the privacy page", () => {
  assert.match(home, /href="\/experiments"/);
  assert.match(home, /href="\/privacy"/);
  assert.equal(home.includes("普通实验 · 选择实验"), false, "no side-by-side entry wording left");
});

test("the catalogue and the detail page no longer carry a mode", () => {
  assert.match(list, /href=\{`\/experiments\/\$\{exp\.id\}`\}/);
  assert.equal(list.includes("collectionMode"), false);
  assert.equal(detail.includes("collectionMode"), false);
  assert.match(detail, /href=\{`\/experiments\/\$\{experiment\.id\}\/workspace`\}/);
});

test("every workspace asks once, inside downloadFinalReport", () => {
  for (const source of [generic, soundLight, polarization]) {
    assert.match(source, /const gate = useDataCollectionConsent\(collection\);/);
    assert.match(source, /if \(!\(await gate\.ensureDecided\(\)\)\) return;/);
    assert.equal(
      source.split("gate.ensureDecided").length - 1,
      1,
      "the gate must live in one place per workspace",
    );
    assert.match(source, /<DataCollectionConsentOverlays collection=\{collection\} gate=\{gate\}/);
    assert.match(source, /<DataCollectionOptInRow collection=\{collection\} gate=\{gate\} \/>/);
  }
});

test("the once-only decision is centralised in shouldPrompt", () => {
  assert.match(gateHook, /shouldPrompt\(preference, ctx\)/);
  assert.match(gateHook, /if \(!shouldPrompt\(preference, ctx\)\) return Promise\.resolve\(true\);/);
  assert.match(gateHook, /if \(pendingRef\.current\) return pendingRef\.current\.promise;/);
});

test("the preference is written in exactly one place and only on confirm", () => {
  assert.match(gateHook, /writeConsent\(browserConsentStorage\(\), status\)/);
  assert.equal(collectionHook.includes("writeConsent"), false, "the collection hook never writes it");
  assert.match(gateHook, /const closeSettings = useCallback\(\(\) => setIntent\(null\), \[\]\);/);
  // choosing a photo must never be a side door around consent
  assert.match(gateHook, /if \(choice\.enabled && choice\.photo\)/);
});

test("a photo uploaded from the row still becomes the session commit uses", () => {
  assert.match(row, /collection\.upload\(picked\)/);
  assert.match(collectionHook, /sessionRef\.current = response\.session_id;/);
  assert.match(collectionHook, /const sid = sessionRef\.current;/);
});

test("the report row states the choice and can change it", () => {
  assert.match(row, /匿名化数据收集：\{label\}/);
  assert.match(row, /const label = granted \? "已开启"/);
  assert.match(row, /附上记录表照片/);
  assert.match(row, /更改/);
});

test("report / record sheet / readings share one export dialog", () => {
  const actions = read("../src/components/workspace/ArtifactActions.tsx");
  const reportTab = actions.slice(
    actions.indexOf('exportTab === "report"'),
    actions.indexOf('exportTab === "record"'),
  );
  const recordTab = actions.slice(
    actions.indexOf('exportTab === "record"'),
    actions.indexOf('exportTab === "data"'),
  );

  assert.match(actions, /export type ExportTab = "report" \| "record" \| "data";/);
  assert.match(actions, /if \(report\) tabs\.push\("report"\);/);
  assert.match(actions, /if \(recordSheet\) tabs\.push\("record"\);/);

  // 匿名分享必须是报告页签里常驻的一块，而不是靠一次性的询问弹窗
  assert.match(reportTab, /variant="panel"/);
  assert.match(reportTab, /report\.collection/);
  assert.match(reportTab, /REPORT_BUTTONS\.map/);
  assert.match(recordTab, /recordSheet\.preview/);
  assert.match(recordTab, /recordSheet\.download\("docx"\)/);
  assert.match(recordTab, /recordSheet\.download\("pdf"\)/);

  for (const [name, source] of [
    ["generic", generic],
    ["sound-light", soundLight],
    ["polarization", polarization],
  ] as const) {
    assert.equal(source.includes("需要纸质记录表"), false, `${name} keeps a second record-sheet card`);
    assert.equal(source.includes("记录表 Word"), false, `${name} keeps a standalone record-sheet button`);
    assert.match(source, /recordSheet=\{\{/, `${name} must feed the dialog instead`);
  }

  // 报告格式只在弹窗里出现一次，页面上不再摊开四个按钮
  assert.equal(soundLight.includes("完整 · PDF"), false, "sound-light keeps the inline format row");
  assert.equal(soundLight.includes("完整 · JSONC"), false, "sound-light keeps the inline format row");
});

test("both overlays portal to the body", () => {
  for (const [name, source] of [["dialog", dialog], ["thanks", thanks]] as const) {
    assert.match(source, /createPortal\(/, name);
    assert.match(source, /document\.body/, name);
    assert.match(source, /setMounted\(true\)/, name);
  }
  assert.match(overlays, /gate\.intent !== null && !collection\.showThanks/);
});

test("user-facing copy stays free of internals", () => {
  for (const [name, source] of [["dialog", dialog], ["row", row], ["thanks", thanks]] as const) {
    for (const banned of ["EXIF", "session_id", "UUID", "collection_mode", "metadata.json"]) {
      assert.equal(source.includes(banned), false, `${name} leaks ${banned}`);
    }
    assert.equal(source.includes("sessions/"), false, `${name} leaks a storage path`);
  }
  assert.equal(thanks.includes("共建"), false, "the thanks dialog drops the old brand");
});

test("the backend contract is unchanged: uploads are still marked as training data", () => {
  assert.match(api, /form\.append\("collection_mode", "true"\)/);
  assert.match(api, /form\.append\("consent", "true"\)/);
});
