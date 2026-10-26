// Checks that manifest.json is valid JSON and that every file referenced by
// the manifest and by local <script src> tags in the extension pages exists.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const errors = [];

function requireFile(path, from, detail = "") {
  if (!existsSync(path)) errors.push(`${from}: missing file "${path}"${detail}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
} catch (err) {
  console.error(`::error::manifest.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

const refs = new Set([
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
  manifest.action?.default_popup,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean));

for (const ref of refs) requireFile(ref, "manifest.json");

// Extension pages: the popup plus standalone pages opened by URL.
const pages = [manifest.action?.default_popup, "dashboard.html"].filter(Boolean);

for (const page of pages) {
  if (!existsSync(page)) continue; // already reported above if referenced
  const html = readFileSync(page, "utf8");
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) {
    if (/^(https?:)?\/\//.test(src)) continue; // remote scripts aren't local files
    requireFile(join(dirname(page), src), page, ` (from <script src="${src}">)`);
  }
}

if (errors.length) {
  for (const e of errors) console.error(`::error::${e}`);
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`OK: manifest.json is valid; ${refs.size} manifest files and all page scripts exist.`);
