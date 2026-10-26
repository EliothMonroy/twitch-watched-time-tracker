const TICK_INTERVAL_MS = 20000;
// Hidden tabs can be throttled to ~1 tick/min, so allow some headroom; longer gaps mean sleep or a frozen tab.
const MAX_ELAPSED_SECONDS = 120;

let isWatching = false;
let lastUpdate = Date.now();

function getChannelName() {
  const path = window.location.pathname.split("/");
  if (path[1] === "videos" && path[2]) {
    // VOD
    let el = document.querySelector('[data-test-selector="ChannelLink"]');
    return el?.textContent.trim().toLowerCase() || null;
  }
  return path[1] || null;
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
  console.log(
    `[Twitch Tracker] will save ${elapsed} seconds for channel: ${channel}, category: ${category}`
  );
  if (!channel) return;
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
