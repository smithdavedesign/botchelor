// The cliffhanger (2026-11-23, the growth wave): the day's episode as a 12 to 20 second short that a stranger watches to
// the end and answers in the comments. The episode cut it replaces as the default (daily-episode.mjs, still made with
// `--format full`) ran 25 to 35 s: two small portraits over a big text card, "Day N" and the host's logline, two or three
// more lines, then the date's report card, which gave the ending away, then tonight's vote. Few watched it to the end.
// The AI shows that spread open on big moving faces, are voiced, stop on a cliffhanger, ask the audience something with
// an answer to come back for, keep their characters recurring, and run 7 to 15 s: completion is what Shorts and TikTok
// reward. So this cut is three beats:
//
//   1. frame 1: the two faces, each half the frame and moving (the character's call face loop where it has one, else the
//      house cast's loop, else a slow push-in on the portrait, the two drifting apart), and the date's best line on
//      screen and in the speaker's voice from the first second, under a few words of setup ("Their seventh date");
//   2. the reply that lands it, in the other's voice, its words coming up as they're said;
//   3. the question, and nothing after it: "How did it end? Eighth date, just friends, or disaster? Call it in the
//      comments." No report card, no grade, no ending. The cut is chosen without reading the ending (cliffhangerEdl
//      takes the lines and the date's number, never `ending`, `why` or the report card), and it quotes no sentence that
//      talks about another date, leaving, goodbyes or an ending by name: that's where a date says how it ended.
//
// The answer comes the next day: the next kit's caption says how this one ended, under its own question, read from the
// public aired record (yesterdaysAnswer). Only the public aired episode is read (fetchEpisodes); every quoted word is the
// date's own, in whole sentences; the setup, the question and the caption are the show's words. Voices as the episode cut
// has them (Kokoro, or macOS `say` with SAY=1); the pictures and sound are put together by Chromium and ffmpeg, free.
//
// A date on film (2026-11-24, lib/date-film.ts): when the date's JSON carries `film`, the cut uses it. Its scenes (both of
// them in the place) fill the frame behind the two quoted lines in place of the two faces, and when one of its filmed
// diary-cam lines says nothing of how the date went (pickConfessional), that clip opens the cut: a face that talks, from
// frame 1, before the hook. Nothing here is required: a date with no film, or film that can't be fetched, is cut exactly
// as before.
//   node scripts/clips/daily-episode.mjs <episode_id> --out <dir>      (the cliffhanger is the default format)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./daily-clip.mjs";
import { bestLineIndex, estimateSeconds, keepFor, SERIES_MARK } from "./daily-episode.mjs";
import { backdropOf, beatSeconds, chunksOf, chunkTimes, endingLabel, fetchEpisodes, firstName, LEAD_IN, LOUDNESS, pickText, resolveBeats, sentences, SILENT_SECONDS, speak, textSize, VOICE_SPEED } from "./episode-cut.mjs";
import { creditLines } from "./post-kit.mjs";
import { soundSeconds, veniceKey } from "./voice.mjs";

/** How long the cut runs, seconds: at least `min` (the question is held), lines fitted to about `fit` before the voices exist. */
export const CLIFF = { min: 12, max: 20, fit: 17 };
/** A hook taken from the end of a line keeps its closing sentences up to this many characters, and at least HOOK_MIN. */
export const HOOK_CHARS = 120;
export const HOOK_MIN = 24;
/** The reply keeps its opening sentences up to this many characters: what answers the hook comes first. */
export const REPLY_CHARS = 130;

/**
 * A sentence that could tell how the date ended, whoever says it (pure): another date by number, "next time", seeing each
 * other again, a goodbye, leaving, or an ending by its name. The cut never quotes one.
 */
export const ENDING_TALK =
  /\b(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|another|next) date\b|\bnext time\b|\bsee (?:you|me|each other) (?:again|soon|next|tomorrow)\b|\bagain\?|\bgood ?(?:bye|night)\b|\b(?:just|close) friends\b|\bdisast(?:er|rous)|\b(?:leave|leaving|go|going|head|heading|walk me) (?:first|home)\b|\b(?:have|got) to (?:go|leave|run)\b|\bgotta go\b/i;
export const tellsEnding = (text) => ENDING_TALK.test(String(text ?? ""));

/**
 * What a line said after the date gives away that a line from the date can't (pure): friends, "again", a kiss, leaving,
 * staying, how it ended. A confessional that opens the cut says none of it. Strict on purpose: leaving a clip out costs
 * nothing (the cut opens on the hook as it always did), and one that hints at the ending costs the question.
 */
export const AFTER_TALK =
  /\bfriends?\b|\bagain\b|\bnext (?:time|week|date|one)\b|\bkiss|\bgood ?(?:bye|night)\b|\bend(?:ed|ing|s)?\b|\bsecond\b|\banother\b|\bsee (?:her|him|them|you)\b|\bcall(?:ed|ing)? (?:her|him|them)\b|\bwalk(?:ed|ing)? (?:out|away|(?:her|him|them|me) home)\b|\bleft\b|\bstay(?:ed)?\b|\bdisaster\b|\bnumber\b/i;
export const tellsAfter = (text) => AFTER_TALK.test(String(text ?? ""));

/** A filmed confessional opens the cut only when it runs no longer than this, seconds. */
export const CONFESSIONAL_MAX_S = 8;

const WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
/** "second", "ninth", "12th": a date's number as the show says it (lib/previously-on.ts ordinalWord). */
export function ordinalWord(n) {
  if (n >= 1 && n <= WORDS.length) return WORDS[n - 1];
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Which date this is for the pair (pure): the episode's date_number, 1 when it has none (a first date). */
const dateNumber = (e) => (Number(e?.date_number) > 1 ? Math.floor(Number(e.date_number)) : 1);

/** The setup over the first line, in the show's words (pure): "Their seventh date", or "A blind date" for a first one. */
export function setupLine(e) {
  const n = dateNumber(e);
  return n > 1 ? `Their ${ordinalWord(n)} date` : "A blind date";
}

/**
 * The big line over the faces on the first frame (pure; David 2026-11-23, "the cast hook"): the faces are the grab, this
 * says why to stay. True by construction: the next beat is the reply, said by `replier`.
 */
export function hookHeadline(replier) {
  return `Watch what ${replier} says back`;
}

/** The ending that means "they'll meet again", named for this pair (pure): "Second date", or "Eighth date" after a seventh. */
export function nextDateOption(e) {
  const w = ordinalWord(dateNumber(e) + 1);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} date`;
}

/** What the question card asks people to do. */
export const ASK_CTA = "Call it in the comments";

/** The question the cut ends on (pure). The same three choices whatever happened: it depends on the date's number only. */
export function askCopy(e) {
  const next = nextDateOption(e);
  return {
    title: "How did it end?",
    options: [next, "Just friends", "Disaster"],
    cta: ASK_CTA,
    say: `How did it end? ${next}, just friends, or disaster? ${ASK_CTA}.`,
  };
}

/** The date's spoken lines with their places in the transcript (pure). */
const spokenLines = (e) => (e.transcript ?? []).map((t, i) => ({ i, text: String(t?.dialogue ?? "").trim() })).filter((l) => l.text);

/**
 * A line's opening sentences for the reply (pure): the first, then the next while they stay within `max` characters,
 * stopping before a sentence that tellsEnding. [] when the first one does.
 */
export function keepHead(text, max = REPLY_CHARS) {
  const all = sentences(text);
  const keep = [];
  let len = -1;
  for (let i = 0; i < all.length; i++) {
    if (tellsEnding(all[i])) break;
    if (keep.length && len + 1 + all[i].length > max) break;
    keep.push(i);
    len += 1 + all[i].length;
  }
  return keep;
}

/**
 * A line's closing sentences for a hook the next line answers (pure): the last, then the ones before it while they stay
 * within `max` characters (or under HOOK_MIN, so a lone "Honestly?" isn't the hook), stopping at a sentence that
 * tellsEnding. [] when the last one does.
 */
export function keepTail(text, max = HOOK_CHARS) {
  const all = sentences(text);
  const keep = [];
  let len = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (tellsEnding(all[i])) break;
    if (keep.length && len >= HOOK_MIN && len + 1 + all[i].length > max) break;
    keep.unshift(i);
    len += 1 + all[i].length;
  }
  return keep;
}

/**
 * The two lines the cut quotes (pure): {hook: {line, keep}, reply: {line, keep}, how}. In order of preference:
 *   "best": the date's best line, in its own sentences, and the opening of the line that answers it;
 *   "best last": the best line as the reply, after the end of the line it answers, when nothing after it can be quoted
 *     (it closes the date, or the next line opens on how it ended);
 *   "question": the last question in the date's second half that has a reply to quote;
 *   "pair": else the latest two lines that can be quoted.
 * The hook is never the date's last line (the goodbye), and no quoted sentence tellsEnding. Throws when the date has
 * too little to cut or nothing to quote without giving the ending away.
 */
export function pickPair(e) {
  const lines = spokenLines(e);
  if (lines.length < 4) throw new Error(`the date has ${lines.length} spoken lines; a cliffhanger needs 4`);
  const clean = (l, keep) => keep.length > 0 && !tellsEnding(pickText(l.text, keep));
  const pair = (h, hookKeep, r, replyKeep, how) => ({ hook: { line: h.i, keep: hookKeep }, reply: { line: r.i, keep: replyKeep }, how });
  const bi = bestLineIndex(e);
  const pos = bi == null ? -1 : lines.findIndex((l) => l.i === bi);
  if (pos >= 0) {
    const best = keepFor(lines[pos].text, e.best_line);
    if (clean(lines[pos], best)) {
      if (pos + 1 < lines.length) {
        const reply = keepHead(lines[pos + 1].text);
        if (clean(lines[pos + 1], reply)) return pair(lines[pos], best, lines[pos + 1], reply, "best");
      }
      if (pos > 0) {
        const hook = keepTail(lines[pos - 1].text);
        if (clean(lines[pos - 1], hook)) return pair(lines[pos - 1], hook, lines[pos], best, "best last");
      }
    }
  }
  for (const how of ["question", "pair"]) {
    for (let p = lines.length - 2; p >= (how === "question" ? Math.floor(lines.length / 2) : 0); p--) {
      const hook = keepTail(lines[p].text);
      const reply = keepHead(lines[p + 1].text);
      if (!clean(lines[p], hook) || !clean(lines[p + 1], reply)) continue;
      if (how === "question" && !/\?["”’')]*$/.test(sentences(lines[p].text).at(-1) ?? "")) continue;
      return pair(lines[p], hook, lines[p + 1], reply, how);
    }
  }
  throw new Error("no two lines of this date can be quoted without giving its ending away");
}

/** Characters a caption's first line may run to: the loop titles a Short with it and adds " #Shorts" when that fits in 100. */
export const TITLE_MAX = 92;

/** The three endings as the caption asks them (pure): "Eighth date, just friends, or disaster?". */
export const optionsLine = (e) => `${nextDateOption(e)}, just friends, or disaster?`;

/**
 * The caption's first line (pure): the question, with the show's name, since the loop makes it the Short's title. With
 * the three endings when they fit (cliffCaption names them further down when they don't).
 */
export function cliffTitle(e, n = 1) {
  const [a, b] = (e.characters ?? []).map((c) => firstName(c.name));
  const question = `Botchelor Day ${n}: how did ${a} and ${b}'s date end?`;
  const tries = [`${question} ${optionsLine(e)}`, question, `Botchelor Day ${n}: how did this AI date end?`];
  return tries.find((t) => t.length <= TITLE_MAX) ?? "Botchelor: how did this AI date end?";
}

/**
 * The filmed diary-cam line that may open the cut (pure), or null: one of the two's, with a clip no longer than
 * CONFESSIONAL_MAX_S, whose words (and the whole diary line they come from) say nothing of how the date went. The
 * shorter of two: the cut is a short.
 */
