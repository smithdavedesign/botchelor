/**
 * The Matches page's data: every thread one of your characters has, a swipe match or someone it has dated, with the
 * last text and whether there's anything unread. Each pair's chain is loaded through lib/text-chain.ts's loadChain
 * (owner layer), so a preview never shows a text from a date the viewer couldn't open.
 */
import { PUBLIC_COLUMNS, toProfile, type MadeBy, type ProfileRow } from "./dating";
import type { Db } from "./db";
import { getPublicCharacter } from "./game";
import { loadRelationship, pairKey, viewRelationship } from "./relationships";
import { matchView } from "./swipes";
import { chainPage, loadChain, type ChainItem, type ChainText } from "./text-chain";

/** At most this many threads per character: the newest first. */
export const INBOX_MAX = 60;

export type Thread = {
  with: { id: string; name: string; house: boolean; made_by: MadeBy; portrait: string | null; hue: number | null };
  pair: [string, string];
  /** The thread-only page. */
  link: string;
  /** From the swipe deck: when they matched and each side's answer about a date (null: not yet). */
  match: { matched_at: string; you: boolean | null; them: boolean | null; agreed: boolean } | null;
  /** Dates of theirs this viewer can see. */
  dates: number;
  last: { text: string; at: string; mine: boolean } | null;
  unread: number;
  /** When anything last happened between them: the last text, else the match or the last date. */
  at: string;
  /** What happens next: book the date they both want, watch the one being filmed, and so on. */
  next: NextStep | null;
};

/**
 * Where a pair stands, as the one thing to do next (the thread's action bar, the Matches badge; David, 2026-10-18:
 * "if both want a date, give them a link"). A date since they matched wins: it's being filmed, or it's there to watch.
 * Otherwise the swipe deck's yes or no: both want one (book it), someone said no, or someone hasn't answered.
 */
export type NextStep =
  | { kind: "book" }
  | { kind: "waiting"; on: "you" | "them" }
  | { kind: "declined"; by: "you" | "them" }
  | { kind: "filming"; episode_id: string }
  | { kind: "dated"; episode_id: string; aired: boolean };

type LatestDate = { id: string; status: string; created_at: string | Date; revealed_at: string | Date | null };

export function nextStep(match: { matched_at: string; you: boolean | null; them: boolean | null } | null, latest: LatestDate | null): NextStep | null {
  if (latest && (!match || new Date(latest.created_at).getTime() >= new Date(match.matched_at).getTime())) {
    return latest.status === "generating" ? { kind: "filming", episode_id: latest.id } : { kind: "dated", episode_id: latest.id, aired: latest.revealed_at !== null };
  }
  if (!match) return null;
  if (match.you === true && match.them === true) return { kind: "book" };
  if (match.you === false || match.them === false) return { kind: "declined", by: match.you === false ? "you" : "them" };
  return { kind: "waiting", on: match.you === null ? "you" : "them" };
}

/**
 * The newest date each of this character's pairs has that the viewer may open: being filmed or ready, not a Sliding
 * Doors replay, and not someone else's private date. Keyed by the other character.
 */
async function latestDates(db: Db, viewerId: string, characterId: string, otherId?: string): Promise<Map<string, LatestDate>> {
  const { rows } = await db.query<LatestDate & { other: string }>(
    `select id, status, created_at, revealed_at, case when character_a = $1 then character_b else character_a end as other
       from episodes
      where $1 in (character_a, character_b) and ($3::text is null or $3 in (character_a, character_b))
        and status in ('generating', 'ready') and varies_episode_id is null
        and (visibility <> 'private' or creator_id = $2 or partner_performer = $2)
      order by created_at desc`,
    [characterId, viewerId, otherId ?? null],
  );
  const out = new Map<string, LatestDate>();
  for (const r of rows) if (!out.has(r.other)) out.set(r.other, r);
  return out;
}

export type Inbox = {
  /** Matched, no texts yet: the row of faces. */
  fresh: Thread[];
  /** Everyone with a text, newest first. */
  conversations: Thread[];
};

/** The links a "texted" notification for this pair may carry: the thread page, or the couple page's texts. */
export const textedLinks = (lo: string, hi: string) => [`/messages/${lo}/${hi}`, `/couples/${lo}/${hi}#texts`];

/** Marks this pair's "texted" notifications read for one viewer (opening the thread, read_texts, wait_for_text). */
export async function markTextsRead(db: Db, userId: string, lo: string, hi: string): Promise<void> {
  await db
    .query(`update notifications set read_at = now() where user_id = $1 and kind = 'texted' and read_at is null and link = any($2)`, [userId, textedLinks(lo, hi)])
    .catch(() => {});
}

