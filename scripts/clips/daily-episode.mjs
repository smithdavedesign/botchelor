#!/usr/bin/env node
// The daily episode (2026-11-19, David's /goal on the growth review: "1-6 … maybe the video isn't catching enough?").
// The loop's daily short used to be the theater recorded at phone size (post-kit.mjs --recording): a block of text for
// 2.6 s faded in from black, then a screen recording with small type and the player's buttons. Seven of those on
// YouTube Shorts drew 72 views in all. This makes the same day's date into a short episode of one running show instead,
// cut the way the hand-edited episode cuts are (episode-cut.mjs renders it), automatically:
//
//   1. the cold open: the date's best line, voiced, on the first frame (no title card, no fade from black);
//   2. "Day N": the story the date belongs to, in the host's voice (the producer's logline, GET /api/story), so a
//      stranger knows who wants what and a follower knows where we are;
//   3. the lines that lead up to the best line and the answer to it, each shortened to whole sentences and shown part
//      by part as it's spoken;
//   4. how it ended: the date's report card at 9:16, full screen, with its grade in the host's voice (2026-11-20), or
//      the plain ending card when the date has no report card;
//   5. tonight: the day's beat ("Tonight, you pick who gets the date with Sable") and where to vote, or watch.
//
// About 25 to 35 seconds. Only the public aired record (what the episode page shows); every quoted word is the date's
// own (whole sentences, gaps marked); the show's words (title, tonight) are the host's, never a character's.
// Out: CLIPS_DIR/posts/<day>-<a>-<b>/ with post.mp4, cover.png (the "Day N" card), caption.txt, edl.json, checklist.md:
// the folder post-kit.mjs always wrote, so the marketing loop (idea-factory buildVideoKit) takes it as it is.
//   node scripts/clips/daily-episode.mjs <episode_id> [--out <dir>] [--day-number N]     (CROWD_BASE, SAY=1 as elsewhere)
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LEAD_IN, LEAD_OUT, VOICE_SPEED, endingLabel, fetchEpisodes, firstName, renderCut, sentences } from "./episode-cut.mjs";
import { creditLines } from "./post-kit.mjs";

/** The report card stays up at least this long, so its letters can be read. */
export const SILENT_SECONDS_REPORT = 3.6;
/** The longest the episode should run, seconds (estimated before the voices exist; lines are dropped to fit). */
export const TARGET_SECONDS = 34;
/** Lines of the date shown after the title: up to three before the best line and the one that answers it. */
export const BEFORE = 3;
/** A shortened line stays under this many characters where its sentences allow. */
export const LINE_CHARS = 150;
/** Kokoro's pace at VOICE_SPEED, in words a second, for the estimate (measured on the November cuts: ~2.9). */
export const WORDS_PER_SECOND = 2.9;
/** The marker the checklist carries, so the next episode can count the ones before it. */
export const SERIES_MARK = "Daily episode: Day ";

const words = (s) => String(s ?? "").split(/\s+/).filter(Boolean).length;

/** Spoken length of `text` with its breath, seconds (pure, an estimate). */
export function estimateSeconds(text) {
  return words(text) / (WORDS_PER_SECOND * (VOICE_SPEED / 1.1)) + LEAD_IN + LEAD_OUT;
}

/**
 * A model's logline as plain words (pure). The producer's model sometimes answered with JSON
 * (`{"logline": "…"}`, stored as is on 2026-11-20 before lib/producer.ts learned to unwrap it): take its first string.
 */
export function unwrapLogline(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const v = Object.values(JSON.parse(t)).find((x) => typeof x === "string" && x.trim());
      return v ? v.trim() : null;
    } catch {
      return null;
    }
  }
  return t.replace(/^["“]+|["”]+$/g, "").trim() || null;
}

/**
 * The story line a date played under, for the title card (pure): the beat's logline without its "Tonight, you pick …"
 * sentence, which was about the vote that made this date, not about what to do now.
 */
export function storyLine(logline) {
  const t = unwrapLogline(logline);
  if (!t) return null;
  const kept = sentences(t).filter((s) => !/^tonight\b/i.test(s));
  return kept.length ? kept.join(" ") : null;
}

