// Small fakes for the chrome.* APIs the extension uses. Pass them to
// loadScripts() as globals:
//
//   const chrome = createFakeChrome({ storage: { initial: { stats: {} } } });
//   loadScripts("background.js", { globals: { chrome }, importScripts: true });
//   const reply = await chrome.runtime.dispatchMessage({ type: "clearStats" });
//   const { stats } = chrome.storage.local.snapshot();
//
// Values going into and out of the fakes are copied with a JSON round trip,
// like Chrome serializes storage values and messages. So tests never share
// objects with the script, and copies are plain objects from the test's realm.
//
// Delays use the real setTimeout captured when this module loads, so faking
// the test's own timers (e.g. node:test mock.timers) doesn't stall storage.

const realSetTimeout = globalThis.setTimeout;

const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// If the last argument is a callback, call it with the result and return
// undefined (Chrome's callback style); otherwise return the promise.
function promiseOrCallback(args, run) {
  const callback = typeof args.at(-1) === "function" ? args.pop() : null;
  const promise = run(...args);
  if (!callback) return promise;
  promise.then((result) => callback(result));
  return undefined;
}

/**
 * A fake `chrome.storage.local`: get/set/remove/clear, promise- or
 * callback-style. Operations apply one at a time in call order (like Chrome),
 * but each finishes asynchronously, so callers that read, await, then write
 * can still race each other.
 *
 * @param {object} [options]
 * @param {object} [options.initial] Starting contents (copied).
 * @param {number} [options.maxDelayMs] Each operation waits a random
 *   0..maxDelayMs before it applies. 0 (default) means a microtask only.
 * @param {() => number} [options.random] Source of randomness for delays.
 */
export function createFakeStorage({ initial = {}, maxDelayMs = 0, random = Math.random } = {}) {
  let data = copy(initial);
  let queue = Promise.resolve();

  const wait = () =>
    maxDelayMs > 0 ? new Promise((resolve) => realSetTimeout(resolve, random() * maxDelayMs)) : null;

  // Runs `op` after earlier operations and its own delay, keeping call order.
  const enqueue = (op) => {
    const result = queue.then(wait).then(op);
    queue = result.catch(() => {});
    return result;
  };

  const has = (key) => Object.hasOwn(data, key);

  const get = (keys = null) =>
    enqueue(() => {
      if (keys === null) return copy(data);
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter(has).map((key) => [key, copy(data[key])]));
      }
      // An object maps keys to default values.
      return Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [key, copy(has(key) ? data[key] : fallback)])
      );
    });

  const set = (items) =>
    enqueue(() => {
      for (const [key, value] of Object.entries(copy(items))) data[key] = value;
    });

  const remove = (keys) =>
    enqueue(() => {
      for (const key of [keys].flat()) delete data[key];
    });

  const clear = () =>
    enqueue(() => {
      data = {};
    });

  return {
    get: (...args) => promiseOrCallback(args, get),
    set: (...args) => promiseOrCallback(args, set),
    remove: (...args) => promiseOrCallback(args, remove),
    clear: (...args) => promiseOrCallback(args, clear),
    /** Test-only: a copy of everything stored right now, ignoring pending operations. */
    snapshot: () => copy(data),
  };
}

// A chrome.events.Event-like object. `listeners` is exposed for assertions.
function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(fn) {
      if (!listeners.includes(fn)) listeners.push(fn);
    },
    removeListener(fn) {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    hasListeners: () => listeners.length > 0,
  };
}

/**
 * A fake `chrome.runtime` for one extension. Scripts register listeners as
 * usual; tests drive them with dispatchMessage() and dispatchInstalled().
 * Scripts that call sendMessage() (content.js, popup.js) reach the listeners
 * registered on the same fake, so share one fake between their contexts.
 *
 * Message replies follow Chrome's rules: every onMessage listener is called;
 * the first sendResponse() call wins; if no listener replied synchronously and
 * none returned `true`, the channel closes and later replies are ignored.
 *
 * @param {object} [options]
 * @param {string} [options.id] Extension id (`chrome.runtime.id`). Set
 *   `runtime.id = undefined` to mimic an invalidated extension context.
 */
export function createFakeRuntime({ id = "fake-extension-id" } = {}) {
  const onMessage = createEvent();
  const onInstalled = createEvent();

  // Resolves { responded: true, response } or { responded: false }. If a
  // listener throws, the other listeners still run, then it rejects with the
  // first error (unless a reply was already sent).
  function deliver(message, sender) {
    return new Promise((resolve, reject) => {
      let open = true;
      let keepOpen = false;
      let error = null;
      const sendResponse = (response) => {
        if (!open) return;
        open = false;
        resolve({ responded: true, response: copy(response) });
      };

      const msg = copy(message);
      const from = copy(sender);
      for (const listener of [...onMessage.listeners]) {
        try {
          if (listener(msg, from, sendResponse) === true) keepOpen = true;
        } catch (e) {
          error ??= e;
        }
      }
      if (error && open) {
        open = false;
        reject(error);
      } else if (open && !keepOpen) {
        open = false;
        resolve({ responded: false });
      }
    });
  }

  const runtime = {
    id,
    lastError: undefined,
    onMessage,
    onInstalled,
    /** Test-only: copies of every message passed to sendMessage(), in order. */
    sent: [],

    getURL: (path) => `chrome-extension://${runtime.id}/${String(path).replace(/^\//, "")}`,

    // Like chrome.runtime.sendMessage(message[, callback]). With a callback,
    // a missing reply sets runtime.lastError while the callback runs;
    // without one, the promise rejects.
    sendMessage(message, callback) {
      runtime.sent.push(copy(message));
      const result = (onMessage.listeners.length === 0
        ? Promise.resolve({ error: "Could not establish connection. Receiving end does not exist." })
        : deliver(message, { id: runtime.id })
      ).then((r) =>
        r.responded || r.error
          ? r
          : { error: "The message port closed before a response was received." }
      );

      if (typeof callback !== "function") {
        return result.then((r) => {
          if (r.error) throw new Error(r.error);
          return r.response;
        });
      }
      result.then((r) => {
        runtime.lastError = r.error ? { message: r.error } : undefined;
        try {
          callback(r.response);
        } finally {
          runtime.lastError = undefined;
        }
      });
      return undefined;
    },

    /**
     * Test-only: delivers `message` to the onMessage listeners and resolves
     * with the value passed to sendResponse, or undefined if nobody replied.
     * Waits for async replies from listeners that returned `true`.
     */
    async dispatchMessage(message, sender = { id: runtime.id }) {
      return (await deliver(message, sender)).response;
    },

    /** Test-only: calls the onInstalled listeners, e.g. with { reason: "update" }. */
    dispatchInstalled(details = { reason: "install" }) {
      for (const listener of [...onInstalled.listeners]) listener(copy(details));
    },
  };
  return runtime;
}

/**
 * A `chrome` global with `storage.local` and `runtime`.
 * @param {{ storage?: Parameters<typeof createFakeStorage>[0],
 *           runtime?: Parameters<typeof createFakeRuntime>[0] }} [options]
 */
export function createFakeChrome({ storage, runtime } = {}) {
  return {
    storage: { local: createFakeStorage(storage) },
    runtime: createFakeRuntime(runtime),
  };
}
