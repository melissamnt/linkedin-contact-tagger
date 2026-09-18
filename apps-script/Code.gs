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

function findRowIndex(sheet, profileUrl) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === profileUrl) return i + 1; // 1-based sheet row
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
  var profileUrl = body.profileUrl;
  if (!profileUrl) throw new Error("Missing profileUrl");

  var sheet = getSheet();
  var updatedAt = body.updatedAt || new Date().toISOString();
  var tags = Array.isArray(body.tags) ? body.tags.join(", ") : String(body.tags || "");

  var rowIndex = findRowIndex(sheet, profileUrl);

  // added_at is stamped once and then kept forever — the sheet's own
  // existing value always wins over whatever the client sends, so clock
  // skew or a stale client payload can never overwrite the true add date.
  var addedAt = body.addedAt || new Date().toISOString();
  if (rowIndex !== -1) {
    var existing = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
    if (existing[6]) addedAt = existing[6];
  }

  var row = [profileUrl, body.name || "", tags, body.note || "", body.status || "", updatedAt, addedAt];

  if (rowIndex === -1) {
    sheet.appendRow(row);
  } else {
    sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
  }
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
