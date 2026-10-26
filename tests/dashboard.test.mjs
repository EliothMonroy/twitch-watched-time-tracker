import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";
import {
  createFakeChart,
  createFakeDialogs,
  createFakeDocument,
  createFakeWindow,
} from "./helpers/fake-dom.mjs";
import { loadScripts } from "./helpers/load-script.mjs";

const HOUR = 3600;
const LIMIT_KEY = "dashboardItemLimit";
const plain = (value) => JSON.parse(JSON.stringify(value));
// Lets pending storage and message callbacks run (they only use microtasks).
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Loads dashboard.js like dashboard.html does (after Chart.js and utils.js).
 * `storage` is the initial chrome.storage.local contents; `chrome: false`
 * loads it as a plain web page (preview mode). `reply` is what the fake
 * background answers to replaceStats; on success it also saves the stats.
 */
async function openDashboard({ storage = {}, chrome: withChrome = true, reply, confirms, matches } = {}) {
  const chrome = createFakeChrome({ storage: { initial: storage } });
  if (reply !== undefined) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type !== "replaceStats") return false;
      const saved = reply.success ? chrome.storage.local.set({ stats: msg.stats }) : Promise.resolve();
      saved.then(() => sendResponse(reply));
      return true;
    });
  }

  const document = createFakeDocument("dashboard.html");
  const dialogs = createFakeDialogs({ confirms });
  const Chart = createFakeChart();
  const ChartDataLabels = { id: "datalabels" };
  const env = loadScripts(["utils.js", "dashboard.js"], {
    globals: {
      ...(withChrome ? { chrome } : {}),
      document,
      window: createFakeWindow({ matches }),
      Chart,
      ChartDataLabels,
      ...dialogs.globals,
    },
  });
  await settle();

  const byId = (id) => document.getElementById(id);
  // The live (not destroyed) chart drawn on a canvas.
  const chart = (canvasId) => {
    const live = Chart.instances.filter((c) => c.canvas.id === canvasId && !c.destroyed);
    assert.equal(live.length, 1, `one live chart on #${canvasId}`);
    return live[0];
  };
  const labels = (canvasId) => plain(chart(canvasId).config.data.labels);
  const chips = () =>
    byId("limit-chips").children.map((b) => ({
      text: b.textContent,
      active: b.classList.contains("active"),
      disabled: b.disabled,
    }));
  const isEmptyShown = () => {
    const empty = byId("empty-state");
    const content = byId("dashboard-content");
    // The two must agree; the test checks which one is visible.
    assert.equal(empty.hidden, empty.classList.contains("hidden"));
    assert.notEqual(empty.hidden, content.classList.contains("hidden"));
    return !empty.hidden;
  };

  return { env, chrome, document, dialogs: dialogs.log, Chart, ChartDataLabels, byId, chart, labels, chips, isEmptyShown };
}

// n channels named ch1..chN, ch1 has the most time.
function manyChannels(n) {
  const stats = {};
  for (let i = 1; i <= n; i++) stats[`ch${i}`] = { [`Game ${i}`]: (n + 1 - i) * HOUR };
  return stats;
}

async function importFile(dash, content) {
  const input = dash.byId("import-file");
  input.files = content === undefined ? [] : [{ text: async () => content }];
  input.value = "C:\\fakepath\\stats.json";
  await input.dispatch("change");
  await settle();
}

describe("aggregateStats", async () => {
  const { env } = await openDashboard();
  const aggregateStats = (stats) => plain(env.get("aggregateStats")(stats));

  test("totals channels and sorts them, largest first", () => {
    const { channels } = aggregateStats({
      small: { Chess: 10 },
      big: { Chess: 100, Minecraft: 200 },
      mid: { Unknown: 50 },
    });
    assert.deepEqual(channels, [
      { channel: "big", total: 300 },
      { channel: "mid", total: 50 },
      { channel: "small", total: 10 },
    ]);
  });

  test("sums categories across channels, sorted, without Unknown in any case", () => {
    const { categories } = aggregateStats({
      a: { Chess: 10, Minecraft: 5, Unknown: 1000 },
      b: { Chess: 20, unknown: 1000 },
      c: { Minecraft: 40, UNKNOWN: 1000 },
    });
    assert.deepEqual(categories, [
      ["Minecraft", 45],
      ["Chess", 30],
    ]);
  });

  test("Unknown time still counts toward the channel total", () => {
    const { channels } = aggregateStats({ a: { Unknown: 100, Chess: 1 } });
    assert.deepEqual(channels, [{ channel: "a", total: 101 }]);
  });

  test("hides non-channel entries and their categories", () => {
    const result = aggregateStats({
      videos: { "Just Chatting": 9e6 },
      Moderator: { Chess: 9e6 },
      xqc: { Minecraft: 10 },
    });
    assert.deepEqual(result, {
      channels: [{ channel: "xqc", total: 10 }],
      categories: [["Minecraft", 10]],
    });
  });

  test("returns empty lists for empty stats", () => {
    assert.deepEqual(aggregateStats({}), { channels: [], categories: [] });
  });
});

