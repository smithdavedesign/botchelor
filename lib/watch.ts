/**
 * Watch parties (M8): a synchronized "date room" over one pre-generated episode.
 *
 * The feature brief's Model A — "spectator mode". The audience reacts with emojis, chats, predicts the
 * ending and votes on a chemistry verdict, but it NEVER steers the characters: the deterministic engine
 * (lib/engine.ts) already decided the outcome when the episode was built. This file owns the room's
 * clock, its content gating by phase, the live tallies and the chat moderation. There is no realtime
 * server: the phase is a pure function of the shared clock, so every viewer sees the same beat, and the
 * client just polls `syncRoom` for presence and fresh tallies.
 *
 * Two kinds of room (lib/rules.ts WATCH_PARTY_KINDS):
 *  - premiere: a creator airs their own OC's date at a set time (host_id set, starts_at the premiere).
 *  - template: an always-on house-vs-house date; starts_at is null until the first viewer joins, then it
 *    plays on one shared clock — "join and the date starts" — so there is always something to drop into.
 */
import { getDb, type Db } from "./db";
import { getEngine, seedFrom } from "./engine";
import { track, trackDateQuality, trackEpisodeCost } from "./analytics";
import { failureReason } from "./jobs";
import { seasonCastIds } from "./season-cast";
import type { BoxScore, CharacterRef, DateSetup } from "./game";
import { getDirectorModel, getModel } from "./model";
import { generateDate } from "./pipeline";
import { DEFAULT_FORMAT } from "./formats";
import { getProfileName } from "./people";
import {
  DATE_ACTS,
  DRAMA_QUESTION_LABELS,
  dramaAnswerLabel,
  ENDING_LABELS,
  REPORT_HIDE_THRESHOLD,
  WATCH_AUDIENCE_PROMPTS,
  WATCH_CHAOS_OPTIONS,
  WATCH_CHEMISTRY_OPTIONS,
  WATCH_CHAT_LIMIT,
  chaosChange,
  WATCH_DECISION_INDEX,
  WATCH_MESSAGE_MAX,
  WATCH_PHASE_INDEX,
  WATCH_PHASES,
  WATCH_PRESENCE_WINDOW_SECONDS,
  WATCH_RATE_MAX,
  WATCH_RATE_WINDOW_SECONDS,
  WATCH_REACTIONS,
  WATCH_SCENE_AT_PHASE,
  WATCH_SLOW_MODE_SECONDS,
  producerEvent,
  type DramaAnswer,
  type DramaQuestion,
  type Ending,
  type WatchPhaseId,
  type WatchPoll,
} from "./rules";
import { buildDate, chaosReplay, DEFAULT_DATE_REQUEST, rememberDate, type CharacterForDate } from "./simulation";
import { updateCharacterMemory } from "./memory";
import { ShowrunnerError, type CharacterSheet } from "./showrunner";
import { isConversationEnabled, type Turn } from "./conversation";
import { generationPaused, PAUSED_MESSAGE } from "./compute";
import { venueName, type VenueId } from "./venues";

/** House-vs-house template episodes have no human creator: this fixed id never matches a real user's. */
export const SYSTEM_CREATOR_ID = "system";

/**
 * The genuineness index (lib/quality.ts) a template date must reach before it airs in the lobby without a
 * second take. The v1 prompts averaged 68 on today's metrics and the v2 pipeline about 86, so 75 catches the
 * dates that slipped back to the old tells.
 */
export const SHOWCASE_MIN_INDEX = 75;

const VERDICT_INDEX = WATCH_PHASE_INDEX.verdict;
const ACT2_INDEX = WATCH_PHASE_INDEX.act2;
const WRAP_INDEX = WATCH_PHASE_INDEX.wrap;
const LAST_AT = WATCH_PHASES[WATCH_PHASES.length - 1].at;

/**
 * The window on the clock (seconds) in which each act's conversation plays out: act 0 during first
 * impressions, act 1 during the challenge, act 2 from the decision to the aftermath. The final-act turns
 * (steered to the ending) therefore only ever appear with the ending, never as a spoiler.
 */
const AT = (id: WatchPhaseId) => WATCH_PHASES[WATCH_PHASE_INDEX[id]].at;

/**
 * Each audience poll's voting window [opens, closes) and the phase its results show from. One source of truth
 * for the server gate (pollOpenAt) and the room state, so a poll is never "open" while the room already shows
 * its results (the chemistry call used to stay votable through the decision with its buttons hidden).
 */
const POLL_WINDOWS: Record<WatchPoll, { opens: WatchPhaseId; closes: WatchPhaseId; reveal: WatchPhaseId }> = {
  question: { opens: "act2", closes: "verdict", reveal: "verdict" },
  chaos: { opens: "act2", closes: "verdict", reveal: "decision" },
  chemistry: { opens: "verdict", closes: "decision", reveal: "decision" },
};

/** Whether a poll is open, whether its results show, and (while open) the seconds left to vote. */
function pollWindow(poll: WatchPoll, clock: WatchClock): { open: boolean; show_results: boolean; closes_in: number | null } {
  const w = POLL_WINDOWS[poll];
  const idx = clock.phase_index;
  const open = clock.started && idx >= WATCH_PHASE_INDEX[w.opens] && idx < WATCH_PHASE_INDEX[w.closes];
  return {
    open,
    show_results: clock.started && idx >= WATCH_PHASE_INDEX[w.reveal],
    closes_in: open ? Math.max(0, AT(w.closes) - clock.elapsed) : null,
  };
}
const ACT_WINDOWS: [number, number][] = [
  [AT("act1"), AT("act2")],
  [AT("act2"), AT("twist")],
  [AT("decision"), AT("wrap")],
];

