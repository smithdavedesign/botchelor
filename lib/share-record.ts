/**
 * The spoiler-free share card for your calls (docs/show-style.md, "Wordle / neal.fun": a spoiler-free share artifact;
 * wave 2, 2026-11-02). After a prediction is scored, and beside your record, Share makes a text grid and a link:
 *
 *   My Botchelor calls · S2 · Night 2
 *   🟩🟩⬛🟩🟩🟩
 *   5 of 6 right · 3 in a row
 *   https://botchelor.com/calls?…
 *
 * No spoilers by construction (lib/episode-share.ts's rule: a share never names a creator or the ending): a square says
 * only whether YOU called a date right, never which date, who was on it, what you picked or how it ended. The night code
 * is today's ("S2 · Night 2"), not an episode's. The link (/calls) shows the same grid with its card (/api/og/record) and
 * invites the reader to call tonight's endings; it carries only these numbers, parsed strictly, so nobody can put words
 * on the card.
 *
 * The sharer's display name (polish, 2026-11-02): when they have one that's theirs alone (#1238's one person per display
 * name, the name the best-callers board shows), the link carries it as `by`, with `k`, a server signature over that
 * person, the name and these numbers (lib/share-record-name.ts). /calls shows "<name>'s calls" only when the signature
 * checks out for the one person who goes by that name now; anything else, a rename or an edited number, reads
 * "Someone's calls". No id ever rides the link: the name, which is already public on the board, and an opaque check.
 *
 * Pure and client-safe (the Share button builds the text in the browser): no server imports, no model call, $0.
 */
import { seasonNumber } from "./season-ref";
import { seasonIdOf } from "./season-window";

/** How many of the latest calls the grid shows (Wordle's six rows, roughly: a run you can read at a glance). */
export const SHARE_SQUARES = 10;
/** The ref on a shared record link, so the engagement log tells these visits apart. */
export const RECORD_SHARE_REF = "share-record";
const RIGHT = "🟩";
const MISS = "⬛";
const MAX_COUNT = 100_000;

export type RecordShare = {
  /** The latest calls in airing order, oldest first, at most SHARE_SQUARES: true = called it right. */
  recent: boolean[];
  right: number;
  called: number;
  streak: number;
  best: number;
  /** Today's season and night ("S1 · Night 2"), or null outside the monthly seasons. */
  season: number | null;
  night: number | null;
  /** The sharer's display name and its signature (lib/share-record-name.ts), when they have a name of their own. */
  by?: string;
  k?: string;
  /**
   * This week's calls (2026-11-07 audit, item 10: "I called 4/5 this week"): when set, the grid is this week's calls and
   * the words lead with them. Shares from before it, without one, read as they always did.
   */
  week?: { right: number; called: number };
};

/** Today's "S1 · Night 2" as numbers (a monthly season is a month; its night is the UTC day of it). */
export function tonightOf(now: Date): { season: number | null; night: number | null } {
  const season = seasonNumber(seasonIdOf(now));
  return season ? { season, night: now.getUTCDate() } : { season: null, night: null };
}

export const recordGrid = (recent: readonly boolean[]): string => recent.slice(-SHARE_SQUARES).map((hit) => (hit ? RIGHT : MISS)).join("");

export const nightCode = (s: Pick<RecordShare, "season" | "night">): string | null => (s.season && s.night ? `S${s.season} · Night ${s.night}` : null);

/**
 * "5 of 6 right · 3 in a row" (lib/streaks.ts recordLine's words, so the card and the page agree); with this week's
 * calls, "4 of 5 this week · 3 in a row".
 */
export function recordWords(s: Pick<RecordShare, "right" | "called" | "streak" | "best" | "week">): string {
  if (s.week) return [`${s.week.right} of ${s.week.called} this week`, ...(s.streak >= 2 ? [`${s.streak} in a row`] : [])].join(" · ");
  const parts = [`${s.right} of ${s.called} right`];
  if (s.streak >= 2) parts.push(`${s.streak} in a row`);
  if (s.best >= 2 && s.best > s.streak) parts.push(`best run ${s.best}`);
  return parts.join(" · ");
}

