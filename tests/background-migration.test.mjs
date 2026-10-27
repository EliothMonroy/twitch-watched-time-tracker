// Tests for the onInstalled migration in background.js that merges channel
// keys differing only by case or whitespace ("xQc" vs "xqc").
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadBackground } from "./helpers/background-env.mjs";

// Runs the migration and waits for it to finish.
async function migrate(env, reason = "update") {
  env.chrome.runtime.dispatchInstalled({ reason });
  await env.flush();
}

describe("channel key migration", () => {
  test("merges keys that differ by case or whitespace, summing per category", async () => {
    const env = loadBackground({
      initial: { stats: { xQc: { A: 10 }, xqc: { A: 5, B: 1 }, " XQC ": { B: 2 } } },
    });
    await migrate(env);
    assert.deepEqual(env.stored(), { stats: { xqc: { A: 15, B: 3 } } });
  });

  test("renames a key when the lowercase key doesn't exist yet", async () => {
    const env = loadBackground({ initial: { stats: { " Shroud": { Music: 4 }, xqc: { A: 1 } } } });
    await migrate(env);
    assert.deepEqual(env.stored(), { stats: { shroud: { Music: 4 }, xqc: { A: 1 } } });
  });

  test("is idempotent and doesn't write when nothing changes", async () => {
    const env = loadBackground({
      initial: { stats: { xQc: { A: 10 }, xqc: { A: 5, B: 1 }, " XQC ": { B: 2 } } },
    });
    await migrate(env);
    assert.equal(env.calls.set, 1);
    await migrate(env);
    await migrate(env, "install");
    assert.equal(env.calls.set, 1);
    assert.deepEqual(env.stored(), { stats: { xqc: { A: 15, B: 3 } } });
  });

  test("leaves keys other than stats untouched", async () => {
    const env = loadBackground({
      initial: { stats: { XQC: { A: 1 } }, dashboardItemLimit: 15, other: { XQC: 1 } },
    });
    await migrate(env);
    assert.deepEqual(env.stored(), {
      stats: { xqc: { A: 1 } },
      dashboardItemLimit: 15,
      other: { XQC: 1 },
    });
  });

  test("leaves keys alone when values can't be summed, still merges the rest", async () => {
    const stats = {
      XQC: { A: "10" }, // string can't be added to xqc.A
      xqc: { A: 5 },
      Shroud: 7, // not a category map
      shroud: { B: 1 },
      Poki: { C: 1 },
      poki: [], // target isn't a category map
      " Foo ": { D: 2 },
    };
    const env = loadBackground({ initial: { stats } });
    await migrate(env);
    assert.deepEqual(env.stored(), {
      stats: {
        XQC: { A: "10" },
        xqc: { A: 5 },
        Shroud: 7,
        shroud: { B: 1 },
        Poki: { C: 1 },
        poki: [],
        foo: { D: 2 },
      },
    });
  });

  test("doesn't treat a __PROTO__ key as __proto__", async () => {
    const env = loadBackground({
      initial: { stats: JSON.parse('{"__PROTO__": {"A": 1}, "XQC": {"B": 2}}') },
    });
    await migrate(env);
    assert.deepEqual(env.stored(), { stats: JSON.parse('{"__PROTO__": {"A": 1}, "xqc": {"B": 2}}') });
    assert.equal(env.bg.run("({}).A"), undefined, "Object.prototype not polluted");
  });

  for (const [label, initial] of [
    ["no stats are stored", { dashboardItemLimit: 10 }],
    ["stats is not an object", { stats: [{ XQC: 1 }] }],
    ["stats is empty", { stats: {} }],
  ]) {
    test(`does nothing when ${label}`, async () => {
      const env = loadBackground({ initial });
      await migrate(env);
      assert.equal(env.calls.get, 1);
      assert.equal(env.calls.set, 0);
      assert.deepEqual(env.stored(), initial);
    });
  }

  for (const reason of ["install", "update"]) {
    test(`runs on ${reason}`, async () => {
      const env = loadBackground({ initial: { stats: { XQC: { A: 1 } } } });
      await migrate(env, reason);
      assert.deepEqual(env.stored(), { stats: { xqc: { A: 1 } } });
    });
  }

  for (const reason of ["chrome_update", "shared_module_update"]) {
    test(`doesn't run on ${reason}`, async () => {
      const env = loadBackground({ initial: { stats: { XQC: { A: 1 } } } });
      await migrate(env, reason);
      assert.equal(env.calls.get, 0);
      assert.deepEqual(env.stored(), { stats: { XQC: { A: 1 } } });
    });
  }

  test('merges into a channel named "constructor"', async () => {
    const env = loadBackground({
      initial: { stats: { Constructor: { A: 2 }, constructor: { A: 3 }, " CONSTRUCTOR": { B: 1 } } },
    });
    await migrate(env);
    assert.deepEqual(env.stored(), { stats: { constructor: { A: 5, B: 1 } } });
  });

  test('renames "Constructor" when no lowercase key exists yet', async () => {
    const env = loadBackground({ initial: { stats: { Constructor: { A: 2 } } } });
    await migrate(env);
    assert.deepEqual(env.stored(), { stats: { constructor: { A: 2 } } });
  });

  test("goes through the write queue, so a concurrent increment isn't lost", async () => {
    const env = loadBackground({
      initial: { stats: { xQc: { A: 10 }, xqc: { A: 5, B: 1 }, " XQC ": { B: 2 } } },
      maxDelayMs: 5,
    });
    env.chrome.runtime.dispatchInstalled({ reason: "update" });
    const reply = await env.chrome.runtime.dispatchMessage({
      type: "incrementStat",
      channel: "xqc",
      category: "A",
      elapsed: 1,
    });
    assert.deepEqual(reply, { success: true });
    assert.deepEqual(env.stored(), { stats: { xqc: { A: 16, B: 3 } } });
  });

  test("a failed migration is logged and doesn't block later writes", async () => {
    const env = loadBackground({ initial: { stats: { XQC: { A: 1 } } } });
    env.failNext("get", "read failed");
    env.chrome.runtime.dispatchInstalled({ reason: "update" });
    const reply = await env.send({ type: "incrementStat", channel: "xqc", category: "A", elapsed: 2 });
    assert.deepEqual(reply, { success: true });
    assert.deepEqual(env.stored(), { stats: { XQC: { A: 1 }, xqc: { A: 2 } } });
    assert.equal(env.errors.length, 1);
    assert.match(env.errors[0], /channel key migration failed.*read failed/);
  });
});
