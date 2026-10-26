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

function isNonChannelPath(channel) {
  return (
    typeof channel === "string" &&
    NON_CHANNEL_PATHS.has(channel.trim().toLowerCase())
  );
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
