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

test("sortRecordsByAdded: newest and oldest first, contacts with no date at all last", () => {
  assert.deepEqual(names("newest").slice(0, 3), ["Mar", "Feb", "Jan"]);
  assert.deepEqual(names("oldest").slice(0, 3), ["Jan", "Feb", "Mar"]);
  assert.deepEqual(names("newest").slice(3).sort(), ["Bad", "NoDate"]);
  assert.deepEqual(names("oldest").slice(3).sort(), ["Bad", "NoDate"]);
});

test("sortRecordsByAdded: does not change the input", () => {
  sortRecordsByAdded(records, "newest");
  assert.deepEqual(records.map((r) => r.name), ["Mar", "NoDate", "Jan", "Bad", "Feb"]);
});

test("sortRecordsByAdded: contacts without an added date sort by their last save instead", () => {
  const list = [
    { name: "Old row", updatedAt: "2025-06-01T00:00:00Z" }, // saved before addedAt was recorded
    { name: "New", addedAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-02T00:00:00Z" },
    { name: "Mid", addedAt: "2025-12-01T00:00:00Z" },
  ];
  assert.deepEqual(sortRecordsByAdded(list, "newest").map((r) => r.name), ["New", "Mid", "Old row"]);
  assert.deepEqual(sortRecordsByAdded(list, "oldest").map((r) => r.name), ["Old row", "Mid", "New"]);
});
