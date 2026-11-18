/* Tag manager: every tag with how many contacts use it, sortable, each
   renamable and recolorable. (Browsing people by tag is browse-view.js.) */

import {
  elTagManagerEmpty,
  elTagManagerList,
  elTagManagerLoading,
  elTagManagerSort,
  elTagManagerToggle,
  showView,
} from "./dom.js";
import { fetchAllRecords, renameTagRemote } from "./sheet-sync.js";
import { renameTagInLocalRecords } from "./storage.js";
import { applyTagRename } from "./profile-view.js";
import {
  TAG_COLOR_COUNT,
  collectTagCounts,
  getKnownTags,
  normalizeTag,
  renameKnownTag,
  renameTagColor,
  renameTagInList,
  setKnownTagsFromRecords,
  setTagColorOverride,
  sortTagCounts,
  tagColorClass,
  tagColorIndex,
  validateTagName,
} from "./tags.js";

let tmRecords = [];
let sortMode = "count"; // "count" | "az" | "za" — kept while the panel is open
let editingTag = null; // label of the tag open in the editor, or null

const PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function renderSort() {
  for (const btn of elTagManagerSort.querySelectorAll("[data-sort]")) {
    btn.setAttribute("aria-checked", String(btn.dataset.sort === sortMode));
  }
}

function renderTagList() {
  const tags = sortTagCounts(collectTagCounts(tmRecords), sortMode);
  elTagManagerList.innerHTML = "";
  elTagManagerEmpty.hidden = tags.length > 0;

  for (const { label, count } of tags) {
    const row = document.createElement("div");
    row.className = "tm-row";

    const dot = document.createElement("span");
    dot.className = `tag-list-dot ${tagColorClass(label)}`;

    const name = document.createElement("span");
    name.className = "tm-name";
    name.textContent = label;

    const n = document.createElement("span");
    n.className = "tm-count";
    n.textContent = String(count);
    n.title = `${count} ${count === 1 ? "contact" : "contacts"}`;

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "tm-edit";
    edit.title = "Edit tag";
    edit.setAttribute("aria-label", `Edit tag ${label}`);
    edit.setAttribute("aria-expanded", String(editingTag === label));
    edit.innerHTML = PENCIL;
    edit.addEventListener("click", () => (editingTag === label ? closeTagEditor() : openTagEditor(label)));

    row.append(dot, name, n, edit);
    elTagManagerList.appendChild(row);
    if (editingTag === label) elTagManagerList.appendChild(buildTagEditor(label));
  }
}


function closeTagEditor() {
  editingTag = null;
  renderTagList();
}

function openTagEditor(label) {
  editingTag = label;
  renderTagList();
}

// The editor opens right under the tag's row.
function buildTagEditor(label) {
  let colorIndex = tagColorIndex(label);
  const editor = document.createElement("div");
  editor.className = "tag-editor";

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
    const to = normalizeTag(input.value); // "Family > Tag" moves the tag into a family
    const existing = [...collectTagCounts(tmRecords).map((t) => t.label), ...getKnownTags()];
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

  editor.append(nameLabel, input, colorLabel, colors, error, actions);
  // focus once it's in the document
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return editor;
}

// Color-only edits stay on this device. A rename goes to the Sheet first, so
// a failed request changes nothing; then local copies, the open contact,
// autocomplete and the color setting follow.
async function saveTagEdit(from, to, colorIndex) {
  if (to === from) {
    await setTagColorOverride(from, colorIndex);
    applyTagRename(from, from); // re-render the open contact's chips in the new color
    return;
  }
  await renameTagRemote(from, to);
  await renameTagInLocalRecords(from, to);
  await renameTagColor(from, to, colorIndex, colorIndex !== tagColorIndex(from));
  renameKnownTag(from, to);
  applyTagRename(from, to);
  tmRecords = tmRecords.map((r) => (r.tags ? { ...r, tags: renameTagInList(r.tags, from, to) } : r));
}

let loadToken = 0; // ignore a slower, older load if the page was reopened meanwhile

async function openTagManager() {
  const myToken = ++loadToken;
  showView("tagManager");
  editingTag = null;
  elTagManagerList.innerHTML = "";
  elTagManagerEmpty.hidden = true;
  renderSort();
  elTagManagerSort.hidden = true;
  elTagManagerLoading.hidden = false;

  let records;
  try {
    ({ records } = await fetchAllRecords());
  } finally {
    if (myToken === loadToken) {
      elTagManagerLoading.hidden = true;
      elTagManagerSort.hidden = false;
    }
  }
  if (myToken !== loadToken) return;
  tmRecords = records;
  renderTagList();
  setKnownTagsFromRecords(records);
}

export function initTagManagerView() {
  elTagManagerToggle.addEventListener("click", openTagManager);
  elTagManagerSort.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    sortMode = btn.dataset.sort;
    renderSort();
    renderTagList();
  });
}
