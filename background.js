// 1. Send track message to all twitch tabs
function checkAllTwitchTabs() {
  chrome.tabs.query({ url: "https://www.twitch.tv/*" }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { shouldTrack: true });
    }
  });
}

// 2. Run when a tab is activated, updated, or focused
chrome.tabs.onActivated.addListener(() => checkAllTwitchTabs());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") checkAllTwitchTabs();
});
chrome.windows.onFocusChanged.addListener(() => checkAllTwitchTabs());

// 3. 🔄 OPTIONAL: Poll every N seconds for backup coverage
setInterval(() => {
  checkAllTwitchTabs();
}, 30_000); // every 30 seconds

// 4. ✅ Also run immediately on extension startup
checkAllTwitchTabs();
