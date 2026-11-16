/**
 * Show ideas (David 2026-11-16: "a show page and ask for interest in each show idea and allow people to propose a new
 * show ... a feeler on what could come"). A list of shows Botchelor MIGHT make, each with three ways to say you'd want
 * it, and a way to propose one. Nothing here is scheduled, built or sold: it is a demand test, and the page says so.
 *
 *  - Three answers, not one thumb: "I'd watch" costs nothing and says little; "I'd enter a character" and "I'd produce
 *    it" are the ones a decision can lean on. Each is a switch a voter can turn on or off, any mix.
 *  - People and agents are counted apart. The site has far more agent-made characters than visitors: one tally would
 *    measure our own bots. A vote is an agent's when it comes over MCP (or from a known bot); every other is a person's.
 *  - The house's ideas (HOUSE_IDEAS) live in code, like the season formats. A proposal is a row: it passes the show's PG
 *    text check, then waits for an admin (/admin/season) before anyone else sees it. Its proposer sees it as "waiting".
 *  - The season format ballot (lib/season-vote.ts) is a different thing and stays what it is: it decides next month.
 *    The page shows both, each labelled.
 *  - Nothing here touches points, odds, pairings or endings. $0: two tables and counts, no model call.
 *
 * SHOW_IDEAS=0 closes the page and its routes; SHOW_IDEAS_PROPOSE=0 keeps the page and stops new proposals.
 */
import { detectBot } from "./bots";
import type { Db } from "./db";
import { isMcpCall } from "./http";
import { notify } from "./notifications";
import { checkShowText } from "./safety";
import { showIdeasOn, showProposalsOn } from "./show-ideas-switch";
import { NO_PICKS, PITCH_MAX, PITCH_MIN, PROPOSALS_PER_30_DAYS, TITLE_MAX, TITLE_MIN, type IdeaView, type Picks, type Tally, type VoterKind } from "./show-ideas-shared";

export * from "./show-ideas-shared";

type Env = Record<string, string | undefined>;

export { showIdeasOn, showProposalsOn };


/** Whose answer a web request is: an agent's when it comes over MCP or from a known bot, a person's otherwise. */
export const voterKind = (req: Request): VoterKind =>
  isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent")) ? "agent" : "person";

/** Taps and proposals from one connection (lib/limits.ts). */
export const SHOW_VOTE_LIMITS = { perHour: 60, perDay: 200 };
export const SHOW_PROPOSE_LIMITS = { perHour: 3, perDay: 6 };

export type HouseIdea = { id: string; title: string; pitch: string; emoji: string; dating: boolean };

/**
 * The house's own ideas, in the order they're listed when nobody has voted. Working titles; one stays a dating show so
 * the list can say whether anyone wants to leave dating at all.
 */
export const HOUSE_IDEAS: readonly HouseIdea[] = [
  {
    id: "house-whodunit",
    title: "Who Did It",
    emoji: "🕵️",
    dating: false,
    pitch: "A mystery a week. The characters are the suspects and the sleuths, the rules decide who did it before a word is written, and you call it before the reveal.",
  },
  {
    id: "house-housemates",
    title: "Housemates",
    emoji: "🏠",
    dating: false,
    pitch: "No dates. Six characters share one house for a month: chores, alliances, a vote on who leaves, and a scene from every room each day.",
  },
  {
    id: "house-quest",
    title: "The Quest",
    emoji: "🗺️",
    dating: false,
    pitch: "A fantasy road story. A party of characters sets out together, each episode ends on a choice, and not everyone who starts the road finishes it.",
  },
  {
    id: "house-cook-off",
    title: "The Cook-Off",
    emoji: "🍳",
    dating: false,
    pitch: "A weekly contest in a shared kitchen. One challenge, one judge who can't be charmed, and one character sent home each week until two are left.",
  },
  {
    id: "house-second-chances",
    title: "Second Chances",
    emoji: "💌",
    dating: true,
    pitch: "A season of rematches. Pairs whose first date didn't click, and couples who broke up, get exactly one more date to change the ending.",
  },
];

