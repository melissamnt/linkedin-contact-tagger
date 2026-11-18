import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeChrome } from "./helpers/fakes.js";
import {
  TAG_COLOR_COUNT,
  collectTagCounts,
  getKnownTags,
  loadTagColorOverrides,
  mergeKnownTags,
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

test("known tags: built from records and merged without case duplicates", () => {
  setKnownTagsFromRecords([{ tags: ["Tech"] }, { tags: ["tech", "SF"] }]);
  assert.deepEqual(getKnownTags(), ["Tech", "SF"]);
  mergeKnownTags(["TECH", "Design"]);
  assert.deepEqual(getKnownTags(), ["Tech", "SF", "Design"]);
});
