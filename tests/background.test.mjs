// Tests for background.js message handlers (incrementStat, clearStats,
// replaceStats) and its write queue. Migration tests are in
// background-migration.test.mjs.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadBackground } from "./helpers/background-env.mjs";

const OK = { success: true };
const inc = (channel, category, elapsed) => ({ type: "incrementStat", channel, category, elapsed });

describe("incrementStat", () => {
  test("saves a new channel and category", async () => {
    const env = loadBackground({ initial: { stats: {} } });
    assert.deepEqual(await env.send(inc("xqc", "Gaming", 20)), OK);
    assert.deepEqual(env.stored(), { stats: { xqc: { Gaming: 20 } } });
  });

  test("works when no stats are stored yet", async () => {
    const env = loadBackground();
    assert.deepEqual(await env.send(inc("xqc", "Gaming", 20)), OK);
    assert.deepEqual(env.stored(), { stats: { xqc: { Gaming: 20 } } });
  });

  test("adds to existing totals and keeps other data", async () => {
    const env = loadBackground({
      initial: { stats: { xqc: { Gaming: 100, Chatting: 5 }, other: { A: 1 } }, dashboardItemLimit: 10 },
    });
    await env.send(inc("xqc", "Gaming", 20));
    await env.send(inc("xqc", "Music", 3));
    assert.deepEqual(env.stored(), {
      stats: { xqc: { Gaming: 120, Chatting: 5, Music: 3 }, other: { A: 1 } },
      dashboardItemLimit: 10,
    });
  });

  test("trims and lowercases the channel name", async () => {
    const env = loadBackground({ initial: { stats: { xqc: { Gaming: 1 } } } });
    await env.send(inc("  xQc ", "Gaming", 2));
    await env.send(inc("XQC", "Gaming", 3));
    assert.deepEqual(env.stored(), { stats: { xqc: { Gaming: 6 } } });
  });

  test("keeps category names as they are", async () => {
    const env = loadBackground();
    await env.send(inc("xqc", "Just Chatting", 1));
    await env.send(inc("xqc", "just chatting", 2));
    assert.deepEqual(env.stored(), { stats: { xqc: { "Just Chatting": 1, "just chatting": 2 } } });
  });

  for (const [label, category] of [
    ["missing", undefined],
    ["empty", ""],
    ["null", null],
    ["a number", 42],
  ]) {
    test(`uses "Unknown" when the category is ${label}`, async () => {
      const env = loadBackground();
      assert.deepEqual(await env.send(inc("xqc", category, 5)), OK);
      assert.deepEqual(env.stored(), { stats: { xqc: { Unknown: 5 } } });
    });
  }

  const invalid = [
    ["empty channel", inc("", "Gaming", 5)],
    ["whitespace-only channel", inc("   ", "Gaming", 5)],
    ["missing channel", { type: "incrementStat", category: "Gaming", elapsed: 5 }],
    ["number channel", inc(123, "Gaming", 5)],
    ["null channel", inc(null, "Gaming", 5)],
    ["object channel", inc({ name: "xqc" }, "Gaming", 5)],
    ["zero elapsed", inc("xqc", "Gaming", 0)],
    ["negative elapsed", inc("xqc", "Gaming", -5)],
    ["NaN elapsed", inc("xqc", "Gaming", NaN)],
    ["Infinity elapsed", inc("xqc", "Gaming", Infinity)],
    ["-Infinity elapsed", inc("xqc", "Gaming", -Infinity)],
    ["string elapsed", inc("xqc", "Gaming", "20")],
    ["null elapsed", inc("xqc", "Gaming", null)],
    ["missing elapsed", { type: "incrementStat", channel: "xqc", category: "Gaming" }],
  ];
  for (const [label, msg] of invalid) {
    test(`rejects ${label} right away and writes nothing`, () => {
      const initial = { stats: { xqc: { Gaming: 1 } } };
      const env = loadBackground({ initial });
      // Called directly so NaN/Infinity aren't turned into null by a JSON copy.
      const { returns, replies } = env.callListeners(msg);
      assert.deepEqual(replies, [{ success: false, error: "invalid incrementStat message" }]);
      assert.ok(!returns.includes(true), "no listener keeps the channel open");
      assert.deepEqual(env.calls, { get: 0, set: 0, remove: 0, clear: 0 });
      assert.deepEqual(env.stored(), initial);
    });
  }

  test(
    'saves a channel named "constructor"',
    {
      todo:
        "bug: stats is a normal object, so stats.constructor is Object.prototype.constructor; " +
        "the seconds are set on the Object function and never saved",
    },
    async () => {
      const env = loadBackground({ initial: { stats: {} } });
      assert.deepEqual(await env.send(inc("constructor", "Gaming", 20)), OK);
      assert.deepEqual(env.stored(), { stats: { constructor: { Gaming: 20 } } });
    }
  );
});

