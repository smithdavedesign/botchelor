/**
 * The Matches page's data: every thread one of your characters has, a swipe match or someone it has dated, with the
 * last text and whether there's anything unread. Each pair's chain is loaded through lib/text-chain.ts's loadChain
 * (owner layer), so a preview never shows a text from a date the viewer couldn't open.
 */
import { PUBLIC_COLUMNS, toProfile, type MadeBy, type ProfileRow } from "./dating";
import { hasJobKey } from "./connections";
import type { Db } from "./db";
import { getPublicCharacter } from "./game";
import { markPairNotices, pairNoticeLinks } from "./notifications";
import { loadRelationship, pairKey, viewRelationship } from "./relationships";
import { matchView } from "./swipes";
import { chainPage, loadChain, type ChainItem, type ChainText } from "./text-chain";
import { unmatchedSql } from "./unmatch";

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
  /** A match whose notice this viewer hasn't seen yet. */
  new_match: boolean;
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

/**
 * Marks this pair's "texted" notifications read for one viewer (opening the thread, read_texts, wait_for_text), and
 * moves the thread's own read mark (thread_reads), which is what the Matches page's dot goes by.
 */
export async function markTextsRead(db: Db, userId: string, lo: string, hi: string): Promise<void> {
  await Promise.all([
    db
      .query(`update notifications set read_at = now() where user_id = $1 and kind = 'texted' and read_at is null and link = any($2)`, [userId, textedLinks(lo, hi)])
      .catch(() => {}),
    setThreadRead(db, userId, lo, hi, new Date()),
  ]);
}

function setThreadRead(db: Db, userId: string, lo: string, hi: string, at: Date): Promise<void> {
  return db
    .query(
      `insert into thread_reads (user_id, character_lo, character_hi, read_at) values ($1, $2, $3, $4)
         on conflict (user_id, character_lo, character_hi) do update set read_at = greatest(thread_reads.read_at, excluded.read_at)`,
      [userId, lo, hi, at.toISOString()],
    )
    .then(() => {})
    .catch(() => {});
}

/**
 * The thread's unread texts (David, 2026-10-24: "clearing notifications shouldn't clear the dot on an unread message,
 * since it still is unread"): the other side's texts since the viewer last read it, or since their own last text (an
 * answer reads everything before it). A thread with no read mark yet (from before thread_reads) goes by its unread
 * notices once and gets a mark from them, so the dot survives the notices being cleared later.
 */
function threadUnread(texts: ChainText[], self: "lo" | "hi", readAt: Date | undefined, notices: number): { unread: number; mark: Date | null } {
  const lastMine = texts.findLast((x) => x.who === self);
  const since = lastMine ? texts.slice(texts.indexOf(lastMine) + 1) : texts;
  if (readAt) return { unread: since.filter((x) => new Date(x.at) > readAt).length, mark: null };
  const unread = Math.min(notices, since.length);
  const first = since.at(-unread);
  return { unread, mark: unread && first ? new Date(new Date(first.at).getTime() - 1) : new Date() };
}

/**
 * #619 (the 2026-10-21-2300 run: waiting_for_you "kept showing texted: 2 after I'd read the texts"): a "texted" notice is
 * done once this viewer's own character has texted that pair since it (lib/texting.ts tell() moves the notice's time to
 * their newest text, so a text of yours after it is an answer to all of it). Marked read before anything counts them.
 */
export async function sweepAnsweredTexts(db: Db, userId: string): Promise<void> {
  await db
    .query(
      `update notifications n set read_at = now()
        where n.user_id = $1 and n.kind = 'texted' and n.read_at is null and n.link is not null
          and exists (
            select 1 from couple_texts t
              join characters c on c.id = case when t.who = 'lo' then t.character_lo else t.character_hi end and c.owner_id = $1
             where n.link in ('/messages/' || t.character_lo || '/' || t.character_hi, '/couples/' || t.character_lo || '/' || t.character_hi || '#texts')
               and t.created_at > n.created_at)`,
      [userId],
    )
    .catch(() => {});
}

/**
 * How many texts each pair has that this viewer hasn't read, by the pair's thread link (#620: read_texts without `with`
 * lists the threads with an unread count). One unread notice per couple counts what came in since it was read ("(3 new)").
 */
