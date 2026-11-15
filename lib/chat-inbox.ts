/**
 * Chat (/chat; lib/nav-chat.ts): every thread a person has, in one list, newest first. Threads used to live behind two
 * doors with two names: Matches (lib/inbox.ts: what a person's characters text with other characters) and Companions
 * (lib/companion.ts: what a character texts with the person themselves). A visitor had to know which product a text
 * belonged to before finding it; in 30 days four people found Companions.
 *
 * This module merges the two lists and nothing else. It reads through the two libraries' own functions, so every rule
 * about what a viewer may see stays where it was: a dating thread's preview is the owner's layer of the chain
 * (lib/text-chain.ts, never a text from a date the viewer couldn't open), and a thread with the viewer is theirs alone.
 * Each row opens the page that thread always had (/messages/<a>/<b>, /companion/<id>). No model is called.
 */
import { listCompanions } from "./companion";
import { companionThreadHref } from "./companion-shared";
import { listMyDatingProfiles } from "./dating";
import type { Db } from "./db";
import { listThreads, newsByCharacter, type Thread } from "./inbox";
import { shortName } from "./names";

export type ChatKind = "you" | "dating";
export const CHAT_FILTERS = ["all", "you", "dating"] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number];
export const chatFilter = (v: string | string[] | undefined): ChatFilter => {
  const one = Array.isArray(v) ? v[0] : v;
  return one === "you" || one === "dating" ? one : "all";
};

export type ChatFace = { id: string; name: string; hue: number | null; house: boolean; portrait: string | null };

export type ChatRow = {
  kind: ChatKind;
  /** Stable across the two kinds: `you:<thread id>`, `dating:<mine>/<theirs>`. */
  key: string;
  /** The thread's own page, as it always was. */
  href: string;
  /** Who it is with: the character texting the viewer, or the one the viewer's character is texting. */
  who: ChatFace;
  /** A dating thread's other end: the viewer's own character. */
  mine: ChatFace | null;
  /** "Nell", or "Ira and Dex" for the viewer's Ira texting Dex. */
  title: string;
  /** The kind in plain words: "texting you", "texting each other". */
  says: string;
  /** The newest text; `by` names who sent it when that's the viewer's own character. */
  last: { text: string; by: string | null } | null;
  /** When anything last happened in it. */
  at: string;
  unread: number;
  /** A dating thread nobody has opened since they matched. */
  new_match: boolean;
};

export type ChatInbox = {
  rows: ChatRow[];
  /** Rows of each kind, before any filter. */
  counts: Record<ChatFilter, number>;
  /** The viewer's characters, newest first (lib/dating.ts listMyDatingProfiles). */
  characters: { id: string; name: string }[];
  /** Characters of theirs whose threads aren't listed here (past CHAT_CHARACTERS): /matches has every one. */
  unlisted: number;
};

/**
 * How many of a person's characters have their threads merged in: each costs a handful of reads (lib/inbox.ts
 * listThreads), all at once, on a ten-connection pool. Past this the ones with unread news come first, and the page
 * says the rest are on /matches.
 */
export const CHAT_CHARACTERS = 6;
/** The list's length: the newest threads. */
export const CHAT_MAX = 120;

/**
 * A dating thread that's filed away on Matches ("Didn't work out": someone passed, or the last date went badly) stays
 * out of this list too, unless it has something the viewer hasn't seen. /matches keeps every one.
 */
const filedAway = (t: Thread) => t.over && !t.new_match && t.unread === 0;

const newestFirst = (x: { at: string }, y: { at: string }) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0);