/** Which transcript line holds the best line (pure): the first that contains it, else null. */
export function bestLineIndex(e) {
  const best = String(e.best_line ?? "").trim();
  if (!best) return null;
  const lines = e.transcript ?? [];
  const i = lines.findIndex((t) => String(t?.dialogue ?? "").replace(/\s+/g, " ").includes(best.replace(/\s+/g, " ")));
  return i >= 0 ? i : null;
}

/** The sentences of `text` that hold `phrase` (pure): their indexes, for episode-cut's `keep`. */
export function keepFor(text, phrase) {
  const all = sentences(text);
  const want = String(phrase ?? "").replace(/\s+/g, " ").trim();
  if (!want) return [];
  const flat = all.join(" ");
  const at = flat.indexOf(want);
  if (at < 0) return [];
  const keep = [];
  let pos = 0;
  all.forEach((s, i) => {
    const from = pos;
    const to = pos + s.length;
    if (to > at && from < at + want.length) keep.push(i);
    pos = to + 1;
  });
  return keep;
}

/**
 * A long line shortened for the episode (pure): its first sentence, and the next while they stay under LINE_CHARS
 * (the opening of a reply is what answers the line before it). Null when the line is short enough whole.
 */
export function keepShort(text) {
  const all = sentences(text);
  if (all.join(" ").length <= LINE_CHARS) return null;
  const keep = [0];
  let len = all[0].length;
  for (let i = 1; i < all.length && len + 1 + all[i].length <= LINE_CHARS; i++) {
    keep.push(i);
    len += 1 + all[i].length;
  }
  return keep;
}

/** What a kept line says (pure): its kept sentences, in order. */
const keptText = (text, keep) => (keep?.length ? keep.map((i) => sentences(text)[i]).join(" ") : sentences(text).join(" "));