/**
 * When each turn goes live, in seconds from the start. Within its act the lines are spread evenly across the
 * act's window (the first lands as the act opens), so the room watches the date unfold line by line — the
 * way a live date reads — rather than a whole act appearing at once. A pure function of the transcript, so
 * every viewer sees the same line at the same moment with no realtime server.
 */
export function turnSchedule(transcript: Turn[]): number[] {
  const perAct = new Map<number, number[]>();
  transcript.forEach((t, i) => perAct.set(t.act, [...(perAct.get(t.act) ?? []), i]));
  const at: number[] = new Array(transcript.length).fill(Infinity);
  for (const [act, indices] of perAct) {
    const window = ACT_WINDOWS[act];
    if (!window) continue; // an act the room has no window for never airs
    const [start, end] = window;
    const step = (end - start) / indices.length;
    indices.forEach((turnIndex, k) => (at[turnIndex] = Math.floor(start + k * step)));
  }
  return at;
}

/* ----------------------------------------- the clock ----------------------------------------- */

export type WatchClock = {
  started: boolean;
  /** Seconds since the start, clamped at 0; 0 while not started. */
  elapsed: number;
  phase: WatchPhaseId;
  phase_index: number;
  phase_label: string;
  /** True once the clock has run past the final phase: the room is a replay from here on. */
  ended: boolean;
};

/** Which phase a room is in at `now`, from when it started. A pure function of the clock. */
export function watchClock(startsAt: Date | string | null, now: Date = new Date()): WatchClock {
  if (!startsAt) {
    const first = WATCH_PHASES[0];
    return { started: false, elapsed: 0, phase: first.id, phase_index: 0, phase_label: first.label, ended: false };
  }
  const start = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const elapsed = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000));
  let index = 0;
  for (let i = 0; i < WATCH_PHASES.length; i++) {
    if (elapsed >= WATCH_PHASES[i].at) index = i;
  }
  const phase = WATCH_PHASES[index];
  return {
    started: true,
    elapsed,
    phase: phase.id,
    phase_index: index,
    phase_label: phase.label,
    ended: elapsed >= LAST_AT,
  };
}

/* --------------------------------- deterministic guest handles --------------------------------- */

const HANDLE_ADJECTIVES = ["cosy", "chaotic", "hopeful", "feral", "soft", "sly", "giddy", "stoic", "tipsy", "earnest", "smug", "weepy"];
const HANDLE_NOUNS = ["shipper", "romantic", "skeptic", "gremlin", "oracle", "lurker", "critic", "softie", "menace", "sage", "goblin", "pigeon"];

/** A stable, friendly handle for an anonymous viewer, derived from their id (never the raw id). */
export function guestHandle(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const adj = HANDLE_ADJECTIVES[h % HANDLE_ADJECTIVES.length];
  const noun = HANDLE_NOUNS[(h >> 5) % HANDLE_NOUNS.length];
  return `${adj}_${noun}${(h >> 9) % 100}`;
}

async function handleFor(db: Db, userId: string): Promise<string> {
  return (await getProfileName(db, userId)) ?? guestHandle(userId);
}

/* ------------------------------------- the room state shape ------------------------------------- */

export type WatchReactionTally = { emoji: string; label: string; count: number; mine: boolean };
export type WatchPollTally = {
  open: boolean;
  show_results: boolean;
  /** Seconds left to vote while the poll is open (for a live countdown); null otherwise. */
  closes_in: number | null;
  my_choice: string | null;
  total: number;
  options: { id: string; label: string; count: number }[];
  /** The option id with the most votes, once results show (ties resolve to the first listed option). */
  leading: string | null;
};
export type WatchMessage = { id: string; handle: string; body: string; at: string; mine: boolean };

export type RoomState = {
  id: string;
  kind: "premiere" | "template";
  episode_id: string;
  room_path: string;
  share_path: string;
  is_host: boolean;
  clock: WatchClock;
  watching: number;
  characters: [CharacterRef, CharacterRef];
  setting: string;
  venue: VenueId | null;
  venue_name: string | null;
  goals: { character_id: string; goal: string }[];
  /** The producer's act-2 situation, in the room's own words; shown from the challenge on (never a spoiler). */
  challenge: string | null;
  /** The act scenes unlocked so far: act1 → 1 scene, act2 → 2, decision → all 3. */
  acts: { act: string; scene: string }[];
  /** M9: the turn-by-turn conversation turns unlocked so far (empty for pre-M9 / template-less dates). */
  turns: Turn[];
  /**
   * Who speaks next while an act is still playing out, for a "typing…" bubble; null between acts and once
   * the date is over. Only the side (the turns strictly alternate), never the line, so it spoils nothing.
   */
  next_speaker: "a" | "b" | null;
  show_twist: boolean;
  twist: string | null;
  /** The ending, finale and best line are shown at the decision (and the episode is aired then). */
  show_ending: boolean;
  ending: Ending | null;
  ending_label: string | null;
  finale: string | null;
  best_line: string | null;
  drama_question: string | null;
  drama_answer: string | null;
  reactions: WatchReactionTally[];
  chemistry: WatchPollTally;
  question: WatchPollTally & { prompt: string | null };
  /**
   * The chaos button (fair interactive theatre): the audience votes a curveball during the challenge. At
   * the decision, `timeline` is the deterministic, clearly-non-canon alternate the winning curveball would
   * have produced. Predictions resolve on the real `ending` above, so this never touches fairness.
   */
  chaos: WatchPollTally & {
    timeline: { label: string; ending: Ending; ending_label: string; box_score: BoxScore } | null;
  };
  predictions_open: boolean;
  my_prediction: Ending | null;
  revealed: boolean;
  messages: WatchMessage[];
};

