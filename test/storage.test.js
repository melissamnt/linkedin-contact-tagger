import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeChrome } from "./helpers/fakes.js";
import {
  clearCachedSuggestion,
  getAllLocalRecords,
  getCachedSuggestion,
  getLocalRecord,
  getSettings,
  markSynced,
  renameTagInLocalRecords,
  setCachedSuggestion,
  setLocalRecord,
} from "../src/storage.js";

const URL_A = "https://www.linkedin.com/in/juan-perez/";

test("getSettings: empty defaults when nothing is saved", async () => {
  installFakeChrome();
  assert.deepEqual(await getSettings(), { webAppUrl: "", token: "", claudeApiKey: "" });
});

test("local records: round-trip by profile URL", async () => {
  installFakeChrome();
  await setLocalRecord({ profileUrl: URL_A, name: "Juan", tags: ["SF"] });
  assert.deepEqual(await getLocalRecord(URL_A), { profileUrl: URL_A, name: "Juan", tags: ["SF"] });
  assert.equal(await getLocalRecord("https://www.linkedin.com/in/nobody/"), null);
});

test("getLocalRecord: migrates a record saved under an old, non-canonical key", async () => {
  const oldUrl = "https://www.linkedin.com/in/Juan-Perez/";
  const store = installFakeChrome({ [`profile:${oldUrl}`]: { profileUrl: oldUrl, name: "Juan" } });

  const record = await getLocalRecord(URL_A);

  assert.deepEqual(record, { profileUrl: URL_A, name: "Juan" });
  assert.ok(!(`profile:${oldUrl}` in store), "old key removed");
  assert.deepEqual(store[`profile:${URL_A}`], { profileUrl: URL_A, name: "Juan" });
});

test("getAllLocalRecords: only profile records, skipping other keys", async () => {
  installFakeChrome({
    settings: { token: "x" },
    [`profile:${URL_A}`]: { profileUrl: URL_A },
    "profile:broken": null,
    [`suggestion:${URL_A}`]: { status: "Keep" },
  });
  assert.deepEqual(await getAllLocalRecords(), [{ profileUrl: URL_A }]);
});

test("markSynced: clears pendingSync when the local copy is that same save", async () => {
  const store = installFakeChrome();
  const saved = { profileUrl: URL_A, updatedAt: "2026-01-01T00:00:00.000Z", pendingSync: true };
  await setLocalRecord(saved);
  await markSynced(saved);
  assert.equal(store[`profile:${URL_A}`].pendingSync, false);
});

test("markSynced: keeps pendingSync when a newer save happened meanwhile", async () => {
  const store = installFakeChrome();
  const older = { profileUrl: URL_A, updatedAt: "2026-01-01T00:00:00.000Z", pendingSync: true };
  await setLocalRecord({ ...older, updatedAt: "2026-01-02T00:00:00.000Z" });
  await markSynced(older);
  assert.equal(store[`profile:${URL_A}`].pendingSync, true);
});

test("cached suggestions: set, get and clear", async () => {
  installFakeChrome();
  await setCachedSuggestion(URL_A, "Keep", "Works in your field");
  assert.deepEqual(await getCachedSuggestion(URL_A), { status: "Keep", rationale: "Works in your field" });
  await clearCachedSuggestion(URL_A);
  assert.equal(await getCachedSuggestion(URL_A), null);
});

test("renameTagInLocalRecords: renames everywhere, keeps updatedAt and pendingSync", async () => {
  const store = installFakeChrome({
    [`profile:${URL_A}`]: { profileUrl: URL_A, tags: ["SF", "start-up"], updatedAt: "t1", pendingSync: true },
    "profile:https://www.linkedin.com/in/b/": { profileUrl: "https://www.linkedin.com/in/b/", tags: ["Design"], updatedAt: "t2" },
  });
  await renameTagInLocalRecords("Start-Up", "Startup");
  assert.deepEqual(store[`profile:${URL_A}`], { profileUrl: URL_A, tags: ["SF", "Startup"], updatedAt: "t1", pendingSync: true });
  assert.deepEqual(store["profile:https://www.linkedin.com/in/b/"].tags, ["Design"]);
});
