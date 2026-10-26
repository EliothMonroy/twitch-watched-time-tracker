// Shared helpers (normalizeStats) from utils.js.
importScripts("utils.js");

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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Sums two { category: seconds } maps. Returns null if a category can't be
// summed (non-number values), so the caller can leave the data untouched.
function mergeCategories(into, from) {
  const merged = { ...into };
  for (const [category, seconds] of Object.entries(from)) {
    const existing = merged[category];
    if (existing === undefined) {
      merged[category] = seconds;
    } else if (typeof existing === "number" && typeof seconds === "number") {
      merged[category] = existing + seconds;
    } else {
      return null;
    }
  }
  return merged;
}

// Older versions could store the same channel under different casing or with
// stray whitespace ("xQc" vs "xqc"). Merge those keys into the trimmed,
// lowercase key, summing per category. Nothing else is changed or removed.
// Safe to run more than once.
async function mergeChannelKeys() {
  const { stats } = await chrome.storage.local.get("stats");
  if (!isPlainObject(stats)) return;

  let changed = false;
  for (const key of Object.keys(stats)) {
    const target = normalizeChannel(key);
    // "__proto__" can't be assigned as a normal key; leave it alone.
    if (target === key || target === "" || target === "__proto__") continue;

    const from = stats[key];
    const into = stats[target] ?? {};
    if (!isPlainObject(from) || !isPlainObject(into)) continue;

    const merged = mergeCategories(into, from);
    if (!merged) continue; // unexpected values: keep both keys, lose nothing

    stats[target] = merged;
    delete stats[key];
    changed = true;
  }

  if (changed) await chrome.storage.local.set({ stats });
}

// Runs once after install or update, through the queue so it can't race
// with saves.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== "install" && reason !== "update") return;
  enqueueWrite(mergeChannelKeys).catch((e) =>
    console.error("[Twitch Tracker] channel key migration failed:", e)
  );
});

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

// Import replaces all stats. It goes through the queue so it can't race with
// saves, and the data is checked again here before it is written.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "replaceStats") return;

  const stats = normalizeStats(msg.stats);
  if (!stats) {
    sendResponse({ success: false, error: "invalid stats data" });
    return;
  }

  enqueueWrite(() => chrome.storage.local.set({ stats }))
    .then(() => sendResponse({ success: true }))
    .catch((e) => {
      console.error("[Twitch Tracker] failed to replace stats:", e);
      sendResponse({ success: false, error: String(e?.message || e) });
    });

  // keep the message channel open for sendResponse
  return true;
});
