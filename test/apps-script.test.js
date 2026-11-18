/*
 * Tests for apps-script/Code.gs. Apps Script isn't a Node module, so the
 * file is evaluated in a vm context with tiny fakes for the Google services
 * it uses (SpreadsheetApp, LockService, PropertiesService, ContentService).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { extractProfileUrl } from "../src/profile-url.js";

const CODE = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");

// A fake Sheet backed by a 2-D array (row 1 = headers), 1-based like Apps Script.
function makeSheet(rows = []) {
  const data = rows.map((r) => [...r]);
  const formats = [];
  const width = () => Math.max(0, ...data.map((r) => r.length));
  const range = (row, col, numRows, numCols) => ({
    getValues: () =>
      Array.from({ length: numRows }, (_, i) =>
        Array.from({ length: numCols }, (_, j) => data[row - 1 + i]?.[col - 1 + j] ?? "")
      ),
    setValues: (values) =>
      values.forEach((vals, i) => {
        data[row - 1 + i] ||= [];
        vals.forEach((v, j) => (data[row - 1 + i][col - 1 + j] = v));
      }),
    setNumberFormat: (f) => formats.push({ row, f }),
  });
  return {
    data,
    formats,
    getLastRow: () => data.length,
    getLastColumn: () => width(),
    getRange: range,
    getDataRange: () => range(1, 1, data.length, width()),
    appendRow: (r) => data.push([...r]),
    setFrozenRows: () => {},
  };
}

function loadCodeGs(sheet, { token = "s3cret" } = {}) {
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => token }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx;
}

const HEADERS = ["profile_url", "name", "tags", "note", "status", "updated_at", "added_at"];
const post = (gs, body) => JSON.parse(gs.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const get = (gs, params) => JSON.parse(gs.doGet({ parameter: params }).text);

test("normalizeProfileUrl in Code.gs matches extractProfileUrl in the extension", () => {
  const gs = loadCodeGs(makeSheet());
  for (const url of [
    "https://www.linkedin.com/in/juan-perez/",
    "https://www.linkedin.com/in/Juan-Perez",
    "https://www.linkedin.com/in/mar%C3%ADa-g/",
    "https://www.linkedin.com/in/María-G/",
    "https://www.linkedin.com/in/bad%E0%A4",
    "https://www.linkedin.com/in/juan-perez/details/experience/",
  ]) {
    assert.equal(gs.normalizeProfileUrl(url), extractProfileUrl(url), url);
  }
});

test("doPost: rejects a wrong token", () => {
  const gs = loadCodeGs(makeSheet([HEADERS]));
  assert.deepEqual(post(gs, { token: "nope", profileUrl: "https://www.linkedin.com/in/a/" }), { ok: false, error: "Unauthorized" });
});

test("doPost: appends a new row with the canonical URL, written as plain text", () => {
  const sheet = makeSheet([HEADERS]);
  const gs = loadCodeGs(sheet);

  const res = post(gs, {
    token: "s3cret",
    profileUrl: "https://www.linkedin.com/in/Juan-Perez/",
    name: "Juan",
    tags: ["SF", "Tech"],
    note: "=HYPERLINK(\"x\")",
    status: "Keep",
    updatedAt: "2026-01-02T00:00:00.000Z",
    addedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(res.ok, true);
  assert.equal(sheet.data.length, 2);
  assert.deepEqual(sheet.data[1], [
    "https://www.linkedin.com/in/juan-perez/",
    "Juan",
    "SF, Tech",
    "=HYPERLINK(\"x\")",
    "Keep",
    "2026-01-02T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  ]);
  assert.deepEqual(sheet.formats, [{ row: 2, f: "@" }], "row formatted as text before writing");
});

test("doPost: updates the existing row (even with an old URL spelling) instead of duplicating", () => {
  const sheet = makeSheet([
    HEADERS,
    ["https://www.linkedin.com/in/Juan-Perez/", "Juan", "SF", "old", "", "2025-01-01", "2025-01-01T00:00:00.000Z"],
  ]);
  const gs = loadCodeGs(sheet);

  post(gs, {
    token: "s3cret",
    profileUrl: "https://www.linkedin.com/in/juan-perez/",
    name: "", // tab title not loaded yet
    tags: ["SF"],
    note: "new",
    addedAt: "2026-06-01T00:00:00.000Z", // a stale/skewed client value
  });

  assert.equal(sheet.data.length, 2, "no duplicate row");
  const row = sheet.data[1];
  assert.equal(row[0], "https://www.linkedin.com/in/juan-perez/", "URL rewritten canonically");
  assert.equal(row[1], "Juan", "empty name keeps the stored one");
  assert.equal(row[3], "new");
  assert.equal(row[6], "2025-01-01T00:00:00.000Z", "added_at never overwritten");
});

test("doGet: finds a record by URL and lists records by tag", () => {
  const sheet = makeSheet([
    HEADERS,
    ["https://www.linkedin.com/in/juan-perez/", "Juan", "SF, Tech", "", "Keep", "", ""],
    ["https://www.linkedin.com/in/ana/", "Ana", "Design", "", "", "", ""],
  ]);
  const gs = loadCodeGs(sheet);

  const one = get(gs, { token: "s3cret", profileUrl: "https://www.linkedin.com/in/Juan-Perez/" });
  assert.equal(one.record.name, "Juan");
  assert.deepEqual(one.record.tags, ["SF", "Tech"]);

  const list = get(gs, { token: "s3cret", action: "list", tag: "tech" });
  assert.deepEqual(list.records.map((r) => r.name), ["Juan"]);
});

test("getSheet: extends an older header row that lacks added_at", () => {
  const sheet = makeSheet([HEADERS.slice(0, 6)]);
  const gs = loadCodeGs(sheet);
  get(gs, { token: "s3cret", action: "list" });
  assert.deepEqual(sheet.data[0], HEADERS);
});
