let isWatching = false;
let lastUpdate = Date.now();

function getChannelName() {
  const path = window.location.pathname.split("/");
  if (path[1] === "videos" && path[2]) {
    // VOD page: try multiple selectors for channel name
    let el = document.querySelector('[data-a-target="streamer-name"]');
    if (el) return el.textContent.trim().toLowerCase();
    // Try .channel-info-content a (first anchor)
    el = document.querySelector(".channel-info-content a");
    if (el) return el.textContent.trim().toLowerCase();
    // Try any anchor with a path that is not /videos/
    const anchors = document.querySelectorAll('a[href^="/"]');
    for (const a of anchors) {
      if (!a.getAttribute("href").startsWith("/videos/")) {
        return a.textContent.trim().toLowerCase();
      }
    }
    return null;
  }
  return path[1] || null;
}

function getCategory() {
  let el = document.querySelector('[data-a-target="stream-game-link"]');
  if (el) return el.textContent.trim();
  // Try .tw-link[data-test-selector="CategoryLink"]
  el = document.querySelector('.tw-link[data-test-selector="CategoryLink"]');
  if (el) return el.textContent.trim();
  // Try .channel-info-content a:last-child
  el = document.querySelector(".channel-info-content a:last-child");
  if (el) return el.textContent.trim();
  return "Unknown";
}

function isPlaying() {
  const video = document.querySelector("video");
  return video && !video.paused;
}

function updateTime() {
  const now = Date.now();
  const elapsed = Math.floor((now - lastUpdate) / 1000);
  if (!isWatching || elapsed < 20) return;

  const channel = getChannelName();
  const category = getCategory();
  console.log(
    `[Twitch Tracker] will save ${elapsed} seconds for channel: ${channel}, category: ${category}`
  );
  if (!channel) return;

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