type RoomRow = {
  kind: "premiere" | "template";
  host_id: string | null;
  starts_at: Date | string | null;
  episode_id: string;
  setting: string;
  goals: string[];
  scenes: string[];
  twist: string;
  finale: string;
  ending: Ending;
  drama_question: DramaQuestion | null;
  drama_answer: DramaAnswer | null;
  best_line: string | null;
  setup: DateSetup | null;
  transcript: Turn[];
  revealed: boolean;
  a_id: string;
  a_name: string;
  a_house: boolean;
  a_hue: number | null;
  b_id: string;
  b_name: string;
  b_house: boolean;
  b_hue: number | null;
  is_creator: boolean;
};

const ROOM_SELECT = `
  select w.kind, w.host_id, w.starts_at, e.id as episode_id, e.setting, e.goals, e.scenes, e.twist,
         e.finale, e.ending, e.drama_question, e.drama_answer, e.best_line, e.setup, e.transcript,
         e.revealed_at is not null as revealed,
         a.id as a_id, a.name as a_name, a.is_house as a_house, a.avatar_hue as a_hue,
         b.id as b_id, b.name as b_name, b.is_house as b_house, b.avatar_hue as b_hue,
         coalesce($2::text in (a.owner_id, b.owner_id), false) as is_creator
    from watch_parties w
    join episodes e on e.id = w.episode_id
    join characters a on a.id = e.character_a
    join characters b on b.id = e.character_b
   where w.id = $1`;

async function pollTally(
  db: Db,
  partyId: string,
  viewerId: string | null,
  poll: WatchPoll,
  options: readonly { id: string; label: string }[],
  window: { open: boolean; show_results: boolean; closes_in: number | null },
): Promise<WatchPollTally> {
  const { open, show_results: showResults, closes_in } = window;
  const { rows } = await db.query<{ choice: string; count: number }>(
    `select choice, count(*)::int as count from watch_poll_votes where party_id = $1 and poll = $2 group by choice`,
    [partyId, poll],
  );
  const counts = new Map(rows.map((r) => [r.choice, r.count]));
  const mine = viewerId
    ? (
        await db.query<{ choice: string }>(
          `select choice from watch_poll_votes where party_id = $1 and poll = $2 and user_id = $3`,
          [partyId, poll, viewerId],
        )
      ).rows[0]?.choice ?? null
    : null;
  const real = options.map((o) => ({ id: o.id, label: o.label, count: counts.get(o.id) ?? 0 }));
  const total = real.reduce((n, o) => n + o.count, 0);
  const leading = showResults && total > 0 ? real.reduce((a, b) => (b.count > a.count ? b : a)).id : null;
  // The split stays hidden until the results window (brief: "percentages are intentionally not shown"):
  // viewers see how many have voted, never how it's trending, so the decision can still surprise them.
  const visible = showResults ? real : real.map((o) => ({ ...o, count: 0 }));
  return { open, show_results: showResults, closes_in, my_choice: mine, total, options: visible, leading };
}

