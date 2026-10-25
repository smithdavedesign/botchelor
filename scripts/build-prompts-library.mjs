// Builds the /prompts library seed (lib/prompts-library.json) from the open image-prompt dump in ~/ai-stack/open_prompts.
//   node scripts/build-prompts-library.mjs [path/to/combined.csv]
// Deterministic: the same CSV always gives the same 2,000 prompts. Civitai rows are left out (unclear licence, and its
// image URLs aren't ours to hotlink); every kept row carries its source and licence. Every prompt must pass the show's
// own bar (lib/safety.ts checkShowText: no minors, nothing sexual, no innuendo, no real people), After Dark's stricter
// age and theme lines (checkAdultText: catches "about 30" ages and the like), plus the youth-word
// list the Studio's Inspiration set uses (scripts/filter-inspiration-prompts.mjs), because the footer link sits on
// every page.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkAdultText, checkShowText } from "../lib/safety.ts";

const SRC = process.argv[2] ?? join(homedir(), "ai-stack", "open_prompts", "combined.csv");
const OUT = new URL("../lib/prompts-library.json", import.meta.url);
const SAMPLE = 2000;
const SEED = 20261025;

const LICENSES = {
  diffusiondb: "CC0-1.0",
  "diffusiondb-large": "CC0-1.0",
  midjourney: "Apache-2.0",
  "open-image-preferences": "Apache-2.0",
  pickapic: "MIT",
};
const YOUNG = /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|loli\w*|child\w*|kid\w*|under.?age|minor\w*|babysit\w*|cheerlead\w*|braces|pigtail\w*|barely|daughter|niece|son|nephew|baby|toddler|infant|youth|juvenile|adolescent|preteen|highschool)\b/i;
// Words the safety list doesn't treat as sexual but a public library shouldn't carry.
const EXTRA = /\b(nsfw|nude\w*|naked|topless|lingerie|bikini|sexy|seductive|erotic\w*|busty|cleavage|swimsuit|thighs?|alluring|sheer|corset|innocent|yandere|bdsm|fetish\w*|gore|bloody)\b/i;

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

/** One line of plain words: SD weights "(word:1.5)" → "word", Midjourney flags ("--ar 9:16") and stray brackets gone. */
function cleanPrompt(raw) {
  return raw
    .replace(/\s--[a-z]+(?:\s+[\w:.]+)?/gi, " ")
    .replace(/[([]([^()[\]]*?):\s*-?\d+(?:\.\d+)?[)\]]/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]+/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    // Midjourney's multi-prompt weights ("portrait::1.5", DiffusionDB's "portrait : :") once the spaces are gone.
    .replace(/::\s*-?\d*(?:\.\d+)?/g, ", ")
    // DiffusionDB's tokenised spacing: "3 0 years" → "30 years", "8 k" / "3 d" / "1940 s" → "8k" / "3d" / "1940s", "close - up" → "close-up".
    .replace(/\b(\d) (?=\d\b)/g, "$1")
    .replace(/\b(\d+) ([kds])\b/gi, "$1$2")
    .replace(/(\w) - (\w)/g, "$1-$2")
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/^[\s,.;:]+|[\s,;:]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** mulberry32: a small seeded generator, so the sample is the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [header, ...rows] = parseCsv(readFileSync(SRC, "utf8"));
const col = (name) => header.indexOf(name);
const [iSource, iPrompt] = [col("source"), col("prompt")];
const seen = new Set();
const kept = [];
const dropped = {};
const drop = (why) => (dropped[why] = (dropped[why] ?? 0) + 1);
for (const r of rows) {
  const source = r[iSource];
  const license = LICENSES[source];
  if (!license) { drop(source === "civitai" ? "civitai" : "unknown source"); continue; }
  const prompt = cleanPrompt(r[iPrompt] ?? "");
  if (prompt.length < 40 || prompt.length > 400) { drop("length"); continue; }
  if (YOUNG.test(prompt) || EXTRA.test(prompt) || !checkShowText({ prompt }).ok || !checkAdultText({ prompt }).ok) { drop("safety"); continue; }
  const key = prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (seen.has(key)) { drop("duplicate"); continue; }
  seen.add(key);
  kept.push({ prompt, source, license });
}

// DiffusionDB is 93% of the dump, so a plain sample would be almost all DiffusionDB: every prompt that survives from
// the small sets goes in, DiffusionDB fills the rest, then the lot is shuffled so a page mixes them.
const rand = rng(SEED);
const shuffle = (xs) => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};
const isDiffusionDb = (p) => p.source.startsWith("diffusiondb");
const small = kept.filter((p) => !isDiffusionDb(p));
const fill = shuffle(kept.filter(isDiffusionDb)).slice(0, Math.max(0, SAMPLE - small.length));
const picked = shuffle([...small, ...fill]).slice(0, SAMPLE);
writeFileSync(OUT, JSON.stringify(picked) + "\n");

const mix = picked.reduce((m, p) => ((m[p.source] = (m[p.source] ?? 0) + 1), m), {});
console.log(`${rows.length} rows; ${kept.length} kept; wrote ${picked.length} to lib/prompts-library.json`);
console.log("dropped:", dropped);
console.log("sources:", mix);