const houseIdea = (id: string): HouseIdea | undefined => HOUSE_IDEAS.find((h) => h.id === id);

const emptyTally = (): Tally => ({ watch: 0, enter: 0, produce: 0, voters: 0 });

type IdeaRow = { id: string; title: string; pitch: string; proposed_by: string; proposer_kind: VoterKind; status: "pending" | "listed" | "declined"; created_at: Date | string };
type TallyRow = { idea_id: string; voter_kind: VoterKind; watch: number; enter: number; produce: number; voters: number };

/** The votes of every idea, by who cast them. `skip`: voters left out (the admin's view drops our own accounts). */
async function tallies(db: Db, skip: readonly string[] = []): Promise<Map<string, Record<VoterKind, Tally>>> {
  const { rows } = await db.query<TallyRow>(
    `select idea_id, voter_kind,
            count(*) filter (where watch)::int as watch,
            count(*) filter (where enter_character)::int as enter,
            count(*) filter (where produce)::int as produce,
            count(*)::int as voters
       from show_idea_votes
      where not (user_id = any($1::text[]))
      group by idea_id, voter_kind`,
    [skip],
  );
  const out = new Map<string, Record<VoterKind, Tally>>();
  for (const r of rows) {
    const t = out.get(r.idea_id) ?? { person: emptyTally(), agent: emptyTally() };
    t[r.voter_kind] = { watch: r.watch, enter: r.enter, produce: r.produce, voters: r.voters };
    out.set(r.idea_id, t);
  }
  return out;
}

/** How much people want an idea, for the order: producing and entering weigh more than watching. Agents never move it. */
export const interestScore = (t: Tally): number => t.watch + 2 * t.enter + 3 * t.produce;

/**
 * Every idea a viewer may see, most wanted by people first (the house's own order, then the newest proposal, on a
 * tie): the house's, each listed proposal, and the viewer's own proposals that are still waiting.
 */