export function pickConfessional(e) {
  const found = [];
  for (const c of e?.film?.confessionals ?? []) {
    const at = (e.characters ?? []).findIndex((x) => x.id === c?.character_id);
    const line = String(c?.line ?? "").trim();
    const seconds = Number(c?.seconds);
    if ((at !== 0 && at !== 1) || !line || !c?.src || !(seconds > 0) || seconds > CONFESSIONAL_MAX_S) continue;
    const whole = String((e.diary ?? []).find((d) => d.character_id === c.character_id)?.line ?? "");
    // Its own public diary line, or it isn't shown (resolveBeats would refuse it too).
    if (!whole.trim()) continue;
    if ([line, whole].some((t) => tellsEnding(t) || tellsAfter(t) || spoilerHits(t, e).length)) continue;
    found.push({ side: at === 0 ? "a" : "b", line, src: c.src, seconds });
  }
  return found.sort((x, y) => x.seconds - y.seconds)[0] ?? null;
}

/** The date's scene pictures (pure): their addresses, in the date's order. [] when it has none. */
export const filmScenes = (e) => (e?.film?.scenes ?? []).filter((x) => x?.src).map((x) => ({ src: x.src, caption: String(x.caption ?? "") }));

/**
 * The cliffhanger's edit decision list (pure), for episode-cut's resolveBeats and renderCliffhanger: the hook, the reply
 * and the question. Reads the date's lines, best line, characters and number, never its ending. Lines are fitted to about
 * CLIFF.fit seconds by keeping fewer of the reply's opening sentences (or of the hook's, when the best line is the reply).
 * `film` (on unless false): a date on film opens on a filmed confessional when one may open it (a "diary" beat with its
 * `clip`), and lists its `scenes` for the picture behind the lines.
 */
export function cliffhangerEdl(e, { n = 1, film = true } = {}) {
  const [a, b] = (e.characters ?? []).map((c) => firstName(c.name));
  const { hook, reply, how } = pickPair(e);
  const ask = askCopy(e);
  const said = (x) => pickText(e.transcript[x.line].dialogue, x.keep);
  const estimate = () => estimateSeconds(said(hook)) + estimateSeconds(said(reply)) + estimateSeconds(ask.say);
  // The best line itself is never cut short: the other line gives way.
  const give = how === "best last" ? hook : reply;
  const shorten = how === "best last" ? (t, max) => keepTail(t, max) : (t, max) => keepHead(t, max);
  for (const max of [90, 0]) {
    if (estimate() <= CLIFF.fit) break;
    const fewer = shorten(e.transcript[give.line].dialogue, max);
    if (fewer.length && fewer.length < give.keep.length) give.keep = fewer;
  }
  const who = (x) => firstName(e.characters[e.transcript[x.line].side === "a" ? 0 : 1]?.name);
  const open = film ? pickConfessional(e) : null;
  const scenes = film ? filmScenes(e) : [];
  return {
    name: `Day ${n}: ${a} × ${b}`,
    format: "cliffhanger",
    direction: "daily episode (cliffhanger)",
    episodes: [e.id],
    hook: said(hook),
    question: cliffTitle(e, n),
    pick: how,
    cover: 0,
    ...(scenes.length ? { scenes } : {}),
    segments: [
      ...(open ? [{ kind: "diary", side: open.side, label: `${open.side === "a" ? a : b} · diary cam`, clip: { src: open.src, seconds: open.seconds, line: open.line } }] : []),
      { kind: "cold", line: hook.line, keep: hook.keep, label: `${setupLine(e)} · ${who(hook)}`, headline: hookHeadline(who(reply)) },
      { kind: "line", line: reply.line, keep: reply.keep, label: who(reply) },
      { kind: "card", kicker: `Botchelor · Day ${n}`, title: ask.title, sub: ask.options.join(" · "), url: "botchelor.com", say: ask.say, secs: SILENT_SECONDS.card, ask: true },
    ],
  };
}

/** Everything the cut shows or says but the closing question (pure): its labels, its lines, any card's words. */
export function cutText(edl, episodes) {
  const beats = resolveBeats(edl, episodes);
  return beats
    .filter((_, i) => !edl.segments[i].ask)
    .flatMap((b) => [b.headline, b.label, b.text, b.kicker, b.title, b.sub, b.url, b.say])
    .filter(Boolean)
    .join("\n");
}

/**
 * What in `text` would give the date's ending away (pure): its ending by the page's own name ("An eighth date", "Just
 * friends"), a report card, a grade, "how it ended". [] when nothing does. `report`: the date's report card, when known.
 */
export function spoilerHits(text, e, report = null) {
  const t = String(text ?? "");
  const hits = [];
  const label = endingLabel(e);
  if (label && t.toLowerCase().includes(label.toLowerCase())) hits.push(label);
  if (/report card/i.test(t)) hits.push("report card");
  if (/\bgrade/i.test(t)) hits.push("grade");
  if (/(?:^|[\s(“"])[A-DF][+-](?=$|[\s.,;:!?)”"])/.test(t) || /\b(?:got|earned|scored|gets) an? [A-DF](?![\w+-])/.test(t)) hits.push("a letter grade");
  if (report?.grade && new RegExp(`(?:^|\\s)${report.grade.replace(/[+-]/g, "\\$&")}(?=$|[\\s.,;:!?])`).test(t)) hits.push(report.grade);
  if (/\bhow (?:it|the date) ended\b/i.test(t)) hits.push("how it ended");
  return hits;
}

/* ------------------------------------------------------------------------------------------------------------------
 * The answer, the next day
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * The daily episode before day `before` in the posts folder (each kit's checklist carries SERIES_MARK and its episode's
 * link, the way nextDayNumber counts them): {day, episode, dir, date} with the highest day under `before`, or null.
 */
export function previousKit(postsDir, before = Infinity) {
  let dirs = [];
  try {
    dirs = readdirSync(postsDir);
  } catch {
    return null;
  }
  let best = null;
  for (const d of dirs) {
    let text;
    try {
      text = readFileSync(join(postsDir, d, "checklist.md"), "utf8");
    } catch {
      continue; // not a kit
    }
    const day = Number(new RegExp(`${SERIES_MARK}(\\d+)`).exec(text)?.[1]);
    const episode = /\/episodes\/([0-9a-f-]{36})/i.exec(text)?.[1]?.toLowerCase();
    if (!day || !episode || day >= before) continue;
    if (!best || day > best.day) best = { day, episode, dir: d, date: /^\d{4}-\d{2}-\d{2}/.exec(d)?.[0] ?? null };
  }
  return best;
}

const MARKS = { second_date: "💘", friends: "🤝", close_friends: "🤝", disaster: "💔" };

/**
 * Yesterday's answer for the caption (pure): "Yesterday's answer: Star and Sweet → a ninth date 💘", from that date's
 * public episode (its ending as the page names it). "Last episode's" when it was more than a day before. Null without one.
 */
export function answerLine(prev, { daysAgo = 1 } = {}) {
  const label = endingLabel(prev);
  if (!label) return null;
  const [a, b] = (prev.characters ?? []).map((c) => firstName(c.name));
  const mark = MARKS[prev.ending];
  return `${daysAgo != null && daysAgo <= 1 ? "Yesterday's" : "Last episode's"} answer: ${a} and ${b} → ${label.charAt(0).toLowerCase()}${label.slice(1)}${mark ? ` ${mark}` : ""}`;
}

/** Whole days from `date` (YYYY-MM-DD) to `now`'s UTC day (pure), or null. */
export function daysBefore(date, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return null;
  return Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(date)) / 86_400_000);
}