describe("snapToPreset", async () => {
  const { env } = await openDashboard();
  const snapToPreset = env.get("snapToPreset");

  const cases = [
    [5, 5],
    [10, 10],
    [40, 40],
    [1, 5],
    [7, 5],
    [7.5, 5], // a tie keeps the smaller preset
    [8, 10],
    [12, 10],
    [13, 15],
    [33, 30],
    [36, 40],
    [1000, 40],
    ["20", 20],
    ["all", "all"],
    // Invalid values fall back to the default (10).
    [0, 10],
    [-5, 10],
    ["abc", 10],
    [NaN, 10],
    [Infinity, 10],
    [null, 10],
    [undefined, 10],
    ["ALL", 10],
  ];
  for (const [input, expected] of cases) {
    test(`${String(input)} -> ${expected}`, () => {
      assert.equal(snapToPreset(input), expected);
    });
  }
});

describe("dashboard rendering", () => {
  test("registers the datalabels plugin with Chart.js", async () => {
    const dash = await openDashboard();
    assert.deepEqual(dash.Chart.registered, [dash.ChartDataLabels]);
  });

  test("shows the empty state when there are no channels", async () => {
    for (const storage of [{}, { stats: {} }, { stats: { videos: { Unknown: HOUR } } }]) {
      const dash = await openDashboard({ storage });
      assert.equal(dash.isEmptyShown(), true, JSON.stringify(storage));
      assert.equal(dash.Chart.instances.length, 0);
    }
  });

  test("shows the charts and summary when there is data", async () => {
    const dash = await openDashboard({
      storage: {
        stats: {
          xqc: { "Just Chatting": 2 * HOUR, Minecraft: HOUR },
          shroud: { Valorant: 30 * 60, Unknown: 15 * 60 },
          videos: { "Just Chatting": 100 * HOUR },
        },
      },
    });
    assert.equal(dash.isEmptyShown(), false);

    // 3h + 45m; "videos" doesn't count.
    assert.equal(dash.byId("stat-total").textContent, "3h 45m");
    assert.equal(dash.byId("stat-channels").textContent, "2");
    assert.equal(dash.byId("stat-categories").textContent, "3");

    assert.deepEqual(dash.labels("channelChart"), ["xqc", "shroud"]);
    assert.deepEqual(plain(dash.chart("channelChart").config.data.datasets[0].data), [3, 0.75]);
    assert.deepEqual(dash.labels("categoryChart"), ["Just Chatting", "Minecraft", "Valorant"]);
    assert.deepEqual(plain(dash.chart("categoryChart").config.data.datasets[0].data), [2, 1, 0.5]);

    assert.equal(dash.byId("channel-meta").textContent, "Showing 2 of 2");
    assert.equal(dash.byId("category-meta").textContent, "Showing 3 of 3");
  });

  test("a channel with only Unknown time leaves the category chart empty", async () => {
    const dash = await openDashboard({ storage: { stats: { xqc: { Unknown: HOUR } } } });
    assert.equal(dash.isEmptyShown(), false);
    assert.equal(dash.byId("stat-categories").textContent, "0");
    assert.deepEqual(dash.labels("categoryChart"), []);
    assert.equal(dash.byId("category-meta").textContent, "No data");
  });

  test("chart labels and tooltips show formatted times", async () => {
    const dash = await openDashboard({ storage: { stats: { xqc: { Chess: HOUR } } } });
    const { options } = dash.chart("channelChart").config;
    assert.equal(options.plugins.datalabels.formatter(1.5), "1h 30m");
    assert.equal(options.plugins.tooltip.callbacks.label({ raw: 26 }), "1d 2h");
  });

  test("narrow screens shorten long channel names and hide bar labels", async () => {
    const long = "averyveryverylongchannelname";
    const narrow = await openDashboard({
      storage: { stats: { [long]: { Chess: HOUR } } },
      matches: { "(max-width: 720px)": true },
    });
    const yTick = (dash, label) =>
      dash.chart("channelChart").config.options.scales.y.ticks.callback.call(
        { getLabelForValue: () => label },
        0
      );
    assert.equal(yTick(narrow, long), "averyveryverylo…");
    assert.equal(yTick(narrow, "sixteen_chars_ok"), "sixteen_chars_ok");
    assert.equal(narrow.chart("channelChart").config.options.plugins.datalabels.display, false);

    const wide = await openDashboard({ storage: { stats: { [long]: { Chess: HOUR } } } });
    assert.equal(yTick(wide, long), long);
    assert.equal(wide.chart("channelChart").config.options.plugins.datalabels.display, true);
  });

  test("without the chrome API (opened as a plain page) it shows preview data", async () => {
    const dash = await openDashboard({ chrome: false });
    assert.equal(dash.byId("import-btn").hidden, true);
    assert.equal(dash.isEmptyShown(), false);
    assert.equal(dash.byId("stat-channels").textContent, "45");
  });
});

