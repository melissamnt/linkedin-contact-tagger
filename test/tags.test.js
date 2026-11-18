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
  renameKnownTag,
  renameTagColor,
  renameTagInList,
  setKnownTagsFromRecords,
  setTagColorOverride,
  tagColorClass,
  tagColorIndex,
  validateTagName,
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

test("validateTagName: empty, commas and existing names refused; capitals-only change allowed", () => {
  const existing = ["Startup", "Tech"];
  assert.equal(validateTagName("  ", "Tech", existing), "Name can't be empty.");
  assert.equal(validateTagName("a, b", "Tech", existing), "Tag names can't contain commas.");
  assert.equal(validateTagName("startup", "Tech", existing), '"startup" already exists.');
  assert.equal(validateTagName("TECH", "Tech", existing), null);
  assert.equal(validateTagName(" Fintech ", "Tech", existing), null);
});

test("renameTagInList: replaces any capitals, no duplicates", () => {
  assert.deepEqual(renameTagInList(["SF", "start-up"], "Start-Up", "Startup"), ["SF", "Startup"]);
  assert.deepEqual(renameTagInList(["startup", "Startup"], "startup", "Startup"), ["Startup"]);
  assert.deepEqual(renameTagInList(["SF"], "Tech", "X"), ["SF"]);
});

test("renameTagColor: new name keeps the chosen color, old override dropped", async () => {
  const store = installFakeChrome({ tagColors: { "start-up": 2 } });
  await loadTagColorOverrides();
  await renameTagColor("start-up", "Startup", 2);
  assert.deepEqual(store.tagColors, { startup: 2 });
  assert.equal(tagColorIndex("Startup"), 2);
});

test("renameKnownTag: renamed in place in the autocomplete list", () => {
  setKnownTagsFromRecords([
    { tags: ["Tech"], updatedAt: "2026-02-01T00:00:00Z" },
    { tags: ["start-up"], updatedAt: "2026-01-01T00:00:00Z" },
  ]);
  renameKnownTag("start-up", "Startup");
  assert.deepEqual(getKnownTags(), ["Tech", "Startup"]);
});
