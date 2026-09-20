Chart.register(ChartDataLabels);

const PRESET_LIMITS = [5, 10, 20, 50];
const STORAGE_KEY = "dashboardItemLimit";
const DEFAULT_LIMIT = 10;
const BAR_ROW_PX = 38;
const CHART_MIN_HEIGHT = 240;

const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isNarrow = window.matchMedia("(max-width: 720px)").matches;
const tickColor = isDark ? "#adadb8" : "#53535f";
const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(24, 24, 27, 0.08)";
const labelColor = isDark ? "#efeff1" : "#18181b";

let channelTotals = [];
let categoryTotals = [];
let itemLimit = DEFAULT_LIMIT;
let channelChartInstance = null;
let categoryChartInstance = null;

const chipsEl = document.getElementById("limit-chips");
const sliderEl = document.getElementById("limit-slider");
const readoutEl = document.getElementById("limit-readout");
const emptyEl = document.getElementById("empty-state");
const contentEl = document.getElementById("dashboard-content");

function maxAvailableItems() {
  return Math.max(channelTotals.length, categoryTotals.length, 1);
}

function clampLimit(value) {
  const max = maxAvailableItems();
  if (value === "all" || value >= max) return max;
  return Math.max(1, Math.min(max, Number(value) || DEFAULT_LIMIT));
}

function isShowingAll() {
  return itemLimit >= maxAvailableItems();
}

function persistLimit(limit) {
  const value = isShowingAll() ? "all" : limit;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ [STORAGE_KEY]: value });
  }
}

function sharedChartOptions() {
  return {
    indexAxis: "y",
    maintainAspectRatio: false,
    responsive: true,
    animation: false,
    scales: {
      x: {
        beginAtZero: true,
        title: {
          display: !isNarrow,
          text: "Hours watched",
          color: tickColor,
        },
        ticks: { color: tickColor },
        grid: { color: gridColor },
      },
      y: {
        ticks: {
          color: labelColor,
          font: { size: isNarrow ? 10 : 12 },
          callback(value) {
            const label = this.getLabelForValue(value);
            if (!isNarrow || label.length <= 16) return label;
            return `${label.slice(0, 15)}…`;
          },
        },
        grid: { display: false },
      },
    },
    plugins: {
      datalabels: {
        anchor: "end",
        align: "right",
        color: labelColor,
        clip: false,
        display: !isNarrow,
        font: { weight: "600", size: 11 },
        formatter: (value) => formatTimeSmart(value * 3600),
      },
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(14, 14, 16, 0.92)",
        titleColor: "#fff",
        bodyColor: "#fff",
        callbacks: {
          label(context) {
            return formatTimeSmart(context.raw * 3600);
          },
        },
      },
    },
    layout: {
      padding: { right: 72 },
    },
  };
}

function barDataset(label, values, accent) {
  return {
    label,
    data: values,
    backgroundColor: accent.fill,
    borderColor: accent.stroke,
    borderWidth: 1,
    borderRadius: 6,
  };
}

function setCanvasHeight(canvas, count) {
  const height = Math.max(CHART_MIN_HEIGHT, count * BAR_ROW_PX + 64);
  canvas.parentElement.style.height = `${height}px`;
}

function destroyChart(instance) {
  if (instance) instance.destroy();
}

function buildChannelChart(data) {
  const canvas = document.getElementById("channelChart");
  setCanvasHeight(canvas, data.length || 1);
  destroyChart(channelChartInstance);

  channelChartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: data.map((d) => d.channel),
      datasets: [
        barDataset(
          "Time watched (hours)",
          data.map((d) => d.total / 3600),
          { fill: "rgba(83, 196, 255, 0.75)", stroke: "#53c4ff" }
        ),
      ],
    },
    options: sharedChartOptions(),
  });
}

function buildCategoryChart(data) {
  const canvas = document.getElementById("categoryChart");
  setCanvasHeight(canvas, data.length || 1);
  destroyChart(categoryChartInstance);

  categoryChartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: data.map(([name]) => name),
      datasets: [
        barDataset(
          "Time watched (hours)",
          data.map(([, seconds]) => seconds / 3600),
          { fill: "rgba(255, 184, 107, 0.8)", stroke: "#ffb86b" }
        ),
      ],
    },
    options: sharedChartOptions(),
  });
}

function renderSummary() {
  const totalSeconds = channelTotals.reduce((sum, item) => sum + item.total, 0);
  document.getElementById("stat-total").textContent = formatTimeSmart(totalSeconds);
  document.getElementById("stat-channels").textContent = String(channelTotals.length);
  document.getElementById("stat-categories").textContent = String(categoryTotals.length);
}

