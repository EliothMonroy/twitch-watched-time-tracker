let activeTwitchTabId = null;

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  checkTab(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    checkTab(tab);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) checkTab(tab);
});

function checkTab(tab) {
  const isTwitch = tab.url && tab.url.startsWith("https://www.twitch.tv/");
  chrome.tabs.sendMessage(tab.id, { shouldTrack: isTwitch });
}