describe("dashboard item limit", () => {
  test("defaults to 10 items", async () => {
    const dash = await openDashboard({ storage: { stats: manyChannels(30) } });
    assert.equal(dash.labels("channelChart").length, 10);
    assert.equal(dash.byId("limit-readout").textContent, "10 of 30");
    assert.equal(dash.byId("channel-meta").textContent, "Showing 10 of 30");
  });

  test("uses the stored limit, snapped to a preset", async () => {
    const cases = [
      [20, 20, "20 of 30"],
      [7, 5, "5 of 30"],
      [27, 25, "25 of 30"],
      ["all", 30, "All (30)"],
      ["abc", 10, "10 of 30"],
      [0, 10, "10 of 30"],
    ];
    for (const [stored, shown, readout] of cases) {
      const dash = await openDashboard({ storage: { stats: manyChannels(30), [LIMIT_KEY]: stored } });
      assert.equal(dash.labels("channelChart").length, shown, `stored ${stored}`);
      assert.equal(dash.byId("limit-readout").textContent, readout, `stored ${stored}`);
    }
  });

  test("shows at most the number of items there are", async () => {
    const dash = await openDashboard({ storage: { stats: manyChannels(3), [LIMIT_KEY]: 20 } });
    assert.equal(dash.labels("channelChart").length, 3);
    assert.equal(dash.byId("limit-readout").textContent, "3 of 3");
  });

  test("chips mark the active limit and disable sizes above the item count", async () => {
    const dash = await openDashboard({ storage: { stats: manyChannels(12), [LIMIT_KEY]: 5 } });
    assert.deepEqual(dash.chips(), [
      { text: "5", active: true, disabled: false },
      { text: "10", active: false, disabled: false },
      { text: "15", active: false, disabled: true },
      { text: "20", active: false, disabled: true },
      { text: "25", active: false, disabled: true },
      { text: "30", active: false, disabled: true },
      { text: "40", active: false, disabled: true },
      { text: "All", active: false, disabled: false },
    ]);
  });

  test("clicking a chip redraws the charts and saves the limit", async () => {
    const dash = await openDashboard({ storage: { stats: manyChannels(30) } });
    const oldChart = dash.chart("channelChart");

    await dash.byId("limit-chips").children.find((b) => b.textContent === "20").click();
    await settle();
    assert.equal(oldChart.destroyed, true, "the old chart is destroyed");
    assert.equal(dash.labels("channelChart").length, 20);
    assert.equal(dash.byId("limit-readout").textContent, "20 of 30");
    assert.equal(dash.chart("channelChart").canvas.parentElement.style.height, `${20 * 38 + 64}px`);
    assert.equal(dash.chips().find((c) => c.active).text, "20");
    assert.equal(dash.chrome.storage.local.snapshot()[LIMIT_KEY], 20);

    await dash.byId("limit-chips").children.find((b) => b.textContent === "All").click();
    await settle();
    assert.equal(dash.labels("channelChart").length, 30);
    assert.equal(dash.byId("limit-readout").textContent, "All (30)");
    assert.equal(dash.chrome.storage.local.snapshot()[LIMIT_KEY], "all");
  });

  test("setLimit snaps odd values before saving", async () => {
    const dash = await openDashboard({ storage: { stats: manyChannels(30) } });
    dash.env.get("setLimit")(17);
    await settle();
    assert.equal(dash.chrome.storage.local.snapshot()[LIMIT_KEY], 15);
    assert.equal(dash.labels("channelChart").length, 15);
  });

  test("loading the page doesn't write the limit", async () => {
    const dash = await openDashboard({ storage: { stats: manyChannels(30), [LIMIT_KEY]: 7 } });
    assert.equal(dash.chrome.storage.local.snapshot()[LIMIT_KEY], 7);
  });
});

