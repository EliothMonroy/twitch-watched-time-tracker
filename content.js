const TICK_INTERVAL_MS = 20000;
// Hidden tabs can be throttled to ~1 tick/min, so allow some headroom; longer gaps mean sleep or a frozen tab.
const MAX_ELAPSED_SECONDS = 120;

// First path segments on twitch.tv that are not channel pages.
// Keep in sync with NON_CHANNEL_PATHS in utils.js (content.js doesn't load utils.js).
// "videos" (VODs) and "moderator" (Mod View) are handled in getChannelName().
const NON_CHANNEL_PATHS = new Set([
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
  "videos",
  "moderator",
]);

let isWatching = false;
let lastUpdate = Date.now();

function normalizeChannel(name) {
  return name?.trim().toLowerCase() || null;
}

// On a VOD page, use the channel link's href (the login) rather than its text,
// which is the display name and can differ (e.g. non-Latin display names).
function getVodChannel() {
  const link = document.querySelector('[data-test-selector="ChannelLink"]');
  if (!link) return null;
  const href = link.getAttribute("href");
  if (href) {
    try {
      const login = new URL(href, window.location.origin).pathname.split("/")[1];
      if (login) return login;
    } catch {
      // Fall back to the link text below.
    }
  }
  return link.textContent;
}

function getChannelName() {
  const [, first = "", second = ""] = window.location.pathname.split("/");
  const segment = first.toLowerCase();
  if (segment === "videos") return second ? normalizeChannel(getVodChannel()) : null;
  // Mod View (/moderator/<channel>) is watching that channel.
  if (segment === "moderator") return normalizeChannel(second);
  if (NON_CHANNEL_PATHS.has(segment)) return null;
  return normalizeChannel(first);
}

function getCategory() {
  let category = "Unknown";
  let categories = document.querySelectorAll(
    '[data-a-target="stream-game-link"]'
  );
  // validation for Streaming Together, loop through categories until we find a category that is not a Streaming Together category
  for (let option of categories) {
    if (!option.textContent.includes("Streaming Together")) {
      category = option;
      break;
    }
  }

  let categoryFallback = document.querySelector(
    '[data-test-selector="GameLink"]'
  );
  return (
    category?.textContent?.trim() ||
    categoryFallback?.textContent?.trim() ||
    "Unknown"
  );
}

function isPlaying() {
  const video = document.querySelector("video");
  return video && !video.paused;
}

function updateTime() {
  const now = Date.now();
  const elapsed = Math.floor((now - lastUpdate) / 1000);
  if (!isWatching || elapsed < 20) return;
  if (elapsed > MAX_ELAPSED_SECONDS) {
    // Too long to be watch time: skip it and start counting fresh.
    lastUpdate = now;
    return;
  }

  const channel = getChannelName();
  const category = getCategory();
  if (!channel) {
    // No channel on this page (e.g. the home page): drop this time so it
    // isn't credited to the next channel the user opens.
    lastUpdate = now;
    return;
  }
  console.log(
    `[Twitch Tracker] will save ${elapsed} seconds for channel: ${channel}, category: ${category}`
  );
  chrome.runtime.sendMessage(
    {
      type: "incrementStat",
      channel,
      category,
      elapsed,
    },
    (resp) => {
      if (!resp?.success)
        console.error("[Twitch Tracker] Failed to update stat");
    }
  );

  lastUpdate = now;
}

setInterval(() => {
  const now = new Date().toISOString();
  const playing = isPlaying();

  if (playing) {
    updateTime();
    if (!isWatching) lastUpdate = Date.now();
    isWatching = true;
  } else {
    if (isWatching) updateTime();
    isWatching = false;
  }
}, TICK_INTERVAL_MS);

window.addEventListener("beforeunload", updateTime);
