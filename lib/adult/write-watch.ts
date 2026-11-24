/**
 * Waiting on a step in the theater (app/after-dark/[a]/[b]/SceneWriter.tsx). David, 2026-11-24: "the longer writer
 * model takes too long and times out and only after you refresh page you see the writing. Ideally if it writes a line
 * it should show."
 *
 * A step is one request that answers when everything is done: the lines (one to several calls on the viewer's writer;
 * the richer one takes a minute or two a call), then any pictures the lines asked for, drawn inside the same request.
 * The host's edge ends a response that has sent nothing for 100 seconds (docs/hosting.md), so on the slow writer the
 * page often got no answer at all, while the write went on behind it and the lines were kept. The page said "reload in
 * a minute".
 *
 * Now the page doesn't depend on that one answer:
 *  - **It asks for the answer to be kept alive** (KEPT_ANSWER_HEADER; lib/http.ts jsonWhenDone: a newline now and then,
 *    the JSON at the end with the real status inside it), so the edge has no silence to cut.
 *  - **While it waits, it looks at the scene itself** (the page's own GET, every few seconds) and shows lines the
 *    moment they're kept: they're saved before the step's pictures are drawn, so they no longer wait on those.
 *  - **When the answer is lost anyway**, it keeps looking until the write has ended (the scene's own mark,
 *    lib/adult/scenes.ts continueScene), then takes the scene as it stands. Lines that landed are shown, with no error
 *    and no reload; when none did, it says so.
 *
 * What it doesn't do is show a line while the step is still being written: a step's checks run on the whole step, and
 * nothing a check refuses is ever shown (docs/after-dark.md "Waiting on a step").
 *
 * This module is the pure part: what a look at the scene means. Client-safe: no imports.
 */

/**
 * How long a write counts as in flight after its mark was last kept fresh (#1122; lib/adult/scenes.ts continueScene
 * marks the scene when a write starts and again every WRITING_BEAT_MS while it runs). Past it, a request that died
 * (a deploy, a crash) no longer holds the page.
 */
export const WRITING_STALE_MS = 4 * 60_000;
/** How often a write still running says so on its scene, so a long one (several calls on the slow writer) never reads as dead. */
export const WRITING_BEAT_MS = 30_000;

/** The first look at the scene while a step's answer is awaited, and the gap between looks after that. */
export const WATCH_FIRST_MS = 8_000;
export const WATCH_EVERY_MS = 4_500;
/**
 * After an answer is lost: this many looks in a row must find no write in flight before the page takes it that none
 * is. One look isn't enough: the answer can be lost before the server has marked the write.
 */
export const WATCH_QUIET_LOOKS = 2;
/** The longest the page follows a write whose answer it lost. A write's own mark ends long before this; it's for a connection that stays down. */
export const WATCH_LOST_MAX_MS = 15 * 60_000;
/** After an answer is lost: when no look at the scene has got through for this long (the viewer is offline, the server is down), the page stops following. */
export const WATCH_UNREACHED_MS = 60_000;
/** One look at the scene is given up on after this long, so a connection that hangs can't hold the page. */
export const WATCH_LOOK_TIMEOUT_MS = 20_000;
/** An answer lost sooner than this, with nothing written, was the connection and not a long write. */
export const QUICK_LOSS_MS = 20_000;

/** What the theater says while a step's lines are already on the page and only its end is awaited (its pictures, a chapter's close). */
export const LINES_IN_NOTE = "Those lines are in. Finishing the step: a picture can take half a minute.";

/** The request header that asks the scene's route to keep a write's answer alive, and its value. */
export const KEPT_ANSWER_HEADER = "x-bz-answer";
export const KEPT_ANSWER = "kept";

/** What the page needs of a scene to tell whether lines have landed. */
export type SeenScene = { chapter?: number; lines: readonly { who: string; text: string }[]; writing_for?: number };

const chapterOf = (s: SeenScene): number => s.chapter ?? 1;

/**
 * Whether the server's scene has lines the page isn't showing: another chapter's lines, or in the same chapter a line
 * the page doesn't have at that place. A scene that is only shorter (a redo's step taken back, its new take not written
 * yet) or empty (a chapter just closed, a night just reset) has nothing to show yet.
 */
export function hasNewLines(page: SeenScene, now: SeenScene): boolean {
  if (!now.lines.length) return false;
  if (chapterOf(now) !== chapterOf(page)) return true;
  return now.lines.some((line, i) => {
    const mine = page.lines[i];
    return !mine || mine.who !== line.who || mine.text !== line.text;
  });
}

/** Whether a write that started from `before` has left its lines: new ones, or a chapter it filled and closed. */
export const writeLanded = (before: SeenScene, now: SeenScene): boolean => chapterOf(now) > chapterOf(before) || hasNewLines(before, now);

/**
 * The moves that write lines, and so can take minutes: the next lines (with a steer, a whisper or neither), a redo, a
 * scenario's first lines. Everything else the scene's route does answers at once.
 */
export function writesLines(body: Record<string, unknown>): boolean {
  return !body.rewind && !body.reset && body.set_scene === undefined && body.roleplay === undefined && !body.forget_whisper && !body.limits;
}

/**
 * Whether a write's answer never reached the page: no response at all (the connection dropped), or a proxy's own page
 * for a request it cut off (a 5xx with none of the app's JSON in it). The app's own refusals always say `error` or
 * `message`.
 */
export function answerLost(res: { ok: boolean; status: number; data: Record<string, unknown> } | null): boolean {
  if (!res) return true;
  if (res.ok) return false;
  return res.status >= 500 && typeof res.data.error !== "string" && typeof res.data.message !== "string";
}

/**
 * What one look at the scene means once a write's answer is lost:
 *  - "writing": the write is still in flight (look again);
 *  - "landed": it has ended and left its lines;
 *  - "nothing": no write is in flight and nothing new is there, for WATCH_QUIET_LOOKS looks running: it never started,
 *    or it failed;
 *  - "again": not known yet (the look itself failed, or it's the first quiet look).
 * `now`: the scene as the server has it, null when it couldn't be asked. `quiet`: the quiet looks before this one.
 */
export function lostWriteVerdict(before: SeenScene, now: SeenScene | null, quiet: number): "writing" | "landed" | "nothing" | "again" {
  if (!now) return "again";
  if (now.writing_for != null) return "writing";
  if (writeLanded(before, now)) return "landed";
  return quiet + 1 >= WATCH_QUIET_LOOKS ? "nothing" : "again";
}

/** How many lines a write added, as far as the scene shows: for autoplay's "nothing new" stop when the answer was lost. */
export function linesAdded(before: SeenScene, now: SeenScene): number {
  if (chapterOf(now) !== chapterOf(before)) return now.lines.length || 1;
  return Math.max(0, now.lines.length - before.lines.length) || (hasNewLines(before, now) ? 1 : 0);
}

/** A kept answer's body (lib/http.ts jsonWhenDone, app/api/admin/after-dark/route.ts): the real status, and the JSON it would have had. */
export type KeptAnswer = { kept: true; status: number; body: Record<string, unknown> };

/** The kept answer in what the route sent, or null when it's something else (a route or a proxy answering the plain way). */
export function keptAnswerOf(value: unknown): KeptAnswer | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { kept?: unknown; status?: unknown; body?: unknown };
  if (v.kept !== true || typeof v.status !== "number" || !Number.isInteger(v.status) || v.status < 100 || v.status > 599) return null;
  return { kept: true, status: v.status, body: v.body && typeof v.body === "object" && !Array.isArray(v.body) ? (v.body as Record<string, unknown>) : {} };
}
