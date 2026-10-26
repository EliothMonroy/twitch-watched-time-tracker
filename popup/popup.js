function sortChannels(stats) {
  return Object.entries(stats)
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
    // Channel keys are lowercase, like Twitch URLs ("xQc" -> "xqc").
    const channel = (prompt("Channel name (e.g., xQc):") || "").trim().toLowerCase();
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
