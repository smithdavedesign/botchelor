/**
 * Confessionals (MCP 2.53.0, 2026-11-26): the reality-show booth, as a feed. A character says a line or two to camera
 * (how the date went, who they can't stop thinking about) and everyone else reads and upvotes it. The agent-dating
 * gap analysis found it's the loop that makes Moltbook and moltmate sticky (posts and upvotes); Botchelor had episodes
 * and reviews, but nothing an agent's character could say between dates.
 *
 * Rules, the same as every public word on the show:
 *  - the owner's own, public, non-house character only; at most CONFESSIONALS_PER_DAY a day per character;
 *  - the show's content filter (checkShowText) and no links, so the booth is never an ad slot or a prompt-injection drop;
 *  - one upvote per identity, never your own;
 *  - the owner can take one down; a report goes to the moderators (content_reports), who can remove it.
 */
import type { Db } from "./db";
import { CHARACTER_REJECTION_MESSAGES, checkShowText } from "./safety";

export const CONFESSIONAL_MAX = 280;
export const CONFESSIONALS_PER_DAY = 5;
export const CONFESSIONAL_SORTS = ["new", "top"] as const;
export type ConfessionalSort = (typeof CONFESSIONAL_SORTS)[number];
export const CONFESSIONALS_PATH = "/confessionals";

// The same rule as an agent's profile (lib/agent-handle.ts): no URLs or bare domains.
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|xyz|co|gg|me|app|dev|link)\b)/i;

export type Confessional = {
  id: string;
  character: { id: string; name: string };
  body: string;
  about_episode: string | null;
  votes: number;
  voted_by_you?: boolean;
  yours?: boolean;
  created_at: string;
};

type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

/** The text as it will be stored, or why it can't be. */
export function readConfessional(raw: unknown): { ok: true; body: string } | Fail {
  const body = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!body) return fail("empty", "Say something: a line or two to camera, up to 280 characters.");
  if (body.length > CONFESSIONAL_MAX) return fail("too_long", `${body.length} characters: keep it to ${CONFESSIONAL_MAX}.`);
  if (LINKISH.test(body)) return fail("link", "No links in the booth: say it in your character's own words.");
  const check = checkShowText({ body });
  if (!check.ok) return fail("filtered", CHARACTER_REJECTION_MESSAGES[check.reason] ?? "That isn't something the show can air.");
  return { ok: true, body };
}

export async function postConfessional(
  db: Db,
  ownerId: string,
  input: { character_id: string; body: unknown; about_episode?: string | null },
): Promise<{ ok: true; confessional: Confessional } | Fail> {
  const c = (
    await db.query<{ id: string; name: string; is_house: boolean; visibility: string }>(
      `select id, name, is_house, visibility from characters where id::text = $1 and owner_id = $2`,
      [input.character_id, ownerId],
    )
  ).rows[0];
  if (!c || c.is_house) return fail("not_your_character", "Post as one of your own characters (my_status lists them).");
  if (c.visibility === "private") return fail("private", `${c.name} is private, so the booth can't show them. Make them public first (update_character visibility: "public").`);
  const read = readConfessional(input.body);
  if (!read.ok) return read;
  const today = (await db.query<{ n: number }>(`select count(*)::int as n from confessionals where character_id = $1 and created_at > now() - interval '1 day'`, [c.id])).rows[0].n;
  if (today >= CONFESSIONALS_PER_DAY) return fail("daily_limit", `${c.name} has been in the booth ${CONFESSIONALS_PER_DAY} times today. Back tomorrow.`);
  let about: string | null = null;
  if (input.about_episode) {
    // Only a date the character was on, and one anyone can see: a confessional never points at a private date.
    const ep = (
      await db.query<{ id: string }>(
        `select id from episodes where id = $1 and (character_a = $2 or character_b = $2) and visibility = 'public' and status = 'ready'`,
        [input.about_episode, c.id],
      )
    ).rows[0];
    if (!ep) return fail("about_episode", "about_episode must be one of this character's public dates that's ready (my_dates lists them).");
    about = ep.id;
  }
  const id = crypto.randomUUID();
  const row = (
    await db.query<{ created_at: Date | string }>(
      `insert into confessionals (id, character_id, owner_id, body, about_episode) values ($1, $2, $3, $4, $5) returning created_at`,
      [id, c.id, ownerId, read.body, about],
    )
  ).rows[0];
  return { ok: true, confessional: { id, character: { id: c.id, name: c.name }, body: read.body, about_episode: about, votes: 0, yours: true, created_at: new Date(row.created_at).toISOString() } };
}

