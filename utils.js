// Shared helpers. Loaded by the popup, the dashboard and the background
// service worker (via importScripts). Not loaded by content.js.

// First path segments on twitch.tv that are not channel pages. Older versions
// stored some of them as if they were channels (e.g. "videos", "moderator"),
// so the popup and dashboard hide them. content.js keeps a matching list so it
// stops recording them; keep the two lists in sync.
const NON_CHANNEL_PATHS = new Set([
  "videos",
  "moderator",
  "directory",
  "settings",
  "search",
  "downloads",
  "subscriptions",
  "inventory",
  "drops",
  "wallet",
  "friends",
  "messages",
  "turbo",
  "prime",
  "jobs",
  "p",
  "u",
  "popout",
  "following",
]);

// Channel keys are stored trimmed and lowercased ("xQc " -> "xqc").
function normalizeChannel(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

function isNonChannelPath(channel) {
  return NON_CHANNEL_PATHS.has(normalizeChannel(channel));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Checks data shaped like `stats`: { channel: { category: seconds } } with
// finite, non-negative seconds. Returns a copy with channel keys normalized
// (duplicates differing only in case/whitespace are summed), or null if the
// data is invalid.
function normalizeStats(data) {
  if (!isPlainObject(data)) return null;

  // Null-prototype objects so a key like "__proto__" is stored as data.
  const result = Object.create(null);
  for (const [rawChannel, categories] of Object.entries(data)) {
    const channel = normalizeChannel(rawChannel);
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

// Parses manual watch time: "90" (minutes) or "H:MM" (e.g. "1:05").
// Returns a positive whole number of minutes, or null if the input is invalid.
function parseWatchTimeMinutes(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();

  let minutes = null;
  if (/^\d+$/.test(text)) {
    minutes = Number(text);
  } else {
    const match = /^(\d+):([0-5]\d)$/.exec(text);
    if (match) minutes = Number(match[1]) * 60 + Number(match[2]);
  }

  if (minutes === null || !Number.isSafeInteger(minutes * 60) || minutes <= 0) {
    return null;
  }
  return minutes;
}

function formatTimeSmart(seconds) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const mins = Math.floor(safeSeconds / 60);
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
