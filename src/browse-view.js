/* Browse view: every saved connection, filterable by tag; tags can be renamed and recolored here. */

import { elBrowseToggle, elTagCloud, elTagEditor, elBrowseList, elBrowseEmpty, showView } from "./dom.js";
import { fetchAllRecords, renameTagRemote } from "./sheet-sync.js";
import { renameTagInLocalRecords } from "./storage.js";
import { applyTagRename } from "./profile-view.js";
import {
  TAG_COLOR_COUNT,
  collectTagCounts,
  getKnownTags,
  renameKnownTag,
  renameTagColor,
  renameTagInList,
  setKnownTagsFromRecords,
  setTagColorOverride,
  tagColorClass,
  tagColorIndex,
  tagStripeClass,
  validateTagName,
} from "./tags.js";

let browseRecords = [];
let browseSelectedTag = null; // null means "All"
let editingTag = null; // label of the tag open in the editor, or null

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
    chip.className = `tag-chip ${tagColorClass(label)}`;
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

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "tag-edit-btn";
    edit.title = "Edit tag";
    edit.setAttribute("aria-label", `Edit tag ${label}`);
    edit.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      if (editingTag === label) closeTagEditor(); // pencil again closes it
      else openTagEditor(label);
    });
    chip.appendChild(edit);

    elTagCloud.appendChild(chip);
  }
}

/* ---------- Tag editor ---------- */

function closeTagEditor() {
  editingTag = null;
  elTagEditor.hidden = true;
  elTagEditor.innerHTML = "";
}

function openTagEditor(label) {
  editingTag = label;
  let colorIndex = tagColorIndex(label);
  elTagEditor.hidden = false;
  elTagEditor.innerHTML = "";

  const nameLabel = document.createElement("label");
  nameLabel.className = "field-label";
  nameLabel.htmlFor = "tagEditorName";
  nameLabel.textContent = "Tag name";

  const input = document.createElement("input");
  input.id = "tagEditorName";
  input.className = "text-input";
  input.type = "text";
  input.value = label;
  input.autocomplete = "off";
  input.spellcheck = false;

  const colorLabel = document.createElement("span");
  colorLabel.className = "field-label tag-editor-color-label";
  colorLabel.textContent = "Color";

  const colors = document.createElement("div");
  colors.className = "tag-editor-colors";
  colors.setAttribute("role", "radiogroup");
  colors.setAttribute("aria-label", "Color");
  const renderColors = () => {
    colors.innerHTML = "";
    for (let i = 0; i < TAG_COLOR_COUNT; i++) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = `tag-editor-color tag-color-${i}`;
      sw.setAttribute("role", "radio");
      sw.setAttribute("aria-checked", String(i === colorIndex));
      sw.setAttribute("aria-label", `Color ${i + 1}`);
      sw.addEventListener("click", () => {
        colorIndex = i;
        renderColors();
      });
      colors.appendChild(sw);
    }
  };
  renderColors();

  const error = document.createElement("p");
  error.className = "tag-editor-error";
  error.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "tag-editor-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "save-btn";
  save.textContent = "Save";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "link-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeTagEditor);
  actions.append(save, cancel);

  const submit = async () => {
    const to = input.value.trim();
    const existing = [...collectTagCounts(browseRecords).map((t) => t.label), ...getKnownTags()];
    const problem = validateTagName(to, label, existing);
    if (problem) {
      error.textContent = problem;
      return;
    }
    error.textContent = "";
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      await saveTagEdit(label, to, colorIndex);
      closeTagEditor();
      renderTagCloud();
      renderBrowseList();
    } catch (err) {
      error.textContent = `Couldn't rename — ${err.message}`;
      save.disabled = false;
      save.textContent = "Save";
    }
  };
  save.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    else if (e.key === "Escape") closeTagEditor();
  });

  elTagEditor.append(nameLabel, input, colorLabel, colors, error, actions);
  input.focus();
  input.select();
}

// Color-only edits stay on this device. A rename goes to the Sheet first, so
// a failed request changes nothing; then local copies, the open contact,
// autocomplete and the color setting follow.
async function saveTagEdit(from, to, colorIndex) {
  if (to === from) {
    await setTagColorOverride(from, colorIndex);
    applyTagRename(from, from); // re-render chips in the new color
    return;
  }
  await renameTagRemote(from, to);
  await renameTagInLocalRecords(from, to);
  await renameTagColor(from, to, colorIndex);
  renameKnownTag(from, to);
  applyTagRename(from, to);
  browseRecords = browseRecords.map((r) => (r.tags ? { ...r, tags: renameTagInList(r.tags, from, to) } : r));
  if (browseSelectedTag === from.toLowerCase()) browseSelectedTag = to.toLowerCase();
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
  closeTagEditor();
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
