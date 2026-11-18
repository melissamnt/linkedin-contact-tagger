/* Browse people: every saved connection, filtered by a checklist of tags. (Editing tags lives in tag-manager-view.js.) */

import {
  elBrowseEmpty,
  elBrowseFilter,
  elBrowseFilterBtn,
  elBrowseFilterSummary,
  elBrowseFilterWrap,
  elBrowseList,
  elBrowseLoading,
  elBrowseSort,
  elBrowseToggle,
  showView,
} from "./dom.js";
import { fetchAllRecords } from "./sheet-sync.js";
import { sortRecordsByAdded } from "./records.js";
import { buildTagTree, collectTagCounts, filterRecordsByTags, setKnownTagsFromRecords, tagColorClass, tagLabel } from "./tags.js";

let browseRecords = [];
// "All" checked = everyone, tagged or not. Unchecking a tag unchecks All too,
// and then only people with at least one checked tag are shown.
let allSelected = true;
let selectedTags = new Set(); // lowercase tags that are checked
let filterOpen = false; // the Filter tags dropdown is showing
let addedOrder = "newest"; // "newest" | "oldest" — kept while the panel is open

function renderSort() {
  for (const btn of elBrowseSort.querySelectorAll("[data-sort]")) {
    btn.setAttribute("aria-checked", String(btn.dataset.sort === addedOrder));
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// checked: true | false | "mixed" (a family with only some of its tags checked).
function filterRow({ label, count, checked, onToggle, colorTag, child = false, title }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `tag-list-item${checked === true ? " is-selected" : ""}${child ? " is-child" : ""}`;
  btn.setAttribute("aria-pressed", String(checked));
  if (title) btn.title = title;
  const check = document.createElement("span");
  check.className = "tag-list-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = checked === true ? "✓" : checked === "mixed" ? "–" : "";
  btn.appendChild(check);
  if (colorTag) {
    const dot = document.createElement("span");
    dot.className = `tag-list-dot ${tagColorClass(colorTag)}`;
    btn.appendChild(dot);
  }
  const name = document.createElement("span");
  name.className = "tm-name";
  name.textContent = label;
  const n = document.createElement("span");
  n.className = "tm-count";
  n.textContent = String(count);
  btn.append(name, n);
  btn.addEventListener("click", onToggle);
  return btn;
}

function rerender() {
  renderFilter();
  renderBrowseList();
}

function setFilterOpen(open) {
  filterOpen = open;
  renderFilter();
}

function renderFilterSummary() {
  elBrowseFilterSummary.textContent = allSelected
    ? "· All"
    : selectedTags.size === 0
      ? "· None"
      : `· ${selectedTags.size} selected`;
}

function renderFilter() {
  renderFilterSummary();
  elBrowseFilterBtn.setAttribute("aria-expanded", String(filterOpen));
  elBrowseFilter.hidden = !filterOpen;
  if (!filterOpen) {
    elBrowseFilter.innerHTML = "";
    return;
  }

  const tagCounts = collectTagCounts(browseRecords);
  const scroll = elBrowseFilter.querySelector(".tag-list-items")?.scrollTop || 0;
  elBrowseFilter.innerHTML = "";

  const head = document.createElement("div");
  head.className = "tag-list-head";
  const title = document.createElement("span");
  title.className = "tag-list-title";
  title.textContent = "Filter tags";
  const actions = document.createElement("span");
  actions.className = "tag-list-actions";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "tag-list-done tag-list-clear";
  clear.textContent = "Clear all";
  clear.disabled = !allSelected && selectedTags.size === 0;
  clear.addEventListener("click", () => {
    allSelected = false;
    selectedTags = new Set();
    rerender();
  });
  const done = document.createElement("button");
  done.type = "button";
  done.className = "tag-list-done";
  done.textContent = "Done";
  done.addEventListener("click", () => setFilterOpen(false));
  actions.append(clear, done);
  head.append(title, actions);
  elBrowseFilter.appendChild(head);

  const items = document.createElement("div");
  items.className = "tag-list-items";

  items.appendChild(
    filterRow({
      label: "All",
      count: browseRecords.length,
      checked: allSelected,
      onToggle: () => {
        allSelected = !allSelected;
        selectedTags = allSelected ? new Set(tagCounts.map((t) => t.label.toLowerCase())) : new Set();
        rerender();
      },
    })
  );

  // Turning tags on or off; All follows: off as soon as anything is off,
  // back on once every tag is checked again.
  const setChecked = (keys, on) => {
    for (const key of keys) {
      if (on) selectedTags.add(key);
      else selectedTags.delete(key);
    }
    allSelected = selectedTags.size === tagCounts.length;
    rerender();
  };

  // Families first-class: a family row checks or unchecks all its tags (and
  // the family's own tag, if used); its tags are listed indented below it.
  for (const node of buildTagTree(browseRecords)) {
    const on = node.keys.filter((k) => selectedTags.has(k)).length;
    const state = on === node.keys.length ? true : on === 0 ? false : "mixed";
    items.appendChild(
      filterRow({
        label: node.label,
        count: node.count,
        colorTag: node.label,
        checked: state,
        onToggle: () => setChecked(node.keys, state !== true),
      })
    );
    for (const child of node.children) {
      const checked = selectedTags.has(child.key);
      items.appendChild(
        filterRow({
          label: child.label,
          count: child.count,
          colorTag: child.tag,
          checked,
          child: true,
          title: child.tag,
          onToggle: () => setChecked([child.key], !checked),
        })
      );
    }
  }

  elBrowseFilter.appendChild(items);
  items.scrollTop = scroll; // keep the place in a long list after toggling
}

function renderBrowseList() {
  const filtered = sortRecordsByAdded(filterRecordsByTags(browseRecords, allSelected, selectedTags), addedOrder);

  elBrowseList.innerHTML = "";
  elBrowseEmpty.hidden = filtered.length > 0;
  elBrowseEmpty.textContent = browseRecords.length ? "No one has the selected tags." : "No connections saved yet.";

  for (const record of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "browse-row";

    const main = document.createElement("div");
    main.className = "browse-row-main";

    const dot = document.createElement("span");
    const statusClass = { Keep: "status-dot-keep", Unsure: "status-dot-unsure", Remove: "status-dot-remove" }[record.status];
    dot.className = `status-dot${statusClass ? ` ${statusClass}` : ""}`;
    main.appendChild(dot);

    const name = document.createElement("span");
    name.className = "browse-row-name";
    name.textContent = record.name || "Unnamed";
    main.appendChild(name);

    row.appendChild(main);

    if (record.tags && record.tags.length) {
      // every tag as a small chip in its own color
      const tags = document.createElement("div");
      tags.className = "browse-row-tags";
      for (const tag of record.tags) {
        const chip = document.createElement("span");
        chip.className = `browse-tag ${tagColorClass(tag)}`;
        chip.textContent = tagLabel(tag); // the family shows through the color
        chip.title = tag;
        tags.appendChild(chip);
      }
      row.appendChild(tags);
    }

    if (record.note) {
      const note = document.createElement("div");
      note.className = "browse-row-note";
      note.textContent = record.note;
      row.appendChild(note);
    }

    if (record.addedAt) {
      const added = document.createElement("div");
      added.className = "browse-row-added";
      added.textContent = `Added ${formatDate(record.addedAt)}`;
      row.appendChild(added);
    }

    row.addEventListener("click", () => chrome.tabs.create({ url: record.profileUrl }));
    elBrowseList.appendChild(row);
  }
}

let loadToken = 0; // ignore a slower, older load if the page was reopened meanwhile

async function openBrowse() {
  const myToken = ++loadToken;
  showView("browse");
  filterOpen = false;
  elBrowseFilter.hidden = true;
  elBrowseFilter.innerHTML = "";
  elBrowseList.innerHTML = "";
  elBrowseEmpty.hidden = true;
  elBrowseFilterWrap.hidden = true;
  elBrowseLoading.hidden = false;

  let records;
  try {
    ({ records } = await fetchAllRecords());
  } finally {
    if (myToken === loadToken) {
      elBrowseLoading.hidden = true;
      elBrowseFilterWrap.hidden = false;
    }
  }
  if (myToken !== loadToken) return;
  browseRecords = records;
  allSelected = true;
  selectedTags = new Set(collectTagCounts(records).map((t) => t.label.toLowerCase()));
  rerender();
  setKnownTagsFromRecords(records);
}

export function initBrowseView() {
  elBrowseToggle.addEventListener("click", openBrowse);
  elBrowseFilterBtn.addEventListener("click", () => setFilterOpen(!filterOpen));
  elBrowseSort.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    addedOrder = btn.dataset.sort;
    renderSort();
    renderBrowseList();
  });
  renderSort();
  // Close on a click outside the dropdown or on Escape.
  document.addEventListener("mousedown", (e) => {
    if (filterOpen && !elBrowseFilterWrap.contains(e.target)) setFilterOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (filterOpen && e.key === "Escape") setFilterOpen(false);
  });
}
