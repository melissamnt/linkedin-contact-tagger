/* Tag colors, tag counts, and the known-tags list used for autocomplete. */

export const TAG_COLOR_COUNT = 6;

let tagColorOverrides = {}; // lowercase tag -> palette index; loaded once, kept in sync with storage
let knownTags = []; // every tag seen across saved connections, for autocomplete

/* ---------- Colors ---------- */

export async function loadTagColorOverrides() {
  const { tagColors } = await chrome.storage.local.get("tagColors");
  tagColorOverrides = tagColors || {};
}

export async function setTagColorOverride(tag, index) {
  tagColorOverrides[tag.toLowerCase()] = index;
  await chrome.storage.local.set({ tagColors: tagColorOverrides });
}

// A renamed tag keeps the color it had (or the one picked while editing):
// pin it on the new name and drop the old name's override.
export async function renameTagColor(from, to, index) {
  delete tagColorOverrides[from.toLowerCase()];
  tagColorOverrides[to.toLowerCase()] = index;
  await chrome.storage.local.set({ tagColors: tagColorOverrides });
}

export function tagColorIndex(tag) {
  const s = tag.toLowerCase();
  if (s in tagColorOverrides) return tagColorOverrides[s];

  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash % TAG_COLOR_COUNT;
}

export function tagColorClass(tag) {
  return `tag-color-${tagColorIndex(tag)}`;
}

/* ---------- Renaming ---------- */

// Why `to` can't replace `from`, or null if it can. `existing` is every tag
// in use. A change of capitals only ("startup" -> "Startup") is allowed.
export function validateTagName(to, from, existing) {
  const name = to.trim();
  if (!name) return "Name can't be empty.";
  if (name.includes(",")) return "Tag names can't contain commas.";
  const key = name.toLowerCase();
  if (key !== from.toLowerCase() && existing.some((t) => t.toLowerCase() === key)) {
    return `"${name}" already exists.`;
  }
  return null;
}

// `tags` with `from` (any capitals) replaced by `to`, without duplicates.
export function renameTagInList(tags, from, to) {
  const fromKey = from.toLowerCase();
  const out = [];
  const seen = new Set();
  for (const tag of tags) {
    const next = tag.toLowerCase() === fromKey ? to : tag;
    if (seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    out.push(next);
  }
  return out;
}

/* ---------- Counts ---------- */

export function collectTagCounts(records) {
  const counts = new Map(); // lowercase tag -> { label, count }
  for (const record of records) {
    for (const tag of record.tags || []) {
      const key = tag.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { label: tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// Browse people filter: everyone while "All" is checked; otherwise people
// carrying at least one checked tag (`selected` holds lowercase tags).
export function filterRecordsByTags(records, allSelected, selected) {
  if (allSelected) return records;
  return records.filter((r) => (r.tags || []).some((t) => selected.has(t.toLowerCase())));
}

// Order for the Tag manager: "count" (most used first, then A–Z), "az" or "za".
export function sortTagCounts(counts, mode) {
  const byName = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  const sorted = [...counts];
  if (mode === "az") sorted.sort(byName);
  else if (mode === "za") sorted.sort((a, b) => byName(b, a));
  else sorted.sort((a, b) => b.count - a.count || byName(a, b));
  return sorted;
}

/* ---------- Known tags (autocomplete) ---------- */

function recordTime(record) {
  const t = Date.parse(record.updatedAt || record.addedAt || "");
  return Number.isNaN(t) ? 0 : t;
}

// Every tag, most recently used first: a tag's time is the latest save of any
// record carrying it. Ties (e.g. records with no dates) fall back to A–Z.
export function collectRecentTags(records) {
  const tags = new Map(); // lowercase tag -> { label, last }
  for (const record of records) {
    const time = recordTime(record);
    for (const tag of record.tags || []) {
      const key = tag.toLowerCase();
      const existing = tags.get(key);
      if (!existing) tags.set(key, { label: tag, last: time });
      else if (time > existing.last) existing.last = time;
    }
  }
  return [...tags.values()]
    .sort((a, b) => b.last - a.last || a.label.localeCompare(b.label))
    .map((t) => t.label);
}

// Known tags not already applied whose name contains `query` (case-insensitive),
// in known-tags order. An empty query matches everything.
export function filterTags(known, applied, query) {
  const q = query.trim().toLowerCase();
  const skip = new Set(applied.map((t) => t.toLowerCase()));
  return known.filter((t) => !skip.has(t.toLowerCase()) && t.toLowerCase().includes(q));
}

// Every tag — known ones plus any applied tag not known yet — whose name
// contains `query`, A–Z, each flagged with whether it's on the contact.
export function listAllTags(known, applied, query) {
  const q = query.trim().toLowerCase();
  const selected = new Set(applied.map((t) => t.toLowerCase()));
  const byKey = new Map();
  for (const tag of [...applied, ...known]) {
    const key = tag.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, tag); // applied spelling wins
  }
  return [...byKey.entries()]
    .filter(([key]) => key.includes(q))
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([key, tag]) => ({ tag, selected: selected.has(key) }));
}

export function getKnownTags() {
  return knownTags;
}

export function setKnownTagsFromRecords(records) {
  knownTags = collectRecentTags(records);
}

// Tags just added to a contact become the most recent: move them (or add
// them, if new) to the front, without creating case-only duplicates.
export function markTagsUsed(tags) {
  const used = [];
  const seen = new Set();
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // keep the spelling already known, so "tech" doesn't relabel "Tech"
    used.push(knownTags.find((t) => t.toLowerCase() === key) || tag);
  }
  knownTags = [...used, ...knownTags.filter((t) => !seen.has(t.toLowerCase()))];
}

export function renameKnownTag(from, to) {
  knownTags = renameTagInList(knownTags, from, to);
}
