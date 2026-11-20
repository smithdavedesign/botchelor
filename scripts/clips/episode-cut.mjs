// The episode cut (2026-11-16, "December: first real audience", part B): a hand-edited 60–90 s vertical episode from one
// or more aired dates, built from an edit decision list (EDL) a person writes, not from a screen recording. The daily
// clip (daily-clip.mjs + post-kit.mjs) films the theater with a title card on each end; this cuts the story instead:
// a cold open on the best line, who these two are, the best stretch of the date, the confessional that disagrees with
// it, the twist, how it ended, and a card that sends the viewer to the next episode.
//
// It reads only the PUBLIC episode JSON (GET /api/episodes/<id>, what the episode page shows once a date has aired),
// so it can never show what the page wouldn't: an unaired date, a private one, or an agent's own private thoughts.
// Every quoted word is the date's own: a line can be shortened only by keeping some of its sentences (`keep`), and
// the cut marks what it left out with an ellipsis. The words the editor writes (title, sub-lines, the closing card)
// are visibly the show's captions, never put in a character's mouth.
//
// Voices: Kokoro on Venice (voice.mjs, about a cent a clip, David's call 2026-11-11), macOS `say` as the fallback.
// Pictures: one still per beat (Chromium), a spoken line's words coming up part by part with its voice, a slow push-in, hard
// cuts (ffmpeg). Free apart from the voices.
//
//   node scripts/clips/episode-cut.mjs <edl.json> [--out <dir>]      (CROWD_BASE, CHROMIUM_PATH, SAY=1 as elsewhere)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromiumPath } from "./daily-clip.mjs";
import { creditLines } from "./post-kit.mjs";
import { sayLine, sayable, soundSeconds, veniceKey, veniceLine, voiceFor } from "./voice.mjs";

/** The frame: drawn at 405×720 CSS px, scaled past 1080×1920 so the push-in never upsamples. */
export const FRAME = { css: { width: 405, height: 720 }, scale: 3.2, out: { width: 1080, height: 1920 }, fps: 30 };
/** Silent beats' lengths, seconds (an EDL segment's `secs` overrides). */
export const SILENT_SECONDS = { title: 2.6, reveal: 3.2, choice: 3, card: 3.4 };
/** Breath around a spoken beat: before the voice starts, and after it ends. */
export const LEAD_IN = 0.12;
export const LEAD_OUT = 0.3;
/** The host's voice for the show's own words (a card's or a title's `say`): a narrator, never a character. */
export const HOST_VOICE = "bm_george";
/** The longest a finished cut may run: Shorts and Reels are up to ~90 s in practice for this kind of piece. */
export const MAX_SECONDS = 95;
/** Kokoro's pace for a cut (an EDL's `speed` overrides): a little brisker than the daily clip, as short video expects. */
export const VOICE_SPEED = 1.1;

const ENDING_LABELS = { second_date: "A second date", friends: "Just friends", close_friends: "Close friends", disaster: "A disaster" };

/**
 * How the episode page names its ending (pure). A "second_date" ending between two who have met before is the page's
 * "A fifth date", "A seventh date": the page's own why line starts with that name, so the reveal reads it from there
 * rather than calling a fifth date a second one. Falls back to the plain label.
 */
