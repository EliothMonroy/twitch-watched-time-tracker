import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadScripts } from "./helpers/load-script.mjs";

const utils = loadScripts("utils.js");
const NON_CHANNEL_PATHS = utils.get("NON_CHANNEL_PATHS");
const isNonChannelPath = utils.get("isNonChannelPath");
const formatTimeSmart = utils.get("formatTimeSmart");
const normalizeStats = utils.get("normalizeStats");

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

describe("formatTimeSmart", () => {
  const cases = [
    [0, "0m"],
    [1, "0m"],
    [59, "0m"],
    [59.9, "0m"],
    [MINUTE, "1m"],
    [119, "1m"],
    [59 * MINUTE, "59m"],
    [HOUR, "1h"],
    [HOUR + MINUTE, "1h 1m"],
    [DAY - 1, "23h 59m"],
    [DAY, "1d"],
    [DAY + HOUR + MINUTE, "1d 1h 1m"],
    [DAY + MINUTE, "1d 1m"],
    [MONTH - 1, "29d 23h 59m"],
    [MONTH, "1mo"],
    [MONTH + DAY, "1mo 1d"],
    [2 * MONTH + 3 * HOUR + 4 * MINUTE + 5, "2mo 3h 4m"],
    // There is no year unit: 365 days is 12 months and 5 days.
    [365 * DAY, "12mo 5d"],
  ];
  for (const [seconds, expected] of cases) {
    test(`${seconds}s -> ${expected}`, () => {
      assert.equal(formatTimeSmart(seconds), expected);
    });
  }

  test("treats negative, non-finite and non-number input as 0m", () => {
    for (const value of [-1, -HOUR, NaN, Infinity, -Infinity, "120", null, undefined, {}]) {
      assert.equal(formatTimeSmart(value), "0m", `formatTimeSmart(${String(value)})`);
    }
  });
});

describe("isNonChannelPath", () => {
  test("matches every listed path", () => {
    for (const path of NON_CHANNEL_PATHS) assert.equal(isNonChannelPath(path), true, path);
  });

  test("list entries are already trimmed and lowercase", () => {
    for (const path of NON_CHANNEL_PATHS) assert.equal(path, path.trim().toLowerCase());
  });

  test("ignores case and surrounding whitespace", () => {
    for (const path of ["Videos", "DIRECTORY", " settings ", "\tModerator\n", " P "]) {
      assert.equal(isNonChannelPath(path), true, JSON.stringify(path));
    }
  });

  test("returns false for channel names and near misses", () => {
    for (const name of ["xqc", "shroud", "pokimane", "video", "videos2", "directory/game", "", " "]) {
      assert.equal(isNonChannelPath(name), false, JSON.stringify(name));
    }
  });

  test("returns false for non-strings", () => {
    for (const value of [null, undefined, 0, 1, true, ["videos"], { videos: 1 }]) {
      assert.equal(isNonChannelPath(value), false, String(value));
    }
  });
});

describe("normalizeStats", () => {
  // normalizeStats returns null-prototype objects from the vm realm. Check
  // that, then compare as plain data. JSON.parse keeps a "__proto__" key as
  // an own property, and so does a computed ["__proto__"] key in `expected`.
  function assertStats(actual, expected) {
    assert.notEqual(actual, null);
    assert.equal(Object.getPrototypeOf(actual), null);
    for (const categories of Object.values(actual)) {
      assert.equal(Object.getPrototypeOf(categories), null);
    }
    assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);
  }

  test("returns a copy of valid data", () => {
    const input = { xqc: { "Just Chatting": 120, Gaming: 0 }, shroud: { Valorant: 3600.5 } };
    assertStats(normalizeStats(input), input);
  });

  test("accepts empty stats and channels with no categories", () => {
    assertStats(normalizeStats({}), {});
    assertStats(normalizeStats({ xqc: {} }), { xqc: {} });
  });

  test("trims and lowercases channel keys and sums duplicates per category", () => {
    const input = {
      " xQc ": { "Just Chatting": 10 },
      XQC: { "Just Chatting": 5, Gaming: 1 },
      xqc: { Gaming: 2 },
      Shroud: { Valorant: 7 },
    };
    assertStats(normalizeStats(input), {
      xqc: { "Just Chatting": 15, Gaming: 3 },
      shroud: { Valorant: 7 },
    });
  });

  test("keeps category names as they are", () => {
    assertStats(normalizeStats({ xqc: { gaming: 1, Gaming: 2 } }), { xqc: { gaming: 1, Gaming: 2 } });
  });

  test("rejects data that isn't a plain object", () => {
    for (const value of [null, undefined, 0, 42, "stats", true, [], [{ xqc: { Gaming: 1 } }]]) {
      assert.equal(normalizeStats(value), null, JSON.stringify(value));
    }
  });

  test("rejects channels whose value isn't a plain object", () => {
    for (const value of [null, 5, "Gaming", true, [], [1, 2]]) {
      assert.equal(normalizeStats({ xqc: value }), null, JSON.stringify(value));
    }
  });

  test("rejects empty channel names", () => {
    assert.equal(normalizeStats({ "": { Gaming: 1 } }), null);
    assert.equal(normalizeStats({ "   ": { Gaming: 1 } }), null);
  });

  test("rejects negative, non-finite and non-number seconds", () => {
    for (const seconds of [-1, -0.5, NaN, Infinity, -Infinity, "10", null, undefined, true, {}, [10]]) {
      assert.equal(normalizeStats({ xqc: { Gaming: seconds } }), null, String(seconds));
    }
  });

  test("rejects the whole input when only one value is bad", () => {
    assert.equal(normalizeStats({ xqc: { Gaming: 1 }, shroud: { Valorant: -1 } }), null);
  });

  test('stores a "__proto__" key as data', () => {
    const input = JSON.parse('{"__proto__": {"Gaming": 5}, "xqc": {"__proto__": 7}}');
    const result = normalizeStats(input);
    assertStats(result, { ["__proto__"]: { Gaming: 5 }, xqc: { ["__proto__"]: 7 } });
    assert.ok(Object.hasOwn(result, "__proto__"));
    assert.equal(result.xqc.__proto__, 7);
  });

  test('normalizes " __PROTO__ " to a "__proto__" data key', () => {
    const result = normalizeStats({ " __PROTO__ ": { Gaming: 5 } });
    assertStats(result, { ["__proto__"]: { Gaming: 5 } });
  });

  test("doesn't mutate its input", () => {
    const input = { " xQc ": { Gaming: 1 }, xqc: { Gaming: 2 } };
    const before = structuredClone(input);
    const result = normalizeStats(input);
    assert.deepStrictEqual(input, before);
    assert.notEqual(result.xqc, input.xqc);
  });
});
