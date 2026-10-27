// Helpers for the checks against live twitch.tv.
import { readFileSync } from "node:fs";

export const TWITCH = "https://www.twitch.tv";

// The extension's own content script, run in the page to resolve the channel
// and category exactly as the extension would.
const CONTENT_SCRIPT = readFileSync(
  new URL("../content.js", import.meta.url),
  "utf8"
);

// "Start watching" overlays on mature or classified streams. The check skips
// those streams.
const MATURE_GATES = [
  '[data-a-target="content-classification-gate-overlay-start-watching-button"]',
  '[data-a-target="player-overlay-mature-accept"]',
].join(", ");

// Cookie consent banner (shown in some regions).
async function acceptConsent(page) {
  const accept = page.locator('[data-a-target="consent-banner-accept"]');
  if (await accept.isVisible()) await accept.click();
}

// Logins of live English streams on the directory page, most viewers first.
export async function findLiveEnglishChannels(page, count = 3) {
  await page.goto(`${TWITCH}/directory/all?sort=VIEWER_COUNT`, {
    waitUntil: "domcontentloaded",
  });
  await acceptConsent(page);
  await page
    .locator('article a[data-a-target="preview-card-channel-link"]')
    .first()
    .waitFor();
  return page.$$eval(
    "article",
    (cards, count) =>
      cards
        .filter((card) => card.querySelector('[aria-label="Tag, English"]'))
        .map((card) =>
          card
            .querySelector('a[data-a-target="preview-card-channel-link"]')
            ?.getAttribute("href")
            ?.split("/")[1]
            ?.toLowerCase()
        )
        .filter(Boolean)
        .slice(0, count),
    count
  );
}

// Opens a live stream and waits until its video plays. Returns null if it
// plays, otherwise why not (mature content gate, or no playback in time).
async function openLiveStream(page, login) {
  await page.goto(`${TWITCH}/${login}`, { waitUntil: "domcontentloaded" });
  await acceptConsent(page);
  try {
    const state = await page.waitForFunction(
      (gates) => {
        if (document.querySelector(gates)) return "mature content gate";
        const video = document.querySelector("video");
        if (video && !video.paused && video.currentTime > 0) return "playing";
        return null;
      },
      MATURE_GATES,
      { timeout: 30_000 }
    );
    const result = await state.jsonValue();
    return result === "playing" ? null : result;
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    return "video did not start playing within 30s";
  }
}

// Opens the first stream among `logins` that plays (skipping mature ones,
// and ones that ended since the directory loaded) and returns its login.
export async function openFirstPlayableStream(page, logins) {
  const skipped = [];
  for (const login of logins) {
    const problem = await openLiveStream(page, login);
    if (!problem) return login;
    skipped.push(`${login}: ${problem}`);
  }
  throw new Error(`No playable stream. ${skipped.join("; ")}`);
}

// Runs content.js in the page and returns what it resolves.
export function resolveLikeExtension(page) {
  return page.evaluate(`(() => {
    ${CONTENT_SCRIPT}
    stopTracking();
    return {
      channel: getChannelName(),
      category: getCategory(),
      playing: Boolean(isPlaying()),
    };
  })()`);
}
