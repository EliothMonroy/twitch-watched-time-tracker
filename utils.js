function formatTimeSmart(seconds) {
  const mins = Math.floor(seconds / 60);
  const months = Math.floor(mins / 43200); // 30 days * 24h * 60m
  const days = Math.floor((mins % 43200) / 1440); // 1 day = 1440 mins
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;

  const parts = [];
  if (months > 0) parts.push(`${months}mo`);
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

// Checks data shaped like `stats`: a plain object of { channel: { category:
// seconds } } with finite, non-negative seconds. Returns a copy with channel
// keys trimmed and lowercased (keys that then match are summed per category),
// or null if the data is invalid.
function normalizeStats(data) {
  const isPlainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isPlainObject(data)) return null;

  // Null-prototype objects so a key like "__proto__" is stored as data.
  const result = Object.create(null);
  for (const [rawChannel, categories] of Object.entries(data)) {
    const channel = rawChannel.trim().toLowerCase();
    if (channel === "" || !isPlainObject(categories)) return null;

    const target = (result[channel] ??= Object.create(null));
    for (const [category, seconds] of Object.entries(categories)) {
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
        return null;
      }
      target[category] = (target[category] ?? 0) + seconds;
    }
  }
  return result;
}
