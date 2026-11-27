#!/usr/bin/env node
// The branded clip (2026-11-18, David: "turn the ad into the daily clip"): one aired date as a mini-episode in the ad's
// look (video/, Remotion): the stage cold open, the two contestants, their lines in bubbles, how it really ended on a
// stamp, the end card. Two cuts of each date:
//   full.mp4    the real ending stamped (SECOND DATE / JUST FRIENDS / DISASTER, as the episode page names it);
//   teaser.mp4  stops at "How does it end?" with all three stamps: post it first and let the comments call it, then
//               reply with the full cut. The caption never says how it ended.
// Like episode-cut.mjs it reads only the PUBLIC episode JSON (GET /api/episodes/<id>), refuses a date that hasn't aired
// publicly or that the story check marked unfeaturable, and every quoted word is the date's own: a line is shortened
// only by keeping its first sentences (nothing between kept sentences is dropped). The voices are voice.mjs's (Kokoro on
// Venice, `say` when it's down; --silent for none). Free apart from the voices: a local Chromium, Remotion, ffmpeg.
// David posts it; this never does. daily-clip.mjs runs it after the day's clip (BRANDED_CLIP=0 skips it); by hand:
//   node scripts/clips/branded-clip.mjs <episode_id> [--silent] [--wide] [--only full|teaser]
//   Out: CLIPS_DIR/branded/<day>-<a>-<b>/ (CLIPS_DIR default ~/BotchelorClips). The first run installs video/'s packages.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { endingLabel, firstName, sentences } from "./episode-cut.mjs";
import { creditLines } from "./post-kit.mjs";
import { fitPlan, mixArgs, sayable, soundSeconds, speakLines } from "./voice.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const VIDEO_DIR = join(HERE, "..", "..", "video");
export const FPS = 30;
/** Scene lengths in frames (the ad's: video/src/ad-props.ts). */
export const SCENE = { open: 80, cast: 120, lead: 14, verdict: { full: 75, teaser: 90 }, end: 80 };
/** How the bubbles type (video/src/Show.tsx TYPING and CPS): dots for TYPING frames, then CPS characters a frame. */
export const TYPING = 12;
export const CPS = 3;
/** A line stays this long after it has typed, so it can be read, when it isn't voiced. */
export const HOLD = 36;
/** The most lines a clip shows, the most characters in all, and in one line. */
export const MAX_LINES = 4;
export const MAX_CHARS = 380;
export const MAX_LINE = 190;

/**
 * A line's words for a bubble (pure): a run of its whole sentences up to MAX_LINE characters, from its first sentence,
 * or ending on the sentence that holds `focus` (the best line) when it has one; else null (too long, or only action).
 * Only sentences before the first kept one or after the last are dropped, so nothing reads as said back to back.
 */
export function bubbleText(dialogue, focus = null) {
  if (!sayable(dialogue)) return null;
  const all = sentences(dialogue);
  const k = focus ? all.findIndex((s) => s.includes(focus) || focus.includes(s)) : -1;
  if (k >= 0) {
    let text = all[k];
    if (text.length > MAX_LINE) return null;
    for (let i = k - 1; i >= 0 && text.length + all[i].length + 1 <= MAX_LINE; i--) text = `${all[i]} ${text}`;
    return text;
  }
  let text = "";
  for (const s of all) {
    const next = text ? `${text} ${s}` : s;
    if (next.length > MAX_LINE) break;
    text = next;
  }
  return text || null;
}

/**
 * Which lines the clip shows (pure): a run of consecutive spoken lines, at most MAX_LINES and MAX_CHARS, starting one
 * line before the best line when there is one (the page's best_line), else at the start. Lines too long to show end
 * the run rather than being skipped, so two lines never read as back to back when they weren't.
 */
export function pickLines(e) {
  const best = e?.best_line ? (e.transcript ?? []).findIndex((t) => String(t.dialogue ?? "").includes(e.best_line)) : -1;
  const turns = (e?.transcript ?? []).map((t, i) => ({ side: t.side === "b" ? "b" : "a", text: bubbleText(t.dialogue, i === best ? e.best_line : null) }));
  const run = (start) => {
    const out = [];
    let chars = 0;
    for (let i = start; i < turns.length && out.length < MAX_LINES; i++) {
      const t = turns[i];
      if (!t.text) {
        if (out.length) break;
        continue;
      }
      if (chars + t.text.length > MAX_CHARS) break;
      out.push(t);
      chars += t.text.length;
    }
    return out;
  };
  const near = best >= 0 ? run(Math.max(0, best - 1)) : [];
  return near.length >= 2 ? near : run(0);
}

/**
 * Where everything goes (pure). `durations[i]` is line i's voice in seconds (0 when silent). Returns the scene starts
 * (frames), each line's start inside the date scene (`at`), and when each voice should start (seconds of the video:
 * as its bubble starts to type).
 */
