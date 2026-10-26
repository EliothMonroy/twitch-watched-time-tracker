// Loads background.js with a fake chrome whose storage is instrumented:
// it counts calls and can fail the next call of a method on demand.
//
//   const env = loadBackground({ initial: { stats: {} }, maxDelayMs: 5 });
//   env.failNext("set", "quota exceeded");
//   const reply = await env.send({ type: "incrementStat", ... });
//   env.stored(); // what's in storage now
//
// console.error from background.js is captured in `env.errors` so expected
// failures don't clutter the test output.
import { createFakeChrome } from "./fake-chrome.mjs";
import { loadScripts } from "./load-script.mjs";

export function loadBackground({ initial = {}, maxDelayMs = 0 } = {}) {
  const chrome = createFakeChrome({ storage: { initial, maxDelayMs } });
  const storage = chrome.storage.local;

  const calls = { get: 0, set: 0, remove: 0, clear: 0 };
  const failures = { get: [], set: [], remove: [], clear: [] };
  for (const method of Object.keys(calls)) {
    const real = storage[method];
    storage[method] = (...args) => {
      calls[method]++;
      if (failures[method].length > 0) {
        return Promise.reject(new Error(failures[method].shift()));
      }
      return real(...args);
    };
  }

  const errors = [];
  const quietConsole = {
    ...console,
    error: (...args) => errors.push(args.map(String).join(" ")),
  };

  const bg = loadScripts("background.js", {
    globals: { chrome, console: quietConsole },
    importScripts: true,
  });

  return {
    chrome,
    bg,
    calls,
    errors,
    /** Makes the next call to storage.<method> reject with `message`. */
    failNext(method, message = "storage failed") {
      failures[method].push(message);
    },
    /** Sends a message like chrome.runtime.sendMessage; resolves with the reply. */
    send: (msg) => chrome.runtime.dispatchMessage(msg),
    /**
     * Calls every onMessage listener directly, without the JSON copy that
     * dispatchMessage does (so NaN/Infinity reach the listener as-is).
     * Returns each listener's return value and (plain copies of) the replies sent.
     */
    callListeners(msg) {
      const replies = [];
      const returns = chrome.runtime.onMessage.listeners.map((listener) =>
        listener(msg, { id: chrome.runtime.id }, (r) => replies.push(JSON.parse(JSON.stringify(r))))
      );
      return { returns, replies };
    },
    /** Waits for every job queued so far in background.js's write queue. */
    flush: () => bg.get("writeQueue"),
    /** Plain copy of everything in storage right now. */
    stored: () => storage.snapshot(),
  };
}