export function endingLabel(e) {
  const named = /^(An? [a-z]+(?:-[a-z]+)? date|Just friends|Close friends|A disaster)(?=:)/.exec(String(e?.why ?? ""));
  return named ? named[1] : ENDING_LABELS[e?.ending] ?? null;
}
const SEE_AGAIN = { yes: "Yes", maybe: "Maybe", no: "No" };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** A line's sentences (pure): split after . ! ? or … followed by a space, kept with their punctuation. */
export function sentences(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.split(/(?<=[.!?…])\s+(?=[A-Z0-9"'“‘(*])/).map((s) => s.trim()).filter(Boolean);
}

/**
 * The words a beat shows (pure): the whole line, or only the sentences `keep` names, in order. Each kept sentence is
 * whole, so dropping sentences before the first or after the last changes nothing a sentence says; sentences dropped
 * BETWEEN kept ones become " … ", so two sentences never read as if they were said back to back when they weren't.
 */
export function pickText(text, keep) {
  const all = sentences(text);
  if (!keep || !keep.length) return all.join(" ");
  const want = [...new Set(keep)].sort((a, b) => a - b);
  for (const i of want) if (!Number.isInteger(i) || i < 0 || i >= all.length) throw new Error(`keep: no sentence ${i} in "${String(text).slice(0, 60)}…" (${all.length} sentences)`);
  const parts = [];
  want.forEach((i, n) => {
    if (n > 0 && i !== want[n - 1] + 1) parts.push("…");
    parts.push(all[i]);
  });
  return parts.join(" ");
}

/** The most words a line shows at once before the next part of it appears (chunksOf). */
export const CHUNK_WORDS = 9;

/**
 * A line in the parts it appears in (pure), so the words come up with the voice instead of sitting still for seconds:
 * whole sentences, a long one split at its commas, semicolons or dashes, and only then by words. Never a piece under
 * three words where it can be helped. Joined with spaces, the parts are the line again.
 */
export function chunksOf(text) {
  const words = (s) => s.split(" ").filter(Boolean).length;
  const pieces = [];
  for (const s of sentences(text)) {
    if (words(s) <= CHUNK_WORDS) {
      pieces.push(s);
      continue;
    }
    let cur = "";
    for (const part of s.split(/(?<=[,;:—–])\s+/)) {
      const next = cur ? `${cur} ${part}` : part;
      if (cur && words(next) > CHUNK_WORDS && words(cur) >= 3) {
        pieces.push(cur);
        cur = part;
      } else cur = next;
    }
    if (cur) pieces.push(cur);
  }
  const out = [];
  for (const piece of pieces) {
    const w = piece.split(" ").filter(Boolean);
    if (w.length <= Math.round(CHUNK_WORDS * 1.6)) {
      out.push(piece);
      continue;
    }
    const parts = [];
    for (let i = 0; i < w.length; i += CHUNK_WORDS) parts.push(w.slice(i, i + CHUNK_WORDS));
    if (parts.length > 1 && parts.at(-1).length < 3) parts.at(-2).push(...parts.pop());
    out.push(...parts.map((p) => p.join(" ")));
  }
  // A lone "…" (pickText's gap) or a scrap under three words rides with its neighbour.
  for (let i = out.length - 1; i > 0; i--) if (words(out[i]) < 3 || /^…$/.test(out[i])) out.splice(i - 1, 2, `${out[i - 1]} ${out[i]}`);
  if (out.length > 1 && words(out[0]) < 3) out.splice(0, 2, `${out[0]} ${out[1]}`);
  return out;
}

/** The kinds of beat whose words appear part by part with the voice. */
const REVEALED = new Set(["cold", "line", "thought", "diary"]);

/**
 * How long each part of a spoken beat stays the newest one on screen (pure): the voice's length shared by the parts'
 * lengths in characters, the breath before the voice on the first, the breath after it on the last. Sums to `seconds`.
 */
export function chunkTimes(chunks, voiceSeconds, seconds) {
  if (chunks.length <= 1 || !(voiceSeconds > 0)) return [seconds];
  const chars = chunks.map((c) => c.length);
  const all = chars.reduce((a, b) => a + b, 0);
  const times = chars.map((n) => (voiceSeconds * n) / all);
  times[0] += LEAD_IN;
  const used = times.reduce((a, b) => a + b, 0);
  times[times.length - 1] += Math.max(0, seconds - used);
  return times.map((t) => Math.round(t * 1000) / 1000);
}

/** A character of an episode by side ("a"/"b"), with the other one. */
function sideOf(e, side) {
  const i = side === "a" ? 0 : side === "b" ? 1 : -1;
  if (i < 0) throw new Error(`side must be "a" or "b", not ${JSON.stringify(side)}`);
  return { me: e.characters[i], other: e.characters[1 - i], i };
}

/**
 * The EDL's segments as beats (pure): each one checked against the public episode it names, so a cut can't quote a
 * line that isn't there or a thought the page doesn't show. Throws with the segment's number on any mistake.
 */
export function resolveBeats(edl, episodes) {
  if (!Array.isArray(edl?.segments) || !edl.segments.length) throw new Error("the EDL has no segments");
  return edl.segments.map((s, n) => {
    const where = `segment ${n + 1} (${s.kind})`;
    const e = episodes[s.ep ?? 0];
    if (!e) throw new Error(`${where}: no episode ${s.ep ?? 0}`);
    const lines = e.transcript ?? [];
    const base = { kind: s.kind, ep: s.ep ?? 0, episode: e, secs: s.secs ?? null, label: s.label ?? null };
    switch (s.kind) {
      case "cold":
      case "line": {
        const t = lines[s.line];
        if (!t || !String(t.dialogue ?? "").trim()) throw new Error(`${where}: line ${s.line} has no dialogue`);
        const { me, other } = sideOf(e, t.side);
        return { ...base, speaker: me, other, emotion: t.emotion ?? null, text: pickText(t.dialogue, s.keep), voiced: true, voice: voiceFor(me), label: s.label ?? null };
      }
      case "thought": {
        const thought = e.inner?.thoughts?.[s.line];
        if (!thought) throw new Error(`${where}: line ${s.line} has no public thought`);
        const t = lines[s.line];
        const { me, other } = sideOf(e, t?.side);
        return { ...base, speaker: me, other, text: pickText(thought, s.keep), voiced: true, voice: voiceFor(me), label: s.label ?? `What ${firstName(me.name)} was thinking` };
      }
      case "diary": {
        const { me, other } = sideOf(e, s.side);
        const entry = (e.diary ?? []).find((d) => d.character_id === me.id);
        if (!entry?.line) throw new Error(`${where}: no public diary line for ${me.name}`);
        return { ...base, speaker: me, other, text: pickText(entry.line, s.keep), voiced: true, voice: voiceFor(me), label: s.label ?? `${firstName(me.name)}, afterwards` };
      }
      case "choice": {
        const answers = e.characters.map((c) => (e.inner?.choices ?? []).find((x) => x.character_id === c.id)?.see_again ?? null);
        if (answers.some((a) => !a)) throw new Error(`${where}: the episode doesn't show both answers`);
        return { ...base, answers, voiced: false, label: s.label ?? "Would they see each other again?" };
      }
      case "title":
      case "card": {
        if (!s.title) throw new Error(`${where}: a ${s.kind} needs a title`);
        // Whose faces a title shows: both of its episode's (the default), or a list of [episode, side] pairs, e.g. one
        // character alone or the three people a character dated. A card shows none unless it names some.
        const faces = Array.isArray(s.faces)
          ? s.faces.map(([ep, side], k) => {
              const fe = episodes[ep];
              if (!fe) throw new Error(`${where}: face ${k + 1} names no episode ${ep}`);
              return sideOf(fe, side).me;
            })
          : s.kind === "title"
            ? e.characters
            : [];
        return { ...base, faces, kicker: s.kicker ?? null, title: s.title, sub: s.sub ?? null, url: s.url ?? null, say: s.say ?? null, voiced: Boolean(s.say), voice: HOST_VOICE };
      }
      case "reveal":
        if (!ENDING_LABELS[e.ending]) throw new Error(`${where}: the episode has no ending yet`);
        return { ...base, ending: e.ending, title: endingLabel(e), sub: s.sub ?? null, say: s.say ?? null, voiced: Boolean(s.say), voice: HOST_VOICE };
      default:
        throw new Error(`${where}: unknown kind`);
    }
  });
}

/** A beat's length on screen (pure): its voice plus breath, or its silent length. */
export function beatSeconds(beat, voiceSeconds) {
  if (beat.secs) return Math.max(beat.secs, beat.voiced && voiceSeconds ? voiceSeconds + LEAD_IN + LEAD_OUT : 0);
  if (beat.voiced && voiceSeconds > 0) return Math.round((voiceSeconds + LEAD_IN + LEAD_OUT) * 100) / 100;
  return SILENT_SECONDS[beat.kind] ?? 2.5;
}

/** What a beat says out loud (pure): a character's words, or the host's for a card, title or reveal. */
export function spokenText(beat) {
  if (!beat.voiced) return "";
  return sayable(beat.kind === "title" || beat.kind === "card" || beat.kind === "reveal" ? beat.say : beat.text);
}

/** The type size that keeps a line on one phone screen (pure). */
export function textSize(text) {
  const n = String(text ?? "").length;
  return n <= 50 ? 31 : n <= 90 ? 27 : n <= 140 ? 23 : n <= 210 ? 20 : 17.5;
}

const img = (src, base) => (src ? esc(new URL(src, base).href) : "");

/** A row of faces for a title or card: one large, two with a ×, three or more smaller and side by side. */
function facesRow(faces, face) {
  if (!faces?.length) return "";
  if (faces.length === 1) return `<div class="stage solo">${face(faces[0], "speaker")}</div>`;
  if (faces.length === 2) return `<div class="stage pair">${faces.map((c) => face(c, "speaker")).join('<span class="x">×</span>')}</div>`;
  return `<div class="stage pair small">${faces.map((c) => face(c)).join("")}</div>`;
}

/** The venue's backdrop on the site (lib/portraits.ts venueBackdrop): /cast/venue-<id>-v2.webp, or none. */
export function backdropOf(venue) {
  const id = String(venue ?? "").split(/[@:]/)[0].trim();
  return /^[a-z_]+$/.test(id) && id !== "elsewhere" ? `/cast/venue-${id}-v2.webp` : null;
}

/** One frame's HTML (pure), in the site's type and colours, text kept out of the apps' bottom and side overlays. */
export function frameHtml(beat, { base, shown = null }) {
  const e = beat.episode;
  // The words on screen: all of them, or the first `shown` parts (chunksOf) with the rest held in place but hidden, so
  // the bubble keeps its size while the line fills in.
  const said = (text) => {
    if (shown == null) return esc(text);
    const parts = chunksOf(text);
    return parts.map((p, i) => (i < shown ? esc(p) : `<span class="hide">${esc(p)}</span>`)).join(" ");
  };
  const bg = backdropOf(e.venue);
  const face = (c, cls = "") => `<figure class="${cls}"><img src="${img(c.portrait, base)}" alt=""><figcaption>${esc(firstName(c.name))}</figcaption></figure>`;
  const top = `<header><span class="brand">Botchelor</span><span class="ep">${esc(e.title ?? "")}</span></header>`;
  let body;
  switch (beat.kind) {
    case "cold":
    case "line":
      body = `${top}<div class="stage">${face(beat.other, "other")}${face(beat.speaker, "speaker")}</div>
        <div class="bubble ${beat.speaker === e.characters[0] ? "left" : "right"}">${beat.label ? `<p class="kick">${esc(beat.label)}</p>` : beat.kind === "cold" ? '<p class="kick">Tonight</p>' : ""}${beat.emotion ? `<span class="emo">${esc(beat.emotion)}</span>` : ""}<p class="said" style="font-size:${textSize(beat.text)}px">${said(beat.text)}</p></div>`;
      break;
    case "thought":
      body = `${top}<div class="stage solo">${face(beat.speaker, "speaker think")}</div><div class="private"><p class="kick">${esc(beat.label)}</p><p class="said thought" style="font-size:${textSize(beat.text)}px">${said(beat.text)}</p><p class="fine">A private thought, shown once the date aired</p></div>`;
      break;
    case "diary":
      body = `${top}<div class="stage solo">${face(beat.speaker, "speaker diary")}</div><div class="private diarybox"><p class="kick"><span class="rec"></span>The diary cam</p><p class="said" style="font-size:${textSize(beat.text)}px">“${said(beat.text)}”</p><p class="fine">${esc(beat.label)}</p></div>`;
      break;
    case "choice":
      body = `${top}<p class="kick center">${esc(beat.label)}</p><div class="stage pair">${e.characters
        .map((c, i) => `<div class="answer">${face(c, "speaker")}<span class="stamp ${esc(beat.answers[i])}">${esc(SEE_AGAIN[beat.answers[i]] ?? beat.answers[i])}</span></div>`)
        .join("")}</div>`;
      break;
    case "reveal":
      body = `${top}<p class="kick center">How it ended</p><div class="stage pair small">${e.characters.map((c) => face(c)).join('<span class="x">×</span>')}</div><p class="ending ${esc(beat.ending)}">${esc(beat.title)}</p>${beat.sub ? `<p class="sub">${esc(beat.sub)}</p>` : ""}`;
      break;
    case "title":
      body = `${beat.kicker ? `<p class="kick center">${esc(beat.kicker)}</p>` : ""}${facesRow(beat.faces, face)}<h1>${esc(beat.title)}</h1>${beat.sub ? `<p class="sub">${esc(beat.sub)}</p>` : ""}`;
      break;
    case "card":
      body = `<p class="brand big">Botchelor</p>${beat.faces?.length ? facesRow(beat.faces, face) : ""}${beat.kicker ? `<p class="kick center">${esc(beat.kicker)}</p>` : ""}<h1>${esc(beat.title)}</h1>${beat.sub ? `<p class="sub">${esc(beat.sub)}</p>` : ""}${beat.url ? `<p class="url">${esc(beat.url)}</p>` : ""}<p class="fine">AI characters · AI-generated fiction</p>`;
      break;
    default:
      body = "";
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@500;600;700&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
html,body{width:405px;height:720px;overflow:hidden}
body{font-family:Inter,system-ui,sans-serif;color:#fff;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:58px 30px 150px;text-align:center;background:#140a18}
.bg{position:absolute;inset:-12px;background:${bg ? `url("${img(bg, base)}") center/cover` : "none"};filter:blur(3px) saturate(1.1);opacity:.55;z-index:0}
.veil{position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,rgba(20,10,24,.55) 0%,rgba(58,20,80,.55) 45%,rgba(20,10,24,.92) 100%)}
body>*:not(.bg):not(.veil){position:relative;z-index:1}
header{position:absolute!important;top:20px;left:24px;right:24px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#ffd6e3}
.brand{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:15px;letter-spacing:0;text-transform:none;background:linear-gradient(90deg,#ff5e8c,#c9a6ff);-webkit-background-clip:text;color:transparent}
.brand.big{font-size:44px}
.ep{opacity:.85;text-align:right}
.stage{display:flex;align-items:flex-end;justify-content:center;gap:14px}
.stage.pair{align-items:center}
figure{display:flex;flex-direction:column;align-items:center;gap:6px}
figure img{width:150px;height:150px;border-radius:30px;object-fit:cover;border:3px solid #ff5e8c;box-shadow:0 12px 34px rgba(0,0,0,.5)}
figure figcaption{font-weight:700;font-size:15px}
figure.other img{width:78px;height:78px;border-radius:18px;border-width:2px;opacity:.6;filter:grayscale(.35)}
figure.other figcaption{font-size:11px;opacity:.7}
figure.think img{border-style:dashed;border-color:#c9a6ff}
figure.diary img{border-color:#ff3b3b}
.stage.small figure img{width:96px;height:96px;border-radius:22px}
.x{font-family:Fraunces,Georgia,serif;font-size:28px;color:#ffb3cb}
.bubble{width:100%;background:rgba(255,255,255,.95);color:#24112c;border-radius:22px;padding:16px 18px 18px;text-align:left;box-shadow:0 12px 30px rgba(0,0,0,.35)}
.bubble.right{border-bottom-right-radius:6px}.bubble.left{border-bottom-left-radius:6px}
.said{font-family:Fraunces,Georgia,serif;font-weight:600;line-height:1.22}
.emo{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a0306a;background:#ffe3ee;border-radius:999px;padding:3px 9px;margin-bottom:8px}
.kick{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#ffb3cb}
.bubble .kick{color:#c2185b;margin-bottom:6px}
.kick.center{text-align:center}
.private{width:100%;border:2px dashed rgba(201,166,255,.8);background:rgba(20,10,24,.55);border-radius:20px;padding:16px 18px;text-align:left;display:flex;flex-direction:column;gap:10px}
.diarybox{border:2px solid rgba(255,59,59,.85)}
.rec{display:inline-block;width:9px;height:9px;border-radius:50%;background:#ff3b3b;margin-right:7px;vertical-align:1px}
.thought{font-style:italic;font-weight:500}
.hide{visibility:hidden}
.fine{font-size:11px;color:#d9c4e6}
.answer{display:flex;flex-direction:column;align-items:center;gap:10px}
.stamp{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:24px;border-radius:12px;padding:4px 16px;border:3px solid currentColor;transform:rotate(-6deg)}
.stamp.yes{color:#7dffb0}.stamp.maybe{color:#ffd36b}.stamp.no{color:#ff6b6b}
h1{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:33px;line-height:1.15}
.sub{font-size:16px;font-weight:600;color:#ffd6e3;line-height:1.35}
.ending{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:40px;line-height:1.1}
.ending.disaster{color:#ff8a8a}.ending.second_date{color:#ff9cc0}.ending.friends,.ending.close_friends{color:#ffd36b}
.url{font-size:19px;font-weight:700;background:#e5356b;border-radius:999px;padding:11px 22px}
</style></head><body><div class="bg"></div><div class="veil"></div>${body}</body></html>`;
}

/** How far a beat's slow push-in goes by its end (1 + ZOOM): enough to read as movement on a phone, never a lurch. */
export const ZOOM = 0.06;

/**
 * The ffmpeg arguments for one beat's segment (pure): its stills in order (one, or one per part of a line as it fills
 * in: `frames` [{file, secs}]), one slow push-in across all of them, over its voice or silence. `fadeIn`/`fadeOut`: a
 * short fade at either end (renderCut cuts hard between beats and fades only the end: a first frame faded up from
 * black is a black thumbnail and a black first second in the feed).
 */
export function segmentArgs({ frame, frames, voice, seconds, out, fadeIn = true, fadeOut = true }) {
  const list = frames?.length ? frames : [{ file: frame, secs: seconds }];
  const total = Math.max(list.length, Math.round(seconds * FRAME.fps));
  const counts = list.map((f) => Math.max(1, Math.round(f.secs * FRAME.fps)));
  counts[counts.length - 1] = Math.max(1, total - counts.slice(0, -1).reduce((a, b) => a + b, 0));
  const { width, height } = FRAME.out;
  const inputs = list.flatMap((f, i) => ["-loop", "1", "-framerate", String(FRAME.fps), "-t", (counts[i] / FRAME.fps).toFixed(3), "-i", f.file]);
  const zoom = `zoompan=z='1+${ZOOM}*on/${total}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${FRAME.fps}`;
  const outAt = Math.max(0, seconds - 0.14).toFixed(2);
  const joined = list.length > 1 ? `${list.map((_, i) => `[${i}:v]`).join("")}concat=n=${list.length}:v=1:a=0,` : "[0:v]";
  const video = `${joined}${zoom},${fadeIn ? "fade=t=in:st=0:d=0.12," : ""}${fadeOut ? `fade=t=out:st=${outAt}:d=0.14,` : ""}format=yuv420p[v]`;
  const a = list.length;
  const delay = Math.round(LEAD_IN * 1000);
  const audio = voice
    ? `[${a}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delay}|${delay},apad=whole_dur=${seconds.toFixed(3)},atrim=0:${seconds.toFixed(3)}[a]`
    : `[${a}:a]atrim=0:${seconds.toFixed(3)}[a]`;
  return [
    "-y", "-loglevel", "error",
    ...inputs,
    ...(voice ? ["-i", voice] : ["-f", "lavfi", "-t", seconds.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"]),
    "-filter_complex", `${video};${audio}`,
    "-map", "[v]", "-map", "[a]", "-t", seconds.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FRAME.fps),
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    out,
  ];
}

/**
 * The ffmpeg arguments that join the segments (pure): pictures copied as they are, the sound brought to the loudness
 * short video plays at (-14 LUFS, peaks under -1.5 dB), so a cut isn't the quiet one in someone's feed.
 */
export const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11";
export function joinArgs(list, out) {
  return ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "copy", "-af", LOUDNESS, "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out];
}

/** The caption to paste (pure): the editor's hook and question, where to watch, the AI line, tags (the loop re-tags ?s=). */
export function cutCaption(edl, episodes, base = "https://botchelor.com") {
  const host = new URL(base).host;
  const watch = edl.watch ?? `${host}${episodes[0].share_path ?? `/episodes/${episodes[0].id}`}`;
  const tags = [...new Set(`#botchelor #aicharacters #datingshow #realitytv #originalcharacter ${edl.tags ?? ""}`.split(/\s+/).filter((t) => t.startsWith("#")))];
  return [
    edl.hook,
    "",
    edl.question,
    "",
    `${edl.watch_label ?? "Watch the whole date"}: ${watch}${watch.includes("?") ? "&" : "?"}s=tiktok`,
    "Every character is AI, and every date is AI-generated fiction.",
    ...creditLines(episodes.flatMap((e) => e.characters ?? [])),
    "",
    tags.join(" "),
  ]
    .filter((l) => l !== undefined && l !== null)
    .join("\n");
}

async function speak(beat, file, key, log, speed = VOICE_SPEED) {
  const words = spokenText(beat);
  if (!words) return null;
  if (key) {
    try {
      await veniceLine(words, beat.voice, `${file}.mp3`, key, speed);
      return `${file}.mp3`;
    } catch (err) {
      // The host's voice is the one most likely to be refused (a voice Venice doesn't carry): a stock one stands in.
      if (beat.voice === HOST_VOICE) {
        try {
          await veniceLine(words, "am_michael", `${file}.mp3`, key, speed);
          return `${file}.mp3`;
        } catch {
          /* say, below */
        }
      }
      log(`voice: Venice failed for a ${beat.kind} (${err.message}); macOS say instead`);
    }
  }
  sayLine(words, beat.speaker?.pronouns, `${file}.m4a`);
  return `${file}.m4a`;
}

/** The public episodes an EDL names, each checked to be an aired public date (what the episode page shows). */
export async function fetchEpisodes(ids, base, headers = { "user-agent": "botchelor-clip/1.0", cookie: "bz_adult=1" }) {
  if (!ids?.length) throw new Error("the EDL names no episodes");
  const episodes = [];
  for (const id of ids) {
    const e = await (await fetch(`${base}/api/episodes/${id}`, { headers })).json();
    if (!e?.id) throw new Error(`no episode ${id}`);
    if (!e.revealed || e.visibility !== "public") throw new Error(`only a public date that has aired goes in a cut (${id})`);
    episodes.push(e);
  }
  return episodes;
}

/**
 * Renders a cut into `out`: post.mp4, cover.png (the frame of beat `edl.cover`, all its words shown), caption.txt,
 * edl.json and, last, checklist.md (a folder is ready once that's there). `caption` and `checklist` replace the
 * hand-edited cut's own (the daily episode writes its own; `checklist` may be a function of {total, beats, voices}).
 * Returns {total, beats, seconds, voices}.
 */
export async function renderCut(edl, episodes, { base, out, log = (m) => console.error(m), caption = null, checklist = null }) {
  const beats = resolveBeats(edl, episodes);
  mkdirSync(out, { recursive: true });
  rmSync(join(out, "checklist.md"), { force: true });
  const tmp = mkdtempSync(join(tmpdir(), "botchelor-cut-"));
  try {
    const key = process.env.SAY === "1" ? null : veniceKey();
    const voices = [];
    for (let i = 0; i < beats.length; i++) voices.push(await speak(beats[i], join(tmp, `v${String(i).padStart(2, "0")}`), key, log, edl.speed ?? VOICE_SPEED));
    const voiceSecs = voices.map((v) => (v ? soundSeconds(v) : 0));
    const seconds = beats.map((b, i) => beatSeconds(b, voiceSecs[i]));
    const total = seconds.reduce((a, b) => a + b, 0);
    if (total > MAX_SECONDS) throw new Error(`the cut runs ${total.toFixed(1)} s, over ${MAX_SECONDS}: trim it`);

    // Each beat's stills: one, or one per part of a spoken line as its words come up with the voice (chunksOf).
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chromiumPath() });
    const stills = [];
    try {
      const page = await browser.newPage({ viewport: FRAME.css, deviceScaleFactor: FRAME.scale });
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        const parts = REVEALED.has(b.kind) && voices[i] && edl.reveal !== false ? chunksOf(b.text) : [];
        const times = parts.length > 1 ? chunkTimes(parts, voiceSecs[i], seconds[i]) : [seconds[i]];
        const list = [];
        for (let k = 0; k < times.length; k++) {
          await page.setContent(frameHtml(b, { base, shown: times.length > 1 ? k + 1 : null }), { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          const f = join(tmp, `f${String(i).padStart(2, "0")}-${k}.png`);
          await page.screenshot({ path: f });
          list.push({ file: f, secs: times[k] });
        }
        stills.push(list);
      }
    } finally {
      await browser.close();
    }

    const ffmpeg = process.env.FFMPEG || "ffmpeg";
    const segs = [];
    for (let i = 0; i < beats.length; i++) {
      const seg = join(tmp, `s${String(i).padStart(2, "0")}.mp4`);
      // Hard cuts between beats, as short video is cut (a dip to black between every beat read as flicker on a phone, and
      // the first frame faded up from black was a black thumbnail); only the very end fades out.
      execFileSync(ffmpeg, segmentArgs({ frames: stills[i], voice: voices[i], seconds: seconds[i], out: seg, fadeIn: false, fadeOut: i === beats.length - 1 }));
      segs.push(seg);
    }
    const list = join(tmp, "parts.txt");
    writeFileSync(list, segs.map((p) => `file '${p}'`).join("\n") + "\n");
    execFileSync(ffmpeg, joinArgs(list, join(out, "post.mp4")));
    copyFileSync(stills[edl.cover ?? 0].at(-1).file, join(out, "cover.png"));
    writeFileSync(join(out, "caption.txt"), (caption ?? cutCaption(edl, episodes, base)) + "\n");
    writeFileSync(join(out, "edl.json"), JSON.stringify(edl, null, 2) + "\n");
    const pair = episodes[0].characters.map((c) => c.name).join(" × ");
    writeFileSync(
      join(out, "checklist.md"),
      (typeof checklist === "function" ? checklist({ total, beats, voices: key ? "Kokoro (Venice)" : "macOS say" }) : checklist ?? [
        `# Posting the episode cut: ${edl.name ?? pair}`,
        "",
        ...episodes.map((e) => `Episode: ${base}/episodes/${e.id}`),
        `Direction: ${edl.direction ?? "-"} · ${total.toFixed(1)} s · ${beats.length} beats · voices: ${key ? "Kokoro (Venice)" : "macOS say"}`,
        "",
        "1. TikTok → + → Upload → post.mp4.",
        "2. The voices are the characters' AI voices (Kokoro) and the host's. Add a quiet instrumental under them or none.",
        "3. Cover: the first frame, or cover.png.",
        "4. Paste caption.txt.",
        "5. More options → turn on \"AI-generated content\".",
        "6. Audience: everyone (the show is PG); never post After Dark.",
        "",
      ]).join("\n"),
    );
    return { total, beats, seconds, voices: key ? "Kokoro (Venice)" : "macOS say" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const edlFile = process.argv[2];
  if (!edlFile || edlFile.startsWith("--")) throw new Error("usage: node scripts/clips/episode-cut.mjs <edl.json> [--out <dir>]");
  const edl = JSON.parse(readFileSync(edlFile, "utf8"));
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  const episodes = await fetchEpisodes(edl.episodes ?? [], base);
  // Staged in cuts/, never posts/: the marketing loop (idea-factory cutKit) releases one a day, in name order, as that
  // day's video kit. A folder in posts/ would go to the follower channels (Shorts, Reels) at once.
  const out = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : join(process.env.CLIPS_DIR || join(homedir(), "BotchelorClips"), "cuts", basename(edlFile).replace(/\.json$/, ""));
  const { total } = await renderCut(edl, episodes, { base, out });
  console.log(`Episode cut: ${out}\n  post.mp4 (${total.toFixed(1)} s), cover.png, caption.txt, checklist.md, edl.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
