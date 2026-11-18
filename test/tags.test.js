import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeChrome } from "./helpers/fakes.js";
import {
  TAG_COLOR_COUNT,
  collectRecentTags,
  collectTagCounts,
  filterTags,
  getKnownTags,
  listAllTags,
  loadTagColorOverrides,
  markTagsUsed,
  setKnownTagsFromRecords,
  setTagColorOverride,
  tagColorClass,
  tagColorIndex,
} from "../src/tags.js";

beforeEach(async () => {
  installFakeChrome();
  await loadTagColorOverrides(); // reset module-level overrides
  setKnownTagsFromRecords([]); // reset module-level known tags
});

test("tagColorIndex: deterministic, case-insensitive, within the palette", () => {
  for (const tag of ["SF", "Tech", "conference 2024", "ñandú"]) {
    const i = tagColorIndex(tag);
    assert.ok(Number.isInteger(i) && i >= 0 && i < TAG_COLOR_COUNT, `${tag} -> ${i}`);
    assert.equal(tagColorIndex(tag.toUpperCase()), i);
    assert.equal(tagColorIndex(tag), i);
  }
});

test("setTagColorOverride: wins over the hash and persists to storage", async () => {
  const store = installFakeChrome();
  await loadTagColorOverrides();
  const next = (tagColorIndex("Tech") + 1) % TAG_COLOR_COUNT;
  await setTagColorOverride("Tech", next);
  assert.equal(tagColorIndex("tech"), next);
  assert.equal(tagColorClass("TECH"), `tag-color-${next}`);
  assert.deepEqual(store.tagColors, { tech: next });
});

test("loadTagColorOverrides: reads overrides saved earlier", async () => {
  installFakeChrome({ tagColors: { sf: 5 } });
  await loadTagColorOverrides();
  assert.equal(tagColorIndex("SF"), 5);
});

test("collectTagCounts: counts case-insensitively, most used first, then A–Z", () => {
  const counts = collectTagCounts([
    { tags: ["Tech", "SF"] },
    { tags: ["tech", "Design"] },
    { tags: ["Art"] },
    { tags: undefined },
  ]);
  assert.deepEqual(counts, [
    { label: "Tech", count: 2 },
    { label: "Art", count: 1 },
    { label: "Design", count: 1 },
    { label: "SF", count: 1 },
  ]);
});

test("collectRecentTags: latest save of any record wins, undated tags last A–Z", () => {
  const tags = collectRecentTags([
    { tags: ["Tech", "SF"], updatedAt: "2026-01-01T00:00:00Z" },
    { tags: ["tech"], updatedAt: "2026-03-01T00:00:00Z" }, // bumps Tech, keeps its first spelling
    { tags: ["Design"], updatedAt: "2026-02-01T00:00:00Z" },
    { tags: ["Startup"], addedAt: "2026-01-15T00:00:00Z" }, // no updatedAt: falls back to addedAt
    { tags: ["Zebra", "Art"] }, // no dates
    { tags: undefined },
  ]);
  assert.deepEqual(tags, ["Tech", "Design", "Startup", "SF", "Art", "Zebra"]);
});

test("filterTags: partial, case-insensitive match that skips applied tags", () => {
  const known = ["Tech", "Startup", "Star Wars fan", "SF"];
  assert.deepEqual(filterTags(known, [], "star"), ["Startup", "Star Wars fan"]);
  assert.deepEqual(filterTags(known, ["startup"], "STAR"), ["Star Wars fan"]);
  assert.deepEqual(filterTags(known, ["SF"], "  "), ["Tech", "Startup", "Star Wars fan"]);
  assert.deepEqual(filterTags(known, [], "nope"), []);
});

test("known tags: built most-recent first; markTagsUsed moves used tags to the front", () => {
  setKnownTagsFromRecords([
    { tags: ["Tech"], updatedAt: "2026-02-01T00:00:00Z" },
    { tags: ["SF"], updatedAt: "2026-01-01T00:00:00Z" },
  ]);
  assert.deepEqual(getKnownTags(), ["Tech", "SF"]);
  markTagsUsed(["sf", "Design", "DESIGN"]);
  assert.deepEqual(getKnownTags(), ["SF", "Design", "Tech"]); // known spelling kept, no case duplicates
});

test("listAllTags: every tag A–Z, applied ones flagged, filtered by query", () => {
  const known = ["Tech", "Startup", "SF"];
  assert.deepEqual(listAllTags(known, ["startup", "Brand new"], ""), [
    { tag: "Brand new", selected: true }, // applied but not known yet still listed
    { tag: "SF", selected: false },
    { tag: "startup", selected: true }, // applied spelling wins, no duplicate
    { tag: "Tech", selected: false },
  ]);
  assert.deepEqual(listAllTags(known, ["Startup"], "STAR"), [{ tag: "Startup", selected: true }]);
});
