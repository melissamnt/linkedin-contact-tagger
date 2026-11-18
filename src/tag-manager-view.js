/* Tag manager: every tag with how many contacts use it, grouped into
   families and sortable. Families can be renamed and recolored; tags can be
   renamed, recolored and moved into or out of a family.
   (Browsing people by tag is browse-view.js.) */

import {
  elTagManagerEmpty,
  elTagManagerList,
  elTagManagerLoading,
  elTagManagerSort,
  elTagManagerToggle,
  showView,
} from "./dom.js";
import { fetchAllRecords, renameFamilyRemote, renameTagRemote } from "./sheet-sync.js";
import { renameFamilyInLocalRecords, renameTagInLocalRecords } from "./storage.js";
import { applyTagsChange } from "./profile-view.js";
import {
  FAMILY_SEPARATOR,
  TAG_COLOR_COUNT,
  buildTagTree,
  collectTagCounts,
  getKnownTags,
  matchFamilySpelling,
  parseTag,
  renameFamilyColor,
  renameFamilyInList,
  renameKnownFamily,
  renameKnownTag,
  renameTagColor,
  renameTagInList,
  setKnownTagsFromRecords,
  setTagColorOverride,
  sortTagTree,
  tagColorClass,
  tagColorIndex,
  validateFamilyName,
  validateTagName,
} from "./tags.js";

let tmRecords = [];
let sortMode = "count"; // "count" | "az" | "za" — kept while the panel is open
let editing = null; // { kind: "family", label } | { kind: "tag", tag } | null

const PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function renderSort() {
  for (const btn of elTagManagerSort.querySelectorAll("[data-sort]")) {
    btn.setAttribute("aria-checked", String(btn.dataset.sort === sortMode));
  }
}

function isEditing(kind, value) {
  return editing?.kind === kind && (kind === "family" ? editing.label === value : editing.tag === value);
}

function tagRow({ label, count, colorTag, child, editKind, editValue, editLabel }) {
  const row = document.createElement("div");
  row.className = `tm-row${child ? " is-child" : ""}`;

  const dot = document.createElement("span");
  dot.className = `tag-list-dot ${tagColorClass(colorTag)}`;

  const name = document.createElement("span");
  name.className = "tm-name";
  name.textContent = label;
  if (child) name.title = colorTag;

  const n = document.createElement("span");
  n.className = "tm-count";
  n.textContent = String(count);
  n.title = `${count} ${count === 1 ? "contact" : "contacts"}`;

  const open = isEditing(editKind, editValue);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "tm-edit";
  edit.title = editKind === "family" ? "Edit family" : "Edit tag";
  edit.setAttribute("aria-label", `${edit.title} ${editLabel}`);
  edit.setAttribute("aria-expanded", String(open));
  edit.innerHTML = PENCIL;
  edit.addEventListener("click", () => {
    editing = open ? null : editKind === "family" ? { kind: "family", label: editValue } : { kind: "tag", tag: editValue };
    renderTagList();
  });

  row.append(dot, name, n, edit);
  return row;
}

function renderTagList() {
  const tree = sortTagTree(buildTagTree(tmRecords), sortMode);
  elTagManagerList.innerHTML = "";
  elTagManagerEmpty.hidden = tree.length > 0;

  for (const node of tree) {
    if (node.children.length) {
      // a family, with its tags indented underneath
      elTagManagerList.appendChild(
        tagRow({ label: node.label, count: node.count, colorTag: node.label, editKind: "family", editValue: node.label, editLabel: node.label })
      );
      if (isEditing("family", node.label)) elTagManagerList.appendChild(buildFamilyEditor(node.label));
      for (const child of node.children) {
        elTagManagerList.appendChild(
          tagRow({ label: child.label, count: child.count, colorTag: child.tag, child: true, editKind: "tag", editValue: child.tag, editLabel: child.tag })
        );
        if (isEditing("tag", child.tag)) elTagManagerList.appendChild(buildTagEditor(child.tag));
      }
    } else {
      elTagManagerList.appendChild(
        tagRow({ label: node.label, count: node.count, colorTag: node.label, editKind: "tag", editValue: node.label, editLabel: node.label })
      );
      if (isEditing("tag", node.label)) elTagManagerList.appendChild(buildTagEditor(node.label));
    }
  }
}

function closeEditor() {
  editing = null;
  renderTagList();
}

/* ---------- Editors ---------- */

function field(labelText, id, value, placeholder = "") {
  const label = document.createElement("label");
  label.className = "field-label tag-editor-field-label";
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement("input");
  input.id = id;
  input.className = "text-input";
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  return { label, input };
}

// The six color swatches. getIndex/setIndex keep the editor's choice.
function colorPicker(getIndex, setIndex, labelText) {
  const label = document.createElement("span");
  label.className = "field-label tag-editor-field-label";
  label.textContent = labelText;
  const colors = document.createElement("div");
  colors.className = "tag-editor-colors";
  colors.setAttribute("role", "radiogroup");
  colors.setAttribute("aria-label", labelText);
  const render = () => {
    colors.innerHTML = "";
    for (let i = 0; i < TAG_COLOR_COUNT; i++) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = `tag-editor-color tag-color-${i}`;
      sw.setAttribute("role", "radio");
      sw.setAttribute("aria-checked", String(i === getIndex()));
      sw.setAttribute("aria-label", `Color ${i + 1}`);
      sw.addEventListener("click", () => {
        setIndex(i);
        render();
      });
      colors.appendChild(sw);
    }
  };
  render();
  return { label, colors, render };
}

