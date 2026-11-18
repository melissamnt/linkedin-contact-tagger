/* Tag families, colors, counts, and the known-tags list used for autocomplete.
   A tag can belong to a family by its name: "Education > Stanford LEAD".
   Two levels only; a family can also be used as a tag on its own. */

export const TAG_COLOR_COUNT = 6;

let tagColorOverrides = {}; // lowercase tag -> palette index; loaded once, kept in sync with storage
let knownTags = []; // every tag seen across saved connections, for autocomplete

/* ---------- Families ---------- */

export const FAMILY_SEPARATOR = " > ";

// { family, name } for a tag: "Education > DS4A" -> { family: "Education", name: "DS4A" };
// a tag without a family -> { family: null, name: tag }.
export function parseTag(tag) {
  const i = tag.indexOf(">");
  if (i === -1) return { family: null, name: tag.trim() };
  return { family: tag.slice(0, i).trim(), name: tag.slice(i + 1).trim() };
}

// Tidies typed input into the stored form: "education>ds4a " -> "education > ds4a".
// Empty sides collapse ("> DS4A" -> "DS4A", "Education >" -> "Education"); a
// deeper path keeps two levels by joining the rest ("A > B > C" -> "A > B C").
export function normalizeTag(raw) {
  const parts = raw.split(">").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return `${parts[0]}${FAMILY_SEPARATOR}${parts.slice(1).join(" ")}`;
}

// Reuses the family spelling already in `known`, so typing "education > Harvard"
// joins the existing "Education" family instead of starting "education".
export function matchFamilySpelling(tag, known) {
  const { family, name } = parseTag(tag);
  if (!family) return tag;
  const key = family.toLowerCase();
  for (const k of known) {
    const p = parseTag(k);
    const existing = p.family || p.name;
    if (existing.toLowerCase() === key) return `${existing}${FAMILY_SEPARATOR}${name}`;
  }
  return tag;
}

// What a chip shows: the tag's own name; the family comes through its color.
export function tagLabel(tag) {
  return parseTag(tag).name;
}

export function tagFamily(tag) {
  return parseTag(tag).family;
}

/* ---------- Colors ---------- */

// Colors belong to the family: "Education", "Education > DS4A" and
// "Education > Uniandes" all share the "education" color.
function colorKey(tag) {
  const { family, name } = parseTag(tag);
  return (family || name).toLowerCase();
}

export async function loadTagColorOverrides() {
  const { tagColors } = await chrome.storage.local.get("tagColors");
  tagColorOverrides = tagColors || {};
}

export async function setTagColorOverride(tag, index) {
  tagColorOverrides[colorKey(tag)] = index;
  await chrome.storage.local.set({ tagColors: tagColorOverrides });
}

// After a rename. A tag without a family keeps the color it had (or the one
// picked while editing) under its new name. A tag moving into a family takes
// that family's color unless a new color was picked; leaving a family never
// changes the family's color for the tags still in it.
export async function renameTagColor(from, to, index, colorChanged = true) {
  const fromKey = colorKey(from);
  const toKey = colorKey(to);
  if (fromKey !== toKey && !tagFamily(from)) delete tagColorOverrides[fromKey];
  if (fromKey === toKey || colorChanged || !tagFamily(to)) tagColorOverrides[toKey] = index;
  await chrome.storage.local.set({ tagColors: tagColorOverrides });
}

// A renamed family keeps its color (or the one picked while editing).
export async function renameFamilyColor(from, to, index) {
  delete tagColorOverrides[from.toLowerCase()];
  tagColorOverrides[to.toLowerCase()] = index;
  await chrome.storage.local.set({ tagColors: tagColorOverrides });
}