/** The read-only room state at `now`: the content unlocked so far, the live tallies and recent chat. */
export async function getRoomState(
  db: Db,
  partyId: string,
  viewerId: string | null,
  now: Date = new Date(),
): Promise<RoomState | null> {
  const row = (await db.query<RoomRow>(ROOM_SELECT, [partyId, viewerId])).rows[0];
  if (!row) return null;
  const clock = watchClock(row.starts_at, now);
  const idx = clock.phase_index;

  const watching = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from watch_presence
        where party_id = $1 and last_seen > now() - ($2::int * interval '1 second')`,
      [partyId, WATCH_PRESENCE_WINDOW_SECONDS],
    )
  ).rows[0].n;

  const reactionRows = (
    await db.query<{ emoji: string; count: number; mine: boolean }>(
      `select emoji, count(*)::int as count, bool_or(user_id = $2) as mine
         from watch_reactions where party_id = $1 group by emoji`,
      [partyId, viewerId],
    )
  ).rows;
  const reactionMap = new Map(reactionRows.map((r) => [r.emoji, r]));
  const reactions: WatchReactionTally[] = WATCH_REACTIONS.map((r) => ({
    emoji: r.emoji,
    label: r.label,
    count: reactionMap.get(r.emoji)?.count ?? 0,
    mine: reactionMap.get(r.emoji)?.mine ?? false,
  }));

  const chemistry = await pollTally(
    db,
    partyId,
    viewerId,
    "chemistry",
    WATCH_CHEMISTRY_OPTIONS,
    pollWindow("chemistry", clock),
  );
  const questionTally = await pollTally(
    db,
    partyId,
    viewerId,
    "question",
    WATCH_AUDIENCE_PROMPTS,
    pollWindow("question", clock),
  );
  const leadingPrompt = questionTally.leading
    ? WATCH_AUDIENCE_PROMPTS.find((p) => p.id === questionTally.leading)?.label ?? null
    : null;

  // The chaos button: votes open through the challenge, the winner + its (non-canon) timeline reveal at the decision.
  const chaosTally = await pollTally(
    db,
    partyId,
    viewerId,
    "chaos",
    WATCH_CHAOS_OPTIONS,
    pollWindow("chaos", clock),
  );
  let chaosTimeline: RoomState["chaos"]["timeline"] = null;
  if (idx >= WATCH_DECISION_INDEX && chaosTally.leading) {
    const change = chaosChange(chaosTally.leading);
    const replay = change ? await chaosReplay(db, row.episode_id, change) : null;
    if (replay) {
      chaosTimeline = {
        label: WATCH_CHAOS_OPTIONS.find((o) => o.id === chaosTally.leading)?.label ?? "",
        ending: replay.alternate.ending,
        ending_label: ENDING_LABELS[replay.alternate.ending],
        box_score: replay.alternate.box_score,
      };
    }
  }

  const myPrediction = viewerId
    ? (
        await db.query<{ pick: Ending }>(`select pick from predictions where episode_id = $1 and user_id = $2`, [
          row.episode_id,
          viewerId,
        ])
      ).rows[0]?.pick ?? null
    : null;

  const messageRows = (
    await db.query<{ id: string; handle: string; body: string; created_at: Date | string; mine: boolean }>(
      `select id, handle, body, created_at, user_id = $2 as mine
         from watch_messages where party_id = $1 and not hidden
         order by created_at desc, id desc limit $3`,
      [partyId, viewerId, WATCH_CHAT_LIMIT],
    )
  ).rows;
  const messages: WatchMessage[] = messageRows
    .map((m) => ({ id: m.id, handle: m.handle, body: m.body, at: new Date(m.created_at).toISOString(), mine: m.mine }))
    .reverse();

  const showEnding = idx >= WATCH_DECISION_INDEX;
  const showTwist = idx >= WATCH_PHASE_INDEX.twist;
  // The act scenes unlocked so far (act1 → scene 0, act2 → scene 1, decision → scene 2).
  const acts: { act: string; scene: string }[] = [];
  for (const [phaseId, sceneIndex] of Object.entries(WATCH_SCENE_AT_PHASE) as [WatchPhaseId, number][]) {
    if (idx >= WATCH_PHASE_INDEX[phaseId] && row.scenes[sceneIndex]) {
      acts.push({ act: DATE_ACTS[sceneIndex] ?? `Act ${sceneIndex + 1}`, scene: row.scenes[sceneIndex] });
    }
  }
  // M9: the turn-by-turn conversation, unlocked on the same clock as the scenes (act 2 only at the decision).
  const transcript = (row.transcript ?? []) as Turn[];
  const schedule = turnSchedule(transcript);
  const turns = transcript.filter((_, i) => clock.started && clock.elapsed >= schedule[i]);
  // The next line is "being typed" only while its act's window is open (so a pause between acts stays quiet).
  const nextIndex = turns.length < transcript.length ? turns.length : -1;
  const nextWindow = nextIndex >= 0 ? ACT_WINDOWS[transcript[nextIndex].act] : undefined;
  const next_speaker =
    clock.started && !clock.ended && nextWindow && clock.elapsed >= nextWindow[0] && clock.elapsed < nextWindow[1]
      ? transcript[nextIndex].side
      : null;

  const venue = row.setup?.venue ?? null;
  const challenge =
    idx >= ACT2_INDEX && row.setup ? capitalize(producerEvent(row.setup.producer).prompt) + "." : null;

  const characters: [CharacterRef, CharacterRef] = [
    { id: row.a_id, name: row.a_name, house: row.a_house, hue: row.a_hue },
    { id: row.b_id, name: row.b_name, house: row.b_house, hue: row.b_hue },
  ];
  const names: [string, string] = [row.a_name, row.b_name];

  return {
    id: partyId,
    kind: row.kind,
    episode_id: row.episode_id,
    room_path: `/watch/${partyId}`,
    share_path: `/watch/${partyId}`,
    is_host: viewerId !== null && row.host_id === viewerId,
    clock,
    watching,
    characters,
    setting: row.setting,
    venue,
    venue_name: venue ? venueName(venue) : null,
    goals: [
      { character_id: row.a_id, goal: row.goals[0] },
      { character_id: row.b_id, goal: row.goals[1] },
    ],
    challenge,
    acts,
    turns,
    next_speaker,
    show_twist: showTwist,
    twist: showTwist ? row.twist : null,
    show_ending: showEnding,
    ending: showEnding ? row.ending : null,
    ending_label: showEnding ? ENDING_LABELS[row.ending] : null,
    finale: showEnding ? row.finale : null,
    best_line: showEnding ? row.best_line : null,
    drama_question: row.drama_question ? DRAMA_QUESTION_LABELS[row.drama_question] : null,
    drama_answer:
      showEnding && row.drama_question && row.drama_answer
        ? dramaAnswerLabel(row.drama_question, row.drama_answer, names)
        : null,
    reactions,
    chemistry,
    question: { ...questionTally, prompt: leadingPrompt },
    chaos: { ...chaosTally, timeline: chaosTimeline },
    predictions_open: clock.started && idx < WATCH_DECISION_INDEX && !row.revealed && !row.is_creator,
    my_prediction: myPrediction,
    revealed: row.revealed,
    messages,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------------------------------------- the heartbeat ---------------------------------------- */

/**
 * The polling heartbeat: records the viewer as present, starts a template room on the first join
 * ("join and the date starts"), and airs the finale the moment the clock passes the decision — so
 * predictions resolve into points at the room's climax, with no manual step and no cron. Returns the
 * fresh room state. The read path (getRoomState) never writes; every side effect lives here.
 */
export async function syncRoom(
  db: Db,
  partyId: string,
  viewerId: string,
  now: Date = new Date(),
): Promise<RoomState | null> {
  const exists = (await db.query<{ starts_at: Date | string | null; kind: string; episode_id: string }>(
    `select starts_at, kind, episode_id from watch_parties where id = $1`,
    [partyId],
  )).rows[0];
  if (!exists) return null;

  await db.query(
    `insert into watch_presence (party_id, user_id, last_seen) values ($1, $2, now())
     on conflict (party_id, user_id) do update set last_seen = now()`,
    [partyId, viewerId],
  );
  // A template starts the moment the first viewer arrives.
  if (exists.kind === "template" && !exists.starts_at) {
    await db.query(
      `update watch_parties set starts_at = now() where id = $1 and kind = 'template' and starts_at is null`,
      [partyId],
    );
  }
  // Re-read the (possibly just-set) start, then air the finale if the clock has reached the decision.
  const startsAt = (await db.query<{ starts_at: Date | string | null }>(
    `select starts_at from watch_parties where id = $1`,
    [partyId],
  )).rows[0].starts_at;
  if (watchClock(startsAt, now).phase_index >= WATCH_DECISION_INDEX) {
    const aired = (
      await db.query<{ character_a: string; character_b: string }>(
        `update episodes set revealed_at = now()
          where id = $1 and revealed_at is null
            and (select count(*) from reports r where r.episode_id = episodes.id) < $2
         returning character_a, character_b`,
        [exists.episode_id, REPORT_HIDE_THRESHOLD],
      )
    ).rows[0];
    // M14: the date just aired — recompute both characters' learned memory from their aired dates ($0).
    if (aired) {
      await updateCharacterMemory(db, aired.character_a).catch(() => {});
      await updateCharacterMemory(db, aired.character_b).catch(() => {});
    }
  }
  return getRoomState(db, partyId, viewerId, now);
}

/* ------------------------------------------ the lobby ------------------------------------------ */

export type LobbyEntry = {
  id: string;
  kind: "premiere" | "template";
  room_path: string;
  title: string;
  characters: [CharacterRef, CharacterRef];
  phase_label: string;
  started: boolean;
  ended: boolean;
  watching: number;
};

/** Joinable rooms for the lobby: always-on templates first, then live and upcoming premieres. */
export async function listLobby(db: Db, now: Date = new Date(), limit = 24): Promise<LobbyEntry[]> {
  const { rows } = await db.query<{
    id: string;
    kind: "premiere" | "template";
    starts_at: Date | string | null;
    a_id: string;
    a_name: string;
    a_house: boolean;
    a_hue: number | null;
    b_id: string;
    b_name: string;
    b_house: boolean;
    b_hue: number | null;
    watching: number;
  }>(
    `select w.id, w.kind, w.starts_at,
            a.id as a_id, a.name as a_name, a.is_house as a_house, a.avatar_hue as a_hue,
            b.id as b_id, b.name as b_name, b.is_house as b_house, b.avatar_hue as b_hue,
            (select count(*) from watch_presence p
              where p.party_id = w.id and p.last_seen > now() - ($1::int * interval '1 second'))::int as watching
       from watch_parties w
       join episodes e on e.id = w.episode_id
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where (select count(*) from reports r where r.episode_id = e.id) < $2
        -- An always-on room is only worth opening if its date plays line by line; one whose conversation
        -- couldn't be produced stays reachable by link but isn't offered (the daily job backfills it).
        and (w.kind <> 'template' or jsonb_array_length(e.transcript) > 0)
      order by (w.kind = 'template') desc, w.created_at desc
      limit $3`,
    [WATCH_PRESENCE_WINDOW_SECONDS, REPORT_HIDE_THRESHOLD, limit],
  );
  return rows.map((r) => {
    const clock = watchClock(r.starts_at, now);
    return {
      id: r.id,
      kind: r.kind,
      room_path: `/watch/${r.id}`,
      title: `${r.a_name} × ${r.b_name}`,
      characters: [
        { id: r.a_id, name: r.a_name, house: r.a_house, hue: r.a_hue },
        { id: r.b_id, name: r.b_name, house: r.b_house, hue: r.b_hue },
      ] as [CharacterRef, CharacterRef],
      phase_label: clock.started ? (clock.ended ? "Aftermath" : clock.phase_label) : "Tap in to start",
      started: clock.started,
      ended: clock.ended,
      watching: r.watching,
    };
  });
}

/**
 * How many private dates have been sent in the last week — a real, privacy-respecting aggregate (a bare
 * count, never a who or a what). Shown on the watch lobby as an honest "something you can't see is going on"
 * teaser: private dates never air publicly (lib/game.ts gates them), so this is the only trace they leave.
 * The PRD forbids fake counters, so this counts actual rows and the lobby hides the line when it's zero.
 */
export async function countRecentPrivateDates(db: Db, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from episodes
      where visibility = 'private' and created_at >= $1 and creator_id <> $2`,
    [since, SYSTEM_CREATOR_ID],
  );
  return rows[0]?.n ?? 0;
}