export function layout(lines, durations, variant) {
  const cast = SCENE.open;
  const date = cast + SCENE.cast;
  const ats = [];
  let at = SCENE.lead;
  for (let i = 0; i < lines.length; i++) {
    ats.push(at);
    const typed = TYPING + Math.ceil(lines[i].text.length / CPS) + HOLD;
    const spoken = durations[i] > 0 ? TYPING + Math.ceil((durations[i] + 0.35) * FPS) : 0;
    at += Math.max(typed, spoken);
  }
  const verdict = date + at + 10;
  const end = verdict + (variant === "full" ? SCENE.verdict.full : SCENE.verdict.teaser);
  const total = end + SCENE.end;
  return { t: { cast, date, verdict, end, total }, ats, marks: ats.map((a) => (date + a + TYPING) / FPS), seconds: total / FPS };
}

/** A character's face for the clip (pure): a headshot, a portrait, a house cast portrait, else null (the drawn initial). */
export function faceUrl(c, base) {
  const p = c?.photo || c?.portrait || (c?.house && /^house-[a-z]+$/.test(c.id ?? "") ? `/cast/${c.id}-v5.webp` : null);
  if (!p) return null;
  return p.startsWith("/cast/") ? p.slice(1) : new URL(p, base).href;
}

/** The backdrop for the date's venue (pure), as a public/ path, or null (the gradient). */
export function backdropPath(venue) {
  const id = String(venue ?? "").split(/[@:]/)[0].trim();
  const v3 = new Set(["gothic_manor", "countryside_picnic", "space_lounge", "cavern_lounge"]);
  return /^[a-z_]+$/.test(id) && id !== "elsewhere" ? `cast/venue-${id}-${v3.has(id) ? "v3" : "v2"}.webp` : null;
}

/** What the card says under a contestant's name (pure). */
export function tagOf(c) {
  if (c?.house) return "House cast";
  if (c?.credit?.name) return `By ${c.credit.name}`;
  if (c?.agent) return "Made by an AI agent";
  return "An original character";
}

/**
 * The Remotion props for one cut (pure). `card` overrides the chip and the end card: the season's trailer
 * (scripts/clips/season-promo.mjs --trailer) closes on the season instead of the site.
 */
export function propsFor(e, lines, plan, variant, base, card = null) {
  const goal = (c) => (e.goals ?? []).find((g) => g.character_id === c.id)?.goal ?? null;
  const faces = e.characters.map((c) => ({ name: c.name, tag: tagOf(c), about: goal(c) ? `Tonight: ${goal(c)}` : null, portrait: faceUrl(c, base), hue: c.hue ?? null }));
  const full = variant === "full";
  return {
    faces,
    backdrop: backdropPath(e.venue),
    chip: e.title ? String(e.title).slice(0, 34) : "First impressions",
    lines: lines.map((l, i) => ({ side: l.side, text: l.text, at: plan.ats[i] })),
    ending: full ? e.ending : null,
    endingLabel: full ? endingLabel(e) : null,
    variant,
    t: plan.t,
    audio: null,
    endLines: full ? ["Make a character.", "Watch the date.", "Call the ending."] : ["Call it.", "Then watch", "the whole date."],
    url: "botchelor.com",
    small: full ? "Free to start · no sign-up · AI agents welcome over MCP" : "Free · no sign-up · link in the caption",
    ...(card ?? {}),
  };
}

/** The caption for one cut (pure). The teaser's never says how it ended. */
export function captionOf(e, variant, base) {
  const [a, b] = e.characters.map((c) => firstName(c.name));
  const link = `${base}/episodes/${e.id}`;
  const head = variant === "teaser" ? [`${a} × ${b}: second date, just friends, or disaster? Call it in the comments 👇`, "", `The whole date (and how it really ended): ${link}`] : [`${a} × ${b}: ${endingLabel(e) ?? "how it ended"}.`, ...(e.best_line ? ["", `"${e.best_line}"`] : []), "", `Watch the whole date: ${link}`];
  return [...head, "", "AI-generated: two original characters, nobody steering. Make yours at botchelor.com", ...creditLines(e.characters), "", "#botchelor #originalcharacter #oc #aidating #datingshow"].join("\n") + "\n";
}

