// Fakes for running content.js outside a browser: a clock with manual
// intervals, and a tiny Twitch page (location, window events, DOM lookups).
//
//   const clock = createFakeClock();
//   const page = createFakePage({ pathname: "/xqc" });
//   page.setVideo({ paused: false });
//   loadScripts("content.js", { globals: { chrome, ...clock.globals, ...page.globals } });
//   clock.tick();               // an interval fires 20s after the previous one
//   clock.tick(60_000);         // a throttled interval fires 60s later
//   clock.advance(5_000);       // time passes, no interval fires
//   page.dispatch("pagehide");

/**
 * A clock that only moves when the test says so. `Date.now()` and
 * `new Date()` read it; intervals run only from tick() / runIntervals().
 *
 * @param {object} [options]
 * @param {number} [options.now] Starting time in ms since the epoch.
 */
export function createFakeClock({ now = Date.UTC(2026, 0, 1) } = {}) {
  let time = now;
  let nextId = 1;
  const intervals = new Map();

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [time]));
    }
    static now() {
      return time;
    }
  }

  const clock = {
    Date: FakeDate,
    setInterval(fn, ms = 0, ...args) {
      const id = nextId++;
      intervals.set(id, { fn, ms, args });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    /** Globals to pass to loadScripts(). */
    get globals() {
      return { Date: FakeDate, setInterval: clock.setInterval, clearInterval: clock.clearInterval };
    },
    get now() {
      return time;
    },
    /** Delays of the intervals that are still active. */
    get intervals() {
      return [...intervals.values()].map(({ ms }) => ms);
    },
    /** Moves time forward without running any interval. */
    advance(ms) {
      time += ms;
    },
    /** Runs every active interval once, at the current time. */
    runIntervals() {
      for (const [id, { fn, args }] of [...intervals]) {
        if (intervals.has(id)) fn(...args);
      }
    },
    /**
     * Moves time forward by `ms`, then runs the intervals: one interval firing
     * `ms` after the previous one. Defaults to the delay of the first active
     * interval (an on-time tick); pass more to mimic a throttled tab.
     */
    tick(ms = clock.intervals[0] ?? 0) {
      clock.advance(ms);
      clock.runIntervals();
    },
  };
  return clock;
}

/** A minimal element: text content and attributes. */
export function createElement({ text = "", attributes = {}, ...props } = {}) {
  return {
    textContent: text,
    getAttribute: (name) => (Object.hasOwn(attributes, name) ? attributes[name] : null),
    ...props,
  };
}

/**
 * A fake Twitch page. querySelector / querySelectorAll look up exact selector
 * strings registered with setElements() (no real CSS matching).
 *
 * @param {object} [options]
 * @param {string} [options.pathname] Starting `location.pathname`.
 * @param {string} [options.origin] `location.origin`.
 */
export function createFakePage({ pathname = "/", origin = "https://www.twitch.tv" } = {}) {
  const elements = new Map();
  const listeners = new Map();

  const location = { pathname, origin };

  const document = {
    querySelector: (selector) => elements.get(selector)?.[0] ?? null,
    querySelectorAll: (selector) => [...(elements.get(selector) ?? [])],
  };

  const window = {
    location,
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      if (!list.includes(fn)) list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
  };

  const page = {
    document,
    window,
    location,
    /** Globals to pass to loadScripts(). Includes the real URL. */
    get globals() {
      return { document, window, URL };
    },
    /** Elements returned for `selector` (replaces any earlier ones). */
    setElements(selector, list) {
      if (list.length) elements.set(selector, list);
      else elements.delete(selector);
    },
    /** Puts a <video> on the page, or removes it with `null`. */
    setVideo(video) {
      page.setElements("video", video ? [createElement(video)] : []);
    },
    /** Number of listeners registered for an event type. */
    listenerCount: (type) => (listeners.get(type) ?? []).length,
    /** Calls the listeners for `type` with a minimal event object. */
    dispatch(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type });
    },
  };
  return page;
}
