#!/usr/bin/env node
// The daily clip (docs/house-crowd.md, David 2026-10-23: "market … keep it cheap"): the best of the newest dates aired
// on botchelor.com that hasn't been clipped yet, recorded in theater mode at phone size as a ready-to-post vertical video
// (1080×1920 MP4, the lines spoken: scripts/clips/voice.mjs, Kokoro on Venice at about a cent a clip, David's call
// 2026-11-11; macOS say when Venice is down; --silent or CLIP_SILENT=1 for none) with a caption file beside it. Free
// apart from the voices: a local Chromium and ffmpeg. David posts it; this never does. launchd runs it once a day
// (scripts/crowd/install.sh); by hand:  node scripts/clips/daily-clip.mjs [episode_id] [--silent]
// After it, the same date's branded cuts (branded-clip.mjs: full and teaser, in CLIPS_DIR/branded/; BRANDED_CLIP=0 skips).
//   CLIPS_DIR (default ~/BotchelorClips), CROWD_BASE (default https://botchelor.com), CHROMIUM_PATH (default: the
//   newest Chromium Playwright has cached), FFMPEG (default: ffmpeg on PATH).
// The home page plays it too (lib/home-clip.ts, 2026-11-15): once the MP4 is written, a small muted web loop (the first
// 10 to 14 seconds of lines, 480 px wide, H.264 faststart, well under 1.5 MB) and a poster are cut from it with the same
// ffmpeg and sent to POST /api/admin/home-clip, which itself refuses anything but a publicly aired date. The admin
// password is read when it's needed (FRONTIER_PASSWORD, else the keychain's vault/botchelor/FRONTIER_PASSWORD), never
// written or printed; a failed upload is logged and the clip run still succeeds. HOME_CLIP_UPLOAD=0 skips it.
// With the loop goes the cut (2026-11-19): the whole clip with its voices, 540 px wide, under 12 MB, which the date's
// page offers as "the 60-second version" (webCutArgs, makeWebCut). No cut (too long, too heavy) never stops the loop.
// A clip already rendered:  node scripts/clips/daily-clip.mjs --upload <clip.mp4> --episode <id> [--from <seconds>] [--dry]
//   (--from: where the loop starts in the clip, default 2; --dry: cut the files into CLIPS_DIR/web and send nothing).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { voiceTrack } from "./voice.mjs";

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
 * line scores, a longer date scores a little; a tie goes to the newer. `prefer`: the episodes the day's story is about
 * (the producer's beat, GET /api/story): one of those outscores any other, so the clip has a story. Never one the feed
 * marks `featurable: false` (the story check found its ending contradicting its lines as written: lib/story-check.ts). Returns the
 * episode or null. Pure.
 */
export function pickClip(episodes, { clipped = new Set(), prefer = new Set() } = {}) {
  const score = (e) => (prefer.has(e.id) ? 5 : 0) + (e.ending === "second_date" || e.ending === "disaster" ? 2 : 0) + (e.best_line ? 1 : 0) + Math.min(1, (e.transcript?.length ?? 0) / 24);
  const fresh = episodes
    .slice(0, NEWEST)
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.revealed && e.featurable !== false && !clipped.has(e.id) && (e.transcript?.length ?? 0) >= MIN_LINES);
  fresh.sort((x, y) => score(y.e) - score(x.e) || x.i - y.i);
  return fresh[0]?.e ?? null;
}

/**
 * The day's story from the show (GET /api/story, lib/producer.ts clipStory): the logline each aired date played under,
 * by episode id. Best effort: no story (an older deploy, a quiet day, a network error) is an empty map.
 */
export async function fetchStory(base, headers = {}) {
  try {
    const res = await fetch(`${base}/api/story`, { headers });
    if (!res.ok) return new Map();
    const body = await res.json();
    return new Map((body.episodes ?? []).filter((x) => x?.id && x?.logline).map((x) => [x.id, x.logline]));
  } catch {
    return new Map();
  }
}

