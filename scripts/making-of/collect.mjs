#!/usr/bin/env node
/**
 * The making-of page from git (app/making-of). Run from the repo root with origin/main fetched:
 *
 *   node scripts/making-of/collect.mjs events <out.json>   every screenshot version with its PR, day and safety, for picking
 *   node scripts/making-of/collect.mjs page                 picks.json → public/making-of/*.webp + lib/making-of-data.json
 *
 * `page` reads each picked screenshot as it was at the commit that brought it (git show <sha>:<path>), so a picture's
 * day is the day it was taken; the merged PRs and their days come from GitHub's list, how many Claude Code wrote from its search.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { openPageSafe, pacificDay, pacificTime, parseFirstParent, parseShotLog, prsPerDay, shotKind } from "./lib.mjs";

const REF = process.env.MAKING_OF_REF ?? "origin/main";
const REPO = process.env.GH_REPO ?? "smithdavedesign/botchelor";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

function history() {
  const commits = parseFirstParent(git("log", "--first-parent", "--format=%H%x1f%cI%x1f%s%x1f%b%x1e", REF));
  const shots = parseShotLog(git("log", "--first-parent", "--diff-merges=first-parent", "--name-status", "--format=@@%H", REF, "--", "docs/screenshots"));
  return { commits, shots };
}

function events(out) {
  const { commits, shots } = history();
  const rows = [];
  for (const c of commits) {
    for (const s of shots.get(c.sha) ?? []) {
      rows.push({ sha: c.sha, day: c.day, pr: c.pr, title: c.title, path: s.path, status: s.status, safe: openPageSafe(s.path), ...shotKind(s.path) });
    }
  }
  rows.reverse(); // oldest first
  writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
  const safe = rows.filter((r) => r.safe);
  console.log(`${rows.length} screenshot versions, ${safe.length} open-page safe by name → ${out}`);
}

/** GitHub's own counts: PRs merged into main whose description carries Claude Code's line, and issues. */
function prCounts() {
  const count = (q) => Number(execFileSync("gh", ["api", `search/issues?q=${encodeURIComponent(`repo:${REPO} ${q}`)}&per_page=1`, "--jq", ".total_count"], { encoding: "utf8" }).trim());
  return { byClaude: count('is:pr is:merged base:main "Generated with Claude Code" in:body'), issues: count("is:issue") };
}

/**
 * Every PR merged into main and its Pacific day, from GitHub: the chart, the running totals and the headline count all
 * come from this one list. Git's first-parent line misses a few (merges made by hand, and two that landed through a
 * branch that had merged main), so it's only used for the pictures and day one.
 */
function mergedPrs() {
  const out = execFileSync("gh", ["pr", "list", "--repo", REPO, "--state", "merged", "--base", "main", "--limit", "20000", "--json", "number,mergedAt", "--jq", ".[] | [.number, .mergedAt] | @tsv"], { encoding: "utf8", maxBuffer: 1 << 26 });
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [n, at] = line.split("\t");
    return { pr: Number(n), day: pacificDay(at) };
  });
}

const OUT_DIR = "public/making-of";
const DATA = "lib/making-of-data.json";
/** Pictures are stored at two widths per device: a card and the full view. WebP keeps a desktop shot near 60 KB. */
const WIDTHS = { desktop: { card: 640, full: 1440 }, phone: { card: 300, full: 640 } };

/**
 * A capture shorter than its device's screen (the early phone shots are 375×640) would lose its sides to the screen's
 * shape: carry the page on below in its own background, the colour by the bottom-left corner, fading the cut edge.
 */
