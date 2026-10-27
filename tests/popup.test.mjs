import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";
import {
  createFakeDialogs,
  createFakeDocument,
  createFakeURL,
  createManualTimers,
} from "./helpers/fake-dom.mjs";
import { loadScripts } from "./helpers/load-script.mjs";

const HOUR = 3600;
const plain = (value) => JSON.parse(JSON.stringify(value));
// Lets pending storage and message callbacks run (they only use microtasks).
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Loads popup.js like popup.html does, with fakes for everything it touches.
 * `reply` is what the fake background answers to every message (undefined =
 * no background listener at all).
 */
function loadPopup({ stats, prompts, confirms, reply } = {}) {
  const chrome = createFakeChrome({ storage: { initial: stats === undefined ? {} : { stats } } });
  const tabsCreated = [];
  chrome.tabs = { create: (options) => tabsCreated.push(plain(options)) };
  if (reply !== undefined) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => sendResponse(reply));
  }

  const document = createFakeDocument("popup/popup.html");
  const dialogs = createFakeDialogs({ prompts, confirms });
  const timers = createManualTimers();
  const url = createFakeURL();
  const env = loadScripts(["utils.js", "popup/popup.js"], {
    globals: {
      chrome,
      document,
      ...dialogs.globals,
      setTimeout: timers.setTimeout,
      URL: url.URL,
      Blob,
    },
  });
  return { env, chrome, document, dialogs: dialogs.log, timers, url: url.log, tabsCreated };
}

async function openPopup(options) {
  const popup = loadPopup(options);
  await popup.document.dispatch("DOMContentLoaded");
  await settle();
  return popup;
}

async function clickButton(popup, id) {
  await popup.document.getElementById(id).click();
  await settle();
}

const rows = (document) =>
  document.getElementById("channel-list").children.map((row) => row.textContent);

describe("parseWatchTimeMinutes", () => {
  const parse = loadPopup().env.get("parseWatchTimeMinutes");

  const valid = [
    ["90", 90],
    ["1:30", 90],
    ["0:05", 5],
    [" 45 ", 45],
    ["2:00", 120],
    ["10:59", 659],
    ["007", 7],
    // The largest value whose seconds are still a safe integer.
    [String(Math.floor(Number.MAX_SAFE_INTEGER / 60)), Math.floor(Number.MAX_SAFE_INTEGER / 60)],
  ];
  for (const [input, minutes] of valid) {
    test(`${JSON.stringify(input)} -> ${minutes}`, () => {
      assert.equal(parse(input), minutes);
    });
  }

  const invalid = [
    "1:5",
    "1:60",
    "1:99",
    "1.5",
    "abc",
    "0",
    "0:00",
    "-5",
    "+5",
    "",
    "   ",
    "1:30:00",
    ":30",
    "1:",
    "1e3",
    "0x10",
    "90 min",
    String(Math.floor(Number.MAX_SAFE_INTEGER / 60) + 1),
    "99999999999999999999",
    "99999999999999999999:00",
  ];
  for (const input of invalid) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(parse(input), null);
    });
  }

  test("rejects non-strings", () => {
    for (const value of [90, null, undefined, {}, ["90"]]) assert.equal(parse(value), null);
  });
});

describe("sortChannels", () => {
  const sortChannels = loadPopup().env.get("sortChannels");

  test("totals each channel and sorts by total, largest first", () => {
    const result = plain(
      sortChannels({
        small: { Chess: 60 },
        big: { "Just Chatting": 3000, Minecraft: 2000 },
        mid: { Unknown: 1000 },
      })
    );
    assert.deepEqual(result, [
      { channel: "big", categories: { "Just Chatting": 3000, Minecraft: 2000 }, total: 5000 },
      { channel: "mid", categories: { Unknown: 1000 }, total: 1000 },
      { channel: "small", categories: { Chess: 60 }, total: 60 },
    ]);
  });

  test("hides non-channel entries, ignoring case", () => {
    const result = plain(
      sortChannels({
        videos: { Unknown: 9e6 },
        Moderator: { Unknown: 9e6 },
        DIRECTORY: { Unknown: 9e6 },
        xqc: { Gaming: 10 },
      })
    );
    assert.deepEqual(result.map((c) => c.channel), ["xqc"]);
  });

  test("returns an empty list for empty stats", () => {
    assert.deepEqual(plain(sortChannels({})), []);
  });
});

