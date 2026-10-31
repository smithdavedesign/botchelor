#!/usr/bin/env node
// The daily clip (docs/house-crowd.md, David 2026-10-23: "market … keep it cheap"): the best of the newest dates aired
// on botchelor.com that hasn't been clipped yet, recorded in theater mode at phone size as a ready-to-post vertical video
// (1080×1920 MP4, no sound) with a caption file beside it. Free: a local Chromium and ffmpeg. David posts it; this never
// does. launchd runs it once a day (scripts/crowd/install.sh); by hand:  node scripts/clips/daily-clip.mjs [episode_id]
//   CLIPS_DIR (default ~/BotchelorClips), CROWD_BASE (default https://botchelor.com), CHROMIUM_PATH (default: the
//   newest Chromium Playwright has cached), FFMPEG (default: ffmpeg on PATH).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Analytics and the portfolio beacon: a recording is ours, not a visit (scripts/e2e-live.mjs blocks the same). */
const ANALYTICS = /google-analytics\.com|googletagmanager\.com|idea-factory\.1426davejobs\.workers\.dev\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;
/** How far down the feed (newest first) today's clip may come from, and the shortest transcript worth a clip. */
const NEWEST = 15;
const MIN_LINES = 8;
/** The longest recording: Shorts and Reels cap around a minute, and a replay that hangs mustn't run forever. */
const MAX_RECORD_MS = 75_000;

/**
 * Today's clip from the public feed (newest first): among the newest NEWEST dates, one that has aired, has at least
 * MIN_LINES lines and wasn't clipped before. A decided ending scores (a second date or a disaster beats friends), a best
 * line scores, a longer date scores a little; a tie goes to the newer. Returns the episode or null. Pure.
 */
export function pickClip(episodes, { clipped = new Set() } = {}) {
  const score = (e) => (e.ending === "second_date" || e.ending === "disaster" ? 2 : 0) + (e.best_line ? 1 : 0) + Math.min(1, (e.transcript?.length ?? 0) / 24);
  const fresh = episodes
    .slice(0, NEWEST)
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.revealed && !clipped.has(e.id) && (e.transcript?.length ?? 0) >= MIN_LINES);
  fresh.sort((x, y) => score(y.e) - score(x.e) || x.i - y.i);
  return fresh[0]?.e ?? null;
}

/** The caption to paste with the video: the pair, the best line, the link, a few tags. */
export function captionFor(e, base) {
  const [a, b] = (e.characters ?? []).map((c) => c.name);
  const pair = a && b ? `${a} × ${b}` : "Tonight's date";
  return [`${pair}${e.best_line ? `: "${e.best_line}"` : ""}`, "", `Watch the whole date: ${base}/episodes/${e.id}`, "", "#botchelor #originalcharacter #oc #aidating #datingshow"].join("\n");
}

/** The newest Chromium Playwright has cached on this Mac (no download, ever). */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((x, y) => Number(y.split("-")[1]) - Number(x.split("-")[1])) : [];
  for (const d of dirs) {
    for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
      const app = join(cache, d, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
      if (existsSync(app)) return app;
    }
  }
  throw new Error("No Chromium: set CHROMIUM_PATH (this script never downloads one).");
}

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function emit(status, message) {
  try {
    execFileSync(join(homedir(), "ai-stack", "bin", "emit-event"), ["botchelor", "daily-clip", "clip", status, message], { stdio: "ignore", timeout: 5000 });
  } catch {
    /* no ai-stack */
  }
}

