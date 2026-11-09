#!/usr/bin/env node
// A ready-to-post TikTok / Reels / Shorts kit for one aired date (David, 2026-11-09: "prepare everything for a post").
// The daily clip (daily-clip.mjs) is a bare theater recording; this wraps it the way short video needs:
//   1. a hook card (the first ~2.5 s decide whether anyone stays): the pair's faces and one line on why to watch;
//   2. the date itself, recorded in the theater at phone size (daily-clip.mjs does the recording);
//   3. the reveal, after the date: how it ended and its best line (never before it: that would spoil the watch);
//   4. an end card: botchelor.com and what you can do there.
// Out: ~/BotchelorClips/posts/<day>-<a>-<b>/ with post.mp4 (1080×1920, H.264, no sound: add a sound in the app),
// cover.png (the hook card, for the app's cover picker), caption.txt and checklist.md. Free: local Chromium + ffmpeg.
// David posts it; this never does.
//   node scripts/clips/post-kit.mjs <episode_id> [--hook "one line"] [--tags "#anime #animeart"] [--date-seconds 45]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromiumPath } from "./daily-clip.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** How long each card stays up, in seconds. */
export const CARD_SECONDS = { hook: 2.6, reveal: 4, end: 2.6 };
/**
 * How much of the date to show (seconds of the theater): the opening as a teaser, then the reveal. Short video holds
 * people for 30-60 s and a whole date plays for minutes, so the post is the first lines; botchelor.com has the rest.
 * --date-seconds sets it per post (cut just after a good line).
 */
export const DATE_SECONDS = 45;

/** Where the date happened, in words: the dealt set's sentence (setting), or a named place (venue "elsewhere@…"). */
export function placeOf(e) {
  const named = typeof e.venue === "string" && e.venue.includes("@") ? e.venue.slice(e.venue.indexOf("@") + 1) : null;
  const words = (named ?? e.setting ?? "").trim().replace(/[.\s]+$/, "");
  return words ? words.charAt(0).toLowerCase() + words.slice(1) : null;
}

const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** The hook: a line written for this post, or the pair and the place. */
export function hookFor(e, override) {
  if (override?.trim()) return override.trim();
  const [a, b] = (e.characters ?? []).map((c) => firstName(c.name));
  const place = placeOf(e);
  return `${a} and ${b} meet for the first time${place ? `, on ${/^(a|an|the) /i.test(place) ? place : `a ${place}`}` : ""}.`;
}

const ENDINGS = {
  second_date: { mark: "💘", label: "They want a second date" },
  friends: { mark: "🤝", label: "Just friends" },
  close_friends: { mark: "🤝", label: "Close friends" },
  disaster: { mark: "💔", label: "A disaster" },
};

/** The reveal: how it ended, its best line and who said it (when the transcript says). */
export function revealFor(e) {
  const ending = ENDINGS[e.ending] ?? { mark: "🎬", label: String(e.ending ?? "It's over").replace(/_/g, " ") };
  const line = e.best_line?.trim() || null;
  let by = null;
  if (line) {
    for (const t of e.transcript ?? []) {
      const said = String(t?.dialogue ?? t?.said ?? t?.line ?? "");
      if (said.includes(line)) {
        // A stored line names its side (a/b: the episode's first or second character); a step's transcript names "who".
        const side = t?.side === "a" ? 0 : t?.side === "b" ? 1 : -1;
        const speaker = side >= 0 ? e.characters?.[side]?.name : (t?.who ?? t?.speaker ?? t?.name);
        by = firstName(speaker) || null;
        break;
      }
    }
  }
  return { ...ending, line, by };
}

