import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), "ai-stack", "open_prompts");
const FILES = ["pickapic.json", "midjourney.json", "open-image-preferences.json", "diffusiondb.json"];
const OK_LICENSE = /^(CC0|Apache-2\.0|MIT)/i;
// Belt-and-suspenders beyond their underage filter: any hint of youth is dropped.
const YOUNG = /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|loli\w*|child\w*|kid\w*|under.?age|minor\w*|babysit\w*|cheerlead\w*|braces|pigtail\w*|barely|daughter|niece|son|nephew|baby|toddler|infant|youth|juvenile|adolescent|preteen|highschool)\b/i;
// Drop anything that isn't a clean photoreal portrait of an adult person.
const NOT_PORTRAIT = /\b(anime|manga|cartoon|hentai|waifu|chibi|horse|dog|cat|landscape|mountain|forest|building|car|animal|creature|robot|logo|graphic design|abstract|pokemon|dragon|monster|furry|elf|orc|goblin)\b/i;
const PERSON = /\b(woman|man|lady|person|portrait|female|male|guy|gentleman|model)\b/i;

const seen = new Set();
const out = [];
for (const f of FILES) {
  let rows;
  try { rows = JSON.parse(readFileSync(join(DIR, f), "utf8")); } catch { continue; }
  for (const r of rows) {
    const license = String(r.license ?? "");
    const prompt = String(r.prompt ?? "").replace(/\s+/g, " ").trim();
    if (!OK_LICENSE.test(license)) continue;
    if (prompt.length < 12 || prompt.length > 180) continue;
    if (!PERSON.test(prompt)) continue;
    if (YOUNG.test(prompt) || NOT_PORTRAIT.test(prompt)) continue;
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ prompt, source: r.source, license });
  }
}
// Shuffle, cap to keep the client bundle reasonable (each prompt ~110 chars).
for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
const picked = out.slice(0, 600);
console.log(`kept ${out.length} clean adult-portrait prompts; bundling ${picked.length}`);
console.log("license mix:", Object.entries(picked.reduce((m, r) => ((m[r.license] = (m[r.license] || 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(" "));
// The shape the picker reads (app/after-dark/studio/[id]/inspiration.json): a note plus the prompts.
const note = "Openly-licensed (CC0-1.0 / Apache-2.0 / MIT) adult portrait prompts, hard-filtered (person only; young-words and non-portrait dropped) from ~/ai-stack/open_prompts. Inspiration only: the user picks and edits; never auto-applied. See docs/after-dark.md.";
writeFileSync(process.argv[2], JSON.stringify({ note, prompts: picked.map((r) => r.prompt) }, null, 0));
