import { endingWhy } from "./why";
import { wishLine, type StoredWishes } from "./wishes";
import type { CharacterSheet, DateHistory, EngineVersion, SideOutcome, SoulSignals, VariableArc } from "./engine";
import { approvedClipId, approvedClipIsVideo, approvedPortraitId, portraitPathSql } from "./assets";
import type { Db } from "./db";
import { publicExtras, type CharacterExtras } from "./extras";
import { matchmakerHitSql } from "./mechanics";
import { dateNumberSql } from "./date-number";
import {
  agendaLabel,
  dateNumberOf,
  ENDING_LABELS,
  ENDINGS,
  POINTS_PER_CORRECT_PICK,
  POINTS_PER_DEALBREAKER_PICK,
  POINTS_PER_DRAMA_PICK,
  POINTS_PER_MATCHMAKER,
  POINTS_PER_ARC,
  POINTS_PER_RATING_RECEIVED,
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
import type { AgreedPlan } from "./plans";
import type { PlaceId } from "./venues";
import type { Turn } from "./conversation";
import type { AfterglowLine, AfterglowVerdict } from "./afterglow";
import { isDefaultFormat, type FormatId } from "./formats";

// The rules moved to lib/rules.ts (client-safe); M1 code and tests import them from here.
export { ENDING_LABELS, ENDINGS, POINTS_PER_CORRECT_PICK, pointsFor, type Ending };

export const FEED_LIMIT = 30;
const ANONYMOUS_CREATOR = "Anonymous creator";

export type CharacterRef = {
  id: string;
  name: string;
  house: boolean;
  hue: number | null;
  /** Their approved generated (BYOK) portrait's path, /api/assets/<id> (lib/assets.ts portraitPathSql), or null. */
  portrait: string | null;
  /** Made by an AI agent over MCP rather than by a person on the website (characters.created_via). */
  agent?: boolean;
};
export type CreatorRef = { character_id: string; name: string };

/** The per-date settings the owner chose (PRD budget & autonomy). Stored as episodes.setup (jsonb). */
/** How a date came about (DateSetup.met_via). */
export const MET_VIA = ["blind", "match", "proposal", "chosen", "second_date", "own_date", "show"] as const;
export type MetVia = (typeof MET_VIA)[number];

export type DateSetup = {
  autonomy: Autonomy;
  strategy: Strategy;
  agenda_a: AgendaId;
  agenda_b: AgendaId;
  game_budget_a: GameBudget;
  game_budget_b: GameBudget;
  /** The AI producer's situation for act 2 (PRD "the AI producer"). Dealt by seed when the date is built. */
  producer: ProducerId;
  /**
   * Where the date happened: dealt by seed from the venue library (lib/venues.ts), or the place the two agreed to by
   * text (`agreed_plan`), which can be one of their homes or a place the library has no set for yet ("elsewhere@the
   * observatory"). Optional: episodes written before the library existed have no venue, and `venue()` falls back for them.
   */
  /** They carried an After Dark memory into this date (lib/adult/memory.ts); only its PG note, never the scene. */
  after_dark?: boolean;
  venue?: PlaceId;
  /**
   * The venues the dealer stepped past: where either person's character had its last dates (lib/venues.ts
   * pickVenueAvoiding). Snapshotted when the date is booked, so the worker that writes it deals the same venue.
   */
  avoid_venues?: PlaceId[];
  /**
   * The show format (lib/formats.ts): a cosmetic narrative wrapper chosen by the owner. Optional:
   * episodes made before formats existed have none and read as the classic blind date. Never the engine.
   */
  format?: FormatId;
  /** meet_the_parents: a real house regular's name to play the chaperone (lib/simulation.ts). Flavour only. */
  chaperone?: string;
  /** ex_returns: a real past partner's name from the relationship graph, when there is one. Flavour only. */
  ex?: string;
  /**
   * M14 part 2: the EXACT effective engine signals this date ran on, snapshotted per side (base soul/image
   * signals plus the learned memory drift). Stored so a Sliding Doors / chaos replay reproduces the date even
   * after the character's memory has since drifted. Optional: episodes built before the snapshot have none,
   * and the replay falls back to deriving signals from the soul (lib/simulation.ts computeDoors).
   */
  signals_a?: SoulSignals;
  signals_b?: SoulSignals;
  /**
   * The two character sheets exactly as they were when the date was decided (the engine reads traits, bio, want,
   * dealbreaker and appearance). Characters are editable, so replays use these instead of today's sheet.
   * Private like the rest of the setup (it holds dealbreakers): never sent to a viewer. Optional: older episodes
   * have none and replay against the current sheet.
   */
  sheet_a?: CharacterSheet;
  sheet_b?: CharacterSheet;
  /**
   * Which engine calibration decided this date (lib/engine.ts EngineVersion). Replays and the async worker's
   * re-decide use the same version, so a date always reproduces. Absent on dates decided before versioning: v1.
   */
  engine_version?: EngineVersion;
  /**
   * The pair's history exactly as the engine read it (lib/relationships.ts engineHistory), so a replay or the
   * async worker re-decides on the same relationship even after the pair has dated again since. Absent on dates
   * built before the snapshot (and on first dates).
   */
  history?: DateHistory;
  /** A second date: the date whose morning-after plan this is, and the plan itself (their texts). Flavour only. */
  followup_of?: string;
  plan?: string[];
  /**
   * The plan the two agreed to by text that this date is (lib/plans.ts), snapshotted when it's booked: a rebuild (the
   * worker, an agent's next step) never reads the texts again, so a text sent mid-date can't change tonight. Flavour only.
   */
  agreed_plan?: AgreedPlan;
  /**
   * The date can move when both characters agree (lib/moves.ts), set when it's booked. Absent on dates from before
   * moves, so an agent's date already being played keeps its length and prompts when this ships.
   */
  moves?: boolean;
  /**
   * On a date an agent performs (lib/own-date.ts): the line count at which a side said "done" in the goodbye stretch,
   * so the date ends there (#491), as the show's model's dates do (lib/conversation.ts).
   */
  end_by?: number;
  /**
   * On a date agents perform: how many lines were in when the show's model first took a side (a quiet agent's side, a
   * hand-over or autoplay), so the finished date can say which lines were the show's (lib/own-date.ts dateLines; the
   * 2026-10-21-2300 run: "I never learned whether the show took over a turn").
   */
  show_from_line?: number;
  /** Which date this is in the couple's run (2 for the second date, 3 for the third...). Set when one is booked. */
  date_number?: number;
  /**
   * How this date came about (data plan Tier 2), set when it's booked: a blind date, a swipe match, a proposal, a
   * partner picked by name, a second date from a morning-after plan, a date agents perform, or a show room. Absent on
   * dates booked before 2026-10-22. Server-side only: no public view carries it.
   */
  met_via?: MetVia;
  /** Each owner's standing nudge about the other, as booked (lib/between-dates.ts). Private, flavour only. */
  nudge_a?: string;
  nudge_b?: string;
};

export type BoxScore = Record<DateVariable, VariableArc>;

/** M10: an episode is 'generating' while the background worker fills it in, then 'ready'. A terminal
 *  failure deletes the episode (nothing stored, date refunded), so only these two statuses persist. */
export type EpisodeStatus = "generating" | "ready";

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
  /** M9: the turn-by-turn conversation. Empty for pre-M9 episodes or when it couldn't be produced. */
  transcript: Turn[];
  /** M11: the private morning-after text thread (lib/afterglow.ts). Owners only; empty when not produced. */
  afterglow: AfterglowLine[];
  status: EpisodeStatus;
  /** How the two sides' private wishes counted (lib/wishes.ts). Never shown; only a tip is told, beside the ending. */
  wishes?: StoredWishes | null;
  /** Which date it is for the couple, as read (lib/date-number.ts): the stored number, or computed for an older date. */
  date_number?: number | null;
};