/** The caption to paste with the video: the story's logline when this date is the one it's about, the pair, the best line, the link, a few tags. */
export function captionFor(e, base, logline = null) {
  const [a, b] = (e.characters ?? []).map((c) => c.name);
  const pair = a && b ? `${a} × ${b}` : "Tonight's date";
  return [...(logline ? [logline, ""] : []), `${pair}${e.best_line ? `: "${e.best_line}"` : ""}`, "", `Watch the whole date: ${base}/episodes/${e.id}`, "", "#botchelor #originalcharacter #oc #aidating #datingshow"].join("\n");
}

/** The newest Chromium Playwright has cached on this Mac (no download, ever). */
export function chromiumPath() {
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

/* ------------------------------------------------------------------------------------------------------------
 * The home page's web loop (lib/home-clip.ts)
 * ------------------------------------------------------------------------------------------------------------ */

/** The loop's size: a phone frame on the home page is at most this wide; 9:16 like the clip. */
export const WEB_LOOP = { width: 480, height: 854, fps: 24, min: 10, max: 14, target: 12, maxBytes: 1_400_000 };
/** Where a rendered clip's lines start when nobody measured it: the date's page shows for about two seconds first. */
export const WEB_LOOP_FROM = 2;

/**
 * Which seconds of the clip the loop shows: from just after the first line's bubble appears (so the poster, the
 * loop's first frame, already has a line on it), for 10 to 14 seconds, ending a second after a line landed when one
 * fits (a cut mid-typing reads as a glitch), else 12. `marks`: when each line appeared, in seconds from the clip's
 * start (null: not seen). No marks: from `from`. Never past the clip's end. Pure.
 */
export function webLoopWindow(marks, totalSeconds, from = WEB_LOOP_FROM) {
  const seen = (marks ?? []).filter((t) => typeof t === "number" && t >= 0 && t < totalSeconds).sort((x, y) => x - y);
  let start = seen.length ? seen[0] + 0.2 : from;
  if (!(start >= 0) || start > totalSeconds - 3) start = 0;
  const ends = seen.map((t) => t + 1 - start).filter((d) => d >= WEB_LOOP.min && d <= WEB_LOOP.max);
  const seconds = Math.min(ends.length ? ends.at(-1) : WEB_LOOP.target, Math.max(1, totalSeconds - start));
  return { start: Number(start.toFixed(2)), seconds: Number(seconds.toFixed(2)) };
}

const WEB_FIT = `scale=${WEB_LOOP.width}:${WEB_LOOP.height}:force_original_aspect_ratio=decrease,pad=${WEB_LOOP.width}:${WEB_LOOP.height}:(ow-iw)/2:(oh-ih)/2`;

/** ffmpeg's arguments for the loop: muted, 480 px wide, H.264 a phone plays inline, faststart, a capped bitrate. Pure. */
export function webLoopArgs({ src, out, start, seconds, crf = 26 }) {
  return [
    "-y", "-loglevel", "error", "-ss", String(start), "-t", String(seconds), "-i", src, "-an",
    "-vf", `${WEB_FIT},fps=${WEB_LOOP.fps}`,
    "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", String(crf),
    // 700 kbit/s at most: 14 seconds is then about 1.2 MB whatever the picture does.
    "-maxrate", "700k", "-bufsize", "1400k", "-movflags", "+faststart",
    out,
  ];
}

/**
 * The cut (lib/home-clip.ts, the episode page's "60-second version", 2026-11-19): the whole clip with its voices, small
 * enough for a phone to start at once. 540 wide (the theater's lines stay readable), 9:16 like the clip.
 */
/** Press the theater's "Start the date" when its cold open is up (COLD_OPEN=0, or a date with nothing to set up: none). */
export async function startTheDate(page, timeout = 5_000) {
  const start = page.locator(".theater .cold-open").getByRole("button", { name: /Start the date/ });
  await start.waitFor({ timeout }).then(() => start.click(), () => {});
}

export const WEB_CUT = { width: 540, height: 960, maxBytes: 12_000_000, maxSeconds: 150 };
const CUT_FIT = `scale=${WEB_CUT.width}:${WEB_CUT.height}:force_original_aspect_ratio=decrease,pad=${WEB_CUT.width}:${WEB_CUT.height}:(ow-iw)/2:(oh-ih)/2`;

/** ffmpeg's arguments for the cut: the whole clip, voices kept (mono AAC), H.264 a phone plays inline, faststart, a capped bitrate. Pure. */
export function webCutArgs({ src, out, crf = 27 }) {
  return [
    "-y", "-loglevel", "error", "-i", src,
    "-vf", CUT_FIT,
    "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", String(crf),
    // 1 Mbit/s at most: 90 seconds is then about 11 MB whatever the picture does; a theater recording is mostly still.
    "-maxrate", "900k", "-bufsize", "1800k",
    "-c:a", "aac", "-b:a", "96k", "-ac", "1",
    "-movflags", "+faststart",
    out,
  ];
}

/** ffmpeg's arguments for the poster: the loop's own first frame, so the video starts where the picture was. Pure. */
export function posterArgs({ src, out, start }) {
  return ["-y", "-loglevel", "error", "-ss", String(start), "-i", src, "-frames:v", "1", "-vf", WEB_FIT, "-q:v", "5", out];
}

/** `--upload <clip.mp4> --episode <id> [--from <seconds>] [--dry]`, or null when this isn't that mode. Throws on a half-given one. Pure. */
export function parseUpload(argv) {
  const at = argv.indexOf("--upload");
  if (at < 0) return null;
  const val = (flag) => {
    const i = argv.indexOf(flag);
    const v = i < 0 ? undefined : argv[i + 1];
    return v && !v.startsWith("--") ? v : undefined;
  };
  const file = val("--upload");
  const episode = val("--episode");
  if (!file || !episode) throw new Error("usage: daily-clip.mjs --upload <clip.mp4> --episode <id> [--from <seconds>] [--dry]");
  const from = val("--from") === undefined ? WEB_LOOP_FROM : Number(val("--from"));
  if (!Number.isFinite(from) || from < 0) throw new Error("--from: seconds into the clip, 0 or more");
  return { file, episode, from, dry: argv.includes("--dry") };
}

/** The day in a clip's file name (2026-11-15-a-b.mp4), else null. Pure. */
export const dayOfClip = (file) => /(?:^|\/)(\d{4}-\d{2}-\d{2})-[^/]*$/.exec(String(file))?.[1] ?? null;

/**
 * The admin password for the upload: FRONTIER_PASSWORD when the run has it, else the keychain's. Read when needed,
 * handed straight to the request, never logged. `read`: the keychain lookup (tests pass their own). Null: none.
 */
export function adminKey(env = process.env, read = keychainKey) {
  const given = env.FRONTIER_PASSWORD?.trim();
  if (given) return given;
  try {
    return read()?.trim() || null;
  } catch {
    return null;
  }
}

function keychainKey() {
  return execFileSync("/usr/bin/security", ["find-generic-password", "-s", "vault/botchelor/FRONTIER_PASSWORD", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
}

/** Cuts the loop and its poster from a rendered clip into `dir`. A loop that came out too heavy is cut again, coarser. */
export function makeWebClip({ mp4, dir, name, window, ffmpeg = process.env.FFMPEG || "ffmpeg" }) {
  mkdirSync(dir, { recursive: true });
  const loop = join(dir, `${name}.mp4`);
  const poster = join(dir, `${name}.jpg`);
  for (const crf of [26, 30, 36]) {
    execFileSync(ffmpeg, webLoopArgs({ src: mp4, out: loop, ...window, crf }));
    if (statSync(loop).size <= WEB_LOOP.maxBytes) break;
  }
  execFileSync(ffmpeg, posterArgs({ src: mp4, out: poster, start: window.start }));
  return { loop, poster, bytes: statSync(loop).size };
}

/**
 * Cuts the whole clip for the web (webCutArgs) into `dir`, or null when it runs longer than the route takes. A cut that
 * came out too heavy is cut again, coarser; still too heavy is null.
 */
export function makeWebCut({ mp4, dir, name, seconds, ffmpeg = process.env.FFMPEG || "ffmpeg" }) {
  if (!(seconds > 0 && seconds <= WEB_CUT.maxSeconds)) return null;
  mkdirSync(dir, { recursive: true });
  const cut = join(dir, `${name}-cut.mp4`);
  for (const crf of [27, 31, 35]) {
    execFileSync(ffmpeg, webCutArgs({ src: mp4, out: cut, crf }));
    if (statSync(cut).size <= WEB_CUT.maxBytes) return { cut, bytes: statSync(cut).size, seconds: Number(seconds.toFixed(2)) };
  }
  return null;
}

/**
 * Sends the loop and poster to the show (POST /api/admin/home-clip), and the cut with its length when there is one.
 * Returns { ok, status, error }: the route's own refusal (not aired, not public) comes back as its `error`. `send`: fetch
 * (tests pass their own). Never throws.
 */
export async function uploadWebClip({ base, key, episode, day, loop, poster, seconds, cut = null, cutSeconds = null, send = fetch }) {
  try {
    const form = new FormData();
    form.set("episode", episode);
    if (day) form.set("day", day);
    form.set("width", String(WEB_LOOP.width));
    form.set("height", String(WEB_LOOP.height));
    form.set("seconds", String(seconds));
    form.set("loop", new Blob([readFileSync(loop)], { type: "video/mp4" }), "loop.mp4");
    form.set("poster", new Blob([readFileSync(poster)], { type: "image/jpeg" }), "poster.jpg");
    if (cut && cutSeconds) {
      form.set("cut", new Blob([readFileSync(cut)], { type: "video/mp4" }), "cut.mp4");
      form.set("cut_seconds", String(cutSeconds));
    }
    const res = await send(`${base}/api/admin/home-clip`, { method: "POST", headers: { "x-frontier-key": key, "user-agent": "botchelor-clip/1.0" }, body: form });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.ok === true, status: res.status, error: res.ok ? null : String(body.error ?? `http_${res.status}`), id: body.id ?? null };
  } catch (e) {
    return { ok: false, status: 0, error: `network: ${String(e?.message ?? e).slice(0, 120)}`, id: null };
  }
}

/**
 * The whole step, for the daily run and for --upload: cut, then send. Logs what happened and returns it; never throws,
 * so a clip that rendered is never failed by the home page's copy.
 */
export async function sendWebClip({ mp4, out, name, episode, day, window, base, dry = false }) {
  try {
    const made = makeWebClip({ mp4, dir: join(out, "web"), name, window });
    console.log(`Web loop: ${made.loop} (${Math.round(made.bytes / 1024)} KB, ${window.seconds}s from ${window.start}s)`);
    if (made.bytes > WEB_LOOP.maxBytes) {
      console.error("home clip: the loop is still too heavy; not sent");
      return { ok: false, error: "too_large" };
    }
    // The whole clip with its voices, for the date's page (best effort: no cut never stops the loop going up).
    let cut = null;
    try {
      cut = makeWebCut({ mp4, dir: join(out, "web"), name, seconds: clipSeconds(mp4) });
      if (cut) console.log(`Web cut: ${cut.cut} (${Math.round(cut.bytes / 1024)} KB, ${cut.seconds}s)`);
      else console.error("home clip: no cut (too long or too heavy); the loop goes alone");
    } catch (e) {
      console.error(`home clip: no cut (${String(e?.message ?? e).slice(0, 160)})`);
    }
    if (dry) return { ok: true, error: null, dry: true };
    const key = adminKey();
    if (!key) {
      console.error("home clip: no admin password (FRONTIER_PASSWORD or the keychain); not sent");
      return { ok: false, error: "no_key" };
    }
    const sent = await uploadWebClip({ base, key, episode, day, loop: made.loop, poster: made.poster, seconds: window.seconds, cut: cut?.cut ?? null, cutSeconds: cut?.seconds ?? null });
    if (sent.ok) console.log(`Home clip: sent (${sent.id})`);
    else console.error(`home clip: not sent (${sent.status} ${sent.error})`);
    return sent;
  } catch (e) {
    console.error(`home clip: skipped (${String(e?.message ?? e).slice(0, 200)})`);
    return { ok: false, error: "failed" };
  }
}

/** The clip's length in seconds, read from ffmpeg's own report of the file (no ffprobe needed). */
function clipSeconds(mp4, ffmpeg = process.env.FFMPEG || "ffmpeg") {
  let text = "";
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", mp4], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // ffmpeg with no output file exits non-zero after printing what the input is: that print is what we want.
    text = String(e?.stderr ?? "");
  }
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) throw new Error(`can't read ${mp4}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
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
  // A clip already rendered: only the home page's copy of it (cut, then sent), nothing recorded again.
  const upload = parseUpload(process.argv.slice(2));
  if (upload) {
    if (!existsSync(upload.file)) throw new Error(`no such clip: ${upload.file}`);
    const window = webLoopWindow(null, clipSeconds(upload.file), upload.from);
    const sent = await sendWebClip({ mp4: upload.file, out, name: basename(upload.file).replace(/\.mp4$/i, ""), episode: upload.episode, day: dayOfClip(upload.file), window, base, dry: upload.dry });
    emit(sent.ok ? "ok" : "fail", `home clip ${upload.episode}: ${sent.ok ? (upload.dry ? "cut, not sent (--dry)" : "sent") : sent.error}`);
    if (!sent.ok) process.exitCode = 1;
    return;
  }
  const doneFile = join(home, "clips.json");
  const done = existsSync(doneFile) ? JSON.parse(readFileSync(doneFile, "utf8")) : {};
  const headers = { "user-agent": "botchelor-clip/1.0", cookie: "bz_adult=1" };

  // The day's story (lib/producer.ts): the dates the producer's beats are about, and the logline each played under.
  const story = await fetchStory(base, headers);
  const wanted = process.argv[2];
  let episode;
  if (wanted) {
    const one = await (await fetch(`${base}/api/episodes/${wanted}`, { headers })).json();
    episode = one?.id ? one : null;
  }
  else {
    const feed = (await (await fetch(`${base}/api/episodes`, { headers })).json()).episodes ?? [];
    episode = pickClip(feed, { clipped: new Set(Object.keys(done)), prefer: new Set(story.keys()) });
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
  const marks = [];
  let firstFrameAt = 0;
  const silent = process.argv.includes("--silent") || process.env.CLIP_SILENT === "1";
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
    // When each line's bubble appears, on the page's wall clock (the voices land on their bubbles: voice.mjs fitPlan).
    // Counted every 100 ms from the chat rows the theater adds, typing rows aside. A poll, not a MutationObserver: an
    // init script runs before the document has an element to observe.
    await page.exposeFunction("__bzMark", (n, t) => marks.push({ n, t }));
    await page.addInitScript(() => {
      let seen = 0;
      setInterval(() => {
        const n = document.querySelectorAll(".theater .chat-row:not(.chat-typing-row)").length;
        while (seen < n) window.__bzMark(seen++, Date.now() / 1000);
      }, 100);
    });
    // As a viewer: the episode page, then its "Watch in theater" (?play=1 opens it only for the date's creator).
    await page.goto(`${base}/episodes/${episode.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Watch in theater" }).click({ timeout: 20_000 });
    await page.locator(".theater").waitFor({ timeout: 20_000 });
    // The cold open (lib/cold-open.ts) holds the first line until Start: the clip starts where the date does, as before.
    await startTheDate(page);
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", (f) => {
      // The wall clock when the first frame lands: the page's line marks (Date.now()) are measured from this, since the
      // screencast's own frame times run on another clock.
      if (!frames.length) firstFrameAt = Date.now() / 1000;
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
  // two seconds; then H.264 at a steady 30 fps in an MP4 every app takes, 1080×1920, the voices as its sound track.
  // At most 30 frames a second (the screencast can send twice that), each lasting until the next kept one: real time.
  const kept = [];
  for (const f of frames) if (!kept.length || f.t - kept.at(-1).t >= 1 / 30) kept.push(f);
  const list = kept.map((f, i) => `file '${f.file}'\nduration ${((kept[i + 1]?.t ?? f.t + 2) - f.t).toFixed(3)}`);
  writeFileSync(join(tmp, "frames.txt"), `${list.join("\n")}\nfile '${kept.at(-1).file}'\n`);
  const totalSeconds = kept.at(-1).t + 2 - kept[0].t;
  // The voices (voice.mjs): each line at the second its bubble appeared, on one track; a silent run keeps no track.
  let voices = null;
  // When each line's bubble appeared, in seconds from the clip's start: the voices land on them, and the web loop starts at the first.
  const lineMarks = (episode.transcript ?? []).map((_, i) => marks.find((m) => m.n === i)?.t).map((t) => (t === undefined ? null : t - firstFrameAt));
  if (!silent) {
    const spoken = lineMarks.map((t, i) => (t === null || t < 0 || t > totalSeconds ? null : i)).filter((i) => i !== null);
    console.log(`Marks: ${marks.length} lines seen, ${spoken.length} inside the ${totalSeconds.toFixed(1)}s recording${spoken.length ? ` (first at ${lineMarks[spoken[0]].toFixed(1)}s)` : ""}`);
    try {
      voices = await voiceTrack({
        lines: spoken.map((i) => ({ side: episode.transcript[i].side, text: episode.transcript[i].dialogue })),
        characters: episode.characters,
        marks: spoken.map((i) => lineMarks[i]),
        totalSeconds,
        dir: tmp,
      });
      console.log(`Voices: ${voices.spoken} lines on ${voices.engine}`);
    } catch (e) {
      console.error(`voices: skipped (${e.message})`);
      voices = null;
    }
  }
  execFileSync(process.env.FFMPEG || "ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(tmp, "frames.txt"),
    ...(voices ? ["-i", voices.track] : []),
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-movflags", "+faststart",
    ...(voices ? ["-map", "0:v", "-map", "1:a", "-c:a", "copy", "-shortest"] : ["-an"]),
    mp4,
  ]);
  writeFileSync(join(out, `${name}.txt`), captionFor(episode, base, story.get(episode.id) ?? null) + (voices ? "\nVoices: AI (Kokoro)." : "") + "\n");
  rmSync(tmp, { recursive: true, force: true });
  done[episode.id] = { at: new Date().toISOString(), file: mp4 };
  writeFileSync(doneFile + ".tmp", JSON.stringify(done, null, 1));
  renameSync(doneFile + ".tmp", doneFile);
  console.log(`Clip: ${mp4}\nCaption: ${join(out, `${name}.txt`)}`);
  emit("ok", `${mp4} (${a} × ${b})`);
  // The home page's copy (lib/home-clip.ts): after everything above is safe on disk, and never able to fail the run.
  if (process.env.HOME_CLIP_UPLOAD !== "0") {
    const sent = await sendWebClip({ mp4, out, name, episode: episode.id, day, window: webLoopWindow(lineMarks, totalSeconds), base });
    if (!sent.ok) emit("fail", `home clip ${episode.id}: ${sent.error}`);
  }
  // The branded cuts (branded-clip.mjs, 2026-11-18): the same date in the ad's look, with its real ending, and the
  // "How does it end?" teaser. Last, like the home copy, and never able to fail the run. BRANDED_CLIP=0 skips it.
  if (process.env.BRANDED_CLIP !== "0") {
    try {
      const { brandedClip } = await import("./branded-clip.mjs");
      const made = await brandedClip({ id: episode.id, base, out: join(out, "branded"), silent });
      console.log(`Branded: ${made.dir}`);
    } catch (e) {
      console.error(`branded clip: ${e?.message ?? e}`);
      emit("fail", `branded clip ${episode.id}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    emit("fail", String(e?.message ?? e).slice(0, 300));
    console.error(e);
    process.exit(1);
  });
}
