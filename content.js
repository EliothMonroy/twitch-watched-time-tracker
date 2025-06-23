let isWatching = false;
let lastUpdate = Date.now();
let shouldTrack = true;

function getChannelName() {
  const path = window.location.pathname.split('/');
  return path[1] || null;
}

function getCategory() {
  const el = document.querySelector('[data-a-target="stream-game-link"]');
  return el ? el.textContent.trim() : "Unknown";
}

function isPlaying() {
  const video = document.querySelector('video');
  return video && !video.paused;
}

function updateTime() {
  const now = Date.now();
  const elapsed = Math.floor((now - lastUpdate) / 1000);
  if (!isWatching || elapsed < 5 || !shouldTrack) return;

  const channel = getChannelName();
  const category = getCategory();
  if (!channel || !category) return;

  chrome.storage.local.get("stats", (data) => {
    const stats = data.stats || {};
    stats[channel] = stats[channel] || {};
    stats[channel][category] = (stats[channel][category] || 0) + elapsed;
    chrome.storage.local.set({ stats });
  });

  lastUpdate = now;
}

setInterval(() => {
  if (!shouldTrack) return;

  if (isPlaying()) {
    if (!isWatching) lastUpdate = Date.now();
    isWatching = true;
  } else {
    if (isWatching) updateTime();
    isWatching = false;
  }
}, 5000);

window.addEventListener("beforeunload", updateTime);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.shouldTrack !== undefined) {
    shouldTrack = msg.shouldTrack;
    if (!shouldTrack) {
      updateTime();
      isWatching = false;
    }
  }
});