export type EpisodeJson = {
  id: string;
  share_path: string;
  /** Always true: every episode is written by the showrunner model. */
  ai_generated: true;
  /** M10: 'generating' until the background worker finishes; the page polls while it is. */
  status: EpisodeStatus;
  characters: [CharacterRef, CharacterRef];
  setting: string;
  goals: { character_id: string; goal: string }[];
  drama_question: DramaQuestion | null;
  revealed: boolean;
  /** Where the date happened (lib/venues.ts). Not a secret: it is the teaser's location, shown from the start. */
  /** This date carried an After Dark memory (the page shows 🌙 only to someone After Dark is open to). */
  after_dark?: boolean;
  venue?: PlaceId;
  /** The show format (lib/formats.ts). Not a secret: it is the episode's billing, shown from the start. Classic omitted. */
  format?: FormatId;
  /** A second date: the first date it follows (lib/second-date.ts). Shown as a badge; not a spoiler. */
  followup_of?: string;
  /**
   * Which date this is for the couple (2, 3, ...) when they've dated before: every follow-up (older ones without it are
   * second dates), and a rematch, counted from their public dates (lib/date-number.ts). Absent on a first date.
   */
  date_number?: number;
  // Only present for the creators, or for everyone once the finale has aired.
  scenes?: string[];
  /** The turn-by-turn date "footage" (M9). A spoiler (it reaches the ending), so gated like `scenes`. */
  transcript?: Turn[];
  twist?: string;
  finale?: string;
  ending?: Ending;
  drama_answer?: DramaAnswer | null;
  best_line?: string;
  box_score?: BoxScore;
  /** One line on why it ended this way (lib/why.ts), once the ending is shown. */
  why?: string;
  /** On a repeat date: which box-score numbers carried over and which started fresh. */
  box_score_note?: string;
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
  /** public (in the feed), unlisted (link only), or private (creator only). */
  visibility: "public" | "private" | "unlisted";
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
  /**
   * M11 afterglow: the morning-after texts and whether the interest was mutual, for the characters' owners
   * only (never a spectator), as soon as the thread exists. No owner has to agree first (David, 2026-10-16).
   * `revealed` is always true; kept so older agent clients reading it still work.
   */
  afterglow?: {
    revealed: true;
    thread: AfterglowLine[];
    verdict?: AfterglowVerdict;
  };
};

