import type { Db } from "./db";
import {
  ENDING_LABELS,
  ENDINGS,
  POINTS_PER_CORRECT_PICK,
  POINTS_PER_DRAMA_PICK,
  pointsFor,
  predictionPoints,
  REPORT_HIDE_THRESHOLD,
  type DramaAnswer,
  type DramaQuestion,
  type Ending,
} from "./rules";

// The rules moved to lib/rules.ts (client-safe); M1 code and tests import them from here.
export { ENDING_LABELS, ENDINGS, POINTS_PER_CORRECT_PICK, pointsFor, type Ending };

export const FEED_LIMIT = 30;
const ANONYMOUS_CREATOR = "Anonymous creator";

export type CharacterRef = { id: string; name: string; house: boolean };
export type CreatorRef = { character_id: string; name: string };

export type StoredEpisode = {
  id: string;
  characters: [CharacterRef, CharacterRef];
  setting: string;
  goals: string[];
  scenes: string[];
  twist: string;
  finale: string;
  ending: Ending;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  revealed: boolean;
};

export type EpisodeJson = {
  id: string;
  share_path: string;
  /** Always true: every episode is written by the showrunner model. */
  ai_generated: true;
  characters: [CharacterRef, CharacterRef];
  setting: string;
  goals: { character_id: string; goal: string }[];
  drama_question: DramaQuestion | null;
  revealed: boolean;
  // Only present for the creators, or for everyone once the finale has aired.
  scenes?: string[];
  twist?: string;
  finale?: string;
  ending?: Ending;
  drama_answer?: DramaAnswer | null;
  // Only present once every creator of the episode has consented (POST /api/reveal).
  creators?: CreatorRef[];
};

export type EpisodeView = EpisodeJson & {
  /** The viewer owns one of the two characters. */
  is_creator: boolean;
  /** The viewer asked for this date, so they air the finale. */
  is_host: boolean;
  /** Reported by enough distinct people: out of the feed, and only its creators can open it. */
  hidden: boolean;
  /** The viewer blocked this episode's creator(s) from this episode. Per episode, so it links nothing. */
  blocked: boolean;
  my_pick: Ending | null;
  my_drama_pick: DramaAnswer | null;
  my_points: number | null;
  /** Creators only: where the mutual identity reveal stands. */
  identity?: { consented: boolean; consents: number; needed: number };
};

export function toEpisodeJson(ep: StoredEpisode, full: boolean, creators?: CreatorRef[]): EpisodeJson {
  const [a, b] = ep.characters;
  const teaser: EpisodeJson = {
    id: ep.id,
    share_path: `/episodes/${ep.id}`,
    ai_generated: true,
    characters: ep.characters,
    setting: ep.setting,
    goals: [
      { character_id: a.id, goal: ep.goals[0] },
      { character_id: b.id, goal: ep.goals[1] },
    ],
    drama_question: ep.drama_question,
    revealed: ep.revealed,
  };
  const json: EpisodeJson = full
    ? {
        ...teaser,
        scenes: ep.scenes,
        twist: ep.twist,
        finale: ep.finale,
        ending: ep.ending,
        drama_answer: ep.drama_answer,
      }
    : teaser;
  return creators ? { ...json, creators } : json;
}

type EpisodeRow = {
  id: string;
  setting: string;
  goals: string[];
  scenes: string[];
  twist: string;
  finale: string;
  ending: Ending;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  revealed: boolean;
  a_id: string;
  a_name: string;
  a_house: boolean;
  b_id: string;
  b_name: string;
  b_house: boolean;
  is_creator: boolean;
  is_host: boolean;
  hidden: boolean;
  consents: number;
  needed: number;
  a_creator_name: string | null;
  b_creator_name: string | null;
  my_pick: Ending | null;
  my_drama_pick: DramaAnswer | null;
  my_consent: boolean;
  blocked: boolean;
};

/**
 * Everything one viewer may know about episodes, in one statement. $1 is the viewer (or null) and
 * $2 the report threshold. User ids never leave SQL: creator roles come back as booleans, and the
 * creators' display names are only joined once every creator has consented, so no later code can
 * leak them early.
 */
const EPISODE_SELECT = `
select e.id, e.setting, e.goals, e.scenes, e.twist, e.finale, e.ending, e.drama_question, e.drama_answer,
       e.revealed_at is not null as revealed,
       a.id as a_id, a.name as a_name, a.is_house as a_house,
       b.id as b_id, b.name as b_name, b.is_house as b_house,
       coalesce($1::text in (a.owner_id, b.owner_id), false) as is_creator,
       coalesce(e.creator_id = $1::text, false) as is_host,
       rep.n >= $2::int as hidden,
       cons.n as consents, need.n as needed,
       pa.name as a_creator_name, pb.name as b_creator_name,
       p.pick as my_pick, p.drama_pick as my_drama_pick,
       exists (select 1 from identity_consents mc where mc.episode_id = e.id and mc.user_id = $1::text) as my_consent,
       exists (select 1 from blocks bl where bl.blocker_id = $1::text and bl.via_episode_id = e.id) as blocked
  from episodes e
  join characters a on a.id = e.character_a
  join characters b on b.id = e.character_b
  cross join lateral (select count(*)::int as n from reports r where r.episode_id = e.id) rep
  cross join lateral (select (a.owner_id is not null)::int + (b.owner_id is not null)::int as n) need
  cross join lateral (
    select count(*)::int as n from identity_consents ic
     where ic.episode_id = e.id and ic.user_id in (a.owner_id, b.owner_id)
  ) cons
  left join profiles pa on pa.user_id = a.owner_id and need.n > 0 and cons.n >= need.n
  left join profiles pb on pb.user_id = b.owner_id and need.n > 0 and cons.n >= need.n
  left join predictions p on p.episode_id = e.id and p.user_id = $1::text`;

