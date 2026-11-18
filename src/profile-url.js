/* Profile URL / name parsing — pure functions, no DOM or chrome.* access. */

export function extractProfileUrl(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/in\/([^/?#]+)\/?/);
  if (!match) return null;
  // Canonical form: decoded, lowercased, re-encoded — so "/in/Juan-Perez" and
  // "/in/juan-perez" (or "mar%C3%ADa" vs "maría") map to the same record.
  // Must stay in sync with normalizeProfileUrl() in apps-script/Code.gs.
  let slug;
  try {
    slug = encodeURIComponent(decodeURIComponent(match[1]).toLowerCase());
  } catch {
    slug = match[1].toLowerCase(); // malformed escape — don't double-encode it
  }
  return `https://www.linkedin.com/in/${slug}/`;
}

export function extractNameFromTitle(title) {
  if (!title) return "";
  let t = title.replace(/^\(\d+\)\s*/, ""); // strip unread-message badge, e.g. "(3) "
  t = t.split("|")[0].trim(); // LinkedIn profile titles are "Name | LinkedIn"
  return t || "";
}
