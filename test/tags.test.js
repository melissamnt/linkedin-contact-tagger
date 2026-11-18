import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeChrome } from "./helpers/fakes.js";
import {
  TAG_COLOR_COUNT,
  buildTagTree,
  collectRecentTags,
  collectTagCounts,
  filterRecordsByTags,
  filterTags,
  getKnownTags,
  listAllTags,
  loadTagColorOverrides,
  markTagsUsed,
  matchFamilySpelling,
  normalizeTag,
  renameFamilyColor,
  renameFamilyInList,
  renameKnownFamily,
  sortTagTree,
  validateFamilyName,
  parseTag,
  renameKnownTag,
  renameTagColor,
  renameTagInList,
  setKnownTagsFromRecords,
  setTagColorOverride,
  sortTagCounts,
  tagColorClass,
  tagColorIndex,
  tagLabel,
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

test("sortTagCounts: most used (ties A–Z), A–Z and Z–A ignoring capitals", () => {
  const counts = [
    { label: "tech", count: 2 },
    { label: "Art", count: 1 },
    { label: "SF", count: 3 },
    { label: "design", count: 2 },
  ];
  const labels = (mode) => sortTagCounts(counts, mode).map((t) => t.label);
  assert.deepEqual(labels("count"), ["SF", "design", "tech", "Art"]);
  assert.deepEqual(labels("az"), ["Art", "design", "SF", "tech"]);
  assert.deepEqual(labels("za"), ["tech", "SF", "design", "Art"]);
  assert.deepEqual(counts.map((t) => t.label), ["tech", "Art", "SF", "design"], "input not mutated");
});

test("filterRecordsByTags: All shows everyone; otherwise anyone with a checked tag", () => {
  const records = [
    { name: "A", tags: ["SF", "Tech"] },
    { name: "B", tags: ["design"] },
    { name: "C", tags: [] },
    { name: "D" },
  ];
  const names = (all, sel) => filterRecordsByTags(records, all, new Set(sel)).map((r) => r.name);
  assert.deepEqual(names(true, []), ["A", "B", "C", "D"]);
  assert.deepEqual(names(false, ["tech", "design"]), ["A", "B"]); // untagged hidden once All is off
  assert.deepEqual(names(false, ["design"]), ["B"]);
  assert.deepEqual(names(false, []), []);
});

/* ---------- Tag families ---------- */

test("parseTag / tagLabel: family and name, or just a name", () => {
  assert.deepEqual(parseTag("Education > Stanford LEAD"), { family: "Education", name: "Stanford LEAD" });
  assert.deepEqual(parseTag("SF"), { family: null, name: "SF" });
  assert.equal(tagLabel("Education > DS4A"), "DS4A");
  assert.equal(tagLabel("Tech"), "Tech");
});

test("normalizeTag: tidies typed families into the stored form", () => {
  assert.equal(normalizeTag("Education>DS4A"), "Education > DS4A");
  assert.equal(normalizeTag("  Education  >   Uniandes "), "Education > Uniandes");
  assert.equal(normalizeTag("> DS4A"), "DS4A");
  assert.equal(normalizeTag("Education >"), "Education");
  assert.equal(normalizeTag("A > B > C"), "A > B C");
  assert.equal(normalizeTag("  "), "");
});

test("family colors: every tag in a family shares the family's color", async () => {
  const store = installFakeChrome();
  await loadTagColorOverrides();
  const family = tagColorIndex("Education");
  assert.equal(tagColorIndex("Education > Stanford LEAD"), family);
  assert.equal(tagColorIndex("education > DS4A"), family);

  const next = (family + 1) % TAG_COLOR_COUNT;
  await setTagColorOverride("Education > DS4A", next); // recoloring a tag recolors its family
  assert.deepEqual(store.tagColors, { education: next });
  assert.equal(tagColorIndex("Education > Uniandes"), next);
  assert.equal(tagColorIndex("Education"), next);
});

test("renameTagColor: moving into a family adopts its color; leaving one keeps the family's", async () => {
  const store = installFakeChrome({ tagColors: { education: 4, uniandes: 1 } });
  await loadTagColorOverrides();

  await renameTagColor("Uniandes", "Education > Uniandes", 1, false); // color untouched in the editor
  assert.equal(tagColorIndex("Education > Uniandes"), 4);
  assert.deepEqual(store.tagColors, { education: 4 });

  await renameTagColor("Education > DS4A", "DS4A", 4, false); // leaves the family, keeps its look
  assert.equal(tagColorIndex("DS4A"), 4);
  assert.equal(tagColorIndex("Education > Uniandes"), 4, "family color untouched");
});

test("validateTagName: families allowed, one > at most, duplicates compared normalized", () => {
  const existing = ["Education > Uniandes", "SF"];
  assert.equal(validateTagName("Education > DS4A", "DS4A", existing), null);
  assert.equal(validateTagName("education>uniandes", "Uniandes", existing), '"education > uniandes" already exists.');
  assert.equal(validateTagName("A > B > C", "SF", existing), 'Use one ">" at most: Family > Tag.');
  assert.equal(validateTagName(" > ", "SF", existing), "Name can't be empty.");
});

test("listAllTags: a family's own tag first, then its tags A–Z, grouped with flat tags", () => {
  const known = ["Education > Uniandes", "SF", "Education", "Education > DS4A", "Design", "Events > Web Summit"];
  assert.deepEqual(
    listAllTags(known, [], "").map((r) => r.tag),
    ["Design", "Education", "Education > DS4A", "Education > Uniandes", "Events > Web Summit", "SF"]
  );
  // searching a family name finds its tags
  assert.deepEqual(listAllTags(known, [], "educ").map((r) => r.tag), ["Education", "Education > DS4A", "Education > Uniandes"]);
});

test("buildTagTree: families count people once and own their tags; flat tags stand alone", () => {
  const tree = buildTagTree([
    { tags: ["Education > Stanford LEAD", "Education > DS4A", "SF"] },
    { tags: ["Education > DS4A"] },
    { tags: ["education"] }, // the family used as a tag on its own
    { tags: ["SF"] },
  ]);
  assert.deepEqual(
    tree.map(({ label, count, keys, children }) => ({ label, count, keys, children: children.map((c) => [c.label, c.count]) })),
    [
      {
        label: "Education",
        count: 3,
        keys: ["education > stanford lead", "education > ds4a", "education"],
        children: [["DS4A", 2], ["Stanford LEAD", 1]],
      },
      { label: "SF", count: 2, keys: ["sf"], children: [] },
    ]
  );
});

test("matchFamilySpelling: joins an existing family's spelling", () => {
  const known = ["Education > Uniandes", "SF"];
  assert.equal(matchFamilySpelling("education > Harvard", known), "Education > Harvard");
  assert.equal(matchFamilySpelling("sf > Mission", known), "SF > Mission"); // a flat tag becomes the family
  assert.equal(matchFamilySpelling("Events > Web Summit", known), "Events > Web Summit");
  assert.equal(matchFamilySpelling("Tech", known), "Tech");
});

test("renameFamilyInList: family tags and the family's own tag, nothing else", () => {
  assert.deepEqual(
    renameFamilyInList(["Education > DS4A", "education", "Educational", "SF"], "Education", "Studies"),
    ["Studies > DS4A", "Studies", "Educational", "SF"]
  );
  assert.deepEqual(renameFamilyInList(["Studies", "Education"], "Education", "Studies"), ["Studies"], "no duplicates");
});

test("validateFamilyName: refuses separators and names in use; capitals-only allowed", () => {
  const existing = ["Education > DS4A", "SF", "Events > Web Summit"];
  assert.equal(validateFamilyName("Studies", "Education", existing), null);
  assert.equal(validateFamilyName("education", "Education", existing), null);
  assert.equal(validateFamilyName("events", "Education", existing), '"events" already exists.');
  assert.equal(validateFamilyName("SF", "Education", existing), '"SF" already exists.');
  assert.equal(validateFamilyName("A > B", "Education", existing), 'Family names can\'t contain "," or ">".');
  assert.equal(validateFamilyName(" ", "Education", existing), "Name can't be empty.");
});

test("renameFamilyColor / renameKnownFamily: color and autocomplete follow the new name", async () => {
  const store = installFakeChrome({ tagColors: { education: 3 } });
  await loadTagColorOverrides();
  await renameFamilyColor("Education", "Studies", 3);
  assert.deepEqual(store.tagColors, { studies: 3 });
  assert.equal(tagColorIndex("Studies > DS4A"), 3);

  setKnownTagsFromRecords([{ tags: ["Education > DS4A", "SF"], updatedAt: "2026-01-01T00:00:00Z" }]);
  renameKnownFamily("Education", "Studies");
  assert.deepEqual(getKnownTags(), ["Studies > DS4A", "SF"]); // renamed in place
});

test("sortTagTree: families and their tags follow the chosen order", () => {
  const tree = buildTagTree([
    { tags: ["Education > Uniandes", "Education > DS4A"] },
    { tags: ["Education > Uniandes", "SF"] },
    { tags: ["Art"] },
  ]);
  const view = (mode) => sortTagTree(tree, mode).map((n) => [n.label, n.children.map((c) => c.label)]);
  assert.deepEqual(view("count"), [["Education", ["Uniandes", "DS4A"]], ["Art", []], ["SF", []]]);
  assert.deepEqual(view("az"), [["Art", []], ["Education", ["DS4A", "Uniandes"]], ["SF", []]]);
  assert.deepEqual(view("za"), [["SF", []], ["Education", ["Uniandes", "DS4A"]], ["Art", []]]);
});
