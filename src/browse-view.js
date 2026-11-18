/* Browse people by tag: every saved connection, filterable by tag. (Editing tags lives in tag-manager-view.js.) */

import { elBrowseToggle, elTagCloud, elBrowseList, elBrowseEmpty, showView } from "./dom.js";
import { fetchAllRecords } from "./sheet-sync.js";
import { collectTagCounts, setKnownTagsFromRecords, tagColorClass, tagStripeClass } from "./tags.js";

let browseRecords = [];
let browseSelectedTag = null; // null means "All"

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderTagCloud() {
  const tagCounts = collectTagCounts(browseRecords);
  elTagCloud.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "tag-chip tag-chip-all";
  allChip.classList.toggle("is-active", browseSelectedTag === null);
  allChip.textContent = `All (${browseRecords.length})`;
  allChip.addEventListener("click", () => {
    browseSelectedTag = null;
    renderTagCloud();
    renderBrowseList();
  });
  elTagCloud.appendChild(allChip);

  for (const { label, count } of tagCounts) {
    const chip = document.createElement("span");
    chip.className = `tag-chip tag-chip-plain ${tagColorClass(label)}`;
    chip.classList.toggle("is-active", browseSelectedTag === label.toLowerCase());

    const select = document.createElement("button");
    select.type = "button";
    select.className = "tag-chip-select";
    select.textContent = `${label} (${count})`;
    select.addEventListener("click", () => {
      browseSelectedTag = label.toLowerCase();
      renderTagCloud();
      renderBrowseList();
    });
    chip.appendChild(select);

    elTagCloud.appendChild(chip);
  }
}

function renderBrowseList() {
  const filtered = browseSelectedTag === null
    ? browseRecords
    : browseRecords.filter((r) => (r.tags || []).some((t) => t.toLowerCase() === browseSelectedTag));

  elBrowseList.innerHTML = "";
  elBrowseEmpty.hidden = filtered.length > 0;

  for (const record of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "browse-row";
    if (record.tags && record.tags.length) {
      row.classList.add(tagStripeClass(record.tags[0]));
    }

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
      const tags = document.createElement("div");
      tags.className = "browse-row-tags";
      tags.textContent = record.tags.join(" · ");
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
  elTagCloud.innerHTML = "";
  elBrowseList.innerHTML = "";
  elBrowseEmpty.hidden = true;

  const { records } = await fetchAllRecords();
  browseRecords = records;
  browseSelectedTag = null;
  renderTagCloud();
  renderBrowseList();
  setKnownTagsFromRecords(records);
}

export function initBrowseView() {
  elBrowseToggle.addEventListener("click", openBrowse);
}
