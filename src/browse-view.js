/* Browse people: every saved connection, filtered by a checklist of tags. (Editing tags lives in tag-manager-view.js.) */

import {
  elBrowseEmpty,
  elBrowseFilter,
  elBrowseFilterBtn,
  elBrowseFilterSummary,
  elBrowseFilterWrap,
  elBrowseList,
  elBrowseToggle,
  showView,
} from "./dom.js";
import { fetchAllRecords } from "./sheet-sync.js";
import { collectTagCounts, filterRecordsByTags, setKnownTagsFromRecords, tagColorClass } from "./tags.js";

let browseRecords = [];
// "All" checked = everyone, tagged or not. Unchecking a tag unchecks All too,
// and then only people with at least one checked tag are shown.
let allSelected = true;
let selectedTags = new Set(); // lowercase tags that are checked
let filterOpen = false; // the Filter tags dropdown is showing

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function filterRow({ label, count, checked, onToggle, colorTag }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = checked ? "tag-list-item is-selected" : "tag-list-item";
  btn.setAttribute("aria-pressed", String(checked));
  const check = document.createElement("span");
  check.className = "tag-list-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = checked ? "✓" : "";
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

  for (const { label, count } of tagCounts) {
    const key = label.toLowerCase();
    items.appendChild(
      filterRow({
        label,
        count,
        colorTag: label,
        checked: selectedTags.has(key),
        onToggle: () => {
          if (selectedTags.has(key)) {
            selectedTags.delete(key);
            allSelected = false;
          } else {
            selectedTags.add(key);
            // checking the last unchecked tag checks All again
            if (selectedTags.size === tagCounts.length) allSelected = true;
          }
          rerender();
        },
      })
    );
  }

  elBrowseFilter.appendChild(items);
  items.scrollTop = scroll; // keep the place in a long list after toggling
}

function renderBrowseList() {
  const filtered = filterRecordsByTags(browseRecords, allSelected, selectedTags);

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
        chip.textContent = tag;
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

async function openBrowse() {
  showView("browse");
  elBrowseFilter.innerHTML = "";
  elBrowseList.innerHTML = "";
  elBrowseEmpty.hidden = true;

  const { records } = await fetchAllRecords();
  browseRecords = records;
  allSelected = true;
  selectedTags = new Set(collectTagCounts(records).map((t) => t.label.toLowerCase()));
  filterOpen = false;
  rerender();
  setKnownTagsFromRecords(records);
}

export function initBrowseView() {
  elBrowseToggle.addEventListener("click", openBrowse);
  elBrowseFilterBtn.addEventListener("click", () => setFilterOpen(!filterOpen));
  // Close on a click outside the dropdown or on Escape.
  document.addEventListener("mousedown", (e) => {
    if (filterOpen && !elBrowseFilterWrap.contains(e.target)) setFilterOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (filterOpen && e.key === "Escape") setFilterOpen(false);
  });
}