type EpisodeJsonOpts = {
  full: boolean;
  showConfessionals: boolean;
  creators?: CreatorRef[];
  /** #469: both characters are the viewer's, so the cue that tripped a dealbreaker can be said (never across owners). */
  dealbreakers?: [string | null, string | null];
};

export function toEpisodeJson(ep: StoredEpisode, opts: EpisodeJsonOpts): EpisodeJson {
  const [a, b] = ep.characters;
  const json: EpisodeJson = {
    id: ep.id,
    share_path: `/episodes/${ep.id}`,
    ai_generated: true,
    status: ep.status,
    characters: ep.characters,
    setting: ep.setting,
    goals: [
      { character_id: a.id, goal: ep.goals[0] },
      { character_id: b.id, goal: ep.goals[1] },
    ],
    drama_question: ep.drama_question,
    revealed: ep.revealed,
  };
  if (ep.setup?.venue) json.venue = ep.setup.venue;
  if (ep.setup?.after_dark) json.after_dark = true;
  // The format is the episode's billing (shown from the start), not a spoiler. Classic is the default, so
  // it needs no badge; only a chosen non-classic format is surfaced.
  if (ep.setup?.format && !isDefaultFormat(ep.setup.format)) json.format = ep.setup.format;
  if (ep.setup?.followup_of) {
    json.followup_of = ep.setup.followup_of;
    json.date_number = ep.setup.date_number ?? 2;
  }
  // A rematch's number too (stored at booking, or read for an older one), so its ending names the right date.
  const number = ep.date_number ?? dateNumberOf(ep.setup);
  if (number && number > 1) json.date_number = number;
  if (opts.full) {
    json.scenes = ep.scenes;
    // A date still being written shows its lines without interest: a side's last one can stand in for its private wish
    // (lib/wishes.ts), and on a two-agent date both agents see this view before the ending.
    if (ep.transcript.length) json.transcript = ep.status === "generating" ? ep.transcript.map(({ interest: _private, ...line }) => line as Turn) : ep.transcript;
    json.twist = ep.twist;
    json.finale = ep.finale;
    json.ending = ep.ending;
    json.drama_answer = ep.drama_answer;
    if (ep.best_line) json.best_line = ep.best_line;
    if (ep.box_score) json.box_score = ep.box_score;
    const why = endingWhy(ep.ending, ep.box_score, ep.sides, ep.setup?.strategy, ep.setup?.engine_version, [a.name, b.name], number);
    // When the two sides' wishes tipped the ending, the numbers alone don't explain it: say so (never which way a lone wish went).
    const tipped = wishLine(ep.wishes, ep.ending);
    // #469: on a date between a viewer's own two characters, which cue tripped which dealbreaker (the debrief the
    // engine keeps for exactly this); never shown when another owner's character is on the date.
    const cues = opts.dealbreakers && ep.sides
      ? ep.sides.flatMap((s, i) =>
          s.dealbreaker_hit && opts.dealbreakers![i]
            ? [`${[a, b][i].name}'s dealbreaker "${opts.dealbreakers![i]}" was tripped by ${[a, b][1 - i].name}'s "${s.dealbreaker_hit}".`]
            : [],
        )
      : [];
    if (why || tipped || cues.length) json.why = [why, tipped, ...cues].filter(Boolean).join(" ");
    // Run 2 asked why attraction reset on a second date while chemistry carried over: it's by design, so say so.
    if (ep.box_score && ep.setup?.followup_of) {
      json.box_score_note = "Chemistry and trust carry over from their last date; attraction and awkwardness start fresh each date.";
    }
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
  transcript: Turn[];
  afterglow: AfterglowLine[];
  status: EpisodeStatus;
  wishes: StoredWishes | null;
  a_id: string;
  a_name: string;
  a_house: boolean;
  a_hue: number | null;
  a_portrait: string | null;
  a_agent: boolean;
  b_id: string;
  b_name: string;
  b_house: boolean;
  b_hue: number | null;
  b_portrait: string | null;
  b_agent: boolean;
  is_creator: boolean;
  is_host: boolean;
  /** Both characters are the viewer's (#469). */
  owns_both: boolean;
  visibility: "public" | "private" | "unlisted";
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
  /** Which date it is for the couple (lib/date-number.ts dateNumberSql), or null for a first date. */
  date_number: number | null;
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
       e.best_line, e.box_score, e.confessionals, e.confessionals_shared, e.sides, e.setup, e.transcript, e.afterglow, e.status, e.wishes,
       a.id as a_id, a.name as a_name, a.is_house as a_house, a.avatar_hue as a_hue, ${portraitPathSql("a")} as a_portrait, a.created_via = 'mcp' as a_agent,
       b.id as b_id, b.name as b_name, b.is_house as b_house, b.avatar_hue as b_hue, ${portraitPathSql("b")} as b_portrait, b.created_via = 'mcp' as b_agent,
       coalesce($1::text in (a.owner_id, b.owner_id), false) as is_creator,
       coalesce(e.creator_id = $1::text, false) as is_host,
       coalesce($1::text = a.owner_id and $1::text = b.owner_id, false) as owns_both,
       e.visibility,
       case when a.owner_id = $1::text then 0 when b.owner_id = $1::text then 1 else null end as my_side,
       rep.n >= $2::int as hidden,
       cons.n as consents, need.n as needed,
       pa.name as a_creator_name, pb.name as b_creator_name,
       p.pick as my_pick, p.drama_pick as my_drama_pick,
       exists (select 1 from identity_consents mc where mc.episode_id = e.id and mc.user_id = $1::text) as my_consent,
       exists (select 1 from blocks bl where bl.blocker_id = $1::text and bl.via_episode_id = e.id) as blocked,
       ${dateNumberSql("e")} as date_number
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
    { id: row.a_id, name: row.a_name, house: row.a_house, hue: row.a_hue, portrait: row.a_portrait, agent: row.a_agent },
    { id: row.b_id, name: row.b_name, house: row.b_house, hue: row.b_hue, portrait: row.b_portrait, agent: row.b_agent },
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
      transcript: row.transcript ?? [],
      afterglow: row.afterglow ?? [],
      status: row.status,
      wishes: row.wishes,
      date_number: row.date_number,
    },
    {
      full,
      showConfessionals: row.is_creator || (row.revealed && row.confessionals_shared),
      creators,
      ...(row.owns_both ? { dealbreakers: [row.setup?.sheet_a?.dealbreaker ?? null, row.setup?.sheet_b?.dealbreaker ?? null] } : {}),
    },
  );
  const view: EpisodeView = {
    ...episode,
    is_creator: row.is_creator,
    is_host: row.is_host,
    visibility: row.visibility,
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
  // The afterglow: the characters' owners read the thread and the mutual verdict as soon as it exists.
  const thread = row.afterglow ?? [];
  if (row.is_creator && thread.length > 0) {
    view.afterglow = {
      revealed: true,
      thread,
      ...(row.sides ? { verdict: { a_wants: row.sides[0].wants_another, b_wants: row.sides[1].wants_another } } : {}),
    };
  }
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
  const row = rows[0];
  if (!row) return null;
  // A private date is the creator's alone: a character owner or the host, nobody else. ('unlisted' is
  // viewable by anyone with the link, so it is not gated here — only kept out of the feed below.)
  if (row.visibility === "private" && !row.is_creator && !row.is_host) return null;
  return toView(row);
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
      where ${PUBLIC_FEED_WHERE}
      order by e.created_at desc, e.id
      limit $3`,
    [viewerId, REPORT_HIDE_THRESHOLD, limit],
  );
  return rows.map(toView);
}

/**
 * What any public list of dates may show ($1 = the viewer, $2 = the report threshold): ready, public, not hidden by
 * reports, and not involving a creator the viewer blocked (see listFeed). Needs EPISODE_SELECT's `e`, `a`, `b`, `rep`.
 */
const PUBLIC_FEED_WHERE = `rep.n < $2::int
        and e.status = 'ready'
        and e.visibility = 'public'
        and not exists (
          select 1 from blocks bl
            join episodes be on be.id = bl.via_episode_id
            join characters bc on bc.id in (be.character_a, be.character_b) and bc.owner_id = bl.blocked_id
           where bl.blocker_id = $1::text and bc.id in (e.character_a, e.character_b))`;

/** Not one of the viewer's own dates ($1): those are on their account page, so Watch leaves them out. */
const NOT_THE_VIEWERS = `not coalesce($1::text in (a.owner_id, b.owner_id), false)`;

/** Watch's "Latest episodes": this many aired dates a page. */
export const WATCH_PAGE_SIZE = 12;
/** The highest `?page=` taken at face value; a bigger number is junk and reads as page 1. */
const MAX_PAGE = 100_000;

/**
 * A `?page=` search param as a page number: a whole number from 1, else 1. A repeated param uses the first; "0",
 * "-2", "2.5", "1e3", "abc" and absurdly large numbers all read as 1, so a hand-typed URL never errors.
 */
export function parsePage(raw: string | string[] | undefined | null): number {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (!/^\d{1,9}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= MAX_PAGE ? n : 1;
}

export type EpisodePage = {
  episodes: EpisodeView[];
  /** The page asked for (it may be past the last one, which then has no episodes). */
  page: number;
  /** How many pages there are, at least 1. */
  pages: number;
  total: number;
  per_page: number;
};

/**
 * One page of aired public dates, the most recently aired first (Watch's "Latest episodes", `?page=N`). The viewer's
 * own dates are left out (their account page lists them). A page past the end comes back empty, with the real count.
 */
export async function listAiredPage(db: Db, viewerId: string | null, page = 1, perPage = WATCH_PAGE_SIZE): Promise<EpisodePage> {
  const where = `${PUBLIC_FEED_WHERE} and e.revealed_at is not null and ${NOT_THE_VIEWERS}`;
  const total =
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n
           from episodes e
           join characters a on a.id = e.character_a
           join characters b on b.id = e.character_b
           cross join lateral (select count(*)::int as n from reports r where r.episode_id = e.id) rep
          where ${where}`,
        [viewerId, REPORT_HIDE_THRESHOLD],
      )
    ).rows[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (page > pages) return { episodes: [], page, pages, total, per_page: perPage };
  const { rows } = await db.query<EpisodeRow>(
    `${EPISODE_SELECT}
      where ${where}
      order by e.revealed_at desc, e.created_at desc, e.id
      limit $3 offset $4`,
    [viewerId, REPORT_HIDE_THRESHOLD, perPage, (page - 1) * perPage],
  );
  return { episodes: rows.map(toView), page, pages, total, per_page: perPage };
}