/** Null when the character isn't the viewer's. */
export async function listThreads(db: Db, userId: string, characterId: string): Promise<Inbox | null> {
  const own = (await db.query(`select 1 from characters where id = $1 and owner_id = $2`, [characterId, userId])).rows.length > 0;
  if (!own) return null;
  const others = (
    await db.query<ProfileRow & { owner_id: string | null }>(
      `with others as (
         select case when character_lo = $1 then character_hi else character_lo end as other from matches where $1 in (character_lo, character_hi)
         union
         select case when character_a = $1 then character_b else character_a end from episodes
          where status = 'ready' and varies_episode_id is null and $1 in (character_a, character_b)
         union
         select case when character_lo = $1 then character_hi else character_lo end from couple_texts where $1 in (character_lo, character_hi)
       )
       select ${PUBLIC_COLUMNS}, c.owner_id from others o join characters c on c.id = o.other where c.id <> $1`,
      [characterId],
    )
  ).rows;
  const [matches, unread, latest] = await Promise.all([
    db.query<{ lo: string; hi: string; matched_at: string | Date; yes_lo: boolean | null; yes_hi: boolean | null }>(
      `select character_lo as lo, character_hi as hi, matched_at, yes_lo, yes_hi from matches where $1 in (character_lo, character_hi)`,
      [characterId],
    ),
    db.query<{ link: string; n: number }>(
      `select link, count(*)::int as n from notifications where user_id = $1 and kind = 'texted' and read_at is null and link is not null group by link`,
      [userId],
    ),
    latestDates(db, userId, characterId),
  ]);
  const unreadBy = new Map(unread.rows.map((r) => [r.link, r.n]));

  const threads = await Promise.all(
    others.map(async (row): Promise<Thread | null> => {
      const p = toProfile(row);
      const [lo, hi] = pairKey(characterId, p.id);
      const self = characterId === lo ? "lo" : "hi";
      const chain: ChainItem[] = await loadChain(db, lo, hi, { userId, owner: true });
      const texts = chain.filter((i): i is ChainText => i.kind === "text");
      const dates = chain.filter((i) => i.kind === "date").length;
      const m = matches.rows.find((r) => r.lo === lo && r.hi === hi);
      // A pair with nothing this viewer can see (say, only someone else's private date) isn't a thread.
      if (!m && !texts.length && !dates) return null;
      const last = texts.at(-1);
      const mineLo = self === "lo";
      const match = m
        ? { matched_at: new Date(m.matched_at).toISOString(), you: mineLo ? m.yes_lo : m.yes_hi, them: mineLo ? m.yes_hi : m.yes_lo, agreed: m.yes_lo === true && m.yes_hi === true }
        : null;
      const at = last?.at ?? chain.at(-1)?.at ?? match?.matched_at ?? new Date(0).toISOString();
      return {
        with: { id: p.id, name: p.name, house: p.made_by === "house", made_by: p.made_by, portrait: p.portrait, hue: p.hue },
        pair: [lo, hi],
        link: `/messages/${lo}/${hi}`,
        match,
        dates,
        last: last ? { text: last.text, at: last.at, mine: last.who === self } : null,
        unread: textedLinks(lo, hi).reduce((n, l) => n + (unreadBy.get(l) ?? 0), 0),
        at,
        next: nextStep(match, latest.get(p.id) ?? null),
      };
    }),
  );
  const all = threads.filter((t): t is Thread => t !== null).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, INBOX_MAX);
  return { fresh: all.filter((t) => !t.last), conversations: all.filter((t) => t.last) };
}

/** Unread texts across all of a viewer's characters: the nav's Matches dot. */
export async function unreadTexts(db: Db, userId: string): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and kind = 'texted' and read_at is null`, [userId]);
  return r.rows[0]?.n ?? 0;
}

/**
 * One thread for its owner (the /messages page; the couple page's match view): the pair, which ends are the viewer's,
 * the newest page of the chain, the stage to show, and whether they text on their own key. Null for anyone who owns
 * neither character, or a pair with nothing between them.
 */
export async function loadThread(db: Db, viewerId: string | null, a: string, b: string) {
  if (!viewerId) return null;
  const [lo, hi] = pairKey(a, b);
  const owners = (await db.query<{ id: string; owner_id: string | null }>(`select id, owner_id from characters where id = any($1)`, [[lo, hi]])).rows;
  const mine = owners.filter((o) => o.owner_id === viewerId).map((o) => o.id);
  if (!mine.length) return null;
  const [ca, cb, match, rel, items, key] = await Promise.all([
    getPublicCharacter(db, lo),
    getPublicCharacter(db, hi),
    matchView(db, lo, hi),
    loadRelationship(db, lo, hi),
    loadChain(db, lo, hi, { userId: viewerId, owner: true }),
    db.query("select 1 from user_keys where user_id = $1 and kind = 'text' limit 1", [viewerId]),
  ]);
  if (!ca || !cb) return null;
  const view = rel ? viewRelationship(rel, { userId: viewerId, owner: true }) : null;
  if (!match && !view && !items.length) return null;
  // Whose phone it is decides "you" and "them" in the next step; the page passes ?as= when the viewer owns both.
  const nextFor = async (self: string) => {
    const other = self === lo ? hi : lo;
    const latest = (await latestDates(db, viewerId, self, other)).get(other) ?? null;
    const mineLo = self === lo;
    const m = match ? { matched_at: match.matched_at, you: mineLo ? match.yes_lo : match.yes_hi, them: mineLo ? match.yes_hi : match.yes_lo } : null;
    return nextStep(m, latest);
  };
  return {
    nextFor,
    /** The couple page exists for a pair that has dated or matched (a pair that has only texted has none). */
    hasStory: Boolean(view || match),
    ca,
    cb,
    mine,
    match,
    view,
    chain: chainPage(items),
    ownKey: key.rows.length > 0,
    stageLabel: view?.stage_label ?? (match ? "💘 Matched" : null),
  };
}