function toView(row: EpisodeRow): EpisodeView {
  const characters: [CharacterRef, CharacterRef] = [
    { id: row.a_id, name: row.a_name, house: row.a_house },
    { id: row.b_id, name: row.b_name, house: row.b_house },
  ];
  const identityRevealed = row.needed > 0 && row.consents >= row.needed;
  const creators = identityRevealed
    ? [
        { house: row.a_house, character_id: row.a_id, name: row.a_creator_name },
        { house: row.b_house, character_id: row.b_id, name: row.b_creator_name },
      ]
        .filter((c) => !c.house)
        .map((c) => ({ character_id: c.character_id, name: c.name ?? ANONYMOUS_CREATOR }))
    : undefined;

  const episode = toEpisodeJson(
    {
      id: row.id,
      characters,
      setting: row.setting,
      goals: row.goals,
      scenes: row.scenes,
      twist: row.twist,
      finale: row.finale,
      ending: row.ending,
      drama_question: row.drama_question,
      drama_answer: row.drama_answer,
      revealed: row.revealed,
    },
    row.revealed || row.is_creator,
    creators,
  );
  const view: EpisodeView = {
    ...episode,
    is_creator: row.is_creator,
    is_host: row.is_host,
    hidden: row.hidden,
    blocked: row.blocked,
    my_pick: row.my_pick,
    my_drama_pick: row.my_drama_pick,
    my_points:
      row.revealed && row.my_pick
        ? predictionPoints({ pick: row.my_pick, drama_pick: row.my_drama_pick }, row)
        : null,
  };
  if (row.is_creator) view.identity = { consented: row.my_consent, consents: row.consents, needed: row.needed };
  return view;
}

/**
 * What `viewerId` may see of an episode: spectators get a teaser until the host airs the finale.
 * A hidden episode is still returned (with `hidden: true`); callers show it to its creators only.
 */
export async function getEpisodeView(db: Db, id: string, viewerId: string | null): Promise<EpisodeView | null> {
  const { rows } = await db.query<EpisodeRow>(`${EPISODE_SELECT} where e.id = $3`, [
    viewerId,
    REPORT_HIDE_THRESHOLD,
    id,
  ]);
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Newest episodes, minus hidden ones and any starring a character the viewer blocked: the blocked
 * creator's characters in the episode the block was made from. Blocks follow those visible
 * characters, never the person behind them. Hiding "everything this creator made" would show which
 * anonymous episodes share a creator, and one mutual reveal would then name them all. The blocked
 * creator's own feed is unchanged, so they aren't told.
 */
export async function listFeed(db: Db, viewerId: string | null, limit = FEED_LIMIT): Promise<EpisodeView[]> {
  const { rows } = await db.query<EpisodeRow>(
    `${EPISODE_SELECT}
      where rep.n < $2::int
        and not exists (
          select 1 from blocks bl
            join episodes be on be.id = bl.via_episode_id
            join characters bc on bc.id in (be.character_a, be.character_b) and bc.owner_id = bl.blocked_id
           where bl.blocker_id = $1::text and bc.id in (e.character_a, e.character_b))
      order by e.created_at desc, e.id
      limit $3`,
    [viewerId, REPORT_HIDE_THRESHOLD, limit],
  );
  return rows.map(toView);
}

/** Episodes where the user owns one of the characters, hidden ones included. */
export async function listMyEpisodes(db: Db, userId: string, limit = FEED_LIMIT): Promise<EpisodeView[]> {
  const { rows } = await db.query<EpisodeRow>(
    `${EPISODE_SELECT}
      where $1::text in (a.owner_id, b.owner_id)
      order by e.created_at desc, e.id
      limit $3`,
    [userId, REPORT_HIDE_THRESHOLD, limit],
  );
  return rows.map(toView);
}

/**
 * SQL for one prediction's points, with `p` = predictions and `e` = episodes; mirrors
 * predictionPoints(). Only placeholder names are spliced in, never values.
 */
export function predictionPointsSql(pickPoints: `$${number}`, dramaPoints: `$${number}`): string {
  return `(case when p.pick = e.ending then ${pickPoints}::int else 0 end
         + case when p.drama_pick = e.drama_answer then ${dramaPoints}::int else 0 end)`;
}

/** How many of the creator's characters the builder offers to send on another date. */
export const MY_CHARACTERS_SHOWN = 20;

/** The user's own characters, newest first, so the builder can send one on another date (M4). */
export async function listMyCharacters(db: Db, userId: string, limit = MY_CHARACTERS_SHOWN): Promise<CharacterRef[]> {
  const { rows } = await db.query<CharacterRef>(
    `select id, name, false as house from characters
      where owner_id = $1 and not is_house
      order by created_at desc, id
      limit $2`,
    [userId, limit],
  );
  return rows;
}

export async function getPoints(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ points: number }>(
    `select coalesce(sum(${predictionPointsSql("$2", "$3")}), 0)::int as points
       from predictions p
       join episodes e on e.id = p.episode_id
      where p.user_id = $1 and e.revealed_at is not null`,
    [userId, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK],
  );
  return rows[0]?.points ?? 0;
}
