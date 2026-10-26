function sortChannels(stats) {
  return Object.entries(stats)
    .filter(([channel]) => !isNonChannelPath(channel))
    .map(([channel, categories]) => {
      const total = Object.values(categories).reduce((a, b) => a + b, 0);
      return { channel, categories, total };
    })
    .sort((a, b) => b.total - a.total);
}

// Parses manual watch time: "90" (minutes) or "H:MM" (e.g. "1:05").
// Returns a positive whole number of minutes, or null if the input is invalid.
function parseWatchTimeMinutes(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();

  let minutes = null;
  if (/^\d+$/.test(text)) {
    minutes = Number(text);
  } else {
    const match = /^(\d+):([0-5]\d)$/.exec(text);
    if (match) minutes = Number(match[1]) * 60 + Number(match[2]);
  }

  if (minutes === null || !Number.isSafeInteger(minutes * 60) || minutes <= 0) {
    return null;
  }
  return minutes;
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

    sorted.slice(0, 5).forEach(({ channel, categories, total }, index) => {
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
    if (confirmed) {
      // Only remove watch data; keep settings like the dashboard chart size.
      chrome.storage.local.remove("stats", () => {
        alert("✅ All data has been cleared.");
        location.reload(); // Optional: Refresh to reflect the reset state
      });
    }
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

  document.getElementById("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  document.getElementById("set-initial").addEventListener("click", () => {
    const channel = prompt("Channel name (e.g., xQc):");
    if (!channel) return;

    const category = prompt("Category (e.g., Just Chatting — optional):");
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

// A file picker opened from the popup closes the popup on Windows/Linux, so
// the file never gets read. Import lives on the dashboard page instead.
document.getElementById("importBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});
