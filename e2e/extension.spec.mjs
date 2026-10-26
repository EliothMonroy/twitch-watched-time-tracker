// Loads the real extension, watches a live stream, and checks the watch time
// is saved to chrome.storage.local.
import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, chromium, expect } from "@playwright/test";
import {
  findLiveEnglishChannels,
  openFirstPlayableStream,
} from "./twitch.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Repo files that aren't part of the extension.
const NOT_EXTENSION = new Set([
  ".git",
  ".github",
  "node_modules",
  "e2e",
  "tests",
  "test-results",
  "playwright-report",
]);

const test = base.extend({
  context: async ({ launchOptions }, use) => {
    // Load a copy without node_modules and other non-extension files.
    const extension = mkdtempSync(join(tmpdir(), "twitch-tracker-"));
    for (const name of readdirSync(ROOT)) {
      if (NOT_EXTENSION.has(name)) continue;
      cpSync(join(ROOT, name), join(extension, name), { recursive: true });
    }
    const context = await chromium.launchPersistentContext("", {
      ...launchOptions,
      channel: "chromium",
      locale: "en-US",
      args: [
        ...(launchOptions.args ?? []),
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const [worker] = context.serviceWorkers();
    await use(worker ?? (await context.waitForEvent("serviceworker")));
  },
});

test("watch time is saved for a live stream", async ({
  context,
  serviceWorker,
}, testInfo) => {
  const page = await context.newPage();
  try {
    const candidates = await findLiveEnglishChannels(page);
    expect(candidates, "live English streams on the directory").not.toEqual([]);
    const login = await openFirstPlayableStream(page, candidates);

    const readStats = async () => {
      const { stats } = await serviceWorker.evaluate(() =>
        chrome.storage.local.get("stats")
      );
      return stats?.[login] ?? {};
    };
    // Seconds saved for the channel under a real category (not "Unknown").
    const savedSeconds = async () =>
      Object.entries(await readStats())
        .filter(([category]) => category !== "Unknown")
        .reduce((sum, [, seconds]) => sum + seconds, 0);

    // content.js ticks every 20s: the first tick while playing starts the
    // clock, the next one saves ~20 seconds.
    await expect
      .poll(savedSeconds, {
        message: `seconds saved for ${login} under a known category`,
        timeout: 100_000,
        intervals: [5_000],
      })
      .toBeGreaterThanOrEqual(20);
    console.log(`Saved for ${login}: ${JSON.stringify(await readStats())}`);
  } catch (error) {
    await testInfo.attach("screenshot", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    throw error;
  }
});
