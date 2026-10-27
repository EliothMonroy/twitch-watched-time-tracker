import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { describe, test } from "node:test";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";
import { createElement, createFakeClock, createFakePage } from "./helpers/fake-page.mjs";
import { loadScripts } from "./helpers/load-script.mjs";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const CHANNEL_LINK = '[data-test-selector="ChannelLink"]';
// The channel name heading in the stream info under the player.
const CHANNEL_HEADING_LINK = "#live-channel-stream-information a[href]:has(h1)";
const GAME_LINK = '[data-a-target="stream-game-link"]';
const GAME_LINK_FALLBACK = '[data-test-selector="GameLink"]';

/**
 * Loads content.js on a fake Twitch page with a fake clock. By default the
 * background replies { success: true } to every message (pass `reply: null`
 * for no receiver) and a video plays.
 */
function setup({ pathname = "/xqc", playing = true, reply = { success: true } } = {}) {
  const chrome = createFakeChrome();
  if (reply !== null) {
    chrome.runtime.onMessage.addListener((_msg, _sender, sendResponse) => sendResponse(reply));
  }
  const clock = createFakeClock();
  const page = createFakePage({ pathname });
  page.setVideo(playing === null ? null : { paused: !playing });
  page.setElements(GAME_LINK, [createElement({ text: "Just Chatting" })]);

  const errors = [];
  const console = { ...globalThis.console, error: (...args) => errors.push(args) };

  const env = loadScripts("content.js", {
    globals: { chrome, console, ...clock.globals, ...page.globals },
  });

  return {
    chrome,
    clock,
    page,
    env,
    errors,
    /** Seconds sent to the background so far, one entry per message. */
    credited: () => chrome.runtime.sent.map((m) => m.elapsed),
    total: () => chrome.runtime.sent.reduce((sum, m) => sum + m.elapsed, 0),
    play: () => page.setVideo({ paused: false }),
    pause: () => page.setVideo({ paused: true }),
    /** Tracking is still running: interval active and pagehide listener attached. */
    isTracking: () => clock.intervals.length === 1 && page.listenerCount("pagehide") === 1,
  };
}

/** A page that has been playing long enough for the first tick to start counting. */
function watching(options) {
  const t = setup(options);
  t.clock.tick(); // first tick after playing starts only starts the count
  assert.deepEqual(t.credited(), []);
  return t;
}