/**
 * The answer to the previous daily episode's question, from the public aired record (fetchEpisodes refuses a date that
 * isn't aired and public any more), or null. Never today's own date: its ending is tomorrow's answer.
 */
export async function yesterdaysAnswer(postsDir, { before, episode, base, now = new Date() }) {
  const prev = previousKit(postsDir, before);
  if (!prev || prev.episode === String(episode ?? "").toLowerCase()) return null;
  try {
    const [p] = await fetchEpisodes([prev.episode], base);
    return answerLine(p, { daysAgo: daysBefore(prev.date, now) });
  } catch {
    return null;
  }
}

const TAGS = "#botchelor #aicharacters #datingshow #realitytv #originalcharacter #aidrama";

/**
 * The caption to paste (pure): the question first (the loop makes it the Short's title), yesterday's answer right under
 * it, then the call to comment, the whole date for whoever can't wait, the AI line, credits and tags.
 */
export function cliffCaption(e, edl, { base = "https://botchelor.com", answer = null } = {}) {
  const host = new URL(base).host;
  const watch = `${host}${e.share_path ?? `/episodes/${e.id}`}?s=tiktok`;
  const options = optionsLine(e);
  return [
    edl.question,
    ...(answer ? [answer] : []),
    "",
    `${edl.question.includes(options) ? "" : `${options} `}Call it in the comments: the answer is in tomorrow's episode.`,
    `Can't wait? The whole date: ${watch}`,
    "Every character is AI, and every date is AI-generated fiction.",
    ...creditLines(e.characters),
    "",
    TAGS,
  ].join("\n");
}

/* ------------------------------------------------------------------------------------------------------------------
 * The frame
 * ------------------------------------------------------------------------------------------------------------------ */

/** The frame: drawn at 405×720 CSS px straight to 1080×1920 (the faces are laid in by ffmpeg, nothing is scaled after). */
export const CLIFF_FRAME = { css: { width: 405, height: 720 }, scale: 1080 / 405, out: { width: 1080, height: 1920 }, fps: 30 };
/** The two faces, in output pixels: each half the frame wide, side by side under a thin top band. */
export const TILES = [
  { x: 0, y: 136, w: 540, h: 940 },
  { x: 540, y: 136, w: 540, h: 940 },
];
/** Where a scene or a filmed confessional goes: both tiles' space, as one picture. */
export const SHOT_AREA = { x: 0, y: TILES[0].y, w: TILES[0].w + TILES[1].w, h: TILES[0].h };
/** A scene's push-in, start to end. */
export const SCENE_ZOOM = { from: 1, to: 1.08 };
/** How far the line's card rides up over the faces' feet, and the question's (taller) card, in output pixels. */
export const CARD_OVERLAP = { line: 88, ask: 200 };
/**
 * A still portrait's push-in, start to end, toward the top of the picture where the face is: it starts a little in, so a
 * half-length portrait's face fills more of the tile without a head-and-shoulders one losing the top of its head.
 */
export const STILL_ZOOM = { from: 1.15, to: 1.3 };

const px = (n) => `${+(n / CLIFF_FRAME.scale).toFixed(3)}px`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const url = (src, base) => (src ? esc(new URL(src, base).href) : "");
const tileStyle = (t) => `left:${px(t.x)};top:${px(t.y)};width:${px(t.w)};height:${px(t.h)}`;

const HEAD = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700&family=Inter:wght@500;600;700&display=block" rel="stylesheet">`;

/**
 * The picture under everything (pure): the venue's backdrop, blurred and veiled as on the episode cut, and each portrait
 * still in its tile (what shows if a face can't be fetched for ffmpeg).
 */
export function baseHtml(e, { base }) {
  const bg = backdropOf(e.venue);
  const tiles = (e.characters ?? [])
    .slice(0, 2)
    .map((c, i) => `<div class="tile" style="${tileStyle(TILES[i])}"><span class="initial">${esc(firstName(c.name).charAt(0))}</span>${c.portrait ? `<img src="${url(c.portrait, base)}" alt="">` : ""}</div>`)
    .join("");
  return `${HEAD}<style>
*{box-sizing:border-box;margin:0}
html,body{width:405px;height:720px;overflow:hidden;background:#140a18}
.bg{position:absolute;inset:-12px;background:${bg ? `url("${url(bg, base)}") center/cover` : "none"};filter:blur(3px) saturate(1.1);opacity:.55}
.veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,10,24,.7) 0%,rgba(58,20,80,.6) 50%,rgba(20,10,24,.94) 100%)}
.tile{position:absolute;overflow:hidden;background:#2a1433;display:flex;align-items:center;justify-content:center}
.tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 12%}
.initial{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:96px;color:#ffb3cb}
</style></head><body><div class="bg"></div><div class="veil"></div>${tiles}</body></html>`;
}

/**
 * One beat's layer over the faces (pure; transparent everywhere else): the show's band, the names, the speaker's tile lit
 * and the other dimmed, and the line in a bubble, or the question. `shown`: how many parts of the line are up (chunksOf),
 * the rest held in place but hidden so the bubble keeps its size; null shows it all (the hook shows it all at once).
 */