function updateMeta(el, shown, total) {
  el.textContent = total ? `Showing ${shown} of ${total}` : "No data";
}

function renderCharts() {
  const limit = clampLimit(itemLimit);
  const channels = channelTotals.slice(0, limit);
  const categories = categoryTotals.slice(0, limit);

  updateMeta(
    document.getElementById("channel-meta"),
    channels.length,
    channelTotals.length
  );
  updateMeta(
    document.getElementById("category-meta"),
    categories.length,
    categoryTotals.length
  );

  buildChannelChart(channels);
  buildCategoryChart(categories);
}

function renderChips() {
  const max = maxAvailableItems();
  chipsEl.innerHTML = "";

  PRESET_LIMITS.filter((n) => n < max).forEach((n) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (itemLimit === n && !isShowingAll() ? " active" : "");
    button.textContent = String(n);
    button.addEventListener("click", () => setLimit(n));
    chipsEl.appendChild(button);
  });

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "chip" + (isShowingAll() ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => setLimit(max));
  chipsEl.appendChild(allBtn);
}

function syncControls() {
  const max = maxAvailableItems();
  const limit = clampLimit(itemLimit);
  sliderEl.min = "1";
  sliderEl.max = String(max);
  sliderEl.value = String(limit);
  readoutEl.textContent = isShowingAll() ? `All (${max})` : `${limit} of ${max}`;
  renderChips();
}

function setLimit(next) {
  itemLimit = clampLimit(next);
  persistLimit(itemLimit);
  syncControls();
  renderCharts();
}

function showEmpty(isEmpty) {
  emptyEl.classList.toggle("hidden", !isEmpty);
  emptyEl.hidden = !isEmpty;
  contentEl.classList.toggle("hidden", isEmpty);
}

function aggregateStats(stats) {
  const channels = [];
  const categories = {};

  for (const [channel, cats] of Object.entries(stats)) {
    if (channel === "videos") continue;
    let channelTotal = 0;
    for (const [category, seconds] of Object.entries(cats)) {
      channelTotal += seconds;
      if (category.toLowerCase() !== "unknown") {
        categories[category] = (categories[category] || 0) + seconds;
      }
    }
    channels.push({ channel, total: channelTotal });
  }

  channels.sort((a, b) => b.total - a.total);
  const sortedCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  return { channels, categories: sortedCategories };
}

function initControls() {
  sliderEl.addEventListener("input", () => {
    itemLimit = Number(sliderEl.value);
    persistLimit(itemLimit);
    syncControls();
    renderCharts();
  });
}

function startDashboard(stats, storedLimit) {
  const aggregated = aggregateStats(stats);
  channelTotals = aggregated.channels;
  categoryTotals = aggregated.categories;

  if (channelTotals.length === 0) {
    showEmpty(true);
    return;
  }

  showEmpty(false);
  itemLimit =
    storedLimit === "all"
      ? maxAvailableItems()
      : clampLimit(storedLimit || DEFAULT_LIMIT);
  initControls();
  syncControls();
  renderSummary();
  renderCharts();
}

if (typeof chrome !== "undefined" && chrome.storage?.local) {
  chrome.storage.local.get(["stats", STORAGE_KEY], (result) => {
    startDashboard(result.stats || {}, result[STORAGE_KEY]);
  });
} else {
  startDashboard(
    {
      xqc: { "Just Chatting": 180000, Minecraft: 54000 },
      pokimane: { "Just Chatting": 92000, Valorant: 41000 },
      shroud: { Valorant: 76000, "Call of Duty": 28000 },
      kai_cenat: { "Just Chatting": 210000 },
      tarik: { Valorant: 64000, "Just Chatting": 18000 },
      lcs: { "League of Legends": 120000 },
      summit1g: { GTA: 88000, "Just Chatting": 22000 },
      sodapoppin: { WoW: 70000, "Just Chatting": 30000 },
      hasanabi: { "Just Chatting": 150000, "React": 24000 },
      ninja: { Fortnite: 99000 },
      sykkuno: { "Among Us": 45000, "Just Chatting": 36000 },
      ludwig: { "Just Chatting": 81000, Variety: 19000 },
      pokelawls: { "Resident Evil": 33000 },
      mizkif: { "Just Chatting": 61000 },
      esfandtv: { WoW: 27000, "Just Chatting": 14000 },
    },
    DEFAULT_LIMIT
  );
}