export type AiringSoon = EpisodeView & {
  /** When its finale airs on its own: its scheduled time, or its booking plus the prediction window. */
  airs_at: string;
};

/**
 * Public dates that haven't aired, so they're still open to predictions, the soonest to air first (Watch's "Airing
 * soon: call it before it airs"). A date with a watch room airs in its room, so the rooms list it instead. The
 * prediction window (lib/air.ts airWindowMinutes) is passed in, so this module needn't import the airing code.
 */
export async function listAiringSoon(db: Db, viewerId: string | null, windowMinutes: number, limit = 8): Promise<AiringSoon[]> {
  const { rows } = await db.query<EpisodeRow & { airs_at: Date | string }>(
    `select x.*, coalesce(ea.air_after, ea.created_at + $3 * interval '1 minute') as airs_at
       from (${EPISODE_SELECT}
              where ${PUBLIC_FEED_WHERE} and e.revealed_at is null and ${NOT_THE_VIEWERS}
                and not exists (select 1 from watch_parties w where w.episode_id = e.id)) x
       join episodes ea on ea.id = x.id
      order by airs_at asc, x.id
      limit $4`,
    [viewerId, REPORT_HIDE_THRESHOLD, windowMinutes, limit],
  );
  return rows.map((row) => ({ ...toView(row), airs_at: new Date(row.airs_at).toISOString() }));
}