export function layerHtml(beat, { e, n = 1, shown = null, plain = false }) {
  const ask = beat.kind === "card";
  const speakerAt = ask ? -1 : beat.speaker === e.characters[0] ? 0 : 1;
  const said = (text) => {
    if (shown == null) return esc(text);
    return chunksOf(text)
      .map((p, i) => (i < shown ? esc(p) : `<span class="hide">${esc(p)}</span>`))
      .join(" ");
  };
  // Over a scene or a filmed confessional (`plain`) there are no two tiles to light: the picture is one frame.
  const tiles = plain
    ? ""
    : e.characters
        .slice(0, 2)
        .map((c, i) => `<div class="tile ${speakerAt < 0 ? "" : i === speakerAt ? "lit" : "dim"} ${i ? "b" : "a"}" style="${tileStyle(TILES[i])}"><span class="name">${esc(firstName(c.name))}</span></div>`)
        .join("");
  const headline = beat.headline ? `<p class="headline" style="bottom:${px(720 * (1080 / 405) - (TILES[0].y + TILES[0].h) + 200)}">${esc(beat.headline)} ↓</p>` : "";
  const seam = plain ? "" : `<div class="seam" style="left:${px(TILES[1].x - 3)};top:${px(TILES[1].y)};height:${px(TILES[1].h)}"></div>`;
  const body = ask
    ? `<div class="card ask"><p class="kick">${esc(beat.kicker)}</p><h1>${esc(beat.title)}</h1><div class="opts">${String(beat.sub ?? "")
        .split(" · ")
        .map((o) => `<span>${esc(o)}</span>`)
        .join("")}</div><p class="cta">${esc(ASK_CTA)}</p><p class="url">${esc(beat.url ?? "botchelor.com")}</p><p class="fine">AI characters · AI-generated fiction</p></div>`
    : `<div class="card bubble ${speakerAt === 0 ? "left" : "right"}">${beat.label ? `<p class="kick">${esc(beat.label)}</p>` : ""}<p class="said" style="font-size:${textSize(beat.text)}px">${said(beat.text)}</p></div>`;
  return `${HEAD}<style>
*{box-sizing:border-box;margin:0}
html,body{width:405px;height:720px;overflow:hidden;background:transparent}
body{font-family:Inter,system-ui,sans-serif;color:#fff;position:relative}
header{position:absolute;top:0;left:0;right:0;height:${px(TILES[0].y)};display:flex;justify-content:space-between;align-items:center;padding:0 16px}
.brand{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:19px;background:linear-gradient(90deg,#ff5e8c,#c9a6ff);-webkit-background-clip:text;color:transparent}
.tag{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ffd6e3}
.tile{position:absolute}
.tile.dim{background:rgba(14,6,18,.42)}
.tile.lit{box-shadow:inset 0 0 0 4px #ff5e8c}
.name{position:absolute;bottom:44px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:5px 11px;border-radius:999px;background:rgba(20,10,24,.75)}
.tile.a .name{left:10px}.tile.b .name{right:10px}
.tile.lit .name{background:#e5356b}
.seam{position:absolute;width:${px(6)};background:#140a18}
.headline{position:absolute;left:14px;right:14px;text-align:center;font-family:Fraunces,Georgia,serif;font-weight:700;font-size:30px;line-height:1.08;color:#fff;text-shadow:0 2px 3px rgba(0,0,0,.9),0 0 22px rgba(20,10,24,.95)}
.card{position:absolute;left:16px;right:16px;top:${px(TILES[0].y + TILES[0].h - CARD_OVERLAP.line)};background:#fff;color:#24112c;border-radius:22px;box-shadow:0 14px 34px rgba(0,0,0,.45)}
.bubble{padding:14px 18px 17px;text-align:left}
.bubble.left{border-top-left-radius:6px}.bubble.right{border-top-right-radius:6px}
.kick{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c2185b;margin-bottom:6px}
.said{font-family:Fraunces,Georgia,serif;font-weight:600;line-height:1.2}
.hide{visibility:hidden}
.ask{top:${px(TILES[0].y + TILES[0].h - CARD_OVERLAP.ask)};padding:16px 16px 14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px}
.ask .kick{margin:0}
.ask h1{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:33px;line-height:1.1}
.opts{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
.opts span{font-size:13.5px;font-weight:700;color:#a0306a;border:2px solid #e5356b;border-radius:999px;padding:5px 11px}
.cta{font-size:16px;font-weight:700}
.url{font-size:15px;font-weight:700;color:#fff;background:#e5356b;border-radius:999px;padding:8px 18px}
.fine{font-size:10px;color:#7a5a86}
</style></head><body><header><span class="brand">Botchelor</span><span class="tag">AI dating show · Day ${esc(n)}</span></header>${tiles}${seam}${headline}${body}</body></html>`;
}

/**
 * The ffmpeg arguments for the whole cut (pure), in one pass: the background still; each face laid into its tile (a loop
 * played round and round, or a still pushed in slowly, the two drifting apart); the layers over them in order (`tops`,
 * each held `secs`); the voices at their moments (`at`, seconds), brought to short video's loudness. Hard cuts: nothing
 * fades in (a first frame faded up from black is a black thumbnail), only the very end fades out.
 * `shots` (a date on film): pictures that fill both tiles for a stretch of the cut, each {kind, file, at, secs}: a
 * "scene" (a still, pushed in slowly) or a "clip" (a filmed confessional, played once from `at`).
 */
