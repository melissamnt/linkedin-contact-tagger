/* DOM element references and small view helpers shared by every view. */

const $ = (id) => document.getElementById(id);

export const elProfileView = $("profileView");
export const elEmptyView = $("emptyView");
export const elSettingsView = $("settingsView");
export const elBrowseView = $("browseView");
export const elTagManagerView = $("tagManagerView");

// Profile view
export const elProfileName = $("profileName");
export const elProfileUrl = $("profileUrl");
export const elChipsList = $("chipsList");
export const elTagsInput = $("tagsInput");
export const elTagSuggestions = $("tagSuggestions");
export const elTagList = $("tagList");
export const elNoteInput = $("noteInput");
export const elSaveBtn = $("saveBtn");
export const elSavedConfirm = $("savedConfirm");
export const elSyncStatus = $("syncStatus");

// Status + AI suggestion
export const elSuggestStatusBtn = $("suggestStatusBtn");
export const elStatusCurrent = $("statusCurrent");
export const elStatusPill = $("statusPill");
export const elStatusSuggestion = $("statusSuggestion");
export const elSuggestionChip = $("suggestionChip");
export const elSuggestionRationale = $("suggestionRationale");
export const elStatusEmptyHint = $("statusEmptyHint");

// Settings view
export const elSettingsToggle = $("settingsToggle");
export const elBackBtn = $("backBtn");
export const elWebAppUrl = $("webAppUrl");
export const elSecretToken = $("secretToken");
export const elClaudeApiKey = $("claudeApiKey");
export const elSaveSettingsBtn = $("saveSettingsBtn");
export const elSettingsSavedConfirm = $("settingsSavedConfirm");

// Browse people
export const elBrowseToggle = $("browseToggle");
export const elBrowseLoading = $("browseLoading");
export const elBrowseFilterWrap = $("browseFilterWrap");
export const elBrowseFilterBtn = $("browseFilterBtn");
export const elBrowseFilterSummary = $("browseFilterSummary");
export const elBrowseFilter = $("browseFilter");
export const elBrowseSort = $("browseSort");
export const elBrowseList = $("browseList");
export const elBrowseEmpty = $("browseEmpty");
export const elBrowseBackBtn = $("browseBackBtn");

// Tag manager
export const elTagManagerToggle = $("tagManagerToggle");
export const elTagManagerLoading = $("tagManagerLoading");
export const elTagManagerToolbar = $("tagManagerToolbar");
export const elTagManagerSort = $("tagManagerSort");
export const elTagManagerExpandAll = $("tagManagerExpandAll");
export const elTagManagerList = $("tagManagerList");
export const elTagManagerEmpty = $("tagManagerEmpty");
export const elTagManagerBackBtn = $("tagManagerBackBtn");

export function showView(name) {
  elProfileView.hidden = name !== "profile";
  elEmptyView.hidden = name !== "empty";
  elSettingsView.hidden = name !== "settings";
  elBrowseView.hidden = name !== "browse";
  elTagManagerView.hidden = name !== "tagManager";
}

export function isOverlayOpen() {
  return !elSettingsView.hidden || !elBrowseView.hidden || !elTagManagerView.hidden;
}

export function flashSavedConfirm(el) {
  el.classList.remove("is-visible");
  // force reflow so the transition restarts if triggered twice quickly
  void el.offsetWidth;
  el.classList.add("is-visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("is-visible"), 1800);
}