/** The shared link's path: the numbers only, never a name or an episode. */
export function recordSharePath(s: RecordShare): string {
  const q = new URLSearchParams({
    g: s.recent
      .slice(-SHARE_SQUARES)
      .map((h) => (h ? "1" : "0"))
      .join(""),
    w: String(s.right),
    c: String(s.called),
    s: String(s.streak),
    b: String(s.best),
  });
  if (s.season && s.night) q.set("n", `${s.season}-${s.night}`);
  if (s.week) q.set("t", `${s.week.right}-${s.week.called}`);
  if (s.by && s.k) {
    q.set("by", s.by);
    q.set("k", s.k);
  }
  q.set("ref", RECORD_SHARE_REF);
  return `/calls?${q.toString()}`;
}

/** The text a Share puts on the clipboard (or in the phone's share sheet). */
export function recordShareText(s: RecordShare, url: string): string {
  const code = nightCode(s);
  return [`My Botchelor calls${code ? ` · ${code}` : ""}`, recordGrid(s.recent), recordWords(s), url].join("\n");
}

const int = (v: string | undefined, max: number): number | null => (v && /^\d{1,6}$/.test(v) && Number(v) <= max ? Number(v) : null);

/**
 * A shared link's numbers back, strictly: a grid of 1–SHARE_SQUARES zeros and ones, counts that add up, and an
 * optional "season-night". Anything else is null (the /calls page then just invites the reader to play).
 */
export function parseRecordShare(params: Record<string, string | string[] | undefined>): RecordShare | null {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const g = one("g");
  if (!g || !new RegExp(`^[01]{1,${SHARE_SQUARES}}$`).test(g)) return null;
  const right = int(one("w"), MAX_COUNT);
  const called = int(one("c"), MAX_COUNT);
  const streak = int(one("s"), MAX_COUNT);
  const best = int(one("b"), MAX_COUNT);
  if (right === null || called === null || streak === null || best === null) return null;
  if (right > called || called < g.length || streak > right || best > right || streak > best) return null;
  const n = /^(\d{1,3})-(\d{1,2})$/.exec(one("n") ?? "");
  const season = n ? Number(n[1]) : null;
  const night = n && Number(n[2]) >= 1 && Number(n[2]) <= 31 ? Number(n[2]) : null;
  // This week's calls: the grid is theirs, so it can't hold more squares (or more right ones) than the week does.
  let week: RecordShare["week"];
  const t = one("t");
  if (t !== undefined) {
    const m = /^(\d{1,4})-(\d{1,4})$/.exec(t);
    if (!m) return null;
    const [wr, wc] = [Number(m[1]), Number(m[2])];
    const ones = [...g].filter((c) => c === "1").length;
    if (wr > wc || wc > called || wr > right || g.length > wc || ones > wr || g.length - ones > wc - wr) return null;
    week = { right: wr, called: wc };
  }
  return {
    recent: [...g].map((c) => c === "1"),
    right,
    called,
    streak,
    best,
    season: season && night ? season : null,
    night: season && night ? night : null,
    ...(week ? { week } : {}),
  };
}

/** The numbers a share's signature covers, in one fixed order (lib/share-record-name.ts signs and checks this). */
export function recordShareKey(s: RecordShare): string {
  const g = s.recent
    .slice(-SHARE_SQUARES)
    .map((h) => (h ? "1" : "0"))
    .join("");
  // A week rides the key only when the share has one, so a link signed before weeks existed still checks out.
  return [g, s.right, s.called, s.streak, s.best, s.season && s.night ? `${s.season}-${s.night}` : "", ...(s.week ? [`t:${s.week.right}-${s.week.called}`] : [])].join("|");
}

/** The longest display name a link may carry (lib/people.ts PROFILE_NAME_MAX). */
const BY_MAX = 30;
const SIGNATURE = /^[A-Za-z0-9_-]{22}$/;

/** A shared link's claimed name and signature, shape-checked only: lib/share-record-name.ts decides whether it's true. */
export function sharedByOf(params: Record<string, string | string[] | undefined>): { by: string; k: string } | null {
  const by = typeof params.by === "string" ? params.by.trim() : "";
  const k = typeof params.k === "string" ? params.k : "";
  return by && by.length <= BY_MAX && SIGNATURE.test(k) ? { by, k } : null;
}