describe("getChannelName", () => {
  const channelOn = (pathname, links = [], headingLinks = []) => {
    const t = setup({ pathname, playing: null });
    if (links.length) t.page.setElements(CHANNEL_LINK, links.map(createElement));
    if (headingLinks.length) {
      t.page.setElements(CHANNEL_HEADING_LINK, headingLinks.map(createElement));
    }
    return t.env.get("getChannelName")();
  };

  test("plain channel page", () => {
    assert.equal(channelOn("/xqc"), "xqc");
  });

  test("subpages of a channel use the first segment", () => {
    assert.equal(channelOn("/xqc/videos"), "xqc");
    assert.equal(channelOn("/xqc/clip/SomeClip"), "xqc");
  });

  test("VOD at /<channel>/video/<id> uses the first segment", () => {
    assert.equal(channelOn("/xqc/video/123456"), "xqc");
    assert.equal(channelOn("/XQC/video/123456"), "xqc");
  });

  test("lowercases the channel", () => {
    assert.equal(channelOn("/XQC"), "xqc");
    assert.equal(channelOn("/Shroud/"), "shroud");
  });

  test("home page has no channel", () => {
    assert.equal(channelOn("/"), null);
    assert.equal(channelOn(""), null);
  });

  // Every entry except videos and moderator, which have their own handling.
  const nonChannelPaths = [
    "directory",
    "settings",
    "search",
    "downloads",
    "subscriptions",
    "inventory",
    "drops",
    "wallet",
    "friends",
    "messages",
    "turbo",
    "prime",
    "jobs",
    "p",
    "u",
    "popout",
    "following",
  ];
  for (const path of nonChannelPaths) {
    test(`/${path} is not a channel`, () => {
      assert.equal(channelOn(`/${path}`), null);
      assert.equal(channelOn(`/${path}/something`), null);
      assert.equal(channelOn(`/${path.toUpperCase()}`), null);
    });
  }

  test("Mod View is watching the moderated channel", () => {
    assert.equal(channelOn("/moderator/xqc"), "xqc");
    assert.equal(channelOn("/moderator/XQC"), "xqc");
    assert.equal(channelOn("/Moderator/xqc"), "xqc");
  });

  test("/moderator alone is not a channel", () => {
    assert.equal(channelOn("/moderator"), null);
    assert.equal(channelOn("/moderator/"), null);
  });

  test("VOD uses the channel link's relative href", () => {
    const link = { text: "xQc", attributes: { href: "/xqc" } };
    assert.equal(channelOn("/videos/123456", [link]), "xqc");
  });

  test("VOD uses the channel link's absolute href", () => {
    const link = { text: "xQc", attributes: { href: "https://www.twitch.tv/XQC/videos" } };
    assert.equal(channelOn("/videos/123456", [link]), "xqc");
  });

  test("VOD without an href falls back to the lowercased link text", () => {
    assert.equal(channelOn("/videos/123456", [{ text: "  SomeStreamer \n" }]), "somestreamer");
  });

  test("VOD href without a login falls back to the link text", () => {
    const link = { text: "SomeStreamer", attributes: { href: "https://www.twitch.tv/" } };
    assert.equal(channelOn("/videos/123456", [link]), "somestreamer");
  });

  test("VOD with a non-Latin display name uses the login from the href", () => {
    const link = { text: "日本の配信者", attributes: { href: "/japanese_streamer" } };
    assert.equal(channelOn("/videos/123456", [link]), "japanese_streamer");
  });

  test("VOD uses the channel name heading's href", () => {
    const heading = { text: "Jynxzi", attributes: { href: "/jynxzi" } };
    assert.equal(channelOn("/videos/123456", [], [heading]), "jynxzi");
  });

  test("VOD with a non-Latin display name in the heading uses the login", () => {
    const heading = { text: "日本の配信者", attributes: { href: "/japanese_streamer" } };
    assert.equal(channelOn("/videos/123456", [], [heading]), "japanese_streamer");
  });

  test("VOD heading without an href falls back to its text", () => {
    assert.equal(channelOn("/videos/123456", [], [{ text: " Jynxzi " }]), "jynxzi");
  });

  test("VOD prefers the channel name heading over a ChannelLink", () => {
    const heading = { text: "xQc", attributes: { href: "/xqc" } };
    const link = { text: "Other", attributes: { href: "/other" } };
    assert.equal(channelOn("/videos/123456", [link], [heading]), "xqc");
  });

  test("VOD without a channel link has no channel", () => {
    assert.equal(channelOn("/videos/123456"), null);
  });

  test("/videos alone is not a channel", () => {
    const link = { text: "xQc", attributes: { href: "/xqc" } };
    assert.equal(channelOn("/videos", [link]), null);
  });
});

describe("getCategory", () => {
  const categoryWith = ({ gameLinks = [], fallback = [] }) => {
    const t = setup({ playing: null });
    t.page.setElements(GAME_LINK, gameLinks.map((text) => createElement({ text })));
    t.page.setElements(GAME_LINK_FALLBACK, fallback.map((text) => createElement({ text })));
    return t.env.get("getCategory")();
  };

  test("uses the stream game link, trimmed", () => {
    assert.equal(categoryWith({ gameLinks: ["  Just Chatting \n"] }), "Just Chatting");
  });

  test("skips Streaming Together links", () => {
    assert.equal(categoryWith({ gameLinks: ["Streaming Together", "Fortnite"] }), "Fortnite");
    assert.equal(categoryWith({ gameLinks: ["Streaming Together with 3 others", "Chess"] }), "Chess");
  });

  test("skips blank links", () => {
    assert.equal(categoryWith({ gameLinks: ["", "   ", "Minecraft"] }), "Minecraft");
  });

  test("falls back to the GameLink element", () => {
    assert.equal(categoryWith({ fallback: [" Valorant "] }), "Valorant");
    assert.equal(categoryWith({ gameLinks: ["Streaming Together", " "], fallback: ["Valorant"] }), "Valorant");
  });

  test("Unknown when there is no category", () => {
    assert.equal(categoryWith({}), "Unknown");
    assert.equal(categoryWith({ gameLinks: ["Streaming Together"], fallback: ["  "] }), "Unknown");
  });
});