export async function listShowIdeas(db: Db, viewerId: string | null, opts: { skip?: readonly string[] } = {}): Promise<IdeaView[]> {
  const [votes, proposals, mine] = await Promise.all([
    tallies(db, opts.skip),
    db.query<IdeaRow>(
      `select id, title, pitch, proposed_by, proposer_kind, status, created_at from show_ideas
        where status = 'listed' or (status = 'pending' and proposed_by = $1)
        order by created_at desc`,
      [viewerId ?? ""],
    ),
    viewerId
      ? db.query<{ idea_id: string; watch: boolean; enter_character: boolean; produce: boolean }>(
          `select idea_id, watch, enter_character, produce from show_idea_votes where user_id = $1`,
          [viewerId],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const own = new Map(mine.rows.map((r) => [r.idea_id, { watch: r.watch, enter: r.enter_character, produce: r.produce }]));
  const view = (id: string, rest: Pick<IdeaView, "title" | "pitch" | "emoji" | "house" | "proposed_by" | "status">): IdeaView => ({
    id,
    ...rest,
    people: votes.get(id)?.person ?? emptyTally(),
    agents: votes.get(id)?.agent ?? emptyTally(),
    mine: own.get(id) ?? { ...NO_PICKS },
    open: rest.status === "listed",
  });
  const all = [
    ...HOUSE_IDEAS.map((h) => view(h.id, { title: h.title, pitch: h.pitch, emoji: h.emoji, house: true, proposed_by: null, status: "listed" })),
    ...proposals.rows.map((p) =>
      view(p.id, { title: p.title, pitch: p.pitch, emoji: "💡", house: false, proposed_by: p.proposer_kind, status: p.status === "listed" ? "listed" : "waiting" }),
    ),
  ];
  // A stable sort: the list above is already the tie order.
  return all.map((idea, i) => ({ idea, i })).sort((a, b) => interestScore(b.idea.people) - interestScore(a.idea.people) || a.i - b.i).map((x) => x.idea);
}

export type Refusal = { ok: false; status: number; error: string; message: string; field?: string };

/** Whether an idea takes votes: one of the house's, or a listed proposal. */
async function votable(db: Db, ideaId: string): Promise<boolean> {
  if (houseIdea(ideaId)) return true;
  const { rows } = await db.query(`select 1 from show_ideas where id = $1 and status = 'listed'`, [ideaId]);
  return rows.length > 0;
}

/**
 * One voter's answers on one idea: the three switches as they should now stand. All off removes the row, so "voters"
 * counts only those who want something.
 */
export async function voteShowIdea(db: Db, userId: string, kind: VoterKind, ideaId: string, picks: Picks): Promise<{ ok: true; idea_id: string; mine: Picks } | Refusal> {
  if (!(await votable(db, ideaId))) return { ok: false, status: 404, error: "no_such_idea", message: "That show idea isn't on the list." };
  if (!picks.watch && !picks.enter && !picks.produce) {
    await db.query(`delete from show_idea_votes where idea_id = $1 and user_id = $2`, [ideaId, userId]);
    return { ok: true, idea_id: ideaId, mine: { ...NO_PICKS } };
  }
  await db.query(
    `insert into show_idea_votes (idea_id, user_id, voter_kind, watch, enter_character, produce) values ($1, $2, $3, $4, $5, $6)
     on conflict (idea_id, user_id) do update
       set watch = excluded.watch, enter_character = excluded.enter_character, produce = excluded.produce, voter_kind = excluded.voter_kind, updated_at = now()`,
    [ideaId, userId, kind, picks.watch, picks.enter, picks.produce],
  );
  return { ok: true, idea_id: ideaId, mine: { ...picks } };
}

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();
/** A title as it's compared for "already on the list": letters and digits only, lower case. */
const titleKey = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * A proposal: a working title and a pitch, held for an admin. Refused when it's too short or long, when it isn't PG
 * (the show's own text check), when an idea by that title is already listed or waiting, or when this proposer already
 * has PROPOSALS_PER_30_DAYS from the last 30 days. Admins hear, once per proposal.
 */
export async function proposeShowIdea(
  db: Db,
  userId: string,
  kind: VoterKind,
  input: { title: string; pitch: string },
  env: Env = process.env,
): Promise<{ ok: true; id: string; status: "waiting"; title: string; pitch: string } | Refusal> {
  if (!showProposalsOn(env)) return { ok: false, status: 503, error: "proposals_closed", message: "New show ideas aren't being taken right now. You can still vote on the list." };
  const title = squash(input.title);
  const pitch = squash(input.pitch);
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    return { ok: false, status: 422, error: "invalid_idea", field: "title", message: `Give it a working title of ${TITLE_MIN} to ${TITLE_MAX} characters.` };
  }
  if (pitch.length < PITCH_MIN || pitch.length > PITCH_MAX) {
    return { ok: false, status: 422, error: "invalid_idea", field: "pitch", message: `Say what happens on the show in ${PITCH_MIN} to ${PITCH_MAX} characters.` };
  }
  if (/https?:\/\/|www\.|@\w+\.\w+/i.test(`${title} ${pitch}`)) {
    return { ok: false, status: 422, error: "invalid_idea", field: "pitch", message: "No links or addresses: describe the show in words." };
  }
  const safe = checkShowText({ title, pitch });
  if (!safe.ok) {
    return { ok: false, status: 422, error: "not_pg", field: safe.field, message: "The show is PG and every character is an adult. Reword it so it fits, then send it again." };
  }
  const key = titleKey(title);
  const taken =
    HOUSE_IDEAS.some((h) => titleKey(h.title) === key) ||
    (await db.query<{ title: string }>(`select title from show_ideas where status in ('pending', 'listed')`)).rows.some((r) => titleKey(r.title) === key);
  if (taken) return { ok: false, status: 409, error: "already_proposed", message: "A show by that title is already on the list or waiting. Vote for it, or pick another title." };
  const recent = await db.query<{ n: number }>(
    `select count(*)::int as n from show_ideas where proposed_by = $1 and status in ('pending', 'listed') and created_at > now() - interval '30 days'`,
    [userId],
  );
  if ((recent.rows[0]?.n ?? 0) >= PROPOSALS_PER_30_DAYS) {
    return { ok: false, status: 429, error: "too_many_ideas", message: `That's ${PROPOSALS_PER_30_DAYS} ideas from you this month. Give these a chance first.` };
  }
  const id = crypto.randomUUID();
  await db.query(`insert into show_ideas (id, title, pitch, proposed_by, proposer_kind) values ($1, $2, $3, $4, $5)`, [id, title, pitch, userId, kind]);
  // The admins hear (a notice, never an email): one proposal, one notice each. Best effort.
  try {
    const admins = await db.query<{ user_id: string }>(`select user_id from admins`);
    for (const a of admins.rows) {
      await notify(db, a.user_id, { kind: "show_idea", title: `💡 A show idea is waiting: ${title}`, body: pitch.slice(0, 200), link: "/admin/season#show-ideas" });
    }
  } catch {
    // The proposal stands; the admin panel lists it either way.
  }
  return { ok: true, id, status: "waiting", title, pitch };
}

export type AdminIdea = {
  id: string;
  title: string;
  pitch: string;
  house: boolean;
  status: "pending" | "listed" | "declined";
  proposed_by: VoterKind | null;
  created_at: string | null;
  people: Tally;
  agents: Tally;
};

/** Everything, for /admin/season: waiting proposals first, then the list as the page orders it, then the declined. `skip` drops our own voters from the counts. */
export async function adminShowIdeas(db: Db, skip: readonly string[] = []): Promise<AdminIdea[]> {
  const [votes, rows] = await Promise.all([tallies(db, skip), db.query<IdeaRow>(`select id, title, pitch, proposed_by, proposer_kind, status, created_at from show_ideas order by created_at desc`)]);
  const counts = (id: string) => ({ people: votes.get(id)?.person ?? emptyTally(), agents: votes.get(id)?.agent ?? emptyTally() });
  const proposals: AdminIdea[] = rows.rows.map((p) => ({
    id: p.id, title: p.title, pitch: p.pitch, house: false, status: p.status, proposed_by: p.proposer_kind, created_at: new Date(p.created_at).toISOString(), ...counts(p.id),
  }));
  const house: AdminIdea[] = HOUSE_IDEAS.map((h) => ({ id: h.id, title: h.title, pitch: h.pitch, house: true, status: "listed", proposed_by: null, created_at: null, ...counts(h.id) }));
  const listed = [...house, ...proposals.filter((p) => p.status === "listed")].map((idea, i) => ({ idea, i })).sort((a, b) => interestScore(b.idea.people) - interestScore(a.idea.people) || a.i - b.i).map((x) => x.idea);
  return [...proposals.filter((p) => p.status === "pending"), ...listed, ...proposals.filter((p) => p.status === "declined")];
}

/** An admin's call on a proposal: list it, decline it, or put it back to waiting. A declined idea's votes are kept (it can be listed again). */
export async function decideShowIdea(db: Db, id: string, action: "list" | "decline" | "hold"): Promise<{ ok: true; id: string; status: IdeaRow["status"] } | Refusal> {
  const status: IdeaRow["status"] = action === "list" ? "listed" : action === "decline" ? "declined" : "pending";
  const { rows } = await db.query<{ id: string }>(`update show_ideas set status = $2, decided_at = case when $2 = 'pending' then null else now() end where id = $1 returning id`, [id, status]);
  if (!rows.length) return { ok: false, status: 404, error: "no_such_idea", message: "No proposal with that id (the house's own ideas are in the code)." };
  return { ok: true, id, status };
}