async function fillScreen(png, meta, screen) {
  const { data } = await sharp(png).extract({ left: 2, top: meta.height - 3, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = data;
  const fade = Math.round(meta.width * 0.15);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${fade}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/><stop offset="1" stop-color="rgb(${r},${g},${b})"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/></svg>`;
  const faded = await sharp(png).composite([{ input: Buffer.from(svg), top: meta.height - fade, left: 0 }]).png().toBuffer();
  return sharp(faded).extend({ bottom: screen - meta.height, background: { r, g, b } }).png().toBuffer();
}

async function writeShot(sha, path, slug, kind) {
  let png = execFileSync("git", ["show", `${sha}:${path}`], { maxBuffer: 1 << 28 });
  const meta = await sharp(png).metadata();
  // Many shots are full-page captures: keep the first screen (16:10 on a computer, about 9:19.5 on a phone), the part the
  // stage and the cards show, not a 6,000px strip.
  const screen = Math.round(meta.width * (kind === "phone" ? 2.17 : 0.625));
  if (meta.height < screen * 0.97) png = await fillScreen(png, meta, screen);
  const out = {};
  for (const [size, width] of Object.entries(WIDTHS[kind === "phone" ? "phone" : "desktop"])) {
    const file = `${slug}-${size}.webp`;
    const w = Math.min(width, meta.width);
    let img = sharp(png);
    if (meta.height > screen) img = img.extract({ left: 0, top: 0, width: meta.width, height: screen });
    const info = await img.resize({ width: w }).webp({ quality: size === "card" ? 72 : 80 }).toFile(join(OUT_DIR, file));
    out[size] = { src: `/making-of/${file}`, w: info.width, h: info.height };
  }
  // Where it came from, so tests can hold every picture on the page to the open-page rule (openPageSafe).
  out.from = path;
  return out;
}

async function page() {
  const picks = JSON.parse(readFileSync("scripts/making-of/picks.json", "utf8"));
  const { commits, shots } = history();
  const byPr = new Map(commits.filter((c) => c.pr).map((c) => [c.pr, c]));
  // Clear the pictures only: share.png (the Remotion still, video/README.md) lives here too.
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith(".webp")) rmSync(join(OUT_DIR, f));

  const frames = [];
  for (const [i, f] of picks.frames.entries()) {
    const c = byPr.get(f.pr);
    if (!c) throw new Error(`picks.json frame ${i}: no PR #${f.pr} on ${REF}`);
    // A live check after a deploy is sometimes committed by the next PR: `shotsFrom` names that one, and the frame still
    // credits the PR whose change is on screen.
    const at = f.shotsFrom ? byPr.get(f.shotsFrom) : c;
    if (!at) throw new Error(`picks.json frame ${i}: no PR #${f.shotsFrom} on ${REF}`);
    const brought = shots.get(at.sha) ?? [];
    const frame = { pr: f.pr, day: c.day, title: c.title, caption: f.caption };
    for (const kind of ["desktop", "phone"]) {
      if (!f[kind]) continue;
      if (!openPageSafe(f[kind])) throw new Error(`picks.json frame ${i}: ${f[kind]} is not open-page safe by name`);
      if (!brought.some((s) => s.path === f[kind])) throw new Error(`picks.json frame ${i}: PR #${f.shotsFrom ?? f.pr} didn't add or change ${f[kind]}`);
      frame[kind] = await writeShot(at.sha, f[kind], `${String(i + 1).padStart(3, "0")}-${kind}`, kind);
    }
    frames.push(frame);
  }
  frames.sort((a, b) => a.day.localeCompare(b.day) || a.pr - b.pr);

  const merged = mergedPrs();
  const first = commits.at(-1).day;
  const last = [commits[0].day, ...merged.map((m) => m.day)].sort().at(-1);
  const days = prsPerDay(merged, first, last);
  const counts = prCounts();
  const allShots = [...shots.values()].reduce((n, list) => n + list.length, 0);
  const data = {
    note: "Written by scripts/making-of/collect.mjs page; edit scripts/making-of/picks.json and run it again.",
    first,
    last,
    // Day one, oldest first: the idea at 7:44 in the morning, then what merged by midnight.
    dayOne: commits.filter((c) => c.day === first).reverse().map((c) => ({ time: pacificTime(c.iso), pr: c.pr, title: c.title })),
    totals: { prs: merged.length, byClaude: counts.byClaude, issues: counts.issues, screenshots: allShots, days: days.length },
    days,
    chapters: picks.chapters,
    frames,
  };
  writeFileSync(DATA, `${JSON.stringify(data, null, 1)}\n`);
  const webp = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webp"));
  const bytes = webp.reduce((n, f) => n + readFileSync(join(OUT_DIR, f)).length, 0);
  console.log(`${frames.length} frames, ${webp.length} pictures, ${(bytes / 1048576).toFixed(1)} MB → ${OUT_DIR}; ${DATA}`);
  console.log(`totals: ${JSON.stringify(data.totals)}; ${pacificDay(new Date().toISOString())} today`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "events" && arg) events(arg);
else if (cmd === "page") await page();
else {
  console.error("usage: collect.mjs events <out.json> | page");
  process.exit(2);
}