async function main() {
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  const out = process.env.CLIPS_DIR || join(homedir(), "BotchelorClips");
  const home = process.env.CROWD_HOME || join(homedir(), ".botchelor-crowd");
  mkdirSync(out, { recursive: true });
  mkdirSync(home, { recursive: true });
  const doneFile = join(home, "clips.json");
  const done = existsSync(doneFile) ? JSON.parse(readFileSync(doneFile, "utf8")) : {};
  const headers = { "user-agent": "botchelor-clip/1.0", cookie: "bz_adult=1" };

  const wanted = process.argv[2];
  let episode;
  if (wanted) {
    const one = await (await fetch(`${base}/api/episodes/${wanted}`, { headers })).json();
    episode = one?.id ? one : null;
  }
  else {
    const feed = (await (await fetch(`${base}/api/episodes`, { headers })).json()).episodes ?? [];
    episode = pickClip(feed, { clipped: new Set(Object.keys(done)) });
  }
  if (!episode) {
    console.log("No new aired date with enough lines among the newest: no clip today.");
    emit("skipped", "no new aired date to clip");
    return;
  }

  const { chromium } = await import("playwright-core");
  const tmp = join(out, `.recording-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  // Chrome's own screencast (frames with their timestamps), not Playwright's recorder: that needs a pinned ffmpeg build
  // of Playwright's, and this Mac's ffmpeg does the encoding instead.
  const frames = [];
  try {
    // A phone's viewport (405×720 CSS px) at a scale that makes its frames exactly 1080×1920.
    const context = await browser.newContext({
      viewport: { width: 405, height: 720 },
      deviceScaleFactor: 1080 / 405,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 botchelor-clip/1.0",
      reducedMotion: "no-preference",
    });
    await context.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    await context.route(ANALYTICS, (route) => route.abort());
    const page = await context.newPage();
    // As a viewer: the episode page, then its "Watch in theater" (?play=1 opens it only for the date's creator).
    await page.goto(`${base}/episodes/${episode.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Watch in theater" }).click({ timeout: 20_000 });
    await page.locator(".theater").waitFor({ timeout: 20_000 });
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", (f) => {
      const file = join(tmp, `f${String(frames.length).padStart(5, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      frames.push({ file, t: f.metadata.timestamp });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    const started = Date.now();
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1080, maxHeight: 1920 });
    // The replay plays the date line by line; the verdict card is its last frame.
    await page.locator(".theater-verdict").waitFor({ timeout: MAX_RECORD_MS }).catch(() => {});
    await page.waitForTimeout(3_000);
    await cdp.send("Page.stopScreencast").catch(() => {});
    await context.close();
    console.log(`Recorded ${Math.round((Date.now() - started) / 1000)}s of ${episode.id} (${frames.length} frames)`);
  } finally {
    await browser.close();
  }
  if (frames.length < 2) throw new Error(`the screencast caught ${frames.length} frames`);

  const day = new Date().toISOString().slice(0, 10);
  const [a, b] = (episode.characters ?? []).map((c) => c.name);
  const name = `${day}-${slug(a)}-${slug(b)}`;
  const mp4 = join(out, `${name}.mp4`);
  // Each frame for as long as it was on screen (the screencast only sends a frame when something changes), the last for
  // two seconds; then H.264 at a steady 30 fps in an MP4 every app takes, 1080×1920, no sound track.
  // At most 30 frames a second (the screencast can send twice that), each lasting until the next kept one: real time.
  const kept = [];
  for (const f of frames) if (!kept.length || f.t - kept.at(-1).t >= 1 / 30) kept.push(f);
  const list = kept.map((f, i) => `file '${f.file}'\nduration ${((kept[i + 1]?.t ?? f.t + 2) - f.t).toFixed(3)}`);
  writeFileSync(join(tmp, "frames.txt"), `${list.join("\n")}\nfile '${kept.at(-1).file}'\n`);
  execFileSync(process.env.FFMPEG || "ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(tmp, "frames.txt"),
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", "-an", mp4,
  ]);
  writeFileSync(join(out, `${name}.txt`), captionFor(episode, base) + "\n");
  rmSync(tmp, { recursive: true, force: true });
  done[episode.id] = { at: new Date().toISOString(), file: mp4 };
  writeFileSync(doneFile + ".tmp", JSON.stringify(done, null, 1));
  renameSync(doneFile + ".tmp", doneFile);
  console.log(`Clip: ${mp4}\nCaption: ${join(out, `${name}.txt`)}`);
  emit("ok", `${mp4} (${a} × ${b})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    emit("fail", String(e?.message ?? e).slice(0, 300));
    console.error(e);
    process.exit(1);
  });
}
