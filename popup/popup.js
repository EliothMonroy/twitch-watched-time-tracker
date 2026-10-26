function sortChannels(stats) {
  return Object.entries(stats)
    .map(([channel, categories]) => {
      const total = Object.values(categories).reduce((a, b) => a + b, 0);
      return { channel, categories, total };
    })
    .sort((a, b) => b.total - a.total);
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

    container.innerHTML = "";

    sorted.slice(0, 5).forEach(({ channel, categories, total }, index) => {
      const channelDiv = document.createElement("div");
      channelDiv.className = "channel";

      const totalTime = formatTimeSmart(total);
      channelDiv.innerHTML = `<div class="total">${
        index + 1
      }. ${channel} - ${totalTime}</div>`;

      container.appendChild(channelDiv);
    });
  });

  document.getElementById("clear").addEventListener("click", () => {
    const confirmed = confirm(
      "Are you sure you want to clear all watch data? This cannot be undone."
    );
    if (confirmed) {
      chrome.storage.local.clear(() => {
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

      URL.revokeObjectURL(url); // Clean up
    });
  });

  document.getElementById("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  document.getElementById("set-initial").addEventListener("click", () => {
    const channel = prompt("Channel name (e.g., xQc):");
    if (!channel) return;

    const category = prompt("Category (e.g., Just Chatting — optional):");
    const timeStr = prompt("Initial watch time (in minutes or HH:MM format):");
    if (!timeStr) return;

    // Parse time input
    let minutes = 0;
    if (/^\d+:\d{2}$/.test(timeStr)) {
      const [h, m] = timeStr.split(":").map(Number);
      minutes = h * 60 + m;
    } else {
      minutes = parseInt(timeStr);
    }

    const seconds = minutes * 60;
    const catKey = category || "Unknown";
    // Go through the background so this can't race with tracked saves.
    chrome.runtime.sendMessage(
      { type: "incrementStat", channel, category: catKey, elapsed: seconds },
      (resp) => {
        if (!resp?.success) {
          alert("❌ Could not add watch time. Check the time you entered.");
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
