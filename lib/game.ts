import type { SideOutcome, VariableArc } from "./engine";
import type { Db } from "./db";
import { matchmakerHitSql } from "./mechanics";
import {
  agendaLabel,
  ENDING_LABELS,
  ENDINGS,
  POINTS_PER_CORRECT_PICK,
  POINTS_PER_DEALBREAKER_PICK,
  POINTS_PER_DRAMA_PICK,
  POINTS_PER_MATCHMAKER,
  pointsFor,
  predictionPoints,
  producerLabel,
  REPORT_HIDE_THRESHOLD,
  type AgendaId,
  type Autonomy,
  type DateVariable,
  type DramaAnswer,
  type DramaQuestion,
  type Ending,
  type GameBudget,
  type ProducerId,
  type Strategy,
} from "./rules";

// The rules moved to lib/rules.ts (client-safe); M1 code and tests import them from here.
export { ENDING_LABELS, ENDINGS, POINTS_PER_CORRECT_PICK, pointsFor, type Ending };

export const FEED_LIMIT = 30;
const ANONYMOUS_CREATOR = "Anonymous creator";

export type CharacterRef = { id: string; name: string; house: boolean; hue: number | null };
export type CreatorRef = { character_id: string; name: string };

/** The per-date settings the owner chose (PRD budget & autonomy). Stored as episodes.setup (jsonb). */
export type DateSetup = {
  autonomy: Autonomy;
  strategy: Strategy;
  agenda_a: AgendaId;
  agenda_b: AgendaId;
  game_budget_a: GameBudget;
  game_budget_b: GameBudget;
  /** The AI producer's situation for act 2 (PRD "the AI producer"). Dealt by seed when the date is built. */
  producer: ProducerId;
};

export type BoxScore = Record<DateVariable, VariableArc>;

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
  best_line: string | null;
  box_score: BoxScore | null;
  confessionals: [string, string] | null;
  sides: [SideOutcome, SideOutcome] | null;
  setup: DateSetup | null;
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
  best_line?: string;
  box_score?: BoxScore;
  /** The secret agendas, revealed only once the finale airs (or always to the creators). */
  agendas?: { character_id: string; agenda: string }[];
  /** The AI producer's act-2 situation, revealed with the agendas. */
  producer?: string;
  /** Approved confessionals: to the creators always, to spectators only after the finale airs. */
  confessionals?: { character_id: string; line: string }[];
  // Only present once every creator of the episode has consented (POST /api/reveal).
  creators?: CreatorRef[];
};

/** The owner's private debrief of their own AI's date (PRD core feature 1). Owner-only, one-way. */
export type Debrief = {
  wants_another: boolean;
  agenda_met: boolean;
  satisfied: boolean;
  /** What made it uncomfortable: the other character's cue that tripped the dealbreaker, or null. */
  uncomfortable: string | null;
  /** What it liked: the other character's cue that met the want, or null. */
  liked: string | null;
  note_followed: boolean | null;
  agenda: string;
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
  /** Whether the host has shared the confessionals with viewers (meaningful to the host). */
  confessionals_shared: boolean;
  /** The owner's private debrief of their own AI (the side they own). Owner-only. */
  debrief?: Debrief;
  /** Creators only: where the mutual identity reveal stands. */
  identity?: { consented: boolean; consents: number; needed: number };
};

type EpisodeJsonOpts = { full: boolean; showConfessionals: boolean; creators?: CreatorRef[] };