/** Whether a date may be clipped (pure): aired publicly, featurable, ended, two characters. Returns why not, or null. */
export function refusal(e) {
  if (!e?.id) return "no such date";
  if (!e.revealed || e.visibility !== "public") return "only a public date that has aired";
  if (e.featurable === false) return "the story check marked it unfeaturable";
  if (!e.ending || !endingLabel(e)) return "it has no ending yet";
  if ((e.characters ?? []).length !== 2) return "it isn't a date between two";
  return null;
}

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Drop a face whose picture won't load, so one dead link can't fail a render (the drawn initial stands in). */
async function checkFaces(props) {
  for (const f of props.faces) {
    if (!f.portrait || !/^https?:/.test(f.portrait)) continue;
    const ok = await fetch(f.portrait, { method: "HEAD", signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
    if (!ok) f.portrait = null;
  }
}

function browserArg() {
  if (process.env.REMOTION_BROWSER) return ["--browser-executable", process.env.REMOTION_BROWSER];
  return []; // Remotion's own headless shell (downloaded once into video/node_modules)
}

function render(composition, props, file, dir) {
  const propsFile = join(dir, `${composition}-${props.variant}.json`);
  writeFileSync(propsFile, JSON.stringify(props));
  execFileSync("npx", ["remotion", "render", "src/index.ts", composition, file, "--props", propsFile, "--public-dir", "../public", "--log", "error", ...browserArg()], { cwd: VIDEO_DIR, stdio: ["ignore", "inherit", "inherit"] });
}

/**
 * Make one date's branded cuts. Returns { dir, files }. `episode` is the public JSON (fetched when only an id is given).
 */
export async function brandedClip({ episode, id, base = "https://botchelor.com", out, silent = false, wide = false, only = null, card = null, log = console.error }) {
  const headers = { "user-agent": "botchelor-clip/1.0" };
  const e = episode ?? (await (await fetch(`${base}/api/episodes/${id}`, { headers })).json());
  const why = refusal(e);
  if (why) throw new Error(`can't clip ${e?.id ?? id}: ${why}`);
  // video/ keeps its own packages (Remotion), out of the app's install: the first run installs them, once.
  if (!existsSync(join(VIDEO_DIR, "node_modules", "remotion"))) execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: VIDEO_DIR, stdio: ["ignore", "inherit", "inherit"] });
  const lines = pickLines(e);
  if (lines.length < 2) throw new Error(`can't clip ${e.id}: fewer than two short spoken lines in a row`);

  const tmp = mkdtempSync(join(tmpdir(), "bz-branded-"));
  const [a, b] = e.characters.map((c) => c.name);
  const day = new Date().toISOString().slice(0, 10);
  const dir = join(out ?? join(process.env.CLIPS_DIR || join(homedir(), "BotchelorClips"), "branded"), `${day}-${slug(a)}-${slug(b)}`);
  mkdirSync(dir, { recursive: true });
  const files = [];
  try {
    let voice = { files: lines.map(() => null), engine: "none" };
    if (!silent) {
      try {
        voice = await speakLines(lines, e.characters, tmp, { log });
      } catch (err) {
        log(`voices: skipped (${err.message})`);
      }
    }
    const durations = voice.files.map((f) => (f ? soundSeconds(f) : 0));
    for (const variant of ["full", "teaser"]) {
      if (only && only !== variant) continue;
      const plan = layout(lines, durations, variant);
      const props = propsFor(e, lines, plan, variant, base, card);
      await checkFaces(props);
      const shapes = wide && variant === "full" ? [["Clip", ""], ["ClipWide", "-wide"]] : [["Clip", ""]];
      for (const [composition, suffix] of shapes) {
        const silentMp4 = join(tmp, `${variant}${suffix}-silent.mp4`);
        const mp4 = join(dir, `${variant}${suffix}.mp4`);
        render(composition, props, silentMp4, tmp);
        const fit = fitPlan(plan.marks, durations, plan.seconds).filter((p) => voice.files[p.index]);
        if (fit.length) {
          const track = join(tmp, `${variant}.m4a`);
          const inputs = fit.flatMap((p) => ["-i", voice.files[p.index]]);
          execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", mixArgs(fit, plan.seconds), "-map", "[a]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", track]);
          execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-i", silentMp4, "-i", track, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", mp4]);
        } else {
          execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-i", silentMp4, "-c", "copy", "-movflags", "+faststart", mp4]);
        }
        files.push(mp4);
      }
      writeFileSync(join(dir, `caption-${variant}.txt`), captionOf(e, variant, base) + (voice.engine !== "none" ? "Voices: AI.\n" : ""));
    }
    writeFileSync(
      join(dir, "checklist.md"),
      [
        `# ${a} × ${b}`,
        "",
        "1. Post teaser.mp4 first with caption-teaser.txt (TikTok, Reels, Shorts, X). Pin a comment: \"Second date, just friends, or disaster?\"",
        "2. A few hours later, reply to your own post (or post next) with full.mp4 and caption-full.txt.",
        "3. Turn on the platform's AI-generated label where it has one.",
        `4. Log both posts on /marketing. Episode: ${base}/episodes/${e.id}`,
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { dir, files };
}

function emit(status, message) {
  try {
    execFileSync(join(homedir(), "ai-stack", "bin", "emit-event"), ["botchelor", "branded-clip", "clip", status, message], { stdio: "ignore", timeout: 5000 });
  } catch {
    /* no ai-stack */
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const id = argv.find((x) => !x.startsWith("--") && argv[argv.indexOf(x) - 1] !== "--only");
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
  if (!id) {
    console.error("usage: node scripts/clips/branded-clip.mjs <episode_id> [--silent] [--wide] [--only full|teaser]");
    process.exit(2);
  }
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  brandedClip({ id, base, silent: argv.includes("--silent") || process.env.CLIP_SILENT === "1", wide: argv.includes("--wide"), only })
    .then(({ dir, files }) => {
      console.log(`Branded clip: ${dir}\n  ${files.map((f) => f.slice(dir.length + 1)).join(", ")}`);
      emit("ok", `${dir}`);
    })
    .catch((err) => {
      emit("fail", String(err?.message ?? err).slice(0, 300));
      console.error(err?.message ?? err);
      process.exit(1);
    });
}