describe("popup channel list", () => {
  test("shows the top 5 channels in order with formatted times", async () => {
    const { document } = await openPopup({
      stats: {
        a: { Gaming: 7 * HOUR },
        b: { Gaming: HOUR, Chess: HOUR + 60 },
        c: { Chess: 5 * HOUR },
        d: { Unknown: 4 * HOUR },
        e: { Unknown: 3 * HOUR + 1800 },
        f: { Unknown: 60 },
        videos: { Unknown: 100 * HOUR },
        moderator: { Unknown: 100 * HOUR },
      },
    });
    assert.deepEqual(rows(document), [
      "1. a - 7h",
      "2. c - 5h",
      "3. d - 4h",
      "4. e - 3h 30m",
      "5. b - 2h 1m",
    ]);
    const row = document.getElementById("channel-list").children[0];
    assert.equal(row.className, "channel");
    assert.equal(row.children[0].className, "total");
  });

  test("renders channel names as text, not HTML", async () => {
    const { document } = await openPopup({ stats: { "<img src=x>": { Gaming: HOUR } } });
    assert.deepEqual(rows(document), ["1. <img src=x> - 1h"]);
    assert.deepEqual(document.innerHTMLWrites, []);
    assert.deepEqual(
      document.created.map((el) => el.tagName),
      ["DIV", "DIV"],
      "only the row and its text div are created"
    );
  });

  test("shows a message when there is nothing to show", async () => {
    for (const stats of [undefined, {}, { videos: { Unknown: HOUR } }]) {
      const { document } = await openPopup({ stats });
      const list = document.getElementById("channel-list");
      assert.equal(list.textContent, "No data yet. Watch some streams!", JSON.stringify(stats));
      assert.equal(list.children.length, 0);
    }
  });
});

describe("popup Set Initial Watch Time", () => {
  test("sends one incrementStat with the normalized channel and trimmed category", async () => {
    const popup = await openPopup({
      prompts: ["  xQc ", "  Just Chatting  ", "1:30"],
      reply: { success: true },
    });
    await clickButton(popup, "set-initial");

    assert.deepEqual(popup.chrome.runtime.sent, [
      { type: "incrementStat", channel: "xqc", category: "Just Chatting", elapsed: 90 * 60 },
    ]);
    assert.deepEqual(popup.dialogs.alerts, ["Added 90 minutes to xqc (Just Chatting)"]);
    assert.equal(popup.dialogs.reloads, 1);
  });

  test("uses Unknown when the category is left empty", async () => {
    const popup = await openPopup({ prompts: ["shroud", "   ", "45"], reply: { success: true } });
    await clickButton(popup, "set-initial");
    assert.deepEqual(popup.chrome.runtime.sent, [
      { type: "incrementStat", channel: "shroud", category: "Unknown", elapsed: 45 * 60 },
    ]);
  });

  test("an invalid time shows an error and sends nothing", async () => {
    for (const time of ["1.5", "abc", "0", "1:75"]) {
      const popup = await openPopup({ prompts: ["xqc", "Gaming", time], reply: { success: true } });
      await clickButton(popup, "set-initial");
      assert.deepEqual(popup.chrome.runtime.sent, [], time);
      assert.equal(popup.dialogs.alerts.length, 1, time);
      assert.match(popup.dialogs.alerts[0], /Invalid time/, time);
      assert.equal(popup.dialogs.reloads, 0, time);
    }
  });

  test("cancelling or leaving the channel empty stops at the first prompt", async () => {
    for (const channel of [null, "", "   "]) {
      const popup = await openPopup({ prompts: [channel, "Gaming", "90"], reply: { success: true } });
      await clickButton(popup, "set-initial");
      assert.deepEqual(popup.chrome.runtime.sent, []);
      assert.equal(popup.dialogs.prompts.length, 1);
      assert.deepEqual(popup.dialogs.alerts, []);
    }
  });

  test("cancelling the time prompt sends nothing", async () => {
    const popup = await openPopup({ prompts: ["xqc", "Gaming", null], reply: { success: true } });
    await clickButton(popup, "set-initial");
    assert.deepEqual(popup.chrome.runtime.sent, []);
    assert.equal(popup.dialogs.prompts.length, 3);
    assert.deepEqual(popup.dialogs.alerts, []);
  });

  test("cancelling the optional category prompt skips the category, it doesn't stop", async () => {
    // Cancel then Cancel: nothing is sent.
    let popup = await openPopup({ prompts: ["xqc", null, null], reply: { success: true } });
    await clickButton(popup, "set-initial");
    assert.deepEqual(popup.chrome.runtime.sent, []);
    assert.deepEqual(popup.dialogs.alerts, []);

    // Cancel on the category, then a time: saved as Unknown.
    popup = await openPopup({ prompts: ["xqc", null, "10"], reply: { success: true } });
    await clickButton(popup, "set-initial");
    assert.deepEqual(popup.chrome.runtime.sent, [
      { type: "incrementStat", channel: "xqc", category: "Unknown", elapsed: 600 },
    ]);
  });

  test("a failure reply shows the error and doesn't reload", async () => {
    const popup = await openPopup({
      prompts: ["xqc", "Gaming", "90"],
      reply: { success: false, error: "disk full" },
    });
    await clickButton(popup, "set-initial");
    assert.deepEqual(popup.dialogs.alerts, ["❌ Could not add watch time: disk full"]);
    assert.equal(popup.dialogs.reloads, 0);
  });

  test("no reply from the background shows an error", async () => {
    const popup = await openPopup({ prompts: ["xqc", "Gaming", "90"] });
    await clickButton(popup, "set-initial");
    assert.equal(popup.chrome.runtime.sent.length, 1);
    assert.deepEqual(popup.dialogs.alerts, ["❌ Could not add watch time: unknown error"]);
    assert.equal(popup.dialogs.reloads, 0);
  });
});