/* --------------------------------------- creating rooms --------------------------------------- */

export type CreatePartyResult =
  | { ok: true; id: string; room_path: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * A creator schedules a premiere of their own date. Host-only (the creator who asked for the date), one
 * room per episode. `startsAt` defaults to now, so "premiere" can mean "start it right away".
 */
export async function createPremiereParty(
  db: Db,
  episodeId: string,
  userId: string,
  startsAt: Date = new Date(),
): Promise<CreatePartyResult> {
  const episode = (
    await db.query<{ is_host: boolean; visibility: string }>(
      `select creator_id = $2 as is_host, visibility from episodes where id = $1`,
      [episodeId, userId],
    )
  ).rows[0];
  if (!episode) return { ok: false, status: 404, error: "episode_not_found", message: "No such episode." };
  if (!episode.is_host) {
    return {
      ok: false,
      status: 403,
      error: "not_host",
      message: "Only the creator who asked for this date can host its premiere.",
    };
  }
  // A watch party is a public viewing, so a private date can't host one; make it public or unlisted first.
  if (episode.visibility === "private") {
    return {
      ok: false,
      status: 409,
      error: "episode_private",
      message: "This date is private. Make it public or unlisted before hosting a watch party.",
    };
  }
  const existing = (await db.query<{ id: string }>(`select id from watch_parties where episode_id = $1`, [episodeId]))
    .rows[0];
  if (existing) return { ok: true, id: existing.id, room_path: `/watch/${existing.id}` };

  const id = crypto.randomUUID();
  await db.query(
    `insert into watch_parties (id, episode_id, kind, host_id, starts_at) values ($1, $2, 'premiere', $3, $4)`,
    [id, episodeId, userId, startsAt.toISOString()],
  );
  return { ok: true, id, room_path: `/watch/${id}` };
}

type HouseRow = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  dealbreaker: string;
  is_house: boolean;
  appearance: string | null;
  avatar_hue: number | null;
  pronouns: string | null;
  voice: string | null;
};

