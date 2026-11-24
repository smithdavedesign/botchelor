// The week in review (2026-11-24, David: "A weekly recap episode, 60–90 seconds"): one vertical video a week of the
// week's best aired dates, each with its line of the night and how it ended, for the show's own page (/week,
// lib/week-recap.ts) and for the social loop.
//
// It is cut fresh, not trimmed from the week's daily videos: the show names the week's best dates (GET /api/week: the
// Sunday letter's ranking, only dates still fit to feature), and this builds an edit decision list over them and hands
// it to the episode cut's renderer (episode-cut.mjs renderCut), the way the hand-edited three-date cut was made. So it
// reads only each date's PUBLIC page (an aired public date), every quoted word is the date's own, and the endings it
// names are already on those pages.
//
//   title    "This week on Botchelor", three of the week's faces, the host's voice
//   per date its best line in the character's voice (labelled with both names and the day), then how it ended: the
//            date's report card full screen with the host saying the ending and the grade, or the plain ending card
//   card     where the rest is: botchelor.com/week
//
// About 55 to 85 seconds: up to RECAP_DATES dates, dropped from the end until the estimate fits (and again if the
// rendered voices run long). Voices are Kokoro on Venice as every cut uses (about a cent a recap); nothing else is made.
//
// Out: CLIPS_DIR/recaps/<week>/ with post.mp4, cover.png, caption.txt, edl.json and, last, checklist.md.
//   --week <YYYY-MM-DD|current>  the week by its Monday (UTC), or the one under way. Default: the week that just ended
//                                (on its last half day, the one about to: Sunday evening here is already Monday in UTC
//                                some of the year and not the rest).
//   --upload   make the small web copy and its poster and send them to the show (POST /api/admin/week-recap).
//   --release  copy the folder to CLIPS_DIR/cuts/week-<week>/, where the marketing loop's cutKit posts it as that
//              day's video (in place of the daily episode).
//   --dry      print the edit decision list and its estimated length; render nothing.
//   (CROWD_BASE, CLIPS_DIR, CHROMIUM_PATH, FFMPEG, SAY=1 as elsewhere)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { adminKey, makeWebCut, WEB_CUT } from "./daily-clip.mjs";
import { bestLineIndex, estimateSeconds, keepFor, spokenGrade } from "./daily-episode.mjs";
import { endingLabel, fetchEpisodes, firstName, MAX_SECONDS, renderCut, sentences, SILENT_SECONDS } from "./episode-cut.mjs";
import { creditLines } from "./post-kit.mjs";

