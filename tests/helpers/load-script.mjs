// Loads the extension's classic scripts (utils.js, background.js, ...) into a
// fresh node:vm context so tests can call their top-level functions.
//
//   const env = loadScripts("utils.js");
//   const formatTimeSmart = env.get("formatTimeSmart");
//
//   const chrome = createFakeChrome(); // from ./fake-chrome.mjs
//   const bg = loadScripts("background.js", { globals: { chrome }, importScripts: true });
//
// Each call gets its own context, so scripts never share state between tests.
// Only the globals you pass in exist (plus `console`), so a missing stub fails
// loudly with a ReferenceError. Timers, `document`, `window`, etc. are not
// provided: pass real or fake ones in `globals` when a script needs them.
//
// Caveats:
// - Top-level `const`/`let` (e.g. NON_CHANNEL_PATHS) are not properties of
//   `env.context`; use `env.get(name)`, which works for any top-level name.
// - Values created inside the context come from another realm: their
//   prototypes (Object.prototype, Array.prototype, Set, ...) differ from the
//   test's, so `instanceof` and `assert.deepStrictEqual` against literals made
//   in the test can fail even when the data matches. Compare plain data (e.g.
//   after a JSON round trip) or check fields directly.
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// The extension root (where manifest.json lives). Script paths are relative to it.
export const EXTENSION_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {string | string[]} files Script paths relative to the extension root,
 *   run in order in the same context (like several <script> tags).
 * @param {object} [options]
 * @param {object} [options.globals] Globals for the scripts (e.g. `chrome`,
 *   `setTimeout`, `document`). Copied onto the context's global object.
 * @param {boolean} [options.importScripts] Define a synchronous
 *   `importScripts(...paths)` like a service worker has. Paths are relative to
 *   the extension root, as for background.js in the manifest.
 * @returns {{
 *   context: object,
 *   get: (name: string) => any,
 *   run: (code: string) => any,
 *   loaded: string[],
 * }} `context` is the global object; `get(name)` reads any top-level binding;
 *   `run(code)` evaluates code in the context; `loaded` lists every script run,
 *   including ones pulled in by importScripts.
 */
export function loadScripts(files, { globals = {}, importScripts = false } = {}) {
  const context = vm.createContext({ console, ...globals });
  const loaded = [];

  const runFile = (file) => {
    const path = join(EXTENSION_ROOT, file);
    const code = readFileSync(path, "utf8");
    loaded.push(relative(EXTENSION_ROOT, path));
    vm.runInContext(code, context, { filename: path });
  };

  if (importScripts) {
    context.importScripts = (...paths) => paths.forEach(runFile);
  }

  for (const file of [files].flat()) runFile(file);

  return {
    context,
    get(name) {
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        throw new TypeError(`get() expects an identifier, got ${JSON.stringify(name)}`);
      }
      return vm.runInContext(name, context);
    },
    run: (code) => vm.runInContext(code, context),
    loaded,
  };
}