export function cliffArgs({ background, faces, shots = [], tops, voices, total, out }) {
  const { fps } = CLIFF_FRAME;
  const { width, height } = CLIFF_FRAME.out;
  const T = total.toFixed(3);
  const frames = Math.max(1, Math.round(total * fps));
  const args = ["-y", "-loglevel", "error", "-loop", "1", "-framerate", String(fps), "-t", T, "-i", background];
  const graph = [`[0:v]scale=${width}:${height},setsar=1,format=yuv420p[bg]`];
  let input = 1;
  let under = "bg";
  faces.forEach((f, i) => {
    if (!f || !TILES[i]) return;
    const { x, y, w, h } = TILES[i];
    if (f.kind === "loop") {
      args.push("-stream_loop", "-1", "-i", f.file);
      graph.push(`[${input}:v]fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-ow)/2:(ih-oh)*0.12,setsar=1,format=yuv420p[f${i}]`);
    } else {
      // Drawn at twice the tile's size so the slow push-in moves by half pixels; the faces drift apart as it goes.
      args.push("-loop", "1", "-framerate", String(fps), "-t", T, "-i", f.file);
      const drift = i === 0 ? `0.3+0.4*on/${frames}` : `0.7-0.4*on/${frames}`;
      graph.push(
        `[${input}:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2}:(iw-ow)/2:(ih-oh)*0.12,` +
          `zoompan=z='${STILL_ZOOM.from}+${(STILL_ZOOM.to - STILL_ZOOM.from).toFixed(3)}*on/${frames}':x='(iw-iw/zoom)*(${drift})':y='(ih-ih/zoom)*0.15':d=1:s=${w}x${h}:fps=${fps},setsar=1,format=yuv420p[f${i}]`,
      );
    }
    graph.push(`[${under}][f${i}]overlay=${x}:${y}[u${i}]`);
    under = `u${i}`;
    input++;
  });
  shots.forEach((s, k) => {
    const { x, y, w, h } = SHOT_AREA;
    const at = s.at.toFixed(3);
    if (s.kind === "clip") {
      args.push("-i", s.file);
      graph.push(`[${input}:v]fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-ow)/2:(ih-oh)*0.12,setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${at}/TB[s${k}]`);
    } else {
      // Drawn at twice the size so the slow push-in moves by half pixels, toward the upper part where the faces are.
      const n = Math.max(1, Math.round(s.secs * fps));
      args.push("-loop", "1", "-framerate", String(fps), "-t", s.secs.toFixed(3), "-i", s.file);
      graph.push(
        `[${input}:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2}:(iw-ow)/2:(ih-oh)*0.2,` +
          `zoompan=z='${SCENE_ZOOM.from}+${(SCENE_ZOOM.to - SCENE_ZOOM.from).toFixed(3)}*on/${n}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*0.3':d=1:s=${w}x${h}:fps=${fps},setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${at}/TB[s${k}]`,
      );
    }
    graph.push(`[${under}][s${k}]overlay=${x}:${y}:eof_action=pass:enable='between(t,${at},${(s.at + s.secs).toFixed(3)})'[su${k}]`);
    under = `su${k}`;
    input++;
  });
  for (const t of tops) args.push("-loop", "1", "-framerate", String(fps), "-t", t.secs.toFixed(3), "-i", t.file);
  graph.push(`${tops.map((_, k) => `[${input + k}:v]`).join("")}concat=n=${tops.length}:v=1:a=0,format=rgba[top]`);
  graph.push(`[${under}][top]overlay=0:0:format=auto,fade=t=out:st=${Math.max(0, total - 0.14).toFixed(2)}:d=0.14,format=yuv420p[v]`);
  input += tops.length;
  const spoken = voices.filter(Boolean);
  if (spoken.length) {
    spoken.forEach((v, k) => {
      args.push("-i", v.file);
      const ms = Math.round(v.at * 1000);
      graph.push(`[${input + k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${ms}|${ms}[a${k}]`);
    });
    graph.push(`${spoken.map((_, k) => `[a${k}]`).join("")}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0,apad=whole_dur=${T},atrim=0:${T},${LOUDNESS},aresample=48000[a]`);
  } else {
    args.push("-f", "lavfi", "-t", T, "-i", "anullsrc=r=48000:cl=stereo");
    graph.push(`[${input}:a]atrim=0:${T}[a]`);
  }
  return [
    ...args,
    "-filter_complex", graph.join(";"),
    "-map", "[v]", "-map", "[a]", "-t", T,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
    out,
  ];
}

/** Each beat's length (pure): its voice and breath (a card at least its silent length), the question held so the whole runs CLIFF.min. */
export function cliffSeconds(beats, voiceSecs, fixed = []) {
  // A filmed confessional runs exactly as long as its clip (`fixed`), not its voice and a breath.
  const secs = beats.map((b, i) => fixed[i] ?? beatSeconds(b, voiceSecs[i]));
  const total = secs.reduce((a, b) => a + b, 0);
  if (total < CLIFF.min && secs.length) secs[secs.length - 1] += CLIFF.min - total;
  return secs.map((s) => Math.round(s * 1000) / 1000);
}

/* ------------------------------------------------------------------------------------------------------------------
 * The faces
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * The house cast's own face loops (lib/face-loops.ts, the tall 3:4 cut: the intro's frame, made from the portrait the
 * cast wears now). tests/cliffhanger.test.ts keeps this list the same as that file's.
 */
export const HOUSE_LOOPS = {
  "house-barnaby": "/cast/house-barnaby-loop-tall-a.mp4",
  "house-juniper": "/cast/house-juniper-loop-tall-a.mp4",
  "house-nell": "/cast/house-nell-loop-tall-a.mp4",
  "house-sable": "/cast/house-sable-loop-tall-a.mp4",
};

const IMAGE_EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

/**
 * Where a character's moving face comes from, in order (pure): their call face loop (lib/face-kit.ts; #2077/#2080: a kit
 * is the portrait and a loop, PG-checked and public), the house cast's loop, else their portrait, pushed in slowly.
 */
export function faceChoices(c, kit) {
  return [
    ...(kit?.loop ? [{ url: kit.loop, kind: "loop", from: "call face loop" }] : []),
    ...(Object.hasOwn(HOUSE_LOOPS, c.id) ? [{ url: HOUSE_LOOPS[c.id], kind: "loop", from: "house loop" }] : []),
    ...(c.portrait ? [{ url: c.portrait, kind: "still", from: "portrait push-in" }] : []),
  ];
}