/** The most dates a recap holds, and the fewest worth calling a week. */
export const RECAP_DATES = 6;
export const RECAP_MIN_DATES = 2;
/** What the estimate is fitted to, seconds: under the renderer's own cap (MAX_SECONDS), with room for slow voices. */
export const RECAP_TARGET = 85;
/** How long the title and each ending stay up at least, seconds. */
export const RECAP_TITLE_SECONDS = 2.8;
export const RECAP_ENDING_SECONDS = 3.4;
/** A quoted line longer than this is cut to the sentences that hold the best line, or to its first sentence. */
export const RECAP_LINE_CHARS = 150;
/** The marker the checklist carries. Never the daily episode's ("Daily episode: Day N"): that one is counted. */
export const RECAP_MARK = "Week in review: ";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The endings the renderer can show (episode-cut.mjs ENDING_LABELS): a date with any other isn't quoted. */
const ENDINGS = new Set(["second_date", "friends", "close_friends", "disaster"]);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The Monday (UTC, YYYY-MM-DD) of the week `now` is in (pure): lib/season-window.ts weekWindow. */
export function mondayOf(now) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - ((now.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Which week to recap when none is named (pure): the one that just ended, or, in a week's last twelve hours, the one
 * about to. The job runs on Sunday evening Pacific: Monday 01:00 UTC in winter, Monday 00:00 in summer, and a little
 * before either on a slow clock, so "the last complete week" alone would sometimes be a week late.
 */
export function defaultWeek(now = new Date()) {
  const monday = mondayOf(now);
  const into = now.getTime() - Date.parse(`${monday}T00:00:00.000Z`);
  return into >= 6.5 * DAY_MS ? monday : new Date(Date.parse(`${monday}T00:00:00.000Z`) - 7 * DAY_MS).toISOString().slice(0, 10);
}

/** The day a date aired, as the recap says it (pure, UTC like the week): "Tuesday", or null. */
export function weekdayOf(airedAt) {
  const at = Date.parse(String(airedAt ?? ""));
  return Number.isFinite(at) ? WEEKDAYS[new Date(at).getUTCDay()] : null;
}

/**
 * The line a date is quoted by (pure): {line, keep, text} or null when it has nothing to quote. Its best line's own
 * sentences; with none, the punchiest short line of its second half, as the daily episode picks one. A long pick is
 * cut to its first sentence.
 */
export function recapLine(e) {
  const lines = (e.transcript ?? []).map((t, i) => ({ i, text: String(t?.dialogue ?? "").trim() })).filter((l) => l.text);
  if (!lines.length) return null;
  let line = bestLineIndex(e);
  let keep = line != null ? keepFor(e.transcript[line].dialogue, e.best_line) : [];
  if (line == null || !keep.length) {
    const half = lines.slice(Math.floor(lines.length / 2));
    const punchy = (s) => /[?!]$/.test(s) && s.length <= 110;
    const pick = half.find((l) => sentences(l.text).some(punchy)) ?? half[0];
    line = pick.i;
    keep = [Math.max(0, sentences(pick.text).findIndex(punchy))];
  }
  const all = sentences(e.transcript[line].dialogue);
  const said = (k) => k.map((i) => all[i]).join(" ");
  if (said(keep).length > RECAP_LINE_CHARS) keep = [keep[0]];
  return { line, keep, text: said(keep) };
}

/** The host's words over a date's ending (pure): "Just friends. Report card: a B minus." */
export function recapSay(ending, grade) {
  return grade ? `${ending}. Report card: ${spokenGrade(grade)}.` : `${ending}.`;
}

/**
 * The recap's edit decision list (pure), for episode-cut.mjs. `week`: {id, label}; `dates`: the week's list from
 * GET /api/week, best first ({id, grade, aired_at}); `episodes`: those dates' public pages (fetchEpisodes), any order.
 * Dates with nothing to quote or no ending are left out; then dates are dropped from the end until the estimate fits
 * `target`. Returns {edl, episodes (in the cut's order), seconds (the estimate)}. Throws under RECAP_MIN_DATES.
 */
export function recapEdl(week, dates, episodes, { max = RECAP_DATES, target = RECAP_TARGET } = {}) {
  const byId = new Map((episodes ?? []).map((e) => [e.id, e]));
  let picked = [];
  for (const d of dates ?? []) {
    const e = byId.get(d.id);
    if (!e || e.featurable === false) continue;
    const quote = recapLine(e);
    const ending = ENDINGS.has(e.ending) ? endingLabel(e) : null;
    if (!quote || !ending) continue;
    const [a, b] = (e.characters ?? []).map((c) => firstName(c.name));
    const day = weekdayOf(d.aired_at ?? e.aired_at);
    const say = recapSay(ending, d.grade ?? null);
    picked.push({ e, quote, say, grade: d.grade ?? null, label: `${a} × ${b}${day ? ` · ${day}` : ""}`, est: estimateSeconds(quote.text) + Math.max(RECAP_ENDING_SECONDS, estimateSeconds(say)) });
    if (picked.length >= max) break;
  }
  const closing = { kicker: "Every date, every week", title: "Watch them all. Call the next one.", url: "botchelor.com/week", say: "Watch every date at botchelor dot com." };
  const fixed = RECAP_TITLE_SECONDS + Math.max(SILENT_SECONDS.card, estimateSeconds(closing.say));
  const total = () => fixed + picked.reduce((s, p) => s + p.est, 0);
  while (picked.length > RECAP_MIN_DATES && total() > target) picked = picked.slice(0, -1);
  if (picked.length < RECAP_MIN_DATES) throw new Error(`the week of ${week.label ?? week.id} has ${picked.length} date${picked.length === 1 ? "" : "s"} to recap; a recap needs ${RECAP_MIN_DATES}`);

  // Three faces on the title, each from a different date and nobody twice.
  const faces = [];
  const seen = new Set();
  picked.forEach((p, i) => {
    if (faces.length >= 3) return;
    const side = (p.e.characters ?? []).findIndex((c) => !seen.has(c.id));
    if (side < 0) return;
    seen.add(p.e.characters[side].id);
    faces.push([i, side === 0 ? "a" : "b"]);
  });
  const n = picked.length;
  const segments = [
    { kind: "title", ep: 0, kicker: `The week in review · ${week.label ?? week.id}`, title: "This week on Botchelor", sub: `${n} dates. ${n} endings.`, say: "This week on Botchelor.", secs: RECAP_TITLE_SECONDS, faces },
    ...picked.flatMap((p, i) => [
      { kind: "line", ep: i, line: p.quote.line, keep: p.quote.keep, label: p.label },
      p.grade ? { kind: "report", ep: i, say: p.say, secs: RECAP_ENDING_SECONDS } : { kind: "reveal", ep: i, say: p.say, secs: RECAP_ENDING_SECONDS },
    ]),
    { kind: "card", ep: 0, ...closing, secs: SILENT_SECONDS.card },
  ];
  return {
    edl: {
      name: `The week in review: ${week.label ?? week.id}`,
      direction: "week in review",
      week: week.id,
      episodes: picked.map((p) => p.e.id),
      hook: `This week on Botchelor: ${n} dates, ${n} endings`,
      question: "Which ending did you call? 👀",
      cover: 0,
      segments,
    },
    episodes: picked.map((p) => p.e),
    seconds: Math.round(total() * 10) / 10,
  };
}

/** The caption to paste (pure): the week in a line (a video title too), each date and how it ended, where the rest is. */
export function recapCaption(week, edl, episodes, dates, base = "https://botchelor.com") {
  const host = new URL(base).host;
  const gradeOf = new Map((dates ?? []).map((d) => [d.id, d.grade ?? null]));
  const rows = episodes.map((e) => {
    const grade = gradeOf.get(e.id);
    return `${e.characters.map((c) => firstName(c.name)).join(" × ")}: ${String(endingLabel(e) ?? "").toLowerCase()}${grade ? ` (${grade})` : ""}`;
  });
  return [
    `${edl.hook} (${week.label ?? week.id})`,
    "",
    edl.question,
    "",
    ...rows,
    "",
    `The whole week: ${host}/week/${week.id}?s=tiktok`,
    "Every character is AI, and every date is AI-generated fiction.",
    ...creditLines(episodes.flatMap((e) => e.characters ?? [])),
    "",
    "#botchelor #aicharacters #datingshow #realitytv #originalcharacter #weeklyrecap",
  ].join("\n");
}

/** The folder's checklist (pure): the dates first (the top one's link is the first on the page), never the daily mark. */
export function recapChecklist(week, edl, episodes, { base = "https://botchelor.com", total, beats, voices }) {
  return [
    `# Posting the week in review: ${week.label ?? week.id}`,
    "",
    ...episodes.map((e) => `Episode: ${base}/episodes/${e.id}`),
    `${RECAP_MARK}${week.id} · ${total.toFixed(1)} s · ${beats} beats · voices: ${voices}`,
    `Page: ${base}/week/${week.id}`,
    "",
    "1. TikTok → + → Upload → post.mp4 (the voices are on it; a quiet instrumental under them is fine).",
    "2. Cover: cover.png (the title card).",
    "3. Paste caption.txt.",
    "4. More options → turn on \"AI-generated content\".",
    "5. Audience: everyone (the show's dates are PG); never After Dark.",
    "",
  ];
}

/** The week's list from the show (GET /api/week): {week: {id, from, to, label, complete}, dates: [...]}. Throws on a refusal. */
export async function fetchWeek(base, which, headers = { "user-agent": "botchelor-clip/1.0" }) {
  const res = await fetch(`${base}/api/week?week=${encodeURIComponent(which)}`, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.week?.id) throw new Error(`the show didn't list the week ${which} (${res.status}${body?.error ? ` ${body.error}` : ""})`);
  return body;
}

/** ffmpeg's arguments for the web copy's poster (pure): the cut's own first frame, the title card, at its size. */
export function recapPosterArgs({ src, out }) {
  return ["-y", "-loglevel", "error", "-i", src, "-frames:v", "1", "-vf", `scale=${WEB_CUT.width}:${WEB_CUT.height}:force_original_aspect_ratio=decrease,pad=${WEB_CUT.width}:${WEB_CUT.height}:(ow-iw)/2:(oh-ih)/2`, "-q:v", "4", out];
}

/**
 * Sends the web copy and its poster to the show (POST /api/admin/week-recap). Returns {ok, status, error, page}: the
 * route's own refusal (a date no longer public) comes back as its `error`. `send`: fetch (tests pass their own). Never throws.
 */
export async function uploadRecap({ base, key, week, video, poster, seconds, episodes, send = fetch }) {
  try {
    const form = new FormData();
    form.set("week", week);
    form.set("episodes", episodes.join(","));
    form.set("width", String(WEB_CUT.width));
    form.set("height", String(WEB_CUT.height));
    form.set("seconds", String(seconds));
    form.set("video", new Blob([readFileSync(video)], { type: "video/mp4" }), "recap.mp4");
    form.set("poster", new Blob([readFileSync(poster)], { type: "image/jpeg" }), "poster.jpg");
    const res = await send(`${base}/api/admin/week-recap`, { method: "POST", headers: { "x-frontier-key": key, "user-agent": "botchelor-clip/1.0" }, body: form });
    const body = await res.json().catch(() => null);
    return { ok: res.ok && body?.ok === true, status: res.status, error: body?.error ?? null, page: body?.page ?? null };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message ?? err).split("\n")[0], page: null };
  }
}