describe("write queue", () => {
  test("50 concurrent increments with random storage delays lose nothing", async () => {
    const env = loadBackground({ initial: { stats: {} }, maxDelayMs: 5 });
    const channels = ["xqc", "XQC", " Shroud", "pokimane", "Pokimane "];
    const categories = ["Gaming", "Just Chatting", "Music"];
    const expected = {};
    const pending = [];
    for (let i = 0; i < 50; i++) {
      const channel = channels[i % channels.length];
      const category = categories[i % categories.length];
      const elapsed = 1 + ((i * 7) % 13);
      const key = channel.trim().toLowerCase();
      expected[key] ??= {};
      expected[key][category] = (expected[key][category] ?? 0) + elapsed;
      pending.push(env.send(inc(channel, category, elapsed)));
    }
    const replies = await Promise.all(pending);
    assert.deepEqual(replies, Array(50).fill(OK));
    assert.deepEqual(env.stored(), { stats: expected });
  });

  test("a failed write replies with the error and later writes still succeed", async () => {
    const env = loadBackground({ initial: { stats: {} }, maxDelayMs: 2 });
    env.failNext("set", "QUOTA_BYTES quota exceeded");
    const replies = await Promise.all([
      env.send(inc("xqc", "Gaming", 10)),
      env.send(inc("xqc", "Gaming", 20)),
      env.send(inc("shroud", "Music", 5)),
    ]);
    assert.deepEqual(replies, [{ success: false, error: "QUOTA_BYTES quota exceeded" }, OK, OK]);
    assert.deepEqual(env.stored(), { stats: { xqc: { Gaming: 20 }, shroud: { Music: 5 } } });
    assert.equal(env.errors.length, 1);
    assert.match(env.errors[0], /failed to save stat.*QUOTA_BYTES/);
  });

  test("a failed read replies with the error and the queue keeps going", async () => {
    const env = loadBackground({ initial: { stats: { xqc: { Gaming: 1 } } } });
    env.failNext("get", "read failed");
    const [first, second] = await Promise.all([env.send(inc("xqc", "Gaming", 10)), env.send(inc("xqc", "Gaming", 2))]);
    assert.deepEqual(first, { success: false, error: "read failed" });
    assert.deepEqual(second, OK);
    assert.deepEqual(env.stored(), { stats: { xqc: { Gaming: 3 } } });
  });

  for (const [label, msg, method, what] of [
    ["clearStats", { type: "clearStats" }, "remove", "clear stats"],
    ["replaceStats", { type: "replaceStats", stats: { a: { b: 1 } } }, "set", "replace stats"],
  ]) {
    test(`${label} replies with the error when storage fails`, async () => {
      const env = loadBackground({ initial: { stats: { xqc: { Gaming: 1 } } } });
      env.failNext(method, "boom");
      assert.deepEqual(await env.send(msg), { success: false, error: "boom" });
      assert.match(env.errors[0], new RegExp(`failed to ${what}`));
      assert.deepEqual(await env.send(inc("xqc", "Gaming", 2)), OK);
      assert.deepEqual(env.stored(), { stats: { xqc: { Gaming: 3 } } });
    });
  }
});