describe("tracking watch time", () => {
  test("ticks every 20 seconds and listens for pagehide", () => {
    const t = setup();
    assert.deepEqual(t.clock.intervals, [20 * SECOND]);
    assert.equal(t.page.listenerCount("pagehide"), 1);
  });

  test("steady 20s ticks credit 20 seconds each", () => {
    const t = watching();
    for (let i = 0; i < 5; i++) t.clock.tick();
    assert.deepEqual(t.credited(), [20, 20, 20, 20, 20]);
    assert.deepEqual(t.chrome.runtime.sent[0], {
      type: "incrementStat",
      channel: "xqc",
      category: "Just Chatting",
      elapsed: 20,
    });
  });

  test("late ticks carry the leftover fraction, so the total matches real time", () => {
    const t = watching();
    const start = t.clock.now;
    while (t.clock.now - start < 10 * MINUTE) t.clock.tick(20.6 * SECOND);
    const realSeconds = (t.clock.now - start) / SECOND;
    assert.ok(
      Math.abs(t.total() - realSeconds) < 1,
      `credited ${t.total()}s for ${realSeconds}s of watching`
    );
    assert.ok(t.credited().includes(21), "some ticks credit the carried-over second");
  });

  test("the first tick after the video starts playing credits nothing", () => {
    const t = setup({ playing: false });
    t.clock.tick();
    t.clock.tick();
    t.play();
    t.clock.tick();
    assert.deepEqual(t.credited(), []);
    t.clock.tick();
    assert.deepEqual(t.credited(), [20]);
  });

  test("no video on the page credits nothing", () => {
    const t = setup({ playing: null });
    for (let i = 0; i < 5; i++) t.clock.tick();
    assert.deepEqual(t.credited(), []);
  });

  test("pausing the video stops crediting", () => {
    const t = watching();
    t.clock.tick();
    t.pause();
    t.clock.tick(); // credits the time up to the tick that sees the pause
    const creditedAtPause = t.credited().length;
    for (let i = 0; i < 5; i++) t.clock.tick();
    assert.equal(t.credited().length, creditedAtPause);
    assert.ok(t.total() <= 40);

    // Resuming starts a fresh count.
    t.play();
    t.clock.tick();
    assert.equal(t.credited().length, creditedAtPause);
    t.clock.tick();
    assert.equal(t.credited().at(-1), 20);
  });

  test("throttled 60s and 75s ticks are credited in full", () => {
    const t = watching();
    t.clock.tick(60 * SECOND);
    t.clock.tick(75 * SECOND);
    assert.deepEqual(t.credited(), [60, 75]);
  });

  test("a gap of exactly 120s is still credited", () => {
    const t = watching();
    t.clock.tick(120 * SECOND);
    assert.deepEqual(t.credited(), [120]);
  });

  test("a gap over 120s (sleep or frozen tab) credits nothing, then counting resumes", () => {
    const t = watching();
    t.clock.tick();
    t.clock.tick(121 * SECOND);
    t.clock.tick(10 * MINUTE);
    assert.deepEqual(t.credited(), [20]);
    t.clock.tick();
    assert.deepEqual(t.credited(), [20, 20]);
  });

  test("time on the home page is not carried over to the next channel", () => {
    const t = watching({ pathname: "/" });
    for (let i = 0; i < 6; i++) t.clock.tick(); // 2 minutes of the featured stream
    assert.deepEqual(t.credited(), []);

    t.page.location.pathname = "/shroud"; // SPA navigation, no reload
    t.clock.tick();
    assert.deepEqual(t.credited(), [20]);
    assert.equal(t.chrome.runtime.sent[0].channel, "shroud");
  });

  test("follows SPA navigation between channels", () => {
    const t = watching();
    t.clock.tick();
    t.page.location.pathname = "/shroud";
    t.clock.tick();
    assert.deepEqual(
      t.chrome.runtime.sent.map((m) => m.channel),
      ["xqc", "shroud"]
    );
  });
});

