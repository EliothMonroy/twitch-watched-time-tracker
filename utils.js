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
