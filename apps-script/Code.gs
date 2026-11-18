/**
 * LinkedIn Contact Tagger — Apps Script backend.
 * Bind this script to the Google Sheet that will store your connections
 * (Extensions > Apps Script from inside the Sheet). See DEPLOY.md for
 * full setup and deployment steps.
 */

var SHEET_NAME = "Connections";
var HEADERS = ["profile_url", "name", "tags", "note", "status", "updated_at", "added_at"];

function doGet(e) {
  try {
    checkToken(e.parameter.token);

    if (e.parameter.action === "list") {
      var records = listRecords(e.parameter.tag);
      return jsonOutput({ ok: true, records: records });
    }

    var profileUrl = e.parameter.profileUrl;
    if (!profileUrl) throw new Error("Missing profileUrl");
    var record = findRecord(profileUrl);
    return jsonOutput({ ok: true, record: record });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    checkToken(body.token);
    var record = upsertRecord(body);
    return jsonOutput({ ok: true, record: record });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err.message || err) });
  }
}

/* ---------- Auth ---------- */

function checkToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty("SECRET_TOKEN");
  if (!expected) throw new Error("Server has no SECRET_TOKEN configured");
  if (!token || token !== expected) throw new Error("Unauthorized");
}

/* ---------- Sheet access ---------- */

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < HEADERS.length) {
    // sheet predates a HEADERS column that was added later (e.g. added_at) —
    // extend the header row in place so existing rows keep their positions.
    var have = sheet.getLastColumn();
    sheet.getRange(1, have + 1, 1, HEADERS.length - have).setValues([HEADERS.slice(have)]);
  }
  return sheet;
}

/**
 * Canonical profile URL — must match extractProfileUrl() in sidepanel.js:
 * decoded, lowercased, re-encoded slug. Lets rows saved before the client
 * canonicalized URLs (e.g. "/in/Juan-Perez/") still match "/in/juan-perez/".
 */
function normalizeProfileUrl(url) {
  var match = String(url || "").match(/\/in\/([^\/?#]+)/);
  if (!match) return String(url || "");
  var slug;
  try {
    slug = encodeURIComponent(decodeURIComponent(match[1]).toLowerCase());
  } catch (err) {
    slug = match[1].toLowerCase(); // malformed escape — don't double-encode it
  }
  return "https://www.linkedin.com/in/" + slug + "/";
}

function findRowIndex(sheet, profileUrl) {
  var needle = normalizeProfileUrl(profileUrl);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] && normalizeProfileUrl(values[i][0]) === needle) return i + 1; // 1-based sheet row
  }
  return -1;
}

function findRecord(profileUrl) {
  var sheet = getSheet();
  var rowIndex = findRowIndex(sheet, profileUrl);
  if (rowIndex === -1) return null;
  var row = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
  return rowToRecord(row);
}

function listRecords(tagFilter) {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var records = [];
  var needle = tagFilter ? String(tagFilter).toLowerCase() : null;

  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue; // skip blank rows
    var record = rowToRecord(values[i]);
    if (needle) {
      var match = record.tags.some(function (t) { return t.toLowerCase() === needle; });
      if (!match) continue;
    }
    records.push(record);
  }
  return records;
}

function upsertRecord(body) {
  if (!body.profileUrl) throw new Error("Missing profileUrl");
  var profileUrl = normalizeProfileUrl(body.profileUrl);

  // Two near-simultaneous saves of the same profile could both miss
  // findRowIndex and append duplicate rows — serialize writes.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return upsertRecordLocked(profileUrl, body);
  } finally {
    lock.releaseLock();
  }
}

function upsertRecordLocked(profileUrl, body) {
  var sheet = getSheet();
  var updatedAt = body.updatedAt || new Date().toISOString();
  var tags = Array.isArray(body.tags) ? body.tags.join(", ") : String(body.tags || "");

  var rowIndex = findRowIndex(sheet, profileUrl);

  // added_at is stamped once and then kept forever — the sheet's own
  // existing value always wins over whatever the client sends, so clock
  // skew or a stale client payload can never overwrite the true add date.
  var addedAt = body.addedAt || new Date().toISOString();
  var name = body.name || "";
  if (rowIndex !== -1) {
    var existing = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
    if (existing[6]) addedAt = existing[6];
    // An empty name from the client (tab title not loaded yet) must not
    // erase the name already stored.
    if (!name && existing[1]) name = existing[1];
  }

  var row = [profileUrl, name, tags, body.note || "", body.status || "", updatedAt, addedAt];

  // Write the row as plain text ("@") so Sheets doesn't reinterpret values:
  // a note starting with "=" stays text instead of becoming a formula, and
  // "3/4" or "2024" stay strings instead of turning into dates/numbers.
  var targetRow = rowIndex === -1 ? sheet.getLastRow() + 1 : rowIndex;
  var range = sheet.getRange(targetRow, 1, 1, HEADERS.length);
  range.setNumberFormat("@");
  range.setValues([row.map(function (v) { return v instanceof Date ? v.toISOString() : String(v); })]);
  return rowToRecord(row);
}

function rowToRecord(row) {
  return {
    profileUrl: row[0],
    name: row[1],
    tags: row[2]
      ? String(row[2])
          .split(",")
          .map(function (t) { return t.trim(); })
          .filter(Boolean)
      : [],
    note: row[3],
    status: row[4],
    updatedAt: row[5],
    addedAt: row[6] || "",
  };
}

/* ---------- Output ---------- */

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