export function toEpisodeJson(ep: StoredEpisode, opts: EpisodeJsonOpts): EpisodeJson {
  const [a, b] = ep.characters;
  const json: EpisodeJson = {
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
  if (opts.full) {
    json.scenes = ep.scenes;
    json.twist = ep.twist;
    json.finale = ep.finale;
    json.ending = ep.ending;
    json.drama_answer = ep.drama_answer;
    if (ep.best_line) json.best_line = ep.best_line;
    if (ep.box_score) json.box_score = ep.box_score;
    if (ep.setup) {
      json.agendas = [
        { character_id: a.id, agenda: agendaLabel(ep.setup.agenda_a) },
        { character_id: b.id, agenda: agendaLabel(ep.setup.agenda_b) },
      ];
      json.producer = producerLabel(ep.setup.producer);
    }
  }
  if (opts.showConfessionals && ep.confessionals) {
    json.confessionals = [
      { character_id: a.id, line: ep.confessionals[0] },
      { character_id: b.id, line: ep.confessionals[1] },
    ];
  }
  if (opts.creators) json.creators = opts.creators;
  return json;
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
  best_line: string | null;
  box_score: BoxScore | null;
  confessionals: [string, string] | null;
  confessionals_shared: boolean;
  sides: [SideOutcome, SideOutcome] | null;
  setup: DateSetup | null;
  a_id: string;
  a_name: string;
  a_house: boolean;
  a_hue: number | null;
  b_id: string;
  b_name: string;
  b_house: boolean;
  b_hue: number | null;
  is_creator: boolean;
  is_host: boolean;
  my_side: 0 | 1 | null;
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
 * leak them early. The private soul and the note are never selected here.
 */
const EPISODE_SELECT = `
select e.id, e.setting, e.goals, e.scenes, e.twist, e.finale, e.ending, e.drama_question, e.drama_answer,
       e.revealed_at is not null as revealed,
       e.best_line, e.box_score, e.confessionals, e.confessionals_shared, e.sides, e.setup,
       a.id as a_id, a.name as a_name, a.is_house as a_house, a.avatar_hue as a_hue,
       b.id as b_id, b.name as b_name, b.is_house as b_house, b.avatar_hue as b_hue,
       coalesce($1::text in (a.owner_id, b.owner_id), false) as is_creator,
       coalesce(e.creator_id = $1::text, false) as is_host,
       case when a.owner_id = $1::text then 0 when b.owner_id = $1::text then 1 else null end as my_side,
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

function debriefFrom(side: SideOutcome, setup: DateSetup | null, mySide: 0 | 1): Debrief {
  return {
    wants_another: side.wants_another,
    agenda_met: side.agenda_met,
    satisfied: side.satisfied,
    uncomfortable: side.dealbreaker_hit,
    liked: side.want_met,
    note_followed: side.note_followed,
    agenda: setup ? agendaLabel(mySide === 0 ? setup.agenda_a : setup.agenda_b) : "",
  };
}

function toView(row: EpisodeRow): EpisodeView {
  const characters: [CharacterRef, CharacterRef] = [
    { id: row.a_id, name: row.a_name, house: row.a_house, hue: row.a_hue },
    { id: row.b_id, name: row.b_name, house: row.b_house, hue: row.b_hue },
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

  const full = row.revealed || row.is_creator;
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
      best_line: row.best_line,
      box_score: row.box_score,
      confessionals: row.confessionals,
      sides: row.sides,
      setup: row.setup,
    },
    { full, showConfessionals: row.is_creator || (row.revealed && row.confessionals_shared), creators },
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
    confessionals_shared: row.confessionals_shared,
  };
  if (row.is_creator) view.identity = { consented: row.my_consent, consents: row.consents, needed: row.needed };
  // The private debrief: the owner's own side only, visible to that owner.
  if (row.my_side !== null && row.sides) view.debrief = debriefFrom(row.sides[row.my_side], row.setup, row.my_side);
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
    `select id, name, false as house, avatar_hue as hue from characters
      where owner_id = $1 and not is_house
      order by created_at desc, id
      limit $2`,
    [userId, limit],
  );
  return rows;
}

/**
 * A player's all-time points: the prediction game (ending + drama) plus the free side games (guess the
 * dealbreaker, matchmakers). League and season boards score the prediction game only (that is the
 * weekly contest); this total also counts the side games. All of it is free and none of it can be bought.
 */
/** The public persona for a character's shareable card: no dealbreaker (it is the quiz) and no soul. */
export type PublicCharacter = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  appearance: string | null;
  want: string;
  house: boolean;
  hue: number | null;
};

export async function getPublicCharacter(db: Db, id: string): Promise<PublicCharacter | null> {
  const { rows } = await db.query<PublicCharacter>(
    `select id, name, age, bio, traits, appearance, want, is_house as house, avatar_hue as hue
       from characters where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export type CharacterEpisode = { episode_id: string; share_path: string; partner: string; ending: Ending };
export type CharacterRecord = { dates: number; second_dates: number; friends: number; disasters: number };

/**
 * A character's public date record: the aired episodes it appeared in, newest first, and a tally. Makes
 * a character a reusable asset with a history (the competitor report's Talkie lesson). Aired only.
 */
export async function getCharacterHistory(
  db: Db,
  id: string,
  limit = 10,
): Promise<{ episodes: CharacterEpisode[]; record: CharacterRecord }> {
  const { rows } = await db.query<{ episode_id: string; partner: string; ending: Ending }>(
    `select e.id as episode_id, e.ending,
            case when e.character_a = $1 then b.name else a.name end as partner
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where (e.character_a = $1 or e.character_b = $1) and e.revealed_at is not null
      order by e.revealed_at desc, e.id
      limit $2`,
    [id, limit],
  );
  const episodes = rows.map((r) => ({ episode_id: r.episode_id, share_path: `/episodes/${r.episode_id}`, partner: r.partner, ending: r.ending }));
  const record: CharacterRecord = {
    dates: episodes.length,
    second_dates: episodes.filter((e) => e.ending === "second_date").length,
    friends: episodes.filter((e) => e.ending === "friends").length,
    disasters: episodes.filter((e) => e.ending === "disaster").length,
  };
  return { episodes, record };
}

export async function getPoints(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ points: number }>(
    `select (
        coalesce((select sum(${predictionPointsSql("$2", "$3")})
                    from predictions p join episodes e on e.id = p.episode_id
                   where p.user_id = $1 and e.revealed_at is not null), 0)
      + coalesce((select count(*)
                    from dealbreaker_guesses g
                    join episodes e on e.id = g.episode_id
                    join characters a on a.id = e.character_a
                   where g.user_id = $1 and e.revealed_at is not null and g.pick = a.dealbreaker), 0) * $4
      + coalesce((select count(*) from matchmaker_proposals mp
                   where mp.proposer_id = $1 and ${matchmakerHitSql()}), 0) * $5
     )::int as points`,
    [userId, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK, POINTS_PER_DEALBREAKER_PICK, POINTS_PER_MATCHMAKER],
  );
  return rows[0]?.points ?? 0;
}