/** A character's face fetched into `dir` for ffmpeg: {file, kind, from}, the first of faceChoices that downloads, or null. */
export async function faceMedia(c, { base, dir, headers = { "user-agent": "botchelor-clip/1.0", cookie: "bz_adult=1" } }) {
  let kit = null;
  try {
    const res = await fetch(`${base}/api/face-kit?character=${encodeURIComponent(c.id)}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (res.ok) kit = (await res.json())?.kit ?? null;
  } catch {
    /* no kit: the next choice */
  }
  for (const [k, choice] of faceChoices(c, kit).entries()) {
    try {
      const res = await fetch(new URL(choice.url, base), { headers, signal: AbortSignal.timeout(30_000) });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      const ok = choice.kind === "loop" ? type === "video/mp4" : Boolean(IMAGE_EXT[type]);
      if (!res.ok || !ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length || bytes.length > 30 * 1024 * 1024) continue;
      const file = join(dir, `face-${String(c.id).replace(/[^a-zA-Z0-9-]/g, "")}-${k}.${choice.kind === "loop" ? "mp4" : IMAGE_EXT[type]}`);
      writeFileSync(file, bytes);
      return { file, kind: choice.kind, from: choice.from };
    } catch {
      /* the next choice */
    }
  }
  return null;
}

/** What a file is, from its first bytes (pure): "mp4", "webp", "png", "jpg" or null. */
export function fileKind(bytes) {
  const b = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, Math.min(bytes.length, 16));
  if (b.length > 12 && b.toString("latin1", 4, 8) === "ftyp") return "mp4";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.length >= 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

/**
 * One of the date's film files (a scene's picture or a confessional's clip) fetched into `dir` for ffmpeg, or null when
 * it can't be had or isn't what it should be (`want`: "clip" or "scene"). A picture is written again as a PNG, so
 * ffmpeg reads it whatever it was.
 */
export async function filmMedia(src, { base, dir, name, want, headers = { "user-agent": "botchelor-clip/1.0", cookie: "bz_adult=1" } }) {
  try {
    const res = await fetch(new URL(src, base), { headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const kind = fileKind(bytes);
    if (!bytes.length || bytes.length > 40 * 1024 * 1024 || (want === "clip" ? kind !== "mp4" : !["webp", "png", "jpg"].includes(kind))) return null;
    const raw = join(dir, `${name}.${kind}`);
    writeFileSync(raw, bytes);
    if (want === "clip") return raw;
    const png = join(dir, `${name}-ffmpeg.png`);
    execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-frames:v", "1", png]);
    return png;
  } catch {
    return null;
  }
}

/**
 * Which picture each beat shows over the two tiles (pure): the filmed confessional for its own beat, and the date's
 * scenes behind the lines, one a line in the date's order (the last one stays for the question). `starts` and `seconds`
 * are the beats'; `clipAt` the confessional's beat or -1; `clip` and `scenes` the files. [] with neither.
 */
export function shotPlan(beats, { starts, seconds, clipAt = -1, clip = null, scenes = [] }) {
  const shots = [];
  let line = 0;
  beats.forEach((b, i) => {
    if (i === clipAt) {
      if (clip) shots.push({ kind: "clip", file: clip, at: starts[i], secs: seconds[i] });
      return;
    }
    if (!scenes.length) return;
    const k = b.kind === "card" ? Math.max(0, Math.min(line, scenes.length) - 1) : Math.min(line++, scenes.length - 1);
    shots.push({ kind: "scene", file: scenes[k], at: starts[i], secs: seconds[i] });
  });
  return shots;
}

/** A confessional's clip starts and ends on a breath of silence (lib/date-film-shared.ts FILM_LEAD_S and FILM_TAIL_S). */
const CLIP_BREATH_S = 0.55;

/* ------------------------------------------------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Renders the cliffhanger into `out`: post.mp4 (1080×1920, 30 fps, voices), cover.png (its first frame: both faces and
 * the hook), caption.txt, edl.json and, last, checklist.md (a folder is ready once that's there). `checklist` is a
 * function of {total, voices, faces}. Returns {total, seconds, voices, faces}.
 */
export async function renderCliffhanger(edl, e, { base, out, n = 1, caption, checklist, log = (m) => console.error(m) }) {
  const beats = resolveBeats(edl, [e]);
  // A filmed confessional's words are its clip's (the diary line, or its opening when the line ran long).
  const clipAt = edl.segments.findIndex((s) => s.clip?.src);
  if (clipAt >= 0 && edl.segments[clipAt].clip.line) beats[clipAt].text = edl.segments[clipAt].clip.line;
  mkdirSync(out, { recursive: true });
  rmSync(join(out, "checklist.md"), { force: true });
  const tmp = mkdtempSync(join(tmpdir(), "botchelor-cliff-"));
  try {
    const key = process.env.SAY === "1" ? null : veniceKey();
    // The date's film, fetched first: an EDL that opens on a clip can't be cut without it (the caller cuts it without).
    const clip = clipAt >= 0 ? await filmMedia(edl.segments[clipAt].clip.src, { base, dir: tmp, name: "open", want: "clip" }) : null;
    if (clipAt >= 0 && !clip) throw new Error("the filmed confessional couldn't be fetched");
    const clipSecs = clip ? soundSeconds(clip) : 0;
    if (clip && !(clipSecs > 0.5)) throw new Error("the filmed confessional has no length");
    const scenes = [];
    for (const [k, sc] of (edl.scenes ?? []).entries()) {
      const file = await filmMedia(sc.src, { base, dir: tmp, name: `scene${k}`, want: "scene" });
      if (file) scenes.push(file);
    }
    const voices = [];
    // The confessional speaks from its own clip; everything else is voiced here.
    for (let i = 0; i < beats.length; i++) voices.push(i === clipAt ? null : await speak(beats[i], join(tmp, `v${i}`), key, log, edl.speed ?? VOICE_SPEED));
    const voiceSecs = voices.map((v, i) => (i === clipAt ? Math.max(0.5, clipSecs - CLIP_BREATH_S) : v ? soundSeconds(v) : 0));
    const fixed = [];
    if (clipAt >= 0) fixed[clipAt] = Math.round(clipSecs * 1000) / 1000;
    const seconds = cliffSeconds(beats, voiceSecs, fixed);
    const total = seconds.reduce((a, b) => a + b, 0);
    const starts = seconds.map((_, i) => seconds.slice(0, i).reduce((a, b) => a + b, 0));
    const shots = shotPlan(beats, { starts, seconds, clipAt, clip, scenes });
    // The two faces show wherever no picture covers them: not fetched at all when scenes cover every other beat.
    const faces = [];
    if (!scenes.length) for (const c of e.characters.slice(0, 2)) faces.push(await faceMedia(c, { base, dir: tmp }));

    const { chromium } = await import("playwright-core");
    const browser = await launchChromium(chromium);
    const background = join(tmp, "base.png");
    const tops = [];
    try {
      const page = await browser.newPage({ viewport: CLIFF_FRAME.css, deviceScaleFactor: CLIFF_FRAME.scale });
      // "load" (pictures and fonts' CSS), then the fonts and every picture: steadier than waiting for the network to go
      // quiet, which a busy Mac missed once in 30 s on the first try (2026-11-23).
      const shot = async (html, path, omitBackground) => {
        await page.setContent(html, { waitUntil: "load", timeout: 90_000 });
        await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))))]));
        await page.screenshot({ path, omitBackground });
      };
      await shot(baseHtml(e, { base }), background, false);
      for (let i = 0; i < beats.length; i++) {
        // The hook is up whole from the first frame; the reply's words come up with its voice, and a confessional's with its clip.
        const parts = (beats[i].kind === "line" && voices[i]) || i === clipAt ? chunksOf(beats[i].text) : [];
        const times = parts.length > 1 ? chunkTimes(parts, voiceSecs[i], seconds[i]) : [seconds[i]];
        const plain = i === clipAt || scenes.length > 0;
        for (let k = 0; k < times.length; k++) {
          const path = join(tmp, `top${i}-${k}.png`);
          await shot(layerHtml(beats[i], { e, n, shown: times.length > 1 ? k + 1 : null, plain }), path, true);
          tops.push({ file: path, secs: times[k] });
        }
      }
    } finally {
      await browser.close();
    }

    const ffmpeg = process.env.FFMPEG || "ffmpeg";
    // The clip's own sound starts with its picture; a voiced line a breath after its beat does.
    const said = voices.map((v, i) => (i === clipAt && clip ? { file: clip, at: starts[i] } : v ? { file: v, at: starts[i] + LEAD_IN } : null));
    execFileSync(ffmpeg, cliffArgs({ background, faces, shots, tops, voices: said, total, out: join(out, "post.mp4") }));
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", join(out, "post.mp4"), "-frames:v", "1", join(out, "cover.png")]);
    const engine = key ? "Kokoro (Venice)" : "macOS say";
    const faceNote = scenes.length
      ? [`${scenes.length} scene${scenes.length === 1 ? "" : "s"} of the two of them`]
      : e.characters.slice(0, 2).map((c, i) => `${firstName(c.name)} (${faces[i]?.from ?? "still on the background"})`);
    if (clip) faceNote.unshift(`${firstName(beats[clipAt].speaker.name)}'s filmed confessional (${clipSecs.toFixed(1)} s)`);
    writeFileSync(join(out, "caption.txt"), `${caption}\n`);
    writeFileSync(join(out, "edl.json"), JSON.stringify({ ...edl, faces: faceNote }, null, 2) + "\n");
    writeFileSync(join(out, "checklist.md"), checklist({ total, voices: engine, faces: faceNote }).join("\n"));
    // A filmed confessional is extra to the cut's own length: the aim is for what follows it.
    if (total - clipSecs > CLIFF.max) log(`cliffhanger: ${total.toFixed(1)} s, over the ${CLIFF.max} s it aims for`);
    return { total, seconds, voices: engine, faces: faceNote, film: { open: Boolean(clip), scenes: scenes.length } };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The day's cliffhanger for one aired public date `e` (fetchEpisodes'), into `out`, as day `day` of the series. Refuses
 * (throws) a cut that would say how the date ended, so the caller can cut the full episode instead. Returns {total, answer}.
 */
export async function buildCliffhanger(e, { base, posts, out, day, log = (m) => console.error(m) }) {
  // The cut as it always was, with no film in it: what's made when the date has none, or its film can't be used.
  const edl = cliffhangerEdl(e, { n: day, film: false });
  const hits = spoilerHits(cutText(edl, [e]), e);
  if (hits.length) throw new Error(`the cliffhanger would give the ending away (${hits.join(", ")})`);
  // With the date's film when it has any; a film that would tell the ending, or can't be cut, is left out, not fatal.
  const filmed = cliffhangerEdl(e, { n: day });
  const hasFilm = Boolean(filmed.scenes?.length || filmed.segments.some((s) => s.clip));
  if (hasFilm && !spoilerHits(cutText(filmed, [e]), e).length) {
    try {
      return await cutCliffhanger(filmed, e, { base, posts, out, day, log });
    } catch (err) {
      log(`cliffhanger: the date's film couldn't be used (${err?.message ?? err}); cutting it without`);
    }
  }
  return cutCliffhanger(edl, e, { base, posts, out, day, log });
}

/** One EDL cut into `out` with its caption and checklist. Returns {total, answer, film}. */
async function cutCliffhanger(edl, e, { base, posts, out, day, log }) {
  const answer = await yesterdaysAnswer(posts, { before: day, episode: e.id, base });
  const caption = cliffCaption(e, edl, { base, answer });
  const [a, b] = e.characters.map((c) => c.name);
  const { total, film } = await renderCliffhanger(edl, e, {
    base,
    out,
    n: day,
    caption,
    log,
    checklist: ({ total: secs, voices, faces }) => [
      `# Posting ${a} × ${b}`,
      "",
      `Episode: ${base}/episodes/${e.id}`,
      `${SERIES_MARK}${day}`,
      "Format: cliffhanger (asks how it ended; the next episode's caption answers)",
      `Cut automatically (scripts/clips/cliffhanger.mjs) · ${secs.toFixed(1)} s · ${edl.segments.length} beats · voices: ${voices} · faces: ${faces.join(", ")}`,
      ...(answer ? [`Answers the last one: ${answer}`] : []),
      "",
      "1. TikTok → + → Upload → post.mp4 (the voices are on it; a quiet instrumental under them is fine).",
      "2. Cover: cover.png is the first frame (the faces and the line); keep it.",
      "3. Paste caption.txt; its first line is the question, so it stays first.",
      "4. More options → turn on \"AI-generated content\".",
      "5. Audience: everyone (the show's dates are PG); never After Dark.",
      "6. Don't say how it ended in a reply: tomorrow's caption does.",
      "",
    ],
  });
  return { total, answer, film };
}