// Save / Cancel, the error line, Enter / Escape on the inputs, and the
// "Saving…" state around `onSave` (which throws to show an error).
function editorShell(parts, inputs, onSave) {
  const editor = document.createElement("div");
  editor.className = "tag-editor";

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
  cancel.addEventListener("click", closeEditor);
  actions.append(save, cancel);

  const submit = async () => {
    error.textContent = "";
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      const problem = await onSave();
      if (problem) {
        error.textContent = problem;
        save.disabled = false;
        save.textContent = "Save";
        return;
      }
      closeEditor();
    } catch (err) {
      error.textContent = `Couldn't save — ${err.message}`;
      save.disabled = false;
      save.textContent = "Save";
    }
  };
  save.addEventListener("click", submit);
  for (const input of inputs) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      else if (e.key === "Escape") closeEditor();
    });
  }

  editor.append(...parts, error, actions);
  queueMicrotask(() => {
    inputs[0].focus();
    inputs[0].select();
  });
  return editor;
}

function allTags() {
  return [...collectTagCounts(tmRecords).map((t) => t.label), ...getKnownTags()];
}

function familyNames() {
  return buildTagTree(tmRecords)
    .filter((n) => n.children.length)
    .map((n) => n.label)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// A tag (with or without a family): its name, its family — type or pick one
// to move it, clear it to take it out — and its color. In a family the color
// is the family's, shared by all its tags.
function buildTagEditor(tag) {
  const { family, name } = parseTag(tag);
  let colorIndex = tagColorIndex(tag);
  let colorTouched = false;

  const nameField = field("Tag name", "tagEditorName", name);
  const familyField = field("Family", "tagEditorFamily", family || "", "No family");
  const list = document.createElement("datalist");
  list.id = "tagEditorFamilies";
  for (const f of familyNames()) {
    const opt = document.createElement("option");
    opt.value = f;
    list.appendChild(opt);
  }
  familyField.input.setAttribute("list", list.id);

  const picker = colorPicker(
    () => colorIndex,
    (i) => {
      colorIndex = i;
      colorTouched = true;
    },
    family ? "Family color" : "Color"
  );
  // Until a color is picked, preview the color the tag will have where it's going.
  const target = () => {
    const f = familyField.input.value.trim();
    const n = nameField.input.value.trim();
    return matchFamilySpelling(f ? `${f}${FAMILY_SEPARATOR}${n}` : n, allTags());
  };
  familyField.input.addEventListener("input", () => {
    picker.label.textContent = familyField.input.value.trim() ? "Family color" : "Color";
    if (colorTouched) return;
    colorIndex = tagColorIndex(target() || tag);
    picker.render();
  });

  return editorShell(
    [nameField.label, nameField.input, familyField.label, familyField.input, list, picker.label, picker.colors],
    [nameField.input, familyField.input],
    async () => {
      const n = nameField.input.value.trim();
      const f = familyField.input.value.trim();
      if (n.includes(">") || f.includes(">")) return 'Use the Family field instead of ">".';
      if (f.includes(",")) return "Family names can't contain commas.";
      const to = target();
      const problem = validateTagName(to, tag, allTags());
      if (problem) return problem;
      await saveTagEdit(tag, to, colorIndex, colorTouched);
      return null;
    }
  );
}

// A family: its name (renamed on every contact) and its color.
function buildFamilyEditor(familyLabel) {
  let colorIndex = tagColorIndex(familyLabel);
  const nameField = field("Family name", "tagEditorName", familyLabel);
  const picker = colorPicker(
    () => colorIndex,
    (i) => {
      colorIndex = i;
    },
    "Color"
  );
  const hint = document.createElement("p");
  hint.className = "field-hint";
  hint.textContent = "Renaming changes it on every contact with a tag in this family.";

  return editorShell([nameField.label, nameField.input, hint, picker.label, picker.colors], [nameField.input], async () => {
    const to = nameField.input.value.trim();
    const problem = validateFamilyName(to, familyLabel, allTags());
    if (problem) return problem;
    await saveFamilyEdit(familyLabel, to, colorIndex);
    return null;
  });
}

/* ---------- Saving ---------- */

// Color-only edits stay on this device. A rename goes to the Sheet first, so
// a failed request changes nothing; then local copies, the open contact,
// autocomplete and the color setting follow.
async function saveTagEdit(from, to, colorIndex, colorChanged) {
  if (to === from) {
    await setTagColorOverride(from, colorIndex);
    applyTagsChange((tags) => tags); // re-render the open contact's chips in the new color
    return;
  }
  await renameTagRemote(from, to);
  await renameTagInLocalRecords(from, to);
  await renameTagColor(from, to, colorIndex, colorChanged);
  renameKnownTag(from, to);
  applyTagsChange((tags) => renameTagInList(tags, from, to));
  tmRecords = tmRecords.map((r) => (r.tags ? { ...r, tags: renameTagInList(r.tags, from, to) } : r));
}

async function saveFamilyEdit(from, to, colorIndex) {
  if (to === from) {
    await setTagColorOverride(from, colorIndex);
    applyTagsChange((tags) => tags);
    return;
  }
  await renameFamilyRemote(from, to);
  await renameFamilyInLocalRecords(from, to);
  await renameFamilyColor(from, to, colorIndex);
  renameKnownFamily(from, to);
  applyTagsChange((tags) => renameFamilyInList(tags, from, to));
  tmRecords = tmRecords.map((r) => (r.tags ? { ...r, tags: renameFamilyInList(r.tags, from, to) } : r));
}

let loadToken = 0; // ignore a slower, older load if the page was reopened meanwhile

async function openTagManager() {
  const myToken = ++loadToken;
  showView("tagManager");
  editing = null;
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