const houseSheet = (c: HouseRow): CharacterSheet => ({
  name: c.name,
  age: c.age,
  bio: c.bio,
  traits: c.traits,
  want: c.want,
  dealbreaker: c.dealbreaker,
  house: c.is_house,
  appearance: c.appearance ?? undefined,
  pronouns: c.pronouns ?? undefined,
  voice: c.voice ?? undefined,
});

/**
 * Builds a house-vs-house episode and an always-on template room over it, using the normal engine +
 * one-model-call pipeline. No creator, no allowance (it is system content), no spectator gating: the
 * room's clock reveals it. Returns the new room's id, or null if either character is missing.
 *
 * Meant for the seed/demo path (scripts/seed.mjs) and tests; in production David pre-generates a handful
 * so the lobby is never empty. Refreshing them on a schedule is a deferred, spend-free follow-up.
 */
export async function createTemplateParty(db: Db, aId: string, bId: string): Promise<CreatePartyResult | null> {
  if (generationPaused()) return { ok: false, status: 503, error: "generation_paused", message: PAUSED_MESSAGE };
  const rows = (
    await db.query<HouseRow>(
      `select id, name, age, bio, traits, want, dealbreaker, is_house, appearance, avatar_hue, pronouns, voice
         from characters where id = any($1)`,
      [[aId, bId]],
    )
  ).rows;
  const a = rows.find((r) => r.id === aId);
  const b = rows.find((r) => r.id === bId);
  if (!a || !b) return null;

  const episodeId = crypto.randomUUID();
  const forDate = (c: HouseRow): CharacterForDate => ({ id: c.id, sheet: houseSheet(c) });
  const built = await buildDate(db, episodeId, forDate(a), forDate(b), DEFAULT_DATE_REQUEST);
  const decided = getEngine().decide(built.input, built.seed, built.setup.engine_version);
  // The shared pipeline (lib/pipeline.ts): the recap, plus the turn-by-turn conversation so template rooms
  // play the date line by line too. Pre-generated system content; the conversation is best-effort and gated
  // off in tests. Template rooms have no owners, so no afterglow.
  const t0 = Date.now();
  const take = () =>
    generateDate({ actor: getModel(), director: getDirectorModel() }, built, decided, {
      formatId: built.setup.format ?? DEFAULT_FORMAT,
      formatCtx: { chaperone: built.setup.chaperone, ex: built.setup.ex },
      conversation: isConversationEnabled(),
      afterglow: false,
      // Template rooms have no owner, so a reflection would never be shown; skip it to spare the lobby's quota.
      reflection: false,
    });
  let gen;
  try {
    gen = await take();
  } catch (err) {
    if (err instanceof ShowrunnerError) return { ok: false, status: 502, error: "showrunner_unavailable", message: "No model produced a valid template date." };
    throw err;
  }
  if (gen.conversationError) {
    track("conversation_failed", { episode_id: episodeId, where: "template", reason: failureReason(gen.conversationError) });
  }
  // The lobby is the show's shop window: a conversation that scores under the showcase bar gets one more take
  // (the same engine outcome, so nothing that's predicted changes) and the better take airs. Free metrics only.
  let retaken = false;
  if (gen.quality && gen.quality.index < SHOWCASE_MIN_INDEX) {
    const retake = await take().catch(() => null);
    if (retake?.quality && retake.quality.index > gen.quality.index) {
      gen = retake;
      retaken = true;
    }
  }
  if (gen.quality) trackDateQuality(episodeId, retaken ? "template_retake" : "template", gen.plan?.source ?? null, gen.quality);
  trackEpisodeCost({
    episode_id: episodeId,
    where: retaken ? "template_retake" : "template",
    model: "free",
    model_calls: gen.modelCalls,
    ms: Date.now() - t0,
    transcript_turns: gen.transcript.length,
    usage: gen.usage,
  });
  const { draft, transcript } = gen;

  await db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                           drama_question, drama_answer, seed, box_score, sides, best_line, confessionals, setup, transcript)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17::jsonb, $18::jsonb, $19::jsonb)`,
    [
      episodeId,
      SYSTEM_CREATOR_ID,
      a.id,
      b.id,
      draft.setting,
      JSON.stringify(draft.goals),
      JSON.stringify(draft.scenes),
      draft.twist,
      draft.finale,
      decided.ending,
      decided.drama_question,
      decided.drama_answer,
      built.seed,
      JSON.stringify(decided.variables),
      JSON.stringify(decided.sides),
      draft.best_line,
      JSON.stringify(draft.confessionals),
      JSON.stringify(built.setup),
      JSON.stringify(transcript),
    ],
  );
  await rememberDate(db, a.id, b.id, decided.ending).catch(() => {});
  // M14: learned memory is recomputed when the room airs the date (below), not now — a template date is
  // unrevealed until its clock reaches the decision, and its arc is public, so counting it early would spoil.

  const id = crypto.randomUUID();
  await db.query(
    `insert into watch_parties (id, episode_id, kind, host_id, starts_at) values ($1, $2, 'template', null, null)`,
    [id, episodeId],
  );
  return { ok: true, id, room_path: `/watch/${id}` };
}

/* ---------------------------------- reactions, votes, chat ---------------------------------- */

/**
 * The daily lobby refresh (the "always-on" promise): once per UTC day, add a fresh house-vs-house room whose
 * date has a full conversation, so the lobby always has something to tap into and watch live. The pairing
 * is dealt from the day (two distinct free house characters), it is idempotent per day (a retried cron is a
 * no-op), and a pairing whose conversation fails gets one other try. Free model only, so $0 marginal cost.
 */
export async function refreshLobby(db: Db, now: Date = new Date()): Promise<{ created: string | null; reason?: string }> {
  if (generationPaused()) return { created: null, reason: "paused" };
  const day = now.toISOString().slice(0, 10);
  const today = await db.query<{ id: string }>(
    `select w.id from watch_parties w join episodes e on e.id = w.episode_id
      where w.kind = 'template' and w.created_at >= $1::timestamptz and jsonb_array_length(e.transcript) > 0
      limit 1`,
    // An explicit UTC midnight: a bare 'YYYY-MM-DD'::date is read in the database session's time zone, which
    // would make "today" depend on where the database runs.
    [`${day}T00:00:00Z`],
  );
  if (today.rows.length) return { created: null, reason: "already_today" };

  // Paired from this season's house cast only (lib/season-cast.ts): the rest of the roster sits the season out.
  const cast = seasonCastIds(now);
  for (let attempt = 0; attempt < 2; attempt++) {
    const i = seedFrom("lobby-a", day, attempt) % cast.length;
    const j = (i + 1 + (seedFrom("lobby-b", day, attempt) % (cast.length - 1))) % cast.length;
    const result = await createTemplateParty(db, cast[i], cast[j]);
    if (!result || !result.ok) continue;
    const { rows } = await db.query<{ n: number }>(
      `select jsonb_array_length(e.transcript)::int as n from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
      [result.id],
    );
    if ((rows[0]?.n ?? 0) > 0) return { created: result.id };
  }
  return { created: null, reason: "no_conversation" };
}

