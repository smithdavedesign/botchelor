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

// Prompts read and dropped by hand (2026-11-22): no portrait to draw in them, only a scene and a swear word.
const HAND_DROPS = ["his final words:'fuck art.'"];

// A last pass over the picked prompts' words (2026-11-22: the library's first page opened on "an beautiful", "award
// wining" and "portrait panting"). It runs after the pick, so no prompt moves in line: Midjourney flags typed with a
// dash (" —ar 9:16"), weights left without brackets ("friendly:0.8"), DiffusionDB's spaced f-stops ("f 1. 8" →
// "f/1.8"), wrapping quotes and " _ " separators, a wrong "a"/"an", and misspellings the datasets carry. Every entry
// was read in its prompt by hand; artists' names are left as the datasets spelled them.
const SPELLING = {
  foccus: "focus", ilustration: "illustration", illutration: "illustration", upflifting: "uplifting",
  beautifull: "beautiful", beatifull: "beautiful", beutiful: "beautiful", beutifull: "beautiful", beuatiful: "beautiful",
  googles: "goggles", vaporware: "vaporwave", powerfull: "powerful", acrilic: "acrylic", psychodelic: "psychedelic",
  jewerly: "jewelry", potrait: "portrait", portait: "portrait", protrait: "portrait", illuminaition: "illumination",
  tatooes: "tattoos", arstation: "artstation", artgermm: "artgerm", intrincate: "intricate", symetrical: "symmetrical",
  symettrical: "symmetrical", fashonista: "fashionista", gteen: "green", transhumaninsm: "transhumanism",
  gatheing: "gathering", mowhawk: "mohawk", prety: "pretty", oill: "oil", boken: "bokeh", loght: "light",
  ligthing: "lighting", puppils: "pupils", ultrashar: "ultrasharp", vanishhing: "vanishing", relistic: "realistic",
  reallistic: "realistic", hyperarealistic: "hyperrealistic", hyperaralistic: "hyperrealistic",
  confortable: "comfortable", backgroung: "background", straigh: "straight", misterious: "mysterious",
  chairof: "chair of", teathre: "theatre", forboding: "foreboding", cinematogrophy: "cinematography",
  noveau: "nouveau", novuea: "nouveau", aetheral: "ethereal", vilage: "village", metamorphasis: "metamorphosis",
  heterochomia: "heterochromia", colorfull: "colorful", excelent: "excellent", deatiled: "detailed",
  ambitius: "ambitious", sillouete: "silhouette", wiht: "with", turqouise: "turquoise", infront: "in front",
  ablack: "a black", shortbluehair: "short blue hair", extremelydetailed: "extremely detailed",
  awardwinning: "award winning", costumedesign: "costume design", nineteenthcentury: "nineteenth century",
  velvetcloak: "velvet cloak", bioluminiscent: "bioluminescent", ovle: "oval", stres: "stress", beeing: "being",
  cloting: "clothing", forrest: "forest", lillies: "lilies", cantered: "centered", hight: "high",
  kodakchrome: "kodachrome", antropomorphe: "anthropomorphic", githic: "gothic", freckels: "freckles", hiper: "hyper",
};
const PHRASES = {
  "award wining": "award winning", "portrait panting": "portrait painting", "sit an be": "sit and be", "a a": "a",
  "an beautiful": "a beautiful", "an woman": "a woman", "an man": "a man", "an pub": "a pub", "an photo": "a photo",
  "an moody": "a moody", "an bald": "a bald", "an smoke": "a smoke", "an dragonfly": "a dragonfly",
  "an leather": "a leather", "an delightfully": "a delightfully", "an watercolor": "a watercolor",
  "an cinematic": "a cinematic", "an red": "a red", "a ultradetailed": "an ultradetailed", "a award": "an award",
  "a asian": "an asian", "a australopithecus": "an australopithecus", "a old": "an old", "a intricately": "an intricately",
  "a escher": "an escher", "a action": "an action", "a expressionless": "an expressionless", "a ombre": "an ombre",
  "a eye": "an eye", "a angry": "an angry", "a elven": "an elven", "a apartment": "an apartment", "a ice": "an ice",
  "a ancient": "an ancient", "a anthropomorphic": "an anthropomorphic", "a extremely": "an extremely",
  "a igbo": "an igbo", "a elegant": "an elegant", "a arcana": "an arcana", "a women": "a woman",
  "a beautiful women": "a beautiful woman", "three woman": "three women",
};
const wordsRe = (keys) => new RegExp(`\\b(?:${keys.map(escape).join("|")})\\b`, "gi");
const SPELLING_RE = wordsRe(Object.keys(SPELLING));
const PHRASES_RE = wordsRe(Object.keys(PHRASES).sort((a, b) => b.length - a.length));
/** The fix in the found word's case: "Beutiful" → "Beautiful". */
const asFound = (found, fix) => (found[0] === found[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix);
function tidy(prompt) {
  return prompt
    .replace(/^[“"](.*)[”"]$/s, "$1")
    .replace(/\s[—–](?:no\s+\w+|[a-z]+(?:\s+[\d:.]+)?)/gi, "")
    .replace(/\b([a-z]+):\s?\d*\.\d+\b/gi, "$1")
    .replace(/\bf ?\/? ?(\d+)\. (\d)\b/gi, "f/$1.$2")
    .replace(/ _ /g, ", ")
    .replace(PHRASES_RE, (m) => asFound(m, PHRASES[m.toLowerCase()]))
    .replace(SPELLING_RE, (m) => asFound(m, SPELLING[m.toLowerCase()]))
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/[\s,;:]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
  if (HAND_DROPS.some((d) => prompt.includes(d))) { drop("by hand"); continue; }
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
const picked = inLine([...small, ...ddb.slice(0, room)])
  .slice(0, SAMPLE)
  .map((p) => {
    const prompt = tidy(p.prompt);
    return prompt === p.prompt ? p : { ...p, prompt, tags: tagPrompt(prompt) };
  });
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