/** The dating rows of one of the viewer's characters. */
export function datingRows(mine: ChatFace, threads: readonly Thread[]): ChatRow[] {
  const me = shortName(mine.name);
  return threads
    .filter((t) => !filedAway(t))
    .map((t) => ({
      kind: "dating" as const,
      key: `dating:${mine.id}/${t.with.id}`,
      href: `${t.link}?as=${encodeURIComponent(mine.id)}`,
      who: { id: t.with.id, name: t.with.name, hue: t.with.hue, house: t.with.house, portrait: t.with.portrait },
      mine,
      title: `${me} and ${shortName(t.with.name)}`,
      says: "texting each other",
      last: t.last ? { text: t.last.text, by: t.last.mine ? me : shortName(t.with.name) } : null,
      at: t.at,
      unread: t.unread,
      new_match: t.new_match,
    }));
}

/**
 * The merged inbox for one viewer. `withYou`: the viewer may have threads with characters (lib/companion-access.ts:
 * companions are open to them, or they're a guest trying them); without it only their characters' threads are listed.
 * A viewer with no character gets no dating rows. Round trips in sequence: one for their characters, their news and
 * the threads with them, then listThreads' own for every character at once.
 */
export async function loadChat(db: Db, viewer: { userId: string; withYou: boolean }, now: Date = new Date()): Promise<ChatInbox> {
  const { userId } = viewer;
  const charactersP = listMyDatingProfiles(db, userId);
  const [characters, news, companions, unreadYou] = await Promise.all([
    charactersP,
    newsByCharacter(db, userId, charactersP.then((cs) => cs.map((c) => c.id))),
    viewer.withYou ? listCompanions(db, userId, now, { others: false }) : null,
    // What a character texted them first and they haven't opened, by its thread's link (lib/companion.ts postFromCharacter).
    viewer.withYou
      ? db
          .query<{ link: string; n: number }>(
            `select link, count(*)::int as n from notifications where user_id = $1 and kind = 'character_texted_you' and read_at is null and link is not null group by link`,
            [userId],
          )
          .then((r) => new Map(r.rows.map((x) => [x.link, x.n])))
      : new Map<string, number>(),
  ]);
  // The characters whose threads are merged: the ones with unread news first (the header's count may be any of theirs).
  const withNews = (id: string) => news.get(id)?.latest ?? "";
  const listed = [...characters].sort((a, b) => (withNews(a.id) < withNews(b.id) ? 1 : withNews(a.id) > withNews(b.id) ? -1 : 0)).slice(0, CHAT_CHARACTERS);
  const inboxes = await Promise.all(listed.map((c) => listThreads(db, userId, c.id).catch(() => null)));

  const rows: ChatRow[] = [];
  for (const t of companions?.threads ?? []) {
    if (!t.thread_id) continue;
    const href = companionThreadHref(t.thread_id);
    rows.push({
      kind: "you",
      key: `you:${t.thread_id}`,
      href,
      who: { id: t.id, name: t.name, hue: t.hue, house: t.house, portrait: t.portrait },
      mine: null,
      title: shortName(t.name),
      says: "texting you",
      last: t.last ? { text: t.last, by: null } : null,
      at: t.last_at ?? new Date(0).toISOString(),
      unread: unreadYou.get(href) ?? 0,
      new_match: false,
    });
  }
  listed.forEach((c, i) => {
    const inbox = inboxes[i];
    if (!inbox) return;
    rows.push(...datingRows({ id: c.id, name: c.name, hue: c.hue, house: false, portrait: c.portrait }, [...inbox.fresh, ...inbox.conversations]));
  });
  rows.sort(newestFirst);
  const you = rows.filter((r) => r.kind === "you").length;
  return {
    rows: rows.slice(0, CHAT_MAX),
    counts: { all: rows.length, you, dating: rows.length - you },
    characters: characters.map((c) => ({ id: c.id, name: c.name })),
    unlisted: Math.max(0, characters.length - listed.length),
  };
}

/** One kind's rows (the page's segmented filter). */
export const filterChat = (rows: readonly ChatRow[], filter: ChatFilter): ChatRow[] => (filter === "all" ? [...rows] : rows.filter((r) => r.kind === filter));