describe("clearStats", () => {
  test("removes stats and keeps other settings", async () => {
    const env = loadBackground({ initial: { stats: { xqc: { Gaming: 1 } }, dashboardItemLimit: 25 } });
    assert.deepEqual(await env.send({ type: "clearStats" }), OK);
    assert.deepEqual(env.stored(), { dashboardItemLimit: 25 });
    assert.equal(env.calls.clear, 0);
  });

  test("runs in order with increments queued around it", async () => {
    const env = loadBackground({ initial: { stats: { old: { A: 1 } }, dashboardItemLimit: 25 }, maxDelayMs: 5 });
    const replies = await Promise.all([
      env.send(inc("xqc", "Gaming", 10)),
      env.send(inc("shroud", "Music", 5)),
      env.send({ type: "clearStats" }),
      env.send(inc("xqc", "Gaming", 3)),
      env.send(inc("pokimane", "Chatting", 4)),
    ]);
    assert.deepEqual(replies, Array(5).fill(OK));
    assert.deepEqual(env.stored(), {
      stats: { xqc: { Gaming: 3 }, pokimane: { Chatting: 4 } },
      dashboardItemLimit: 25,
    });
  });
});

describe("replaceStats", () => {
  for (const [label, stats] of [
    ["an array", []],
    ["a number", 5],
    ["null", null],
    ["missing", undefined],
    ["a negative value", { a: { b: -1 } }],
    ["a string value", { a: { b: "1" } }],
    ["an array channel", { a: [] }],
    ["an empty channel name", { " ": { b: 1 } }],
  ]) {
    test(`rejects ${label} and leaves storage untouched`, () => {
      const initial = { stats: { xqc: { Gaming: 1 } }, dashboardItemLimit: 10 };
      const env = loadBackground({ initial });
      const { returns, replies } = env.callListeners({ type: "replaceStats", stats });
      assert.deepEqual(replies, [{ success: false, error: "invalid stats data" }]);
      assert.ok(!returns.includes(true));
      assert.deepEqual(env.calls, { get: 0, set: 0, remove: 0, clear: 0 });
      assert.deepEqual(env.stored(), initial);
    });
  }

  test("replaces all stats with normalized, merged data and keeps settings", async () => {
    const env = loadBackground({ initial: { stats: { old: { A: 99 } }, dashboardItemLimit: 10 } });
    const reply = await env.send({
      type: "replaceStats",
      stats: { " xQc ": { Gaming: 10 }, xqc: { Gaming: 5, Music: 1 }, Shroud: {} },
    });
    assert.deepEqual(reply, OK);
    assert.deepEqual(env.stored(), {
      stats: { xqc: { Gaming: 15, Music: 1 }, shroud: {} },
      dashboardItemLimit: 10,
    });
  });

  test("runs in order with increments queued around it", async () => {
    const env = loadBackground({ initial: { stats: { old: { A: 1 } } }, maxDelayMs: 5 });
    const replies = await Promise.all([
      env.send(inc("xqc", "Gaming", 10)),
      env.send({ type: "replaceStats", stats: { imported: { B: 7 }, xqc: { Gaming: 100 } } }),
      env.send(inc("xqc", "Gaming", 3)),
      env.send(inc("shroud", "Music", 2)),
    ]);
    assert.deepEqual(replies, Array(4).fill(OK));
    assert.deepEqual(env.stored(), {
      stats: { imported: { B: 7 }, xqc: { Gaming: 103 }, shroud: { Music: 2 } },
    });
  });
});

describe("other messages", () => {
  for (const [label, msg] of [
    ["an unknown type", { type: "somethingElse" }],
    ["no type", { channel: "xqc" }],
    ["null", null],
    ["a string", "incrementStat"],
  ]) {
    test(`ignores ${label}: no reply, channel not kept open`, async () => {
      const env = loadBackground({ initial: { stats: { xqc: { A: 1 } } } });
      const { returns, replies } = env.callListeners(msg);
      assert.deepEqual(replies, []);
      assert.ok(!returns.includes(true));
      assert.equal(await env.send(msg), undefined);
      assert.deepEqual(env.calls, { get: 0, set: 0, remove: 0, clear: 0 });
    });
  }
});
