// Checks against live twitch.tv (see README). Run with `npm run test:twitch`.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.mjs",
  timeout: 4 * 60_000,
  // Live pages are flaky (streams end, raids); retry once in CI.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    // Full Chromium (Chrome for Testing): plays Twitch's H.264 video and can
    // load unpacked extensions, also when headless.
    channel: "chromium",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
