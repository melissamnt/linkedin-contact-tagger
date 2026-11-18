/* Pure helpers over saved contact records (no DOM, no storage). */

function addedTime(record) {
  const t = Date.parse(record.addedAt || "");
  return Number.isNaN(t) ? null : t;
}

// "newest" or "oldest" first by the date the contact was added. Contacts
// with no added date (saved before it was tracked) always go last.
export function sortRecordsByAdded(records, order) {
  const dir = order === "oldest" ? 1 : -1;
  return [...records].sort((a, b) => {
    const ta = addedTime(a);
    const tb = addedTime(b);
    if (ta === null || tb === null) return (ta === null) - (tb === null);
    return (ta - tb) * dir;
  });
}
