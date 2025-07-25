Chart.register(ChartDataLabels);
const maxItems = 20;

function buildChart(data) {
  const labels = data.map((d) => d.channel);
  const times = data.map((d) => d.total / 3600); // convert seconds to hours

  const ctx = document.getElementById("channelChart").getContext("2d");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Time Watched (hours)",
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
          title: {
            display: true,
            text: "Hours Watched",
            color: "#fff",
          },
          ticks: {
            color: "#ccc",
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
          },
        },
        x: {
          ticks: {
            color: "#ccc",
          },
          grid: {
            color: "rgba(255, 255, 255, 0.05)",
          },
        },
      },
      plugins: {
        datalabels: {
          anchor: "end",
          align: "end",
          color: "#ccc",
          font: {
            weight: "bold",
          },
          formatter: (value, context) => {
            // value is in hours; convert to seconds for formatting
            const seconds = value * 3600;
            return formatTimeSmart(seconds);
          },
        },
        legend: { display: false },
        tooltip: {
          bodyColor: "inherit",
          backgroundColor: "rgba(0,0,0,0.7)",
          titleColor: "#fff",
          callbacks: {
            label: function (context) {
              const value = context.raw * 3600; // convert hours to seconds
              return formatTimeSmart(value);
            },
          },
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
    if (channel === "videos") continue; // Skip invalid channel name
    let channelTotal = 0;
    for (const [category, seconds] of Object.entries(categories)) {
      channelTotal += seconds;
      categoryTotals[category] = (categoryTotals[category] || 0) + seconds;
    }
    channelTotals.push({ channel, total: channelTotal });
  }

  // Sort and build both charts
  channelTotals.sort((a, b) => b.total - a.total);
  buildChart(channelTotals.slice(0, maxItems));
  buildCategoryChart(categoryTotals);
});

function buildCategoryChart(categoryStats) {
  // Convert to array and sort
  const sorted = Object.entries(categoryStats)
    .filter(([name]) => name.toLowerCase() !== "unknown")
    .sort((a, b) => b[1] - a[1]) // descending by seconds
    .slice(0, maxItems);

  const labels = sorted.map(([cat]) => cat);
  const values = sorted.map(([_, sec]) => sec / 3600);

  const ctx = document.getElementById("categoryChart").getContext("2d");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Time Watched by Category (hours)",
          data: values,
          backgroundColor: "rgba(255, 159, 64, 0.7)",
          borderColor: "rgba(255, 159, 64, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        datalabels: {
          anchor: "end",
          align: "end",
          color: "#ccc",
          font: {
            weight: "bold",
          },
          formatter: (value, context) => {
            // value is in hours; convert to seconds for formatting
            const seconds = value * 3600;
            return formatTimeSmart(seconds);
          },
        },
        legend: { display: false },
        tooltip: {
          bodyColor: "inherit",
          backgroundColor: "rgba(0,0,0,0.7)",
          titleColor: "#fff",
          callbacks: {
            label: function (context) {
              const value = context.raw * 3600; // convert hours to seconds
              return formatTimeSmart(value);
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Hours Watched",
            color: "#fff",
          },
          ticks: {
            color: "#ccc",
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
          },
        },
        x: {
          ticks: {
            color: "#ccc",
          },
          grid: {
            color: "rgba(255, 255, 255, 0.05)",
          },
        },
      },
    },
  });
}
