// Checks for the test helpers themselves, plus a smoke test that background.js
// loads with them. Deeper background tests belong in their own file.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createFakeChrome, createFakeRuntime, createFakeStorage } from "./helpers/fake-chrome.mjs";
import { loadScripts } from "./helpers/load-script.mjs";

test("background.js loads utils.js and registers its listeners", () => {
  const chrome = createFakeChrome();
  const bg = loadScripts("background.js", { globals: { chrome }, importScripts: true });

  assert.deepEqual(bg.loaded, ["background.js", "utils.js"]);
  assert.equal(typeof bg.get("normalizeStats"), "function");
  assert.equal(chrome.runtime.onMessage.listeners.length, 3);
  assert.equal(chrome.runtime.onInstalled.listeners.length, 1);
});

test("loadScripts gives each call its own context", () => {
  const a = loadScripts("utils.js");
  const b = loadScripts("utils.js");
  a.run("globalThis.marker = 1");
  assert.equal(a.get("marker"), 1);
  assert.equal(b.run("typeof marker"), "undefined");
  assert.notEqual(a.get("NON_CHANNEL_PATHS"), b.get("NON_CHANNEL_PATHS"));
});

describe("createFakeStorage", () => {
  test("get/set/remove/clear with promises and callbacks", async () => {
    const storage = createFakeStorage({ initial: { a: 1, b: { c: 2 } } });

    assert.deepEqual(await storage.get("a"), { a: 1 });
    assert.deepEqual(await storage.get(["a", "missing"]), { a: 1 });
    assert.deepEqual(await storage.get({ a: 0, missing: "default" }), { a: 1, missing: "default" });
    assert.deepEqual(await storage.get(null), { a: 1, b: { c: 2 } });
    assert.deepEqual(await storage.get(), { a: 1, b: { c: 2 } });

    await storage.set({ d: [1, 2] });
    await storage.remove(["a", "b"]);
    assert.deepEqual(storage.snapshot(), { d: [1, 2] });

    const viaCallback = await new Promise((resolve) => {
      assert.equal(storage.get("d", resolve), undefined);
    });
    assert.deepEqual(viaCallback, { d: [1, 2] });

    await storage.clear();
    assert.deepEqual(storage.snapshot(), {});
  });

  test("stores copies, not references", async () => {
    const value = { nested: { n: 1 } };
    const storage = createFakeStorage();
    await storage.set({ value });
    value.nested.n = 2;
    const { value: read } = await storage.get("value");
    read.nested.n = 3;
    assert.deepEqual(storage.snapshot(), { value: { nested: { n: 1 } } });
  });

  test("applies operations in call order even with random delays", async () => {
    const storage = createFakeStorage({ maxDelayMs: 5 });
    const writes = [];
    for (let i = 0; i < 10; i++) writes.push(storage.set({ n: i }));
    const read = storage.get("n");
    await Promise.all(writes);
    assert.deepEqual(await read, { n: 9 });
  });
});

describe("createFakeRuntime", () => {
  test("dispatchMessage resolves with a synchronous reply", async () => {
    const runtime = createFakeRuntime();
    runtime.onMessage.addListener((msg, sender, sendResponse) => sendResponse({ echo: msg.n }));
    assert.deepEqual(await runtime.dispatchMessage({ n: 1 }), { echo: 1 });
  });

  test("waits for an async reply only when a listener returns true", async () => {
    const runtime = createFakeRuntime();
    runtime.onMessage.addListener((msg, sender, sendResponse) => {
      setTimeout(() => sendResponse("late"), 1);
      return msg.keepOpen;
    });
    assert.equal(await runtime.dispatchMessage({ keepOpen: true }), "late");
    // Without `return true` the channel closes and the late reply is ignored.
    assert.equal(await runtime.dispatchMessage({ keepOpen: false }), undefined);
  });

  test("the first reply wins", async () => {
    const runtime = createFakeRuntime();
    runtime.onMessage.addListener((msg, sender, sendResponse) => sendResponse("first"));
    runtime.onMessage.addListener((msg, sender, sendResponse) => sendResponse("second"));
    assert.equal(await runtime.dispatchMessage({}), "first");
  });

  test("sendMessage reports a missing reply like Chrome", async () => {
    const runtime = createFakeRuntime();
    await assert.rejects(runtime.sendMessage({}), /Receiving end does not exist/);

    runtime.onMessage.addListener(() => {});
    await assert.rejects(runtime.sendMessage({}), /message port closed/);

    const lastError = await new Promise((resolve) => {
      runtime.sendMessage({ type: "x" }, () => resolve(runtime.lastError));
    });
    assert.match(lastError.message, /message port closed/);
    assert.equal(runtime.lastError, undefined);
    assert.deepEqual(runtime.sent.at(-1), { type: "x" });
  });

  test("dispatchInstalled calls onInstalled listeners", () => {
    const runtime = createFakeRuntime();
    const seen = [];
    runtime.onInstalled.addListener((details) => seen.push(details.reason));
    runtime.dispatchInstalled({ reason: "update" });
    assert.deepEqual(seen, ["update"]);
  });
});