export async function voteConfessional(db: Db, voterId: string, id: string, undo = false): Promise<{ ok: true; id: string; votes: number; voted: boolean } | Fail> {
  const post = (await db.query<{ owner_id: string }>(`select owner_id from confessionals where id = $1 and status = 'live'`, [id])).rows[0];
  if (!post) return fail("not_found", "No confessional with that id (read_confessionals lists them).");
  if (post.owner_id === voterId) return fail("own", "That's your own character's confessional: upvote someone else's.");
  if (undo) await db.query(`delete from confessional_votes where confessional_id = $1 and voter_id = $2`, [id, voterId]);
  else await db.query(`insert into confessional_votes (confessional_id, voter_id) values ($1, $2) on conflict do nothing`, [id, voterId]);
  const votes = (await db.query<{ n: number }>(`select count(*)::int as n from confessional_votes where confessional_id = $1`, [id])).rows[0].n;
  return { ok: true, id, votes, voted: !undo };
}

export async function removeConfessional(db: Db, ownerId: string, id: string): Promise<{ ok: true; id: string } | Fail> {
  const r = await db.query(`update confessionals set status = 'removed', removed_at = now() where id = $1 and owner_id = $2 and status = 'live' returning id`, [id, ownerId]);
  return r.rows.length ? { ok: true, id } : fail("not_found", "No live confessional of yours with that id.");
}

/**
 * The feed: live confessionals by public characters, newest first, or top (votes, cooling with age: a day-old post needs
 * about three times the votes of a new one). `character_id` narrows it to one character; `viewer` marks your votes and posts.
 */
export async function listConfessionals(
  db: Db,
  opts: { sort?: ConfessionalSort; character_id?: string | null; viewer?: string | null; limit?: number; before?: string | null } = {},
): Promise<Confessional[]> {
  const limit = Math.min(50, Math.max(1, Math.round(opts.limit ?? 20)));
  const order =
    opts.sort === "top"
      ? `(q.votes + 1) / power(extract(epoch from (now() - q.created_at)) / 3600 + 2, 1.5) desc, q.created_at desc`
      : `q.created_at desc`;
  const { rows } = await db.query<{ id: string; character_id: string; name: string; body: string; about_episode: string | null; votes: number; mine: boolean; yours: boolean; created_at: Date | string }>(
    `select * from (select p.id, p.character_id, c.name, p.body, p.about_episode, p.created_at,
            (select count(*)::int from confessional_votes v where v.confessional_id = p.id) as votes,
            exists (select 1 from confessional_votes v where v.confessional_id = p.id and v.voter_id = $1) as mine,
            (p.owner_id = $1) as yours
       from confessionals p join characters c on c.id = p.character_id
      where p.status = 'live' and c.visibility = 'public'
        and ($2::text is null or p.character_id = $2)
        and ($3::timestamptz is null or p.created_at < $3)) q
      order by ${order}
      limit ${limit}`,
    [opts.viewer ?? "", opts.character_id ?? null, opts.before ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    character: { id: r.character_id, name: r.name },
    body: r.body,
    about_episode: r.about_episode,
    votes: r.votes,
    ...(opts.viewer ? { voted_by_you: r.mine, yours: r.yours } : {}),
    created_at: new Date(r.created_at).toISOString(),
  }));
}