/** The caption to paste: the hook, a question for the comments, where to watch it all, AI disclosure, tags. */
export function postCaption(e, { hook, tags = "" } = {}) {
  const [a, b] = (e.characters ?? []).map((c) => firstName(c.name));
  return [
    hookFor(e, hook),
    "",
    `Would you have said yes to ${b}? 👀`,
    "",
    "Watch the whole date at botchelor.com. Both are AI characters; the date is AI-generated fiction.",
    "",
    ["#botchelor #aicharacters #blinddate #datingshow #originalcharacter", tags.trim()].filter(Boolean).join(" "),
  ].join("\n");
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** One 1080×1920 card (rendered at 405×720 CSS px, scale 1080/405), in the site's type and colours. */
export function cardHtml(kind, { e, base, hook, reveal }) {
  const faces = (e.characters ?? [])
    .map((c) => `<figure><img src="${esc(c.portrait ? new URL(c.portrait, base).href : "")}" alt=""><figcaption>${esc(firstName(c.name))}</figcaption></figure>`)
    .join('<span class="x">×</span>');
  const body =
    kind === "hook"
      ? `<p class="kicker">A blind date on Botchelor</p><div class="faces">${faces}</div><h1>${esc(hook)}</h1><p class="sub">Watch how it ends ↓</p>`
      : kind === "reveal"
        ? `<p class="kicker">How it ended</p><div class="faces small">${faces}</div><p class="ending">${reveal.mark} ${esc(reveal.label)}</p>${
            reveal.line ? `<blockquote>“${esc(reveal.line)}”${reveal.by ? `<cite>— ${esc(reveal.by)}</cite>` : ""}</blockquote>` : ""
          }`
        : `<p class="brand">Botchelor</p><h1>Make a character.<br>Send them on a date.<br>Watch how it ends.</h1><p class="url">botchelor.com</p><p class="fine">AI characters · AI-generated fiction · 18+</p>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@500;600&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
html,body{width:405px;height:720px;overflow:hidden}
body{font-family:Inter,system-ui,sans-serif;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:40px 30px;text-align:center;
 background:radial-gradient(120% 80% at 50% 0%,#7a36c9 0%,#3a1450 45%,#140a18 100%)}
.kicker{font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#ffb3cb}
.faces{display:flex;align-items:center;gap:14px}
.faces figure{display:flex;flex-direction:column;align-items:center;gap:8px}
.faces img{width:132px;height:132px;border-radius:28px;object-fit:cover;border:3px solid #ff5e8c;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.faces.small img{width:96px;height:96px;border-radius:22px}
.faces figcaption{font-weight:600;font-size:16px}
.x{font-family:Fraunces,Georgia,serif;font-size:30px;color:#ffb3cb}
h1{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:31px;line-height:1.18}
.sub{font-size:17px;font-weight:600;color:#ffd6e3}
.ending{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:34px;line-height:1.15}
blockquote{font-family:Fraunces,Georgia,serif;font-size:23px;line-height:1.3;background:rgba(255,255,255,.1);border-left:4px solid #ff5e8c;border-radius:14px;padding:18px 20px;text-align:left}
cite{display:block;margin-top:10px;font-family:Inter,sans-serif;font-style:normal;font-size:15px;color:#ffd6e3}
.brand{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:52px;background:linear-gradient(90deg,#ff5e8c,#c9a6ff);-webkit-background-clip:text;color:transparent}
.url{font-size:26px;font-weight:600;background:#e5356b;border-radius:999px;padding:12px 26px}
.fine{font-size:13px;color:#d9c4e6}
</style></head><body>${body}</body></html>`;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const slug = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function main() {
  const id = process.argv[2];
  if (!id || id.startsWith("--")) throw new Error('usage: node scripts/clips/post-kit.mjs <episode_id> [--hook "…"] [--tags "#…"]');
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  const headers = { "user-agent": "botchelor-clip/1.0", cookie: "bz_adult=1" };
  const e = await (await fetch(`${base}/api/episodes/${id}`, { headers })).json();
  if (!e?.id) throw new Error(`no episode ${id}`);
  if (!e.revealed || e.visibility !== "public") throw new Error("only a public date that has aired makes a post");
  const hook = hookFor(e, arg("hook"));
  const reveal = revealFor(e);
  const dateSeconds = Number(arg("date-seconds") ?? DATE_SECONDS);
  if (!(dateSeconds >= 5 && dateSeconds <= 75)) throw new Error("--date-seconds is 5 to 75");
  const [a, b] = (e.characters ?? []).map((c) => c.name);
  const out = join(process.env.CLIPS_DIR || join(homedir(), "BotchelorClips"), "posts", `${new Date().toISOString().slice(0, 10)}-${slug(a)}-${slug(b)}`);
  mkdirSync(out, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "botchelor-post-"));
  try {
    // The date, recorded by the daily clip into a scratch folder (its own clips.json untouched: this isn't the daily one).
    execFileSync(process.execPath, [join(HERE, "daily-clip.mjs"), e.id], { env: { ...process.env, CLIPS_DIR: tmp, CROWD_HOME: tmp, CROWD_BASE: base }, stdio: "inherit" });
    const clip = readdirSync(tmp).find((f) => f.endsWith(".mp4"));
    if (!clip) throw new Error("the recording made no video");

    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chromiumPath() });
    try {
      const page = await browser.newPage({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 1080 / 405 });
      for (const kind of ["hook", "reveal", "end"]) {
        await page.setContent(cardHtml(kind, { e, base, hook, reveal }), { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(tmp, `${kind}.png`) });
      }
    } finally {
      await browser.close();
    }

    // Hook, date, reveal, end card: each card a still with a short fade, the date as recorded, one 30 fps H.264 file.
    const still = (i, secs) => `[${i}:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=0.25,fade=t=out:st=${(secs - 0.25).toFixed(2)}:d=0.25[v${i}]`;
    execFileSync(process.env.FFMPEG || "ffmpeg", [
      "-y", "-loglevel", "error",
      "-loop", "1", "-t", String(CARD_SECONDS.hook), "-i", join(tmp, "hook.png"),
      "-t", String(dateSeconds), "-i", join(tmp, clip),
      "-loop", "1", "-t", String(CARD_SECONDS.reveal), "-i", join(tmp, "reveal.png"),
      "-loop", "1", "-t", String(CARD_SECONDS.end), "-i", join(tmp, "end.png"),
      "-filter_complex",
      [still(0, CARD_SECONDS.hook), `[1:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p,fade=t=out:st=${(dateSeconds - 0.3).toFixed(2)}:d=0.3[v1]`, still(2, CARD_SECONDS.reveal), still(3, CARD_SECONDS.end), "[v0][v1][v2][v3]concat=n=4:v=1:a=0[v]"].join(";"),
      "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19", "-movflags", "+faststart", "-an",
      join(out, "post.mp4"),
    ]);
    execFileSync("cp", [join(tmp, "hook.png"), join(out, "cover.png")]);
    writeFileSync(join(out, "caption.txt"), postCaption(e, { hook: arg("hook"), tags: arg("tags") ?? "" }) + "\n");
    writeFileSync(
      join(out, "checklist.md"),
      [
        `# Posting ${a} × ${b}`,
        "",
        `Episode: ${base}/episodes/${e.id}`,
        "",
        "1. TikTok → + → Upload → post.mp4.",
        "2. Sounds: pick a trending or calm instrumental sound at low volume (the video has none, so the app's sound is the only audio).",
        "3. Cover: choose the first frame (the hook card) or upload cover.png.",
        "4. Paste caption.txt. The video shows the date's opening and how it ended; the caption sends people to the whole date.",
        "5. More options → turn on \"AI-generated content\" (TikTok requires the label for AI-made people and stories).",
        "6. Audience: everyone is fine (the show's dates are PG); never post After Dark.",
        "7. Post, then put botchelor.com in the profile bio if it isn't there.",
        "",
      ].join("\n"),
    );
    console.log(`Post kit: ${out}\n  post.mp4, cover.png, caption.txt, checklist.md`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