export async function unreadTextsByPair(db: Db, userId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ link: string; title: string }>(
    `select link, title from notifications where user_id = $1 and kind = 'texted' and read_at is null and link is not null`,
    [userId],
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const m = /^\/(?:messages|couples)\/([^/#?]+)\/([^/#?]+)/.exec(r.link);
    if (!m) continue;
    const key = `/messages/${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`;
    out.set(key, (out.get(key) ?? 0) + Number(/\((\d+) new\)$/.exec(r.title)?.[1] ?? 1));
  }
  return out;
}

/**
 * What's new for each of the viewer's characters (David, 2026-10-21: "my account has a new match but when I go look I
 * can't tell what character it is for"): unread texts and new-match notices, counted by the pair each notice's link
 * names. `latest` is the newest of them, so /matches can open on the character it's about.
 */
export type CharacterNews = { texts: number; matches: number; latest: string | null };

export async function newsByCharacter(db: Db, userId: string, characterIds: readonly string[]): Promise<Map<string, CharacterNews>> {
  const news = new Map(characterIds.map((id) => [id, { texts: 0, matches: 0, latest: null as string | null }]));
  const { rows } = await db.query<{ kind: string; link: string; created_at: string | Date }>(
    `select kind, link, created_at from notifications where user_id = $1 and read_at is null and kind in ('texted', 'matched') and link is not null`,
    [userId],
  );
  for (const r of rows) {
    const m = /^\/(?:messages|couples)\/([^/#?]+)\/([^/#?]+)/.exec(r.link);
    if (!m) continue;
    const at = new Date(r.created_at).toISOString();
    for (const id of new Set([decodeURIComponent(m[1]), decodeURIComponent(m[2])])) {
      const n = news.get(id);
      if (!n) continue;
      if (r.kind === "texted") n.texts++;
      else n.matches++;
      if (!n.latest || at > n.latest) n.latest = at;
    }
  }
  return news;
}

/** The character /matches opens on without one asked for: the one with the newest unread news, else the first. */
export function characterToOpen<T extends { id: string }>(mine: readonly T[], news: Map<string, CharacterNews>): T | undefined {
  let best: T | undefined;
  for (const c of mine) {
    const at = news.get(c.id)?.latest;
    if (at && (!best || at > news.get(best.id)!.latest!)) best = c;
  }
  return best ?? mine[0];
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
       select ${PUBLIC_COLUMNS}, c.owner_id from others o join characters c on c.id = o.other where c.id <> $1 and not ${unmatchedSql("c.id", "$1::text")}`,
      [characterId],
    )
  ).rows;
  const [matches, unread, latest, reads] = await Promise.all([
    db.query<{ lo: string; hi: string; matched_at: string | Date; yes_lo: boolean | null; yes_hi: boolean | null }>(
      `select character_lo as lo, character_hi as hi, matched_at, yes_lo, yes_hi from matches where $1 in (character_lo, character_hi)`,
      [characterId],
    ),
    db.query<{ link: string; n: number; kind: string }>(
      `select link, kind, count(*)::int as n from notifications where user_id = $1 and kind in ('texted', 'matched') and read_at is null and link is not null group by link, kind`,
      [userId],
    ),
    latestDates(db, userId, characterId),
    db.query<{ lo: string; hi: string; read_at: string | Date }>(
      `select character_lo as lo, character_hi as hi, read_at from thread_reads where user_id = $1 and $2 in (character_lo, character_hi)`,
      [userId, characterId],
    ),
  ]);
  const readAt = new Map(reads.rows.map((r) => [`${r.lo}/${r.hi}`, new Date(r.read_at)]));
  const unreadBy = new Map(unread.rows.filter((r) => r.kind === "texted").map((r) => [r.link, r.n]));
  const newMatchLinks = new Set(unread.rows.filter((r) => r.kind === "matched").map((r) => r.link));

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
      const notices = textedLinks(lo, hi).reduce((n, l) => n + (unreadBy.get(l) ?? 0), 0);
      const { unread, mark } = threadUnread(texts, self, readAt.get(`${lo}/${hi}`), notices);
      if (mark && texts.length) await setThreadRead(db, userId, lo, hi, mark);
      return {
        with: { id: p.id, name: p.name, house: p.made_by === "house", made_by: p.made_by, portrait: p.portrait, hue: p.hue },
        pair: [lo, hi],
        link: `/messages/${lo}/${hi}`,
        match,
        dates,
        last: last ? { text: last.text, at: last.at, mine: last.who === self } : null,
        unread,
        new_match: pairNoticeLinks(lo, hi).some((l) => newMatchLinks.has(l)),
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
    hasJobKey(db, viewerId, "text"),
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
    ownKey: key,
    stageLabel: view?.stage_label ?? (match ? "💘 Matched" : null),
  };
}

/**
 * #259: a "matched" or "date_agreed" notification is read once the agent acts on it (answers the match, books the
 * date). Matched on every link either kind has carried for the pair.
 */
export async function markPairNoticesRead(db: Db, userId: string, x: string, y: string, kinds: ("matched" | "date_agreed")[]): Promise<void> {
  await markPairNotices(db, userId, x, y, kinds);
}
