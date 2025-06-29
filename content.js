let isWatching = false;
let lastUpdate = Date.now();

function getChannelName() {
  const path = window.location.pathname.split("/");
  return path[1] || null;
}

function getCategory() {
  const el = document.querySelector('[data-a-target="stream-game-link"]');
  return el ? el.textContent.trim() : "Unknown";
}

function isPlaying() {
  const video = document.querySelector("video");
  return video && !video.paused;
}

function updateTime() {
  const now = Date.now();
  const elapsed = Math.floor((now - lastUpdate) / 1000);
  if (!isWatching || elapsed < 20) return;
  console.log(`[Twitch Tracker] will save ${elapsed} seconds`);

  const channel = getChannelName();
  const category = getCategory();
  if (!channel || !category) return;

  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get("stats", (data) => {
        const stats = data.stats || {};
        stats[channel] = stats[channel] || {};
        stats[channel][category] = (stats[channel][category] || 0) + elapsed;
        chrome.storage.local.set({ stats });
      });
    }
  } catch (e) {
    if (e.message && e.message.includes("Extension context invalidated")) {
      // Silently ignore extension context invalidation errors
    } else {
      throw e;
    }
  }

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
}, 20000);

window.addEventListener("beforeunload", updateTime);
