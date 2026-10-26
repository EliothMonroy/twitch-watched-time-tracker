// Minimal browser fakes for the popup and dashboard scripts: a document built
// from the real HTML page, dialogs (prompt/alert/confirm), location, a manual
// setTimeout, URL blob helpers, matchMedia and a Chart.js stand-in. Only what
// popup.js and dashboard.js use is implemented; anything else is undefined
// and fails loudly.
//
//   const document = createFakeDocument("popup/popup.html");
//   const dialogs = createFakeDialogs({ prompts: ["xqc", "", "90"] });
//   loadScripts(["utils.js", "popup/popup.js"], {
//     globals: { chrome, document, ...dialogs.globals },
//   });
//   await document.dispatch("DOMContentLoaded");
//   await document.getElementById("set-initial").click();
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXTENSION_ROOT } from "./load-script.mjs";

// Tags that never have a closing tag.
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"]);

export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.id = "";
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.type = "";
    this.value = "";
    this.href = "";
    this.download = "";
    this.files = [];
    this.classes = new Set();
    this.listeners = {};
    this.clickCount = 0;
    this._text = "";

    const classes = this.classes;
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    };
  }

  get className() {
    return [...this.classes].join(" ");
  }

  set className(value) {
    this.classes.clear();
    for (const name of String(value).split(/\s+/)) if (name) this.classes.add(name);
  }

  // Own text plus the children's text, like the DOM's textContent.
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.#removeChildren();
    this._text = String(value);
  }

  // Writes are recorded, not parsed: tests can assert untrusted text never
  // goes through innerHTML. Clearing with "" works like the DOM.
  set innerHTML(value) {
    this.ownerDocument.innerHTMLWrites.push({ element: this, value: String(value) });
    this.#removeChildren();
    this._text = "";
  }

  appendChild(child) {
    if (child.parentElement) {
      const siblings = child.parentElement.children;
      siblings.splice(siblings.indexOf(child), 1);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  /** Test-only: calls the listeners for `type`; resolves after async ones finish. */
  dispatch(type, event = {}) {
    const results = (this.listeners[type] ?? []).map((listener) =>
      listener({ type, target: this, preventDefault() {}, ...event })
    );
    return Promise.all(results);
  }

  click() {
    this.clickCount++;
    return this.dispatch("click");
  }

  getContext(kind) {
    return { canvas: this, kind };
  }

  #removeChildren() {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
}

/**
 * A fake `document` whose <body> holds the elements of an extension page
 * (tags, ids, classes, `hidden`, `type`; not text or other attributes).
 * Elements made with createElement() are kept in `created`.
 *
 * @param {string} page HTML path relative to the extension root.
 */
export function createFakeDocument(page) {
  const document = {
    listeners: {},
    created: [],
    innerHTMLWrites: [],
    body: null,
    getElementById(id) {
      const search = (el) => (el.id === id ? el : el.children.map(search).find(Boolean) ?? null);
      return search(document.body);
    },
    createElement(tagName) {
      const element = new FakeElement(tagName, document);
      document.created.push(element);
      return element;
    },
    addEventListener(type, listener) {
      (document.listeners[type] ??= []).push(listener);
    },
    /** Test-only: calls the document's listeners for `type` (e.g. "DOMContentLoaded"). */
    dispatch(type) {
      return Promise.all((document.listeners[type] ?? []).map((listener) => listener({ type })));
    },
  };

  document.body = new FakeElement("body", document);
  const html = readFileSync(join(EXTENSION_ROOT, page), "utf8");
  const body = html.slice(html.search(/<body[\s>]/i));
  const stack = [document.body];
  for (const [, closing, tag, attrs, selfClosing] of body.matchAll(/<(\/?)([a-z][\w-]*)([^>]*?)(\/?)>/gi)) {
    const name = tag.toLowerCase();
    if (name === "body") continue;
    if (closing) {
      const i = stack.findLastIndex((el) => el.tagName === name.toUpperCase());
      if (i > 0) stack.length = i;
      continue;
    }
    const element = new FakeElement(name, document);
    for (const [, attr, value = ""] of attrs.matchAll(/([\w-]+)(?:=["']([^"']*)["'])?/g)) {
      if (attr === "id") element.id = value;
      else if (attr === "class") element.className = value;
      else if (attr === "hidden") element.hidden = true;
      else if (attr === "type") element.type = value;
    }
    stack.at(-1).appendChild(element);
    if (!selfClosing && !VOID_TAGS.has(name)) stack.push(element);
  }
  return document;
}

/**
 * Fake prompt/confirm/alert/location. `prompts` and `confirms` are answers
 * returned in order (null = Cancel for prompt; prompts default to null and
 * confirms to false once used up). Every call is logged.
 */
export function createFakeDialogs({ prompts = [], confirms = [] } = {}) {
  const log = { prompts: [], confirms: [], alerts: [], reloads: 0 };
  const globals = {
    prompt(message) {
      log.prompts.push(message);
      return prompts.length ? prompts.shift() : null;
    },
    confirm(message) {
      log.confirms.push(message);
      return confirms.length ? confirms.shift() : false;
    },
    alert(message) {
      log.alerts.push(String(message));
    },
    location: {
      reload() {
        log.reloads++;
      },
    },
  };
  return { globals, log };
}

/** A setTimeout that only runs callbacks when the test calls runAll(). */
export function createManualTimers() {
  const pending = [];
  return {
    pending,
    setTimeout(fn, delay = 0) {
      pending.push({ fn, delay });
      return pending.length;
    },
    runAll() {
      for (const { fn } of pending.splice(0)) fn();
    },
  };
}

/** A `URL` global with createObjectURL/revokeObjectURL that log their calls. */
export function createFakeURL() {
  const log = { created: [], revoked: [] };
  return {
    log,
    URL: {
      createObjectURL(blob) {
        const url = `blob:fake/${log.created.length + 1}`;
        log.created.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) {
        log.revoked.push(url);
      },
    },
  };
}

/** A `window` with matchMedia; `matches` maps media queries to booleans. */
export function createFakeWindow({ matches = {} } = {}) {
  return {
    matchMedia: (query) => ({ media: query, matches: Boolean(matches[query]) }),
  };
}

/**
 * A Chart.js stand-in that records charts instead of drawing them.
 * `Chart.instances` lists every chart made; `Chart.registered` the plugins.
 */
export function createFakeChart() {
  return class Chart {
    static instances = [];
    static registered = [];

    static register(...plugins) {
      Chart.registered.push(...plugins);
    }

    constructor(context, config) {
      this.canvas = context.canvas;
      this.config = config;
      this.destroyed = false;
      Chart.instances.push(this);
    }

    destroy() {
      this.destroyed = true;
    }
  };
}