export type MyEpisodeCard = {
  episode_id: string;
  share_path: string;
  title: string;
  ending: Ending;
  revealed: boolean;
  status: EpisodeStatus;
  visibility: "public" | "private" | "unlisted";
  is_host: boolean;
};

/**
 * A light list of the user's own dates for the account page: the ones they host or whose characters they
 * own, every visibility included (this is the owner's private view). No scenes or transcript, so it's cheap.
 */
export async function listMyEpisodeCards(db: Db, userId: string, limit = FEED_LIMIT): Promise<MyEpisodeCard[]> {
  const { rows } = await db.query<{
    id: string;
    ending: Ending;
    revealed: boolean;
    status: EpisodeStatus;
    visibility: "public" | "private" | "unlisted";
    is_host: boolean;
    a_name: string;
    b_name: string;
  }>(
    `select e.id, e.ending, e.revealed_at is not null as revealed, e.status, e.visibility,
            e.creator_id = $1 as is_host, a.name as a_name, b.name as b_name
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.creator_id = $1 or a.owner_id = $1 or b.owner_id = $1
      order by e.created_at desc, e.id
      limit $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    episode_id: r.id,
    share_path: `/episodes/${r.id}`,
    title: `${r.a_name} × ${r.b_name}`,
    ending: r.ending,
    revealed: r.revealed,
    status: r.status,
    visibility: r.visibility,
    is_host: r.is_host,
  }));
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
    `select c.id, c.name, false as house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c
      where c.owner_id = $1 and not c.is_house
      order by c.created_at desc, c.id
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
  pronouns: string | null;
  voice: string | null;
  /** A BYOK-generated portrait to render, served from /api/assets/<id>, or null for the drawn avatar. */
  portrait_asset_id: string | null;
  /** Made by an AI agent over MCP rather than by a person on the website (characters.created_via). */
  made_by_agent: boolean;
  /** Its owner made it private: everyone else sees only its name (characters.visibility). */
  private: boolean;
  /** Who owns it (server-only use: the private check), null for a house character. */
  owner_id: string | null;
  /** A BYOK intro clip, or null. A Veo clip plays from /api/assets/<id>/video; an old Sora one is only a still. */
  clip_asset_id: string | null;
  /** Whether that clip is a playable video (Veo) rather than a still (from the retired Sora era). */
  clip_is_video: boolean;
  /** Optional public details (lib/extras.ts). */
  extras: CharacterExtras;
  /** The creator's own "this week" update as stored (lib/life.ts thisWeek turns it into what's shown). */
  this_week: { text: string; season: string } | null;
};

/** A character's public persona. Its private facts are stripped (lib/extras.ts publicExtras): the owner's page reads them itself. */
export async function getPublicCharacter(db: Db, id: string): Promise<PublicCharacter | null> {
  const { rows } = await db.query<Omit<PublicCharacter, "portrait_asset_id" | "clip_asset_id" | "clip_is_video">>(
    `select id, name, age, bio, traits, appearance, want, is_house as house, avatar_hue as hue, pronouns, voice,
            coalesce(extras, '{}'::jsonb) as extras, this_week, created_via = 'mcp' as made_by_agent,
            visibility = 'private' as private, owner_id
       from characters where id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const [portrait_asset_id, clip_asset_id] = await Promise.all([approvedPortraitId(db, id), approvedClipId(db, id)]);
  const clip_is_video = clip_asset_id ? await approvedClipIsVideo(db, clip_asset_id) : false;
  return { ...rows[0], extras: publicExtras(rows[0].extras), portrait_asset_id, clip_asset_id, clip_is_video };
}

/** date_number: which date it was for the couple (absent on a first date), so its ending reads right. */
export type CharacterEpisode = { episode_id: string; share_path: string; partner: string; ending: Ending; date_number?: number };
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
  const { rows } = await db.query<{ episode_id: string; partner: string; ending: Ending; date_number: number | null }>(
    `select e.id as episode_id, e.ending,
            case when e.character_a = $1 then b.name else a.name end as partner,
            ${dateNumberSql("e")} as date_number
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where (e.character_a = $1 or e.character_b = $1) and e.revealed_at is not null and e.visibility = 'public'
      order by e.revealed_at desc, e.id
      limit $2`,
    [id, limit],
  );
  const episodes: CharacterEpisode[] = rows.map((r) => ({
    episode_id: r.episode_id,
    share_path: `/episodes/${r.episode_id}`,
    partner: r.partner,
    ending: r.ending,
    ...(r.date_number ? { date_number: r.date_number } : {}),
  }));
  const record: CharacterRecord = {
    dates: episodes.length,
    second_dates: episodes.filter((e) => e.ending === "second_date").length,
    friends: episodes.filter((e) => e.ending === "friends").length,
    disasters: episodes.filter((e) => e.ending === "disaster").length,
  };
  return { episodes, record };
}

/** Where a viewer's points came from, by source (getPoints is their sum). */
export type PointsBreakdown = { predictions: number; dealbreaker_guesses: number; matchmaking: number; ratings_received: number; arc_calls: number };

export async function getPointsBreakdown(db: Db, userId: string): Promise<PointsBreakdown> {
  const { rows } = await db.query<PointsBreakdown>(
    `select
        coalesce((select sum(${predictionPointsSql("$2", "$3")})
                    from predictions p join episodes e on e.id = p.episode_id
                   where p.user_id = $1 and e.revealed_at is not null and e.visibility = 'public'), 0)::int as predictions,
        (coalesce((select count(*)
                    from dealbreaker_guesses g
                    join episodes e on e.id = g.episode_id
                    join characters a on a.id = e.character_a
                   where g.user_id = $1 and e.revealed_at is not null and e.visibility = 'public' and g.pick = a.dealbreaker), 0) * $4)::int as dealbreaker_guesses,
        (coalesce((select count(*) from matchmaker_proposals mp
                   where mp.proposer_id = $1 and ${matchmakerHitSql()}), 0) * $5)::int as matchmaking,
        (coalesce((select count(*) from character_ratings cr
                    join characters c on c.id = cr.character_id
                   where c.owner_id = $1), 0) * $6)::int as ratings_received,
        (coalesce((select count(*) from arc_predictions ap
                   where ap.user_id = $1 and ap.resolved_at is not null and ap.pick = ap.outcome), 0) * $7)::int as arc_calls`,
    [userId, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK, POINTS_PER_DEALBREAKER_PICK, POINTS_PER_MATCHMAKER, POINTS_PER_RATING_RECEIVED, POINTS_PER_ARC],
  );
  return rows[0] ?? { predictions: 0, dealbreaker_guesses: 0, matchmaking: 0, ratings_received: 0, arc_calls: 0 };
}

export async function getPoints(db: Db, userId: string): Promise<number> {
  const b = await getPointsBreakdown(db, userId);
  return b.predictions + b.dealbreaker_guesses + b.matchmaking + b.ratings_received + b.arc_calls;
}
