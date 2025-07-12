chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "incrementStat") {
    const { channel, category, elapsed } = msg;
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
          console.log(`[Twitch Tracker] time ${stats[channel][category]}`);
        });
      }
    } catch (e) {
      if (e.message && e.message.includes("Extension context invalidated")) {
        // Silently ignore extension context invalidation errors
      } else {
        console.log(`[Twitch Tracker] error: ${e.message}`);
        //throw e;
      }
    }
    // keep the message channel open for sendResponse
    return true;
  }
});
