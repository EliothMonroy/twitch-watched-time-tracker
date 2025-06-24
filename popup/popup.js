function formatTime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

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

      const totalTime = formatTime(total);
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
    chrome.storage.local.get("stats", (data) => {
      const stats = data.stats || {};
      const catKey = category || "Unknown";

      stats[channel] = stats[channel] || {};
      stats[channel][catKey] = (stats[channel][catKey] || 0) + seconds;

      chrome.storage.local.set({ stats }, () => {
        alert(`Added ${minutes} minutes to ${channel} (${catKey})`);
        location.reload(); // Refresh the popup
      });
    });
  });
});

document.getElementById("importBtn").addEventListener("click", () => {
  document.getElementById("importFileInput").click();
});

document
  .getElementById("importFileInput")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // ✅ Validate expected format: streamer -> { category: seconds }
      const isValid = Object.values(data).every(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          Object.values(entry).every((val) => typeof val === "number")
      );

      if (!isValid) {
        alert("❌ Invalid file format.");
        return;
      }

      const confirmed = confirm(
        "Are you sure you want to overwrite your current stats with this file?"
      );
      if (!confirmed) return;

      // ✅ Store as-is, since it's already in the correct format
      chrome.storage.local.set({ stats: data }, () => {
        alert("✅ Stats imported successfully!");
        location.reload();
      });
    } catch (err) {
      alert("❌ Failed to import stats: " + err.message);
    }
  });
