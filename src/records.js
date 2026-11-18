/* Pure helpers over saved contact records (no DOM, no storage). */

function parseTime(value) {
  const t = Date.parse(value || "");
  return Number.isNaN(t) ? null : t;
}

// When the contact was added. Contacts saved before the added date was
// recorded fall back to their last save — the closest date we have.
function addedTime(record) {
  return parseTime(record.addedAt) ?? parseTime(record.updatedAt);
}

// "newest" or "oldest" first by the date the contact was added. Contacts
// with no usable date at all always go last.
export function sortRecordsByAdded(records, order) {
  const dir = order === "oldest" ? 1 : -1;
  return [...records].sort((a, b) => {
    const ta = addedTime(a);
    const tb = addedTime(b);
    if (ta === null || tb === null) return (ta === null) - (tb === null);
    return (ta - tb) * dir;
  });
}