/** "Tonight: you pick who gets the date with Sable." → "You pick who gets the date with Sable." (pure). */
export function tonightLine(tonight) {
  const t = String(tonight ?? "").replace(/^tonight:\s*/i, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

/**
 * What a date's report card says, from its page's og:title and og:description (pure): {grade, subjects: [{label, grade}]}
 * or null. "Ada × Bo got a B- on their AI blind date (just friends)", "Chemistry C+ · Attraction D · Trust A · …".
 */
export function reportFromOg(title, description) {
  const g = /\bgot an? ([A-DF][+-]?) on their\b/.exec(String(title ?? ""));
  if (!g) return null;
  const subjects = [...String(description ?? "").split(". ")[0].matchAll(/([A-Z][a-z]+) ([A-DF][+-]?)(?= ·|$)/g)].map((m) => ({ label: m[1], grade: m[2] }));
  return { grade: g[1], subjects };
}

/** A report card page's grade and subjects, from its og:title and og:description tags (pure), or null. */
export function reportFromHtml(html) {
  const tag = (p) =>
    new RegExp(`<meta[^>]+property="og:${p}"[^>]+content="([^"]*)"`).exec(String(html ?? ""))?.[1]?.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") ?? null;
  return reportFromOg(tag("title"), tag("description"));
}

/** A grade as the host says it (pure): "B-" → "B minus", "A+" → "A plus"; with its article, "an F", "a C". */
export function spokenGrade(grade) {
  const said = String(grade).replace(/\+$/, " plus").replace(/-$/, " minus");
  return `${/^[AF]/.test(said) ? "an" : "a"} ${said}`;
}

/** The subject worth naming (pure): an F first, then a D, an A+, an A; none when every subject is middling. */
export function standoutSubject(subjects) {
  for (const want of ["F", "D", "A+", "A"]) {
    const hit = (subjects ?? []).find((x) => x.grade === want);
    if (hit) return hit;
  }
  return null;
}

/** The host's words over the report card (pure): the ending, the overall grade, and the standout subject. */
export function reportSay(ending, report) {
  const standout = standoutSubject(report.subjects);
  return `${ending}. Report card: ${spokenGrade(report.grade)}${standout ? `, with ${spokenGrade(standout.grade)} in ${standout.label.toLowerCase()}` : ""}.`;
}

/** Whether tonight's line is a vote the audience decides (pure): the producer writes "you pick …" for those. */
export const isVote = (tonight) => /\byou pick\b/i.test(String(tonight ?? ""));

/**
 * The episode's edit decision list (pure), for episode-cut.mjs. `story`: GET /api/story ({day, tonight, episodes:
 * [{id, logline}]}) or null; `n`: the day number. Throws when the date has too little to cut.
 */
export function autoEdl(e, { story = null, n = 1, report = null } = {}) {
  const lines = (e.transcript ?? []).map((t, i) => ({ i, text: String(t?.dialogue ?? "").trim() })).filter((l) => l.text);
  if (lines.length < 4) throw new Error(`the date has ${lines.length} spoken lines; a daily episode needs 4`);
  const [a, b] = (e.characters ?? []).map((c) => firstName(c.name));
  // The cold open: the best line's own sentences; with no best line, the punchiest short line of the second half.
  let bi = bestLineIndex(e);
  let coldKeep = bi != null ? keepFor(e.transcript[bi].dialogue, e.best_line) : [];
  if (bi == null || !coldKeep.length) {
    const half = lines.filter((l) => l.i >= lines[Math.floor(lines.length / 2)].i);
    const pick = half.find((l) => sentences(l.text).some((s) => /[?!]$/.test(s) && s.length <= 110)) ?? half[0];
    bi = pick.i;
    const idx = sentences(pick.text).findIndex((s) => /[?!]$/.test(s) && s.length <= 110);
    coldKeep = [Math.max(0, idx)];
  }
  const cold = { kind: "cold", line: bi, keep: coldKeep, label: `Day ${n}` };

  const line = storyLine(story?.episodes?.find((x) => x.id === e.id)?.logline);
  const titleText = line ?? `${a} and ${b}${e.title ? `: ${e.title}` : ""}.`;
  const title = { kind: "title", kicker: `Botchelor · Day ${n}`, title: titleText, sub: line && e.title ? e.title : null, say: line ?? null };

  // The body: up to BEFORE lines leading up to the best line, then the one that answers it, each shortened.
  const pos = lines.findIndex((l) => l.i === bi);
  const body = [...lines.slice(Math.max(0, pos - BEFORE), pos), ...lines.slice(pos + 1, pos + 2)].map((l) => {
    const keep = keepShort(l.text);
    return { kind: "line", line: l.i, ...(keep ? { keep } : {}), est: estimateSeconds(keptText(l.text, keep)) };
  });

  // How it ended, in the host's voice: only for an ending the episode page names (a date still open has none). With the
  // date's report card (2026-11-20), the card fills the screen and the host adds its grade: the ending as a verdict.
  const ending = endingLabel(e);
  const reveal = ending ? (report ? { kind: "report", say: reportSay(ending, report), secs: SILENT_SECONDS_REPORT } : { kind: "reveal", say: `${ending}.` }) : null;

  const tonight = tonightLine(story?.tonight);
  const vote = isVote(story?.tonight);
  const card = tonight
    ? { kind: "card", kicker: "Tonight on Botchelor", title: tonight, url: vote ? "botchelor.com/vote" : "botchelor.com", say: `Tonight, ${tonight.charAt(0).toLowerCase()}${tonight.slice(1)} ${vote ? "Vote at botchelor dot com." : "Watch at botchelor dot com."}` }
    : { kind: "card", kicker: "Make your own character", title: "Send them on a date. Watch how it ends.", url: "botchelor.com", say: "Make your own character at botchelor dot com." };

  // Fit the estimate: drop the earliest lead-up lines first (the answer to the best line stays).
  const fixed = estimateSeconds(keptText(e.transcript[bi].dialogue, coldKeep)) + (title.say ? estimateSeconds(title.say) : 2.6) + (reveal ? Math.max(estimateSeconds(reveal.say), reveal.secs ?? 0) : 0) + estimateSeconds(card.say);
  while (body.length > 1 && fixed + body.reduce((s, x) => s + x.est, 0) > TARGET_SECONDS) body.shift();
  const segments = [cold, title, ...body.map(({ est, ...s }) => s), ...(reveal ? [reveal] : []), card];
  return {
    name: `Day ${n}: ${a} × ${b}`,
    direction: "daily episode",
    episodes: [e.id],
    hook: titleText,
    question: `${a} or ${b}: who's in more trouble? 👀`,
    cover: 1,
    segments,
  };
}

/** The caption to paste (pure): "Day N: <story>", tonight's vote or the whole date, the AI line, credits, tags. */
export function dailyCaption(e, edl, { story = null, n = 1, base = "https://botchelor.com" } = {}) {
  const host = new URL(base).host;
  const watch = `${host}${e.share_path ?? `/episodes/${e.id}`}?s=tiktok`;
  const tonight = tonightLine(story?.tonight);
  const tags = "#botchelor #aicharacters #datingshow #realitytv #originalcharacter #aidrama";
  return [
    `Day ${n}: ${edl.hook}`,
    "",
    edl.question,
    "",
    ...(tonight && isVote(story?.tonight) ? [`Tonight: ${tonight.charAt(0).toLowerCase()}${tonight.slice(1)} Vote: ${host}/vote?s=tiktok`] : []),
    `Watch the whole date: ${watch}`,
    "Every character is AI, and every date is AI-generated fiction.",
    ...creditLines(e.characters),
    "",
    tags,
  ].join("\n");
}

/** The date's report card, read off its page's tags (reportFromOg), or null when it has none. Best effort. */
export async function fetchReport(base, id, headers = { "user-agent": "botchelor-clip/1.0" }) {
  try {
    const res = await fetch(`${base}/episodes/${encodeURIComponent(id)}/report-card`, { headers, redirect: "manual" });
    if (res.status !== 200) return null;
    return reportFromHtml(await res.text());
  } catch {
    return null;
  }
}

/** The day's story from the show (GET /api/story): {day, tonight, episodes[]} or null. Best effort. */
export async function fetchDayStory(base, headers = { "user-agent": "botchelor-clip/1.0" }) {
  try {
    const res = await fetch(`${base}/api/story`, { headers });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The next day number: one more than the daily episodes already in CLIPS_DIR/posts (their checklists say so). */
export function nextDayNumber(postsDir) {
  let most = 0;
  let dirs = [];
  try {
    dirs = readdirSync(postsDir);
  } catch {
    return 1;
  }
  for (const d of dirs) {
    try {
      const m = new RegExp(`${SERIES_MARK}(\\d+)`).exec(readFileSync(join(postsDir, d, "checklist.md"), "utf8"));
      if (m) most = Math.max(most, Number(m[1]));
    } catch {
      /* not a kit */
    }
  }
  return most + 1;
}

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Builds the day's episode for one aired public date into CLIPS_DIR/posts (or `out`). Returns the folder. */
export async function buildDailyEpisode(id, { out = null, n = null } = {}) {
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  const [e] = await fetchEpisodes([id], base);
  if (e.featurable === false) throw new Error("the story check found this date's ending contradicting its lines; it isn't featured");
  const [story, report] = await Promise.all([fetchDayStory(base), fetchReport(base, e.id)]);
  const posts = join(process.env.CLIPS_DIR || join(homedir(), "BotchelorClips"), "posts");
  const day = n ?? nextDayNumber(posts);
  const edl = autoEdl(e, { story, n: day, report });
  const [a, b] = (e.characters ?? []).map((c) => c.name);
  const dir = out ?? join(posts, `${new Date().toISOString().slice(0, 10)}-${slug(a)}-${slug(b)}`);
  const caption = dailyCaption(e, edl, { story, n: day, base });
  const { total } = await renderCut(edl, [e], {
    base,
    out: dir,
    caption,
    checklist: ({ total: secs, voices }) => [
      `# Posting ${edl.name}`,
      "",
      `Episode: ${base}/episodes/${e.id}`,
      `${SERIES_MARK}${day}`,
      `Cut automatically (scripts/clips/daily-episode.mjs) · ${secs.toFixed(1)} s · ${edl.segments.length} beats · voices: ${voices}`,
      "",
      "1. TikTok → + → Upload → post.mp4 (the voices are on it; a quiet instrumental under them is fine).",
      "2. Cover: upload cover.png (the Day card), not the first frame.",
      "3. Paste caption.txt.",
      "4. More options → turn on \"AI-generated content\".",
      "5. Audience: everyone (the show's dates are PG); never After Dark.",
      "",
    ],
  });
  console.log(`Daily episode: ${dir}\n  Day ${day}, post.mp4 (${total.toFixed(1)} s), cover.png, caption.txt, checklist.md`);
  return dir;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id || id.startsWith("--")) {
    console.error("usage: node scripts/clips/daily-episode.mjs <episode_id> [--out <dir>] [--day-number N]");
    process.exit(1);
  }
  buildDailyEpisode(id, { out: arg("out") ?? null, n: arg("day-number") ? Number(arg("day-number")) : null }).catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