/** Copies a finished recap to the loop's staging folder (cuts/), the checklist last: a folder is ready once that's there. */
export function releaseRecap(dir, cuts, week) {
  const to = join(cuts, `week-${week}`);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const f of ["post.mp4", "cover.png", "caption.txt", "edl.json", "checklist.md"]) copyFileSync(join(dir, f), join(to, f));
  return to;
}

const flag = (argv, name) => {
  const i = argv.indexOf(name);
  const v = i < 0 ? undefined : argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
};

async function main() {
  const argv = process.argv.slice(2);
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  const clips = process.env.CLIPS_DIR || join(homedir(), "BotchelorClips");
  const asked = flag(argv, "--week") ?? defaultWeek();
  const { week, dates } = await fetchWeek(base, asked);
  const episodes = [];
  for (const d of dates) {
    // One at a time, so a date taken down since the list was made only costs itself.
    try {
      episodes.push(...(await fetchEpisodes([d.id], base)));
    } catch (err) {
      console.error(`skipped ${d.id}: ${err?.message ?? err}`);
    }
  }
  let plan = recapEdl(week, dates, episodes);
  if (argv.includes("--dry")) {
    console.log(JSON.stringify(plan.edl, null, 2));
    console.log(`The week in review, ${week.label} (${week.id}): ${plan.episodes.length} dates, about ${plan.seconds} s. Nothing rendered (--dry).`);
    return;
  }
  const out = join(clips, "recaps", week.id);
  let done = null;
  // The estimate is words a second; the voices decide. A cut that runs over the renderer's cap loses its last date.
  for (let max = plan.episodes.length; !done; max--) {
    if (max < plan.episodes.length) plan = recapEdl(week, dates, episodes, { max });
    try {
      done = await renderCut(plan.edl, plan.episodes, {
        base,
        out,
        caption: recapCaption(week, plan.edl, plan.episodes, dates, base),
        checklist: ({ total, beats, voices }) => recapChecklist(week, plan.edl, plan.episodes, { base, total, beats: beats.length, voices }),
      });
    } catch (err) {
      if (!new RegExp(`over ${MAX_SECONDS}`).test(String(err?.message)) || max <= RECAP_MIN_DATES) throw err;
      console.error(`${err.message}; cutting it again with ${max - 1} dates`);
    }
  }
  console.log(`Week in review: ${out}\n  ${week.label}: ${plan.episodes.length} dates, post.mp4 (${done.total.toFixed(1)} s), cover.png, caption.txt, checklist.md, edl.json`);

  if (argv.includes("--upload")) {
    const key = adminKey();
    if (!key) console.error("upload: no admin key (FRONTIER_PASSWORD or the keychain); the recap stays on this Mac");
    else {
      const web = makeWebCut({ mp4: join(out, "post.mp4"), dir: join(out, "web"), name: `week-${week.id}`, seconds: done.total });
      if (!web) console.error("upload: the web copy came out too heavy; nothing sent");
      else {
        const poster = join(out, "web", `week-${week.id}.jpg`);
        execFileSync(process.env.FFMPEG || "ffmpeg", recapPosterArgs({ src: web.cut, out: poster }));
        const sent = await uploadRecap({ base, key, week: week.id, video: web.cut, poster, seconds: web.seconds, episodes: plan.edl.episodes });
        console.log(sent.ok ? `  on the show: ${base}${sent.page} (${(statSync(web.cut).size / 1e6).toFixed(1)} MB)` : `upload refused: ${sent.status} ${sent.error ?? ""}`);
        if (!sent.ok) process.exitCode = 1;
      }
    }
  }
  if (argv.includes("--release")) console.log(`  staged for the social loop: ${releaseRecap(out, join(clips, "cuts"), week.id)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
