import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRecordsByAdded } from "../src/records.js";

const records = [
  { name: "Mar", addedAt: "2026-03-01T00:00:00Z" },
  { name: "NoDate" },
  { name: "Jan", addedAt: "2026-01-01T00:00:00Z" },
  { name: "Bad", addedAt: "not a date" },
  { name: "Feb", addedAt: "2026-02-01T00:00:00Z" },
];
const names = (order) => sortRecordsByAdded(records, order).map((r) => r.name);

test("sortRecordsByAdded: newest and oldest first, undated contacts always last", () => {
  assert.deepEqual(names("newest").slice(0, 3), ["Mar", "Feb", "Jan"]);
  assert.deepEqual(names("oldest").slice(0, 3), ["Jan", "Feb", "Mar"]);
  assert.deepEqual(names("newest").slice(3).sort(), ["Bad", "NoDate"]);
  assert.deepEqual(names("oldest").slice(3).sort(), ["Bad", "NoDate"]);
});

test("sortRecordsByAdded: does not change the input", () => {
  sortRecordsByAdded(records, "newest");
  assert.deepEqual(records.map((r) => r.name), ["Mar", "NoDate", "Jan", "Bad", "Feb"]);
});
