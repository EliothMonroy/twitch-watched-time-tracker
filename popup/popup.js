function sortChannels(stats) {
  return Object.entries(stats)
    .filter(([channel]) => !isNonChannelPath(channel))
    .map(([channel, categories]) => {
      const total = Object.values(categories).reduce((a, b) => a + b, 0);
      return { channel, categories, total };
    })
    .sort((a, b) => b.total - a.total);
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
}

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("channel-list");

  chrome.storage.local.get("stats", (data) => {
    const stats = data.stats || {};
    const sorted = sortChannels(stats);

    if (sorted.length === 0) {
      container.textContent = "No data yet. Watch some streams!";
      return;
    }

    container.textContent = "";

    sorted.slice(0, 5).forEach(({ channel, total }, index) => {
      const channelDiv = document.createElement("div");
      channelDiv.className = "channel";

      const totalDiv = document.createElement("div");
      totalDiv.className = "total";
      totalDiv.textContent = `${index + 1}. ${channel} - ${formatTimeSmart(total)}`;

      channelDiv.appendChild(totalDiv);
      container.appendChild(channelDiv);
    });
  });

  document.getElementById("clear").addEventListener("click", () => {
    const confirmed = confirm(
      "Are you sure you want to clear all watch data? This cannot be undone."
    );
    if (!confirmed) return;

    // Goes through the background write queue and only removes `stats`,
    // so settings like the dashboard chart size are kept.
    chrome.runtime.sendMessage({ type: "clearStats" }, (resp) => {
      if (!resp?.success) {
        alert("❌ Could not clear data: " + (resp?.error || "unknown error"));
        return;
      }
      alert("✅ All data has been cleared.");
      location.reload();
    });
  });

  document.getElementById("export").addEventListener("click", () => {
    chrome.storage.local.get("stats", (data) => {
      const stats = data.stats || {};
      const blob = new Blob([JSON.stringify(stats, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "twitch_watch_stats.json";
      a.click();

      // Revoking right away can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  });

  document.getElementById("open-dashboard").addEventListener("click", openDashboard);

  // A file picker opened from the popup closes the popup on Windows/Linux, so
  // the file never gets read. Import lives on the dashboard page instead.
  document.getElementById("importBtn").addEventListener("click", openDashboard);

  document.getElementById("set-initial").addEventListener("click", () => {
    const channel = normalizeChannel(prompt("Channel name (e.g., xQc):"));
    if (!channel) return;

    const category = (prompt("Category (e.g., Just Chatting — optional):") || "").trim();
    const timeStr = prompt(
      "Watch time to add: minutes (e.g., 90) or hours:minutes (e.g., 1:30):"
    );
    if (timeStr === null) return;

    const minutes = parseWatchTimeMinutes(timeStr);
    if (minutes === null) {
      alert(
        "❌ Invalid time. Enter whole minutes (e.g., 90) or hours:minutes (e.g., 1:30)."
      );
      return;
    }

    const catKey = category || "Unknown";
    // Go through the background so this can't race with tracked saves.
    chrome.runtime.sendMessage(
      {
        type: "incrementStat",
        channel,
        category: catKey,
        elapsed: minutes * 60,
      },
      (resp) => {
        if (!resp?.success) {
          alert("❌ Could not add watch time: " + (resp?.error || "unknown error"));
          return;
        }
        alert(`Added ${minutes} minutes to ${channel} (${catKey})`);
        location.reload(); // Refresh the popup
      }
    );
  });
});