describe("dashboard import", () => {
  const before = { stats: { old: { Chess: HOUR } } };

  test("the Import JSON button opens the file picker", async () => {
    const dash = await openDashboard({ storage: before });
    await dash.byId("import-btn").click();
    assert.equal(dash.byId("import-file").clickCount, 1);
  });

  test("a valid file is normalized, confirmed, sent as replaceStats, then shown", async () => {
    const dash = await openDashboard({ storage: before, confirms: [true], reply: { success: true } });
    await importFile(
      dash,
      JSON.stringify({ " XQC ": { Chess: 60 }, xqc: { Chess: 30, Minecraft: 2 * HOUR }, Shroud: { Valorant: HOUR } })
    );

    assert.equal(dash.dialogs.confirms.length, 1);
    assert.deepEqual(dash.chrome.runtime.sent, [
      {
        type: "replaceStats",
        stats: { xqc: { Chess: 90, Minecraft: 2 * HOUR }, shroud: { Valorant: HOUR } },
      },
    ]);
    assert.deepEqual(dash.dialogs.alerts, ["✅ Stats imported successfully!"]);
    assert.equal(dash.byId("import-file").value, "", "the input is reset so the same file can be picked again");

    // The dashboard reloads from storage and shows the imported data.
    assert.deepEqual(dash.labels("channelChart"), ["xqc", "shroud"]);
    assert.equal(dash.byId("stat-channels").textContent, "2");
  });

  test("an empty object is a valid import", async () => {
    const dash = await openDashboard({ storage: before, confirms: [true], reply: { success: true } });
    await importFile(dash, "{}");
    assert.deepEqual(dash.chrome.runtime.sent, [{ type: "replaceStats", stats: {} }]);
    assert.equal(dash.isEmptyShown(), true);
  });

  test("invalid JSON shows an error and sends nothing", async () => {
    const dash = await openDashboard({ storage: before, confirms: [true], reply: { success: true } });
    await importFile(dash, "{not json");
    assert.equal(dash.dialogs.alerts.length, 1);
    assert.match(dash.dialogs.alerts[0], /^❌ Failed to read file: /);
    assert.deepEqual(dash.dialogs.confirms, []);
    assert.deepEqual(dash.chrome.runtime.sent, []);
  });

  test("data with the wrong shape shows an error and sends nothing", async () => {
    const bad = [
      [],
      null,
      42,
      "text",
      { xqc: [] },
      { xqc: 5 },
      { xqc: { Chess: -1 } },
      { xqc: { Chess: "60" } },
      { "  ": { Chess: 1 } },
    ];
    for (const data of bad) {
      const dash = await openDashboard({ storage: before, confirms: [true], reply: { success: true } });
      await importFile(dash, JSON.stringify(data));
      assert.equal(dash.dialogs.alerts.length, 1, JSON.stringify(data));
      assert.match(dash.dialogs.alerts[0], /Invalid file format/, JSON.stringify(data));
      assert.deepEqual(dash.dialogs.confirms, []);
      assert.deepEqual(dash.chrome.runtime.sent, [], JSON.stringify(data));
    }
  });

  test("cancelling the confirm sends nothing", async () => {
    const dash = await openDashboard({ storage: before, confirms: [false], reply: { success: true } });
    await importFile(dash, JSON.stringify({ xqc: { Chess: 60 } }));
    assert.equal(dash.dialogs.confirms.length, 1);
    assert.deepEqual(dash.chrome.runtime.sent, []);
    assert.deepEqual(dash.dialogs.alerts, []);
  });

  test("no file selected does nothing", async () => {
    const dash = await openDashboard({ storage: before, confirms: [true], reply: { success: true } });
    await importFile(dash, undefined);
    assert.deepEqual(dash.dialogs.confirms, []);
    assert.deepEqual(dash.chrome.runtime.sent, []);
    assert.deepEqual(dash.dialogs.alerts, []);
  });

  test("a failure reply shows the error and keeps the current data", async () => {
    const dash = await openDashboard({
      storage: before,
      confirms: [true],
      reply: { success: false, error: "storage quota exceeded" },
    });
    await importFile(dash, JSON.stringify({ xqc: { Chess: 60 } }));
    assert.equal(dash.chrome.runtime.sent.length, 1);
    assert.deepEqual(dash.dialogs.alerts, ["❌ Failed to import stats: storage quota exceeded"]);
    assert.deepEqual(dash.labels("channelChart"), ["old"]);
  });

  test("no reply from the background shows an error", async () => {
    const dash = await openDashboard({ storage: before, confirms: [true] });
    await importFile(dash, JSON.stringify({ xqc: { Chess: 60 } }));
    assert.deepEqual(dash.dialogs.alerts, ["❌ Failed to import stats: unknown error"]);
  });
});
