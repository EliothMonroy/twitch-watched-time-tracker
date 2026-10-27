import js from "@eslint/js";
import globals from "globals";

// Top-level helpers defined in utils.js and shared with the scripts that load
// it (popup.html and dashboard.html via <script>, background.js via
// importScripts).
const utilsGlobals = {
  NON_CHANNEL_PATHS: "readonly",
  isNonChannelPath: "readonly",
  formatTimeSmart: "readonly",
  normalizeStats: "readonly",
};

export default [
  {
    // Vendored, minified Chart.js libraries.
    ignores: ["chart.umd.js", "chartjs-plugin-datalabels@2.js"],
  },

  js.configs.recommended,

  // Extension scripts are classic scripts (not modules) that share globals.
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "script" },
  },

  // Page scripts and the content script run in a normal browser window.
  {
    files: ["**/*.js"],
    ignores: ["background.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },

  // utils.js only defines helpers for other scripts, so its top-level
  // definitions look unused here. Still check unused locals inside functions.
  {
    files: ["utils.js"],
    rules: {
      "no-unused-vars": ["error", { vars: "local" }],
    },
  },

  {
    files: ["popup/popup.js"],
    languageOptions: { globals: utilsGlobals },
  },

  {
    files: ["dashboard.js"],
    languageOptions: {
      globals: {
        ...utilsGlobals,
        // From chart.umd.js and chartjs-plugin-datalabels@2.js.
        Chart: "readonly",
        ChartDataLabels: "readonly",
      },
    },
  },

  // MV3 service worker (no window or document); loads utils.js with
  // importScripts.
  {
    files: ["background.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.webextensions,
        ...utilsGlobals,
      },
    },
  },

  // Node tooling (this config and scripts/).
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: globals.node,
    },
  },

  // Playwright checks: Node, plus browser globals for code that runs in the
  // page (page.evaluate).
  {
    files: ["e2e/**/*.mjs"],
    languageOptions: { globals: globals.browser },
  },
];
