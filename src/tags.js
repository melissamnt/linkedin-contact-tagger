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

export function tagStripeClass(tag) {
  return `tag-stripe-${tagColorIndex(tag)}`;
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

/* ---------- Known tags (autocomplete) ---------- */

export function getKnownTags() {
  return knownTags;
}

export function setKnownTagsFromRecords(records) {
  knownTags = collectTagCounts(records).map((t) => t.label);
}

export function mergeKnownTags(tags) {
  const have = new Set(knownTags.map((t) => t.toLowerCase()));
  for (const tag of tags) {
    if (!have.has(tag.toLowerCase())) {
      knownTags.push(tag);
      have.add(tag.toLowerCase());
    }
  }
}
