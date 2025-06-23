function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function buildChart(data) {
  const labels = data.map((d) => d.channel);
  const times = data.map((d) => d.total / 60); // convert to minutes

  const ctx = document.getElementById("channelChart").getContext("2d");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Time Watched (minutes)",
          data: times,
          backgroundColor: "rgba(54, 162, 235, 0.7)",
          borderColor: "rgba(54, 162, 235, 1)",
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Minutes Watched", color: "inherit" },
          ticks: { color: "inherit" },
        },
        x: {
          ticks: { color: "inherit" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          bodyColor: "inherit",
          backgroundColor: "rgba(0,0,0,0.7)",
          titleColor: "#fff",
        },
      },
    },
  });
}

chrome.storage.local.get("stats", (result) => {
  const stats = result.stats || {};

  const channelTotals = [];
  const categoryTotals = {};

  for (const [channel, categories] of Object.entries(stats)) {
    let channelTotal = 0;
    for (const [category, seconds] of Object.entries(categories)) {
      channelTotal += seconds;
      categoryTotals[category] = (categoryTotals[category] || 0) + seconds;
    }
    channelTotals.push({ channel, total: channelTotal });
  }

  // Sort and build both charts
  channelTotals.sort((a, b) => b.total - a.total);
  buildChart(channelTotals);
  buildCategoryChart(categoryTotals);
});

function buildCategoryChart(categoryStats) {
  // Convert to array and sort
  const sorted = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]); // descending by seconds

  const labels = sorted.map(([cat]) => cat);
  const values = sorted.map(([_, sec]) => sec / 60); // convert to minutes

  const ctx = document.getElementById("categoryChart").getContext("2d");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Time Watched by Category (minutes)",
          data: values,
          backgroundColor: "rgba(255, 159, 64, 0.7)",
          borderColor: "rgba(255, 159, 64, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: {
          bodyColor: "inherit",
          backgroundColor: "rgba(0,0,0,0.7)",
          titleColor: "#fff",
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Minutes Watched", color: "inherit" },
          ticks: { color: "inherit" },
        },
        x: {
          ticks: { color: "inherit" },
        },
      },
    },
  });
}