describe("pagehide", () => {
  test("flushes the whole seconds watched since the last tick", () => {
    const t = watching();
    t.clock.tick();
    t.clock.advance(5.7 * SECOND);
    t.page.dispatch("pagehide");
    assert.deepEqual(t.credited(), [20, 5]);
  });

  test("flushes a single second", () => {
    const t = watching();
    t.clock.advance(1 * SECOND);
    t.page.dispatch("pagehide");
    assert.deepEqual(t.credited(), [1]);
  });

  test("sends nothing for under a second", () => {
    const t = watching();
    t.clock.advance(999);
    t.page.dispatch("pagehide");
    assert.deepEqual(t.credited(), []);
  });

  test("sends nothing after a long gap", () => {
    const t = watching();
    t.clock.advance(10 * MINUTE);
    t.page.dispatch("pagehide");
    assert.deepEqual(t.credited(), []);
  });

  test("sends nothing when not watching", () => {
    const t = setup({ playing: false });
    t.clock.tick();
    t.clock.advance(10 * SECOND);
    t.page.dispatch("pagehide");
    assert.deepEqual(t.credited(), []);
  });

  test("sends nothing before the first tick", () => {
    const t = setup();
    t.clock.advance(10 * SECOND);
    t.page.dispatch("pagehide");
    assert.deepEqual(t.credited(), []);
  });
});

describe("extension reloaded (orphaned content script)", () => {
  const assertStopped = (t, sentBefore) => {
    assert.deepEqual(t.clock.intervals, [], "interval cleared");
    assert.equal(t.page.listenerCount("pagehide"), 0, "pagehide listener removed");
    // Nothing runs any more, and nothing throws.
    t.clock.advance(5 * SECOND);
    assert.doesNotThrow(() => t.page.dispatch("pagehide"));
    assert.doesNotThrow(() => t.clock.tick(20 * SECOND));
    assert.equal(t.chrome.runtime.sent.length, sentBefore, "no further messages");
  };

  test("a tick without chrome.runtime.id stops tracking", () => {
    const t = watching();
    t.clock.tick();
    t.chrome.runtime.id = undefined;
    assert.doesNotThrow(() => t.clock.tick());
    assertStopped(t, 1);
  });

  test("a paused tab stops tracking too", () => {
    const t = setup({ playing: false });
    t.chrome.runtime.id = undefined;
    assert.doesNotThrow(() => t.clock.tick());
    assertStopped(t, 0);
  });

  test("pagehide without chrome.runtime.id stops tracking", () => {
    const t = watching();
    t.chrome.runtime.id = undefined;
    t.clock.advance(5 * SECOND);
    assert.doesNotThrow(() => t.page.dispatch("pagehide"));
    assertStopped(t, 0);
  });

  test("chrome.runtime throwing on access stops tracking", () => {
    const t = watching();
    Object.defineProperty(t.chrome, "runtime", {
      get() {
        throw new Error("Extension context invalidated.");
      },
    });
    assert.doesNotThrow(() => t.clock.tick());
    assert.deepEqual(t.clock.intervals, []);
    assert.equal(t.page.listenerCount("pagehide"), 0);
  });

  test("sendMessage throwing stops tracking", () => {
    const t = watching();
    let attempts = 0;
    t.chrome.runtime.sendMessage = () => {
      attempts++;
      throw new Error("Extension context invalidated.");
    };
    assert.doesNotThrow(() => t.clock.tick());
    assert.equal(attempts, 1);
    assertStopped(t, 0);
    assert.equal(attempts, 1, "no further attempts");
  });

  test("context lost before the reply arrives stops tracking", async () => {
    const t = watching({ reply: null }); // no receiver, so lastError is set
    t.clock.tick();
    t.chrome.runtime.id = undefined;
    await flush();
    assertStopped(t, 1);
  });
});

describe("responses from the background", () => {
  test("success: false logs an error", async () => {
    const t = watching({ reply: { success: false, error: "quota exceeded" } });
    t.clock.tick();
    await flush();
    assert.equal(t.errors.length, 1);
    assert.match(String(t.errors[0][0]), /Failed to update stat/);
    assert.ok(t.errors[0].includes("quota exceeded"));
  });

  test("success: true logs nothing", async () => {
    const t = watching();
    t.clock.tick();
    await flush();
    assert.deepEqual(t.errors, []);
  });

  test("lastError with a valid context keeps tracking and logs nothing", async () => {
    const t = watching({ reply: null }); // "Receiving end does not exist"
    t.clock.tick();
    await flush();
    assert.ok(t.isTracking());
    assert.deepEqual(t.errors, []);
    t.clock.tick();
    assert.deepEqual(t.credited(), [20, 20]);
  });
});

test("NON_CHANNEL_PATHS matches the list in utils.js", () => {
  const content = setup({ playing: null }).env.get("NON_CHANNEL_PATHS");
  const utils = loadScripts("utils.js").get("NON_CHANNEL_PATHS");
  assert.deepEqual([...content].sort(), [...utils].sort());
});