export function tagColorIndex(tag) {
  const s = colorKey(tag);
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
  if ((to.match(/>/g) || []).length > 1) return "Use one \">\" at most: Family > Tag.";
  const name = normalizeTag(to);
  if (!name) return "Name can't be empty.";
  if (name.includes(",")) return "Tag names can't contain commas.";
  const key = name.toLowerCase();
  if (key !== normalizeTag(from).toLowerCase() && existing.some((t) => normalizeTag(t).toLowerCase() === key)) {
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

// Lowercase family of a tag, or the tag itself when it has none — the key
// a family is known by ("Education > DS4A" and "Education" -> "education").
export function familyKeyOf(tag) {
  const { family, name } = parseTag(tag);
  return (family || name).toLowerCase();
}

// `tags` with family `from` renamed to `to`: "Education > X" -> "Studies > X",
// and the family's own tag "Education" -> "Studies". No duplicates.
export function renameFamilyInList(tags, from, to) {
  const fromKey = from.toLowerCase();
  const out = [];
  const seen = new Set();
  for (const tag of tags) {
    let next = tag;
    if (familyKeyOf(tag) === fromKey) {
      const { family, name } = parseTag(tag);
      next = family ? `${to}${FAMILY_SEPARATOR}${name}` : to;
    }
    if (seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    out.push(next);
  }
  return out;
}

// Why family `from` can't be renamed to `to`, or null if it can. The new
// name can't be used by another family or tag; a change of capitals is fine.
export function validateFamilyName(to, from, existing) {
  const name = to.trim();
  if (!name) return "Name can't be empty.";
  if (name.includes(",") || name.includes(">")) return 'Family names can\'t contain "," or ">".';
  const key = name.toLowerCase();
  if (key !== from.toLowerCase() && existing.some((t) => familyKeyOf(t) === key)) {
    return `"${name}" already exists.`;
  }
  return null;
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

// Groups a family with its tags: by family (or the tag itself), then the
// family's own tag first, then its tags A–Z.
function familyGroupCompare(a, b) {
  const pa = parseTag(a);
  const pb = parseTag(b);
  const ga = pa.family || pa.name;
  const gb = pb.family || pb.name;
  const byGroup = ga.localeCompare(gb, undefined, { sensitivity: "base" });
  if (byGroup) return byGroup;
  if (!pa.family !== !pb.family) return pa.family ? 1 : -1;
  return pa.name.localeCompare(pb.name, undefined, { sensitivity: "base" });
}

// Tags grouped into families for the Browse people filter. Each node is a
// family or a tag without one: { key, label, count, keys, children }.
// `keys` are the lowercase tags the node stands for (the family's own tag, if
// used, plus all its tags); `count` is how many people have any of them.
// Nodes and children are ordered most used first, then A–Z.
export function buildTagTree(records) {
  const nodes = new Map(); // lowercase family-or-tag -> node
  const children = new Map(); // lowercase full tag -> child
  for (const [index, record] of records.entries()) {
    for (const tag of record.tags || []) {
      const { family, name } = parseTag(tag);
      const groupLabel = family || name;
      const groupKey = groupLabel.toLowerCase();
      let node = nodes.get(groupKey);
      if (!node) {
        node = { key: groupKey, label: groupLabel, people: new Set(), keys: new Set(), children: [] };
        nodes.set(groupKey, node);
      }
      node.people.add(index);
      node.keys.add(tag.toLowerCase());
      if (family) {
        const key = tag.toLowerCase();
        let child = children.get(key);
        if (!child) {
          child = { key, tag, label: name, count: 0 };
          children.set(key, child);
          node.children.push(child);
        }
        child.count++;
      }
    }
  }
  const order = (a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  return [...nodes.values()]
    .map(({ people, keys, children: kids, ...node }) => ({
      ...node,
      count: people.size,
      keys: [...keys],
      children: kids.sort(order),
    }))
    .sort(order);
}

// Tag manager order for a tag tree: "count" (most used first, then A–Z),
// "az" or "za" — for families and for the tags inside each family.
export function sortTagTree(tree, mode) {
  const byName = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  const order =
    mode === "az" ? byName : mode === "za" ? (a, b) => byName(b, a) : (a, b) => b.count - a.count || byName(a, b);
  return [...tree].map((node) => ({ ...node, children: [...node.children].sort(order) })).sort(order);
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
// (or its family) contains `query`: families A–Z with their tags first, then
// tags without a family A–Z. Each row says whether it's on the contact and
// whether it belongs to a family.
export function listAllTags(known, applied, query) {
  const q = query.trim().toLowerCase();
  const selected = new Set(applied.map((t) => t.toLowerCase()));
  const byKey = new Map();
  for (const tag of [...applied, ...known]) {
    const key = tag.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, tag); // applied spelling wins
  }
  // Families (with their tags, and the family's own tag if used) come first,
  // then tags without a family.
  const families = new Set([...byKey.values()].filter((t) => tagFamily(t)).map(familyKeyOf));
  const inFamily = (tag) => families.has(familyKeyOf(tag));
  return [...byKey.entries()]
    .filter(([key]) => key.includes(q))
    .sort(([, a], [, b]) => inFamily(b) - inFamily(a) || familyGroupCompare(a, b))
    .map(([key, tag]) => ({ tag, selected: selected.has(key), inFamily: inFamily(tag) }));
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

export function renameKnownFamily(from, to) {
  knownTags = renameFamilyInList(knownTags, from, to);
}
