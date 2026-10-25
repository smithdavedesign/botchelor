// Builds the /prompts library seed (lib/prompts-library.json) from the open image-prompt dump in ~/ai-stack/open_prompts.
//   node scripts/build-prompts-library.mjs [path/to/combined.csv]
// Deterministic: the same CSV always gives the same 2,000 prompts. Civitai rows are left out (unclear licence, and its
// image URLs aren't ours to hotlink); every kept row carries its source and licence. Every prompt must pass the show's
// own bar (lib/safety.ts checkShowText: no minors, nothing sexual, no innuendo, no real people), After Dark's stricter
// age and theme lines (checkAdultText: catches "about 30" ages and the like), plus the youth-word
// list (lib/prompt-library-rules.ts YOUNG), because the footer link sits on every page. Prompts about a picture that
// already exists ("the photo shows", an edit, a question, a CLIP caption) go too: there's no picture here. Each kept
// prompt carries its tags (tagPrompt: the Studio's own option ids, plus a few style and subject facets).
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { imageReference, SENSITIVE, tagPrompt, YOUNG } from "../lib/prompt-library-rules.ts";
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

/** FNV-1a over the prompt with the seed mixed in: a fixed place in line per prompt, so dropping one never reorders the rest. */
function rank(text) {
  let h = 0x811c9dc5 ^ SEED;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// Real people the word lists don't know (scripts/vet-prompt-people.mjs asks the local model which names a prompt holds
// and adds them here): a prompt naming one is dropped. Artists named for a style aren't on it.
const PEOPLE_FILE = new URL("./data/prompt-people.txt", import.meta.url);
const people = readFileSync(PEOPLE_FILE, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PEOPLE = people.length ? new RegExp(`\\b(?:${people.map(escape).join("|")})\\b`, "i") : null;

const [header, ...rows] = parseCsv(readFileSync(SRC, "utf8"));
const col = (name) => header.indexOf(name);
const [iSource, iPrompt] = [col("source"), col("prompt")];
const seen = new Set();
const kept = [];
const dropped = {};
const imageRefs = [];
const drop = (why) => (dropped[why] = (dropped[why] ?? 0) + 1);
for (const r of rows) {
  const source = r[iSource];
  const license = LICENSES[source];
  if (!license) { drop(source === "civitai" ? "civitai" : "unknown source"); continue; }
  const prompt = cleanPrompt(r[iPrompt] ?? "");
  if (prompt.length < 40 || prompt.length > 400) { drop("length"); continue; }
  if (YOUNG.test(prompt) || SENSITIVE.test(prompt) || !checkShowText({ prompt }).ok || !checkAdultText({ prompt }).ok) { drop("safety"); continue; }
  if (PEOPLE?.test(prompt)) { drop("real person"); continue; }
  const ref = imageReference(prompt);
  if (ref) { drop("image reference"); if (imageRefs.length < 400) imageRefs.push(`[${ref}] ${prompt}`); continue; }
  const key = prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (seen.has(key)) { drop("duplicate"); continue; }
  seen.add(key);
  kept.push({ prompt, source, license, tags: tagPrompt(prompt) });
}

// DiffusionDB is 93% of the dump, so a plain sample would be almost all DiffusionDB: every prompt that survives from
// the small sets goes in, DiffusionDB fills the rest, then the lot is put in rank order so a page mixes them.
const inLine = (xs) => [...xs].sort((a, b) => rank(a.prompt) - rank(b.prompt) || (a.prompt < b.prompt ? -1 : 1));
const isDiffusionDb = (p) => p.source.startsWith("diffusiondb");
const small = kept.filter((p) => !isDiffusionDb(p));
const ddb = inLine(kept.filter(isDiffusionDb));
const room = Math.max(0, SAMPLE - small.length);
const picked = inLine([...small, ...ddb.slice(0, room)]).slice(0, SAMPLE);
// The prompts next in line, for scripts/vet-prompt-people.mjs: every small-set prompt, then DiffusionDB in pick order.
if (process.env.VET_OUT) writeFileSync(process.env.VET_OUT, JSON.stringify([...small, ...ddb.slice(0, room + 1500)].map((p) => p.prompt)));
writeFileSync(OUT, JSON.stringify(picked) + "\n");

const mix = picked.reduce((m, p) => ((m[p.source] = (m[p.source] ?? 0) + 1), m), {});
console.log(`${rows.length} rows; ${kept.length} kept; wrote ${picked.length} to lib/prompts-library.json`);
console.log("dropped:", dropped);
console.log("sources:", mix);
const withStudio = picked.filter((p) => p.tags.some((t) => !t.includes(":"))).length;
const counts = picked.flatMap((p) => p.tags).reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
console.log(`tagged: ${withStudio} of ${picked.length} with a Studio tag; top:`, Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25));
console.log("image references dropped, a sample:", imageRefs.filter((_, i) => i % 25 === 0).slice(0, 12));