describe("popup Clear Data", () => {
  test("confirming sends clearStats, then reloads", async () => {
    const popup = await openPopup({ confirms: [true], reply: { success: true } });
    await clickButton(popup, "clear");
    assert.deepEqual(popup.chrome.runtime.sent, [{ type: "clearStats" }]);
    assert.equal(popup.dialogs.confirms.length, 1);
    assert.deepEqual(popup.dialogs.alerts, ["✅ All data has been cleared."]);
    assert.equal(popup.dialogs.reloads, 1);
  });

  test("cancelling sends nothing", async () => {
    const popup = await openPopup({ confirms: [false], reply: { success: true } });
    await clickButton(popup, "clear");
    assert.deepEqual(popup.chrome.runtime.sent, []);
    assert.deepEqual(popup.dialogs.alerts, []);
    assert.equal(popup.dialogs.reloads, 0);
  });

  test("a failure reply shows the error and doesn't reload", async () => {
    const popup = await openPopup({ confirms: [true], reply: { success: false, error: "busy" } });
    await clickButton(popup, "clear");
    assert.deepEqual(popup.dialogs.alerts, ["❌ Could not clear data: busy"]);
    assert.equal(popup.dialogs.reloads, 0);
  });
});

describe("popup Export JSON", () => {
  test("downloads the stats as JSON and revokes the URL later, not right away", async () => {
    const stats = { xqc: { "Just Chatting": 120 }, shroud: { Valorant: 60 } };
    const popup = await openPopup({ stats });
    await clickButton(popup, "export");

    assert.equal(popup.url.created.length, 1);
    const { url, blob } = popup.url.created[0];
    assert.equal(blob.type, "application/json");
    assert.deepEqual(JSON.parse(await blob.text()), stats);

    const link = popup.document.created.find((el) => el.tagName === "A");
    assert.ok(link, "a download link is created");
    assert.equal(link.href, url);
    assert.equal(link.download, "twitch_watch_stats.json");
    assert.equal(link.clickCount, 1);

    // Not revoked yet: that could cancel the download.
    assert.deepEqual(popup.url.revoked, []);
    assert.equal(popup.timers.pending.length, 1);
    assert.ok(popup.timers.pending[0].delay > 0);
    popup.timers.runAll();
    assert.deepEqual(popup.url.revoked, [url]);
  });

  test("exports {} when there are no stats", async () => {
    const popup = await openPopup();
    await clickButton(popup, "export");
    assert.deepEqual(JSON.parse(await popup.url.created[0].blob.text()), {});
  });
});

describe("popup navigation buttons", () => {
  const dashboardUrl = "chrome-extension://fake-extension-id/dashboard.html";

  test("Import JSON opens the dashboard tab", async () => {
    const popup = await openPopup();
    await clickButton(popup, "importBtn");
    assert.deepEqual(popup.tabsCreated, [{ url: dashboardUrl }]);
  });

  test("Import JSON works before DOMContentLoaded", async () => {
    const popup = loadPopup();
    await clickButton(popup, "importBtn");
    assert.deepEqual(popup.tabsCreated, [{ url: dashboardUrl }]);
  });

  test("Open Full Dashboard opens the dashboard tab", async () => {
    const popup = await openPopup();
    await clickButton(popup, "open-dashboard");
    assert.deepEqual(popup.tabsCreated, [{ url: dashboardUrl }]);
  });
});
