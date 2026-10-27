// Checks that the twitch.tv markup content.js relies on is still there.
import { test, expect } from "@playwright/test";
import {
  TWITCH,
  findLiveEnglishChannels,
  openFirstPlayableStream,
  resolveLikeExtension,
} from "./twitch.mjs";

test.describe.configure({ mode: "serial" });

let candidates = [];
let login = null;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  candidates = await findLiveEnglishChannels(page);
  await page.close();
});

test("live stream: video plays and category resolves", async ({ page }) => {
  expect(candidates, "live English streams on the directory").not.toEqual([]);
  login = await openFirstPlayableStream(page, candidates);

  // The stream info can render after the video starts. content.js reads it
  // every 20s, so allow the same time.
  // "Unknown" means neither stream-game-link nor GameLink was found.
  await expect
    .poll(async () => (await resolveLikeExtension(page)).category, {
      message: "category resolved by content.js",
      timeout: 20_000,
    })
    .not.toBe("Unknown");

  const resolved = await resolveLikeExtension(page);
  expect(resolved.playing, "video element is playing").toBe(true);
  expect(resolved.channel).toBe(login);
  expect(resolved.category).not.toContain("Streaming Together");
  console.log(`Checked live stream ${login} (${resolved.category})`);
});

// Path of the latest VOD of `login` as /videos/<id> (where content.js has to
// find the channel on the page), or null if it has none.
async function latestVod(page, login) {
  await page.goto(`${TWITCH}/${login}/videos?filter=archives&sort=time`, {
    waitUntil: "domcontentloaded",
  });
  // VOD links are /videos/<id>, or /<login>/video/<id> on a newer layout.
  const vod = page
    .locator('a[href^="/videos/"], a[href*="/video/"]')
    .filter({ has: page.locator("img") })
    .first();
  try {
    await vod.waitFor({ timeout: 15_000 });
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    return null;
  }
  const { pathname } = new URL(await vod.getAttribute("href"), TWITCH);
  const id = pathname.match(/\/videos?\/(\d+)/)?.[1];
  return id ? `/videos/${id}` : null;
}

test("VOD: content.js finds the channel", async ({ page }) => {
  expect(login, "a live stream was found").toBeTruthy();
  // Some channels don't keep VODs; then try the other directory picks.
  let channel = null;
  let vodPath = null;
  for (const candidate of [login, ...candidates.filter((c) => c !== login)]) {
    vodPath = await latestVod(page, candidate);
    if (vodPath) {
      channel = candidate;
      break;
    }
  }
  expect(vodPath, `a VOD from one of: ${candidates.join(", ")}`).toBeTruthy();

  // On /videos/<id> content.js finds the channel on the page (see
  // getVodChannel() in content.js), whichever layout Twitch serves.
  await page.goto(`${TWITCH}${vodPath}`, { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => (await resolveLikeExtension(page)).channel, {
      message: `channel resolved by content.js on ${vodPath}`,
      timeout: 30_000,
    })
    .toBe(channel);
  console.log(`Checked VOD ${vodPath} (${channel})`);
});
