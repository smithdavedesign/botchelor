#!/usr/bin/env node
/**
 * Vertical clips of aired dates, for TikTok, YouTube Shorts and Reels (competitor review 2026-11-08, #1: an AI dating
 * show parody drew 10M+ views an episode as TikTok clips, with a vote that changed the next episode). David posts them
 * himself (docs/marketing-pipeline.md: browser posting he signs in to and approves); this only makes the files.
 *
 * For each date it opens the public replay (/episodes/<id>?play=1) at phone size in a real browser, records it until the
 * verdict shows, then records an end card ("Vote what happens next: botchelor.com/vote"), and writes:
 *   <out>/<id>.mp4   1080×1920 H.264, silent (add a sound in the app: trending audio does better than none)
 *   <out>/<id>.txt   a caption with the hook, the vote link and hashtags
 *
 * Usage:
 *   node scripts/post/clips.mjs                     the newest 3 dates on /watch
 *   node scripts/post/clips.mjs --count 5
 *   node scripts/post/clips.mjs --episode <id|url>  (repeatable)
 *   options: --out <dir> (default ~/botchelor-clips/<today>), --base <url> (default https://botchelor.com),
 *            --source tiktok (the vote link's ?s=, for attribution), --speed 1.5
 * Needs: playwright-core (a dev dependency), a Chromium (CHROMIUM_PATH, else Playwright's headless shell in its cache),
 * and ffmpeg on PATH. Uses no keys and no database: only public pages.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const many = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));

const BASE = opt("base", "https://botchelor.com").replace(/\/$/, "");
const SOURCE = opt("source", "tiktok").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "tiktok";
const COUNT = Math.max(1, Math.min(10, Number(opt("count", "3")) || 3));
const OUT = opt("out", join(homedir(), "botchelor-clips", new Date().toISOString().slice(0, 10)));
// Identifies itself, so /admin/analytics counts these visits as ours (docs: live checks are botchelor-*).
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-clips/1.0";
// Recorded at the phone's own size (Playwright never upscales a recording), then scaled up to 1080×1920 by ffmpeg.
const VIEW = { width: 432, height: 768 };
const VIDEO = { width: 1080, height: 1920 };
const MAX_PLAY_MS = 4 * 60 * 1000;
const CARD_MS = 3500 * Number(opt("speed", "1.5"));
// Playback speed in the file (1.5 by default: the replay is paced for reading along, a clip for scrolling).
const SPEED = Math.max(1, Math.min(3, Number(opt("speed", "1.5")) || 1.5));

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  if (!shell) return undefined;
  const p = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
  return existsSync(p) ? p : undefined;
}

const idOf = (v) => (v.match(/episodes\/([^/?#]+)/)?.[1] ?? v).trim();

async function newestOnWatch(browser) {
  const context = await browser.newContext({ userAgent: UA });
  await context.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/watch`, { waitUntil: "domcontentloaded" });
  const ids = await page.$$eval('a[href*="/episodes/"]', (as) => as.map((a) => a.getAttribute("href") ?? ""));
  await context.close();
  return [...new Set(ids.map(idOf).filter(Boolean))].slice(0, COUNT);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const endCard = (title, ending) => `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;
  background:#14101c;color:#fff;font:600 28px/1.25 -apple-system,system-ui,sans-serif;text-align:center">
  <div style="padding:32px"><div style="font-size:20px;opacity:.7">${esc(title)}</div>
  <div style="font-size:34px;margin:14px 0 30px">${esc(ending)}</div>
  <div>What should happen next?</div><div style="font-size:24px;margin-top:10px;color:#ffb3d1">Vote: botchelor.com/vote</div>
  <div style="font-size:16px;margin-top:28px;opacity:.6">AI characters · Botchelor</div></div></body>`;

async function record(browser, id) {
  const dir = join(tmpdir(), `botchelor-clip-${id}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, userAgent: UA, recordVideo: { dir, size: VIEW } });
  // Past the 18+ gate the way a visitor who said yes is (app/AgeGate.tsx's cookie).
  await context.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`${BASE}/episodes/${id}?play=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".theater", { timeout: 30_000 });
  const startMs = Date.now() - t0;
  const title = (await page.locator(".theater-id strong").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  await page.waitForSelector(".theater-verdict", { timeout: MAX_PLAY_MS });
  const ending = (await page.locator(".theater-verdict .ending").innerText().catch(() => "")).trim();
  await page.waitForTimeout(2500);
  await page.setContent(endCard(title, ending));
  await page.waitForTimeout(CARD_MS);
  await context.close();
  const webm = readdirSync(dir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no recording");
  return { webm: join(dir, webm), dir, title, ending, skip: Math.max(0, startMs / 1000 - 0.3) };
}

function toMp4(rec, out) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", rec.skip.toFixed(2), "-i", rec.webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
    "-vf", `setpts=PTS/${SPEED},scale=${VIDEO.width}:${VIDEO.height}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2:color=0x14101c`,
    "-movflags", "+faststart", "-an", out]);
}

function caption(rec, id) {
  const [a, b] = rec.title.split("×").map((s) => s.trim());
  const hook = a && b ? `${a} and ${b} went on a blind date. Nobody wrote this.` : "Two AI characters went on a blind date.";
  return [
    hook,
    rec.ending ? `How it ended: ${rec.ending}.` : "",
    `Vote what they do next 👉 botchelor.com/vote?s=${SOURCE}`,
    `Full date: ${BASE}/episodes/${id}?utm_source=${SOURCE}&utm_medium=clip`,
    "",
    "#aidating #datingshow #ai #blinddate #botchelor",
    "(AI-generated characters. Label the post as AI-generated when you upload.)",
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
try {
  const asked = many("episode").map(idOf);
  const ids = asked.length ? asked : await newestOnWatch(browser);
  if (!ids.length) throw new Error(`no dates found on ${BASE}/watch`);
  mkdirSync(OUT, { recursive: true });
  for (const id of ids) {
    process.stdout.write(`${id}: recording… `);
    try {
      const rec = await record(browser, id);
      const mp4 = join(OUT, `${id}.mp4`);
      toMp4(rec, mp4);
      writeFileSync(join(OUT, `${id}.txt`), caption(rec, id) + "\n");
      rmSync(rec.dir, { recursive: true, force: true });
      console.log(`done → ${mp4}`);
    } catch (err) {
      console.log(`failed: ${err instanceof Error ? err.message : err}`);
    }
  }
} finally {
  await browser.close();
}