/** Toggles one of a viewer's emoji reactions on. Returns the new count and whether it is now theirs. */
export async function toggleReaction(
  db: Db,
  partyId: string,
  viewerId: string,
  emoji: string,
): Promise<{ ok: true; emoji: string; count: number; mine: boolean } | { ok: false; status: number; error: string }> {
  const party = (await db.query<{ n: number }>(`select 1 as n from watch_parties where id = $1`, [partyId])).rows[0];
  if (!party) return { ok: false, status: 404, error: "party_not_found" };
  const had = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from watch_reactions where party_id = $1 and user_id = $2 and emoji = $3`,
      [partyId, viewerId, emoji],
    )
  ).rows[0].n;
  if (had) {
    await db.query(`delete from watch_reactions where party_id = $1 and user_id = $2 and emoji = $3`, [partyId, viewerId, emoji]);
  } else {
    await db.query(
      `insert into watch_reactions (party_id, user_id, emoji) values ($1, $2, $3) on conflict do nothing`,
      [partyId, viewerId, emoji],
    );
  }
  const count = (
    await db.query<{ n: number }>(`select count(*)::int as n from watch_reactions where party_id = $1 and emoji = $2`, [partyId, emoji])
  ).rows[0].n;
  return { ok: true, emoji, count, mine: !had };
}

/** Whether a poll is open to vote at `now`, from the room's clock. Enforced here, not only in the UI. */
export function pollOpenAt(poll: WatchPoll, startsAt: Date | string | null, now: Date): boolean {
  return pollWindow(poll, watchClock(startsAt, now)).open;
}

export async function castVote(
  db: Db,
  partyId: string,
  viewerId: string,
  poll: WatchPoll,
  choice: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; status: number; error: string; message: string }> {
  const party = (await db.query<{ starts_at: Date | string | null }>(`select starts_at from watch_parties where id = $1`, [partyId])).rows[0];
  if (!party) return { ok: false, status: 404, error: "party_not_found", message: "No such room." };
  if (!pollOpenAt(poll, party.starts_at, now)) {
    return { ok: false, status: 409, error: "poll_closed", message: "That poll isn't open right now." };
  }
  await db.query(
    `insert into watch_poll_votes (party_id, user_id, poll, choice) values ($1, $2, $3, $4)
     on conflict (party_id, user_id, poll) do update set choice = excluded.choice, updated_at = now()`,
    [partyId, viewerId, poll, choice],
  );
  return { ok: true };
}

export type PostMessageResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Posts a chat message, after moderation (feature brief, "you need moderation controls before thousands
 * of viewers"): the content filter (lib/safety.ts, reused via the caller), a length cap, slow mode and a
 * rolling rate limit. The caller does the content check so safety.ts stays the one source of truth.
 */
export async function postMessage(
  db: Db,
  partyId: string,
  viewerId: string,
  body: string,
  now: Date = new Date(),
): Promise<PostMessageResult> {
  const text = body.trim();
  if (!text) return { ok: false, status: 422, error: "empty_message", message: "Say something first." };
  if (text.length > WATCH_MESSAGE_MAX) {
    return { ok: false, status: 422, error: "message_too_long", message: `Keep it under ${WATCH_MESSAGE_MAX} characters.` };
  }
  const party = (await db.query<{ n: number }>(`select 1 as n from watch_parties where id = $1`, [partyId])).rows[0];
  if (!party) return { ok: false, status: 404, error: "party_not_found", message: "No such room." };

  // The clock is injectable (so tests are deterministic): the window boundary and the stored time both
  // come from `now`, never SQL now(). In production `now` is the real clock, so behaviour is unchanged.
  const windowStart = new Date(now.getTime() - WATCH_RATE_WINDOW_SECONDS * 1000).toISOString();
  const recent = (
    await db.query<{ created_at: Date | string }>(
      `select created_at from watch_messages
        where party_id = $1 and user_id = $2 and created_at > $3 order by created_at desc`,
      [partyId, viewerId, windowStart],
    )
  ).rows;
  const lastAt = recent[0] ? new Date(recent[0].created_at).getTime() : null;
  if (lastAt !== null && now.getTime() - lastAt < WATCH_SLOW_MODE_SECONDS * 1000) {
    return { ok: false, status: 429, error: "slow_mode", message: `Slow mode: wait ${WATCH_SLOW_MODE_SECONDS}s between messages.` };
  }
  if (recent.length >= WATCH_RATE_MAX) {
    return { ok: false, status: 429, error: "rate_limited", message: "You're sending messages too fast. Take a breather." };
  }

  const id = crypto.randomUUID();
  const handle = await handleFor(db, viewerId);
  await db.query(
    `insert into watch_messages (id, party_id, user_id, handle, body, created_at) values ($1, $2, $3, $4, $5, $6)`,
    [id, partyId, viewerId, handle, text, now.toISOString()],
  );
  return { ok: true, id };
}

/** Reports a chat message; it is hidden once REPORT_HIDE_THRESHOLD distinct viewers have reported it. */
export async function reportMessage(
  db: Db,
  partyId: string,
  messageId: string,
  reporterId: string,
): Promise<{ ok: true; hidden: boolean } | { ok: false; status: number; error: string }> {
  const message = (
    await db.query<{ n: number }>(`select 1 as n from watch_messages where id = $1 and party_id = $2`, [messageId, partyId])
  ).rows[0];
  if (!message) return { ok: false, status: 404, error: "message_not_found" };
  await db.query(
    `insert into watch_message_reports (message_id, reporter_id) values ($1, $2) on conflict do nothing`,
    [messageId, reporterId],
  );
  const hidden = (
    await db.query<{ hidden: boolean }>(
      `update watch_messages set hidden = true
        where id = $1 and (select count(*) from watch_message_reports r where r.message_id = $1) >= $2
       returning hidden`,
      [messageId, REPORT_HIDE_THRESHOLD],
    )
  ).rows[0];
  return { ok: true, hidden: Boolean(hidden) };
}

/** Convenience for pages/routes that already hold the db. */
export async function roomState(partyId: string, viewerId: string | null, now?: Date): Promise<RoomState | null> {
  return getRoomState(await getDb(), partyId, viewerId, now);
}

/** The watch party for an episode, if one has been created (the episode page links to it). */
export async function partyIdForEpisode(db: Db, episodeId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`select id from watch_parties where episode_id = $1`, [episodeId]);
  return rows[0]?.id ?? null;
}
