// All stat writes go through this queue so two saves never read the same
// old `stats` and overwrite each other (e.g. several Twitch tabs open).
let writeQueue = Promise.resolve();

function enqueueWrite(job) {
  const result = writeQueue.then(job);
  // Keep the chain alive even if this job fails.
  writeQueue = result.catch(() => {});
  return result;
}

// Channel keys are stored trimmed and lowercased ("xQc " -> "xqc").
function normalizeChannel(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

async function incrementStat(channel, category, elapsed) {
  const { stats = {} } = await chrome.storage.local.get("stats");
  stats[channel] = stats[channel] || {};
  stats[channel][category] = (stats[channel][category] || 0) + elapsed;
  await chrome.storage.local.set({ stats });
}

// Clear Data goes through the queue too. Otherwise a save that was already
// waiting could write the old stats back right after the clear.
// Only `stats` is removed, so settings like dashboardItemLimit are kept.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "clearStats") return;

  enqueueWrite(() => chrome.storage.local.remove("stats"))
    .then(() => sendResponse({ success: true }))
    .catch((e) => {
      console.error("[Twitch Tracker] failed to clear stats:", e);
      sendResponse({ success: false, error: String(e?.message || e) });
    });

  // keep the message channel open for sendResponse
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "incrementStat") return;

  // Safety net: senders should already send lowercase names, but a stray
  // "xQc" would otherwise be saved as a different channel from "xqc".
  const channel = normalizeChannel(msg.channel);
  const { elapsed } = msg;
  const valid = channel !== "" && Number.isFinite(elapsed) && elapsed > 0;
  if (!valid) {
    sendResponse({ success: false, error: "invalid incrementStat message" });
    return;
  }
  const category =
    typeof msg.category === "string" && msg.category !== ""
      ? msg.category
      : "Unknown";

  enqueueWrite(() => incrementStat(channel, category, elapsed))
    .then(() => sendResponse({ success: true }))
    .catch((e) => {
      console.error("[Twitch Tracker] failed to save stat:", e);
      sendResponse({ success: false, error: String(e?.message || e) });
    });

  // keep the message channel open for sendResponse
  return true;
});
