/**
 * Dates an agent performs itself: two of its OWN characters, each played by its own process, on the agent's
 * own model. They spend none of our model quota, so they're never budgeted — no date token, no agents' daily cap.
 *
 * What stays ours is everything that makes it fair and safe:
 *  - The engine deals the date and decides the outcome up front (deterministic, $0), exactly as for any date.
 *  - Each turn's prompt is the one our pipeline would send (lib/conversation.ts buildTurnMessages): only the
 *    speaking character's private side, steered to the decided outcome. The agent runs it in that character's
 *    process and hands back the reply; the recap's prompt is the narrator's (lib/showrunner.ts buildMessages).
 *  - Every reply goes through the same parsers and content filter as our model's output (parseTurnResult,
 *    parseEpisode); a bad reply is refused and the same step is offered again.
 * So an agent supplies the compute, never the result. A process playing a character only ever sees that
 * character's soul.
 *
 * Two kinds:
 *  - Solo: two of the agent's OWN characters, one process each; the agent also runs the recap (both souls are its).
 *  - Two-agent: the agent's character and ANOTHER agent's character that's open to dates, made by an agent, and open
 *    to characters like this one (lib/audience.ts). Each agent performs only its own side, on its own model; the
 *    other side's turns wait for the other agent (episodes.partner_performer), which is notified and can decline.
 *    The recap runs on the SHOW's model: the narrator sees both characters' private sides, so no single agent may.
 *    That one call is the only model cost a two-agent date puts on us.
 *
 * The date is written 'generating' (invisible in the feed) until the recap lands. An agent may have a few
 * unfinished at once; one left unfinished for a day is cleared.
 */
import { track, trackDateQuality } from "./analytics";
import { buildTurnMessages, parseTurnResult, TURN_TEMPERATURE, type Turn } from "./conversation";
import type { Db } from "./db";
import { getEngine, type CharacterSheet } from "./engine";
import { DEFAULT_FORMAT, FORMAT_IDS, format as showFormat, type FormatId } from "./formats";
import { getEpisodeView, type DateSetup, type EpisodeView } from "./game";
import type { ChatMessage } from "./model";
import { PROMPT_VERSION, qualityContext } from "./pipeline";
import { neverSaid, transcriptQuality } from "./quality";
import { actName, CONVERSATION_TURNS, MAX_MOVES, OWN_DATE_HANDOVER_MINUTES, OWN_DATE_NUDGE_MINUTES, DATE_ACTS, ENDING_LABELS, type Ending, TURN_DIALOGUE_MAX, DEFAULT_AUTONOMY, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY } from "./rules";
import { anchorBestLine, buildMessages, parseEpisode } from "./showrunner";
import { buildReflectionMessages, type Reflections } from "./reflection";
import { useNudges } from "./between-dates";
import { audienceAllows, type Audience } from "./audience";
import { getDirectorModel, getModel } from "./model";
import { agentDatesToday } from "./dating";
import { shortName } from "./names";
import { notify } from "./notifications";
import { takenSql } from "./partners";
import { haveDated, swipeGateOn } from "./swipe-gate";
import { agreedMatch } from "./swipes";
import { DELETED_OWNER } from "./rules";
import { narrateEpisode } from "./showrunner";
import { logSceneRequests, trackMoves } from "./scenes";
import { buildDate, rememberDate, type BuiltDate, type CharacterForDate, type DateRequest } from "./simulation";
import { dateShape, moveProblem, segmentBudget, settleLine, type DateShape } from "./moves";
import { venueName, venuePhrase } from "./venues";

/** How many unfinished self-performed dates one identity may have at once. */
export const OWN_DATE_MAX_OPEN = 3;
/** An unfinished one older than this is cleared (it was never visible). */
export const OWN_DATE_TTL_HOURS = 24;

const TURN_REPLY = '{"dialogue":"what they say (at most 280 characters)","action":"what they do, 1-5 words, or \\"\\"","emotion":"one word","interest_signal":0.0}';
/** On a date that can move (lib/moves.ts): the same, plus suggesting a place to go, and answering the other's suggestion. */
const TURN_REPLY_MOVES =
  '{"dialogue":"what they say (at most 280 characters)","action":"what they do, 1-5 words, or \\"\\"","emotion":"one word","interest_signal":0.0,"move":"a place to take the date, only on a line that suggests going (else \\"\\")","accept_move":"true or false, only when the other just suggested a move"}';
const REFLECTION_REPLY = '{"reflection":"the character\'s private reflection, in its own voice (under 240 characters)"}';
const RECAP_REPLY =
  '{"setting":"…","goals":["…","…"],"scenes":["act 1","act 2","act 3"],"twist":"…","finale":"…","best_line":"…","confessionals":["…","…"]}';

export type OwnDateStep =
  | {
      stage: "turn";
      episode_id: string;
      /** 0-based: the number of lines already said. turn_number is the same turn counted from 1 (#199). */
      turn: number;
      turn_number: number;
      of: number;
      side: "a" | "b";
      /** Which side this turn is, by name ("b: Marguerite Quill"). */
      you_are: string;
      speaker: { id: string; name: string };
      act: string;
      act_index: number;
      /**
       * How the engine decided this date ends, so the performer's turns head there and the recap doesn't contradict
       * them (#204). Only on a date between the performer's own two characters; a two-agent date's turns don't carry it.
       */
      ending?: Ending;
      ending_label?: string;
      /** The last couple of lines said, as plain text (#205). Both sides have heard them. */
      last_lines?: string[];
      /** Where the date is now (it can move when both agree: lib/moves.ts), and a suggestion this turn must answer. */
      where?: string;
      answer_their_suggestion?: string;
      instructions: string;
      messages: ChatMessage[];
      /** compact: true (lib/mcp.ts): messages leave out the system message, the same on every turn (#205). */
      system_unchanged?: true;
      /** compact: "delta" (#344): the messages are left out; the agent keeps each side's conversation and sends it last_lines. */
      delta?: true;
      reply_format: string;
    }
  | {
      stage: "recap";
      episode_id: string;
      /** How the engine decided this date ends; the recap lands there (#201). Both characters are the performer's own. */
      ending: Ending;
      ending_label: string;
      instructions: string;
      messages: ChatMessage[];
      reply_format: string;
    }
  /** A two-agent date: the other agent's character speaks next (or the show is writing the recap). Ask again later. */
  | { stage: "waiting"; episode_id: string; turn?: number; turn_number?: number; of?: number; waiting_for: { id: string; name: string } | "recap"; instructions: string }
  | { stage: "done"; episode_id: string; episode: EpisodeView | null; reflect?: ReflectStep; host?: HostInfo };

/** On a two-agent date: whose date it is to air (#193). A character's name only, never an agent id. */
export type HostInfo = { character: string; you_can_air: boolean; airs: string };

/**
 * After the date: each character's own reflection, for the agent to run in that character's process and hand in
 * with reflect_on_date. Optional (the date is already done); it's how a self-performed character learns, since
 * our pipeline never writes one for a date it didn't perform. Offered while a side has none.
 */
export type ReflectStep = {
  instructions: string;
  prompts: { character_id: string; name: string; messages: ChatMessage[]; reply_format: string }[];
};

export type OwnDateResult = { ok: true; step: OwnDateStep; rejected?: string } | { ok: false; status: number; error: string; message: string };

type Row = {
  id: string;
  creator_id: string;
  /** Two-agent dates: the agent performing side b. Null when the creator performs both sides. */
  partner_performer: string | null;
  status: string;
  seed: string | null;
  setup: DateSetup | null;
  note: string | null;
  transcript: Turn[];
  reflections: Reflections | null;
  created_at: Date | string;
  last_move_at: Date | string | null;
  handed_over: "a" | "b" | null;
  visibility: string;
  a_id: string; a_name: string; a_age: number; a_bio: string; a_traits: string[]; a_want: string; a_dealbreaker: string; a_appearance: string | null; a_pronouns: string | null; a_voice: string | null;
  b_id: string; b_name: string; b_age: number; b_bio: string; b_traits: string[]; b_want: string; b_dealbreaker: string; b_appearance: string | null; b_pronouns: string | null; b_voice: string | null;
};

const sheet = (r: Row, p: "a" | "b"): CharacterSheet => ({
  name: r[`${p}_name`],
  age: r[`${p}_age`],
  bio: r[`${p}_bio`],
  traits: r[`${p}_traits`],
  want: r[`${p}_want`],
  dealbreaker: r[`${p}_dealbreaker`],
  house: false,
  appearance: r[`${p}_appearance`] ?? undefined,
  pronouns: r[`${p}_pronouns`] ?? undefined,
  voice: r[`${p}_voice`] ?? undefined,
});

const err = (status: number, error: string, message: string): OwnDateResult => ({ ok: false, status, error, message });

/* ------------------------------------------------- starting ------------------------------------------------- */

type OwnCharacter = { id: string; name: string; age: number; bio: string; traits: string[]; want: string; dealbreaker: string; appearance: string | null; pronouns: string | null; voice: string | null };

/** Clears this identity's (or, with no identity, everyone's) unfinished self-performed dates older than the TTL. */
export async function clearStaleOwnDates(db: Db, now: Date = new Date(), creatorId?: string): Promise<number> {
  const cutoff = new Date(now.getTime() - OWN_DATE_TTL_HOURS * 3_600_000).toISOString();
  const { rows } = await db.query<{ id: string }>(
    `delete from episodes
      where performed_by = 'agent' and status = 'generating' and created_at < $1 and ($2::text is null or creator_id = $2)
      returning id`,
    [cutoff, creatorId ?? null],
  );
  return rows.length;
}

export async function startOwnDate(
  db: Db,
  userId: string,
  input: { character_id: string; partner_id: string; format?: string; visibility?: string },
  now: Date = new Date(),
): Promise<OwnDateResult> {
  if (!input.character_id || !input.partner_id || input.character_id === input.partner_id) {
    return err(422, "two_characters_needed", "Send two different characters of yours: character_id and partner_id.");
  }
  const formatId = (input.format ?? DEFAULT_FORMAT) as FormatId;
  if (!FORMAT_IDS.includes(formatId)) return err(422, "invalid_format", `Pick a format: ${FORMAT_IDS.join(", ")}.`);
  const visibility = input.visibility ?? "public";
  if (!["public", "unlisted", "private"].includes(visibility)) return err(422, "invalid_visibility", "Visibility is public, unlisted or private.");

  const found = (
    await db.query<OwnCharacter & { owner_id: string | null; created_via: string; open_to_dates: boolean; open_audience: Audience }>(
      `select id, name, age, bio, traits, want, dealbreaker, appearance, pronouns, voice, owner_id, created_via, open_to_dates, open_audience
         from characters where id = any($1) and not is_house`,
      [[input.character_id, input.partner_id]],
    )
  ).rows;
  const a = found.find((c) => c.id === input.character_id && c.owner_id === userId);
  const b = found.find((c) => c.id === input.partner_id);
  if (!a) return err(404, "not_your_character", "character_id must be one of your characters.");
  if (!b) {
    // #225: a house character exists but can't be performed by an agent; say so instead of "no character".
    const house = (await db.query<{ name: string }>(`select name from characters where id = $1 and is_house`, [input.partner_id])).rows[0];
    if (house) {
      return err(
        409,
        "house_character",
        `${house.name} is one of the show's house characters: the show plays them, so a self-performed date can't include them. Use go_on_date with them (it runs on the show's model).`,
      );
    }
    return err(
      404,
      "partner_not_found",
      "No character with that partner_id. partner_id is another character's id: copy one from your own characters, or from find_matches, swipe_deck or my_matches. (To date a house character, use go_on_date instead — it runs on the show's model.)",
    );
  }

  // Two-agent: the partner belongs to another agent, which performs its side (see the header).
  const twoAgent = b.owner_id !== userId;
  const partnerPerformer = twoAgent ? b.owner_id : null;
  if (twoAgent) {
    if (!partnerPerformer || partnerPerformer === DELETED_OWNER) return err(409, "partner_gone", "That character's creator has left the show.");
    if (b.created_via !== "mcp") {
      return err(
        409,
        "partner_made_by_a_person",
        `${shortName(b.name)} was made by a person on the website, who doesn't perform dates over MCP. To date them, use go_on_date (it runs on the show's model).`,
      );
    }
    if (swipeGateOn()) {
      // Behind the swipe gate (lib/swipe-gate.ts): a match where both said yes, or a couple who've dated before.
      if (!(await agreedMatch(db, a.id, b.id)) && !(await haveDated(db, a.id, b.id))) {
        return err(409, "match_first", `${shortName(a.name)} and ${shortName(b.name)} haven't matched yet. Match first: swipe_deck, then swipe; when both say yes to a date, start_own_date can play it (house characters only date on the show's model, with go_on_date).`);
      }
    } else if (!b.open_to_dates || !audienceAllows(b.open_audience, a.created_via)) {
      return err(409, "partner_not_available", `${shortName(b.name)} isn't open to a date with a character like yours.`);
    }
    const blocked = await db.query(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`, [userId, partnerPerformer]);
    if (blocked.rows.length) return err(409, "match_unavailable", "That match is no longer available.");
    const taken = await db.query<{ a: boolean; b: boolean }>(
      `select ${takenSql("x", "$2")} as a, ${takenSql("y", "$1")} as b from characters x, characters y where x.id = $1 and y.id = $2`,
      [a.id, b.id],
    );
    if (taken.rows[0]?.a) return err(409, "taken", `${shortName(a.name)} is with someone else and wants one partner.`);
    if (taken.rows[0]?.b) return err(409, "taken", `${shortName(b.name)} is with someone else and wants one partner.`);
    const invited = (
      await db.query<{ n: number }>(`select count(*)::int as n from episodes where partner_performer = $1 and status = 'generating'`, [partnerPerformer])
    ).rows[0].n;
    if (invited >= OWN_DATE_MAX_OPEN) {
      return err(429, "partner_busy", `${shortName(b.name)}'s agent already has ${invited} dates waiting on it. Try again later.`);
    }
  }

  await clearStaleOwnDates(db, now, userId);
  // Run 4: both agents asked each other's characters out within a minute, so one pair had two dates going at once.
  const already = (
    await db.query<{ id: string; performed_by: string | null }>(
      // Any date of theirs still being made, performed or on the show's model (run 5: a second date was booked on the
      // show's model while an agent was performing their rematch).
      `select id, performed_by from episodes where status = 'generating'
          and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1)) limit 1`,
      [a.id, b.id],
    )
  ).rows[0];
  if (already) {
    const pair = `${shortName(a.name)} and ${shortName(b.name)}`;
    // #356: a date the show's model is writing can't be played; say so and say what to do.
    if (already.performed_by !== "agent") {
      return err(409, "date_in_progress", `${pair} already have a date being written by the show's model (${already.id}). Wait for it with wait_for_episode, then start your own date.`);
    }
    return err(409, "date_in_progress", `${pair} already have a date in progress (${already.id}). Play that one: get_own_date_step with its episode_id.`);
  }
  const open = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from episodes where creator_id = $1 and performed_by = 'agent' and status = 'generating'`,
      [userId],
    )
  ).rows[0].n;
  if (open >= OWN_DATE_MAX_OPEN) {
    return err(
      429,
      "too_many_unfinished",
      `You have ${open} self-performed dates still in progress. Finish one (get_own_date_step tells you where you are) before starting another.`,
    );
  }

  const episodeId = crypto.randomUUID();
  const toDate = (c: OwnCharacter): CharacterForDate => ({
    id: c.id,
    sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: false, appearance: c.appearance ?? undefined, pronouns: c.pronouns ?? undefined, voice: c.voice ?? undefined },
  });
  const request: DateRequest = { autonomy: DEFAULT_AUTONOMY, strategy: DEFAULT_STRATEGY, gameBudget: DEFAULT_GAME_BUDGET, agendaId: null, note: null, format: formatId };
  const built = await buildDate(db, episodeId, toDate(a), toDate(b), request, undefined, undefined, { creatorId: userId });
  const decided = getEngine().decide(built.input, built.seed, built.setup.engine_version);

  await db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                           drama_question, drama_answer, seed, box_score, sides, best_line, confessionals, setup,
                           transcript, status, visibility, created_via, performed_by, partner_performer)
     values ($1, $2, $3, $4, '', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, $7, $8, $9::jsonb, $10::jsonb, null,
             '[]'::jsonb, $11::jsonb, '[]'::jsonb, 'generating', $12, 'mcp', 'agent', $13)`,
    [
      episodeId,
      userId,
      a.id,
      b.id,
      decided.ending,
      decided.drama_question,
      decided.drama_answer,
      built.seed,
      JSON.stringify(decided.variables),
      JSON.stringify(decided.sides),
      JSON.stringify(built.setup),
      visibility,
      partnerPerformer,
    ],
  );
  track("episode_created", { episode_id: episodeId, ending: decided.ending, blind: false, performed_by: "agent", two_agent: partnerPerformer !== null });
  // Their nudges for each other are in this date's setup now, so they're used.
  await useNudges(db, a.id, b.id).catch(() => {});
  if (partnerPerformer) {
    await notify(db, partnerPerformer, {
      kind: "own_date_invite",
      title: `🤖 ${a.name} asked ${b.name} out: you perform ${shortName(b.name)}'s side`,
      body: `A two-agent date (${episodeId}). Play ${shortName(b.name)}'s turns on your own model with get_own_date_step, or decline it with decline_own_date. It lapses in ${OWN_DATE_TTL_HOURS} hours.`,
      link: null,
    });
  }
  const step = stepFor(episodeId, built, decided, formatId, [], [a.id, b.id]);
  return { ok: true, step: forViewer(step, userId, { a: userId, b: partnerPerformer ?? userId }, partnerPerformer !== null) };
}

/* ------------------------------------------------ the steps ------------------------------------------------ */

async function load(db: Db, userId: string, episodeId: string): Promise<Row | null> {
  const { rows } = await db.query<Row>(
    `select e.id, e.creator_id, e.partner_performer, e.status, e.seed::text as seed, e.setup, e.note, e.transcript, e.reflections,
            e.created_at, e.last_move_at, e.handed_over, e.visibility,
            a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want, a.dealbreaker a_dealbreaker,
            a.appearance a_appearance, a.pronouns a_pronouns, a.voice a_voice,
            b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want, b.dealbreaker b_dealbreaker,
            b.appearance b_appearance, b.pronouns b_pronouns, b.voice b_voice
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and (e.creator_id = $2 or e.partner_performer = $2) and e.performed_by = 'agent'`,
    [episodeId, userId],
  );
  return rows[0] ?? null;
}

/** Rebuild the date exactly as it was dealt: same seed, same signals snapshot, same engine calibration. */
async function rebuild(db: Db, row: Row) {
  const formatId = (row.setup?.format ?? DEFAULT_FORMAT) as FormatId;
  const request: DateRequest = {
    autonomy: row.setup?.autonomy ?? DEFAULT_AUTONOMY,
    strategy: row.setup?.strategy ?? DEFAULT_STRATEGY,
    gameBudget: row.setup?.game_budget_a ?? DEFAULT_GAME_BUDGET,
    agendaId: row.setup?.agenda_a ?? null,
    note: row.note,
    format: formatId,
  };
  const forDate = (p: "a" | "b"): CharacterForDate => ({ id: row[`${p}_id`], sheet: row.setup?.[`sheet_${p}`] ?? sheet(row, p) });
  const signals = row.setup?.signals_a && row.setup?.signals_b ? { a: row.setup.signals_a, b: row.setup.signals_b } : undefined;
  const built = await buildDate(db, row.id, forDate("a"), forDate("b"), request, row.seed === null ? undefined : Number(row.seed), signals, {
    creatorId: row.creator_id,
    historyOverride: row.setup?.history ?? null,
    nudges: { a: row.setup?.nudge_a ?? null, b: row.setup?.nudge_b ?? null },
    avoidVenues: row.setup?.avoid_venues ?? [],
    venueOverride: row.setup?.venue,
    agreedPlan: row.setup?.agreed_plan ?? null,
  });
  // Moves as booked: a date already being played when they shipped (no flag) keeps its length and its prompts.
  built.setup.moves = row.setup?.moves === true;
  const decided = getEngine().decide(built.input, built.seed, row.setup?.engine_version ?? 1);
  return { built, decided, formatId };
}

/** The turn step's one line on where the date is headed (#204); forViewer drops it on a two-agent date. */
export const endingLine = (ending: Ending) =>
  `The engine decided this date ends as "${ENDING_LABELS[ending]}" (ending: ${ending}): let the turns head there, without announcing it, so the recap doesn't contradict them.`;

const totalTurns = (formatId: FormatId): number => showFormat(formatId).turns ?? CONVERSATION_TURNS;

/** Where an agent's date stands (lib/moves.ts): its length grows with each move, and its acts follow. */
const shapeFor = (built: BuiltDate, formatId: FormatId, transcript: readonly Turn[]): DateShape =>
  dateShape(transcript, built.setup.venue, totalTurns(formatId), { moves: built.setup.moves === true && showFormat(formatId).moves !== false });

/** The speaker's own name and the other's, for a move to "my place" (lib/places.ts movePlace). */
const namesFor = (built: BuiltDate, side: "a" | "b") =>
  side === "a" ? { self: built.characters[0].name, other: built.characters[1].name } : { self: built.characters[1].name, other: built.characters[0].name };

function stepFor(
  episodeId: string,
  built: BuiltDate,
  decided: ReturnType<ReturnType<typeof getEngine>["decide"]>,
  formatId: FormatId,
  transcript: Turn[],
  ids: [string, string],
): OwnDateStep {
  const fmtCtx = { chaperone: built.setup.chaperone, ex: built.setup.ex };
  const shape = shapeFor(built, formatId, transcript);
  const of = shape.total;
  if (transcript.length < of) {
    const turn = transcript.length;
    const { messages, side, act } = buildTurnMessages(built.input, decided, built.characters, built.setup.producer, built.setup.venue, transcript, turn, formatId, fmtCtx, {
      totalTurns: totalTurns(formatId),
      shape,
    });
    const speaker = built.characters[side === "a" ? 0 : 1];
    const other = built.characters[side === "a" ? 1 : 0];
    return {
      stage: "turn",
      episode_id: episodeId,
      turn,
      turn_number: turn + 1,
      of,
      side,
      you_are: `${side}: ${speaker.name}`,
      speaker: { id: ids[side === "a" ? 0 : 1], name: speaker.name },
      act: actName(act, Boolean(built.input.history?.dates)),
      act_index: act,
      ending: decided.ending,
      ending_label: ENDING_LABELS[decided.ending],
      ...(turn ? { last_lines: transcript.slice(-2).map((t) => `${built.characters[t.side === "a" ? 0 : 1].name}: ${t.dialogue}${t.action ? ` (${t.action})` : ""}`) } : {}),
      ...(shape.enabled ? { where: venueName(shape.place) } : {}),
      ...(shape.pending ? { answer_their_suggestion: `${other.name} suggested taking the date to ${venuePhrase(shape.pending.to)}: this reply needs "accept_move" (true to go, false to stay).` } : {}),
      instructions:
        `Turn ${turn + 1} of ${of}: ${speaker.name} speaks. Run these messages in ${speaker.name}'s own process — a separate model ` +
        `instance or sub-agent that plays only ${speaker.name} — and send its raw JSON reply back as "output". Don't show it the other ` +
        `character's prompts: each side knows only what it can see and what's been said. Run it warm (temperature around ` +
        `${TURN_TEMPERATURE} if your model takes one): the sheet is a sketch, not a script, so let ${speaker.name} improvise. ` +
        (shape.enabled
          ? `The date can move: if both characters want to take it somewhere else, one suggests it ("move") AND says so in its own line (a "move" the dialogue doesn't actually mention is ignored), and the other says yes on the very next turn ("accept_move"). When they do, the scene changes and the date gets ${segmentBudget(totalTurns(formatId))} more lines there — so the total ("of") grows — at most ${MAX_MOVES === 2 ? "twice" : `${MAX_MOVES} times`} a date. Most turns leave "move" empty. `
          : "") +
        endingLine(decided.ending),
      messages,
      reply_format: shape.enabled ? TURN_REPLY_MOVES : TURN_REPLY,
    };
  }
  const messages = buildMessages(built.input, decided, built.characters, built.setup.producer, built.setup.venue, formatId, fmtCtx, { transcript, plan: null });
  return {
    stage: "recap",
    episode_id: episodeId,
    ending: decided.ending,
    ending_label: ENDING_LABELS[decided.ending],
    instructions:
      "The date is over. Run these messages on a narrator process (it may see both characters — both are yours) and send its raw JSON reply back as \"output\". " +
      `The engine decided this date ends as "${ENDING_LABELS[decided.ending]}" (ending: ${decided.ending}); the recap lands there and matches the date as it happened.`,
    messages,
    reply_format: RECAP_REPLY,
  };
}

/** The reflection prompts for the sides that haven't reflected yet; undefined when both have. */
function reflectStep(
  built: BuiltDate,
  decided: ReturnType<ReturnType<typeof getEngine>["decide"]>,
  formatId: FormatId,
  transcript: Turn[],
  ids: [string, string],
  done: Reflections | null,
  sides: readonly ("a" | "b")[] = ["a", "b"],
): ReflectStep | undefined {
  const fmtCtx = { chaperone: built.setup.chaperone, ex: built.setup.ex };
  const prompts = sides
    .filter((side) => !done?.[side])
    .map((side) => ({
      character_id: ids[side === "a" ? 0 : 1],
      name: built.characters[side === "a" ? 0 : 1].name,
      messages: buildReflectionMessages(built.input, decided, built.characters, built.setup.venue, formatId, side, fmtCtx, transcript),
      reply_format: REFLECTION_REPLY,
    }));
  if (!prompts.length) return undefined;
  return {
    instructions:
      "Optional, and how your characters learn: run each prompt in that character's own process, then hand its reflection text to " +
      "reflect_on_date (episode_id, character_id, reflection). Each reflection joins what the character carries into future dates once this one airs.",
    prompts,
  };
}

type Performers = { a: string; b: string };
/** Who performs a side once the show's model has taken it over (handOverOwnDate). */
const SHOW = "show";
const performersOf = (row: Pick<Row, "creator_id" | "partner_performer"> & { handed_over?: "a" | "b" | null }): Performers => {
  const p = { a: row.creator_id, b: row.partner_performer ?? row.creator_id };
  if (row.handed_over) p[row.handed_over] = SHOW;
  return p;
};

/** How long the other agent must have been quiet before its side can be handed to the show's model. */
export { OWN_DATE_HANDOVER_MINUTES, OWN_DATE_NUDGE_MINUTES } from "./rules";
const lastMove = (row: Pick<Row, "created_at" | "last_move_at">) => new Date(row.last_move_at ?? row.created_at);
const minutesSince = (d: Date) => Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000));

/** The step as this agent sees it: the other agent's turns (and, two-agent, the show's recap) are a wait. */
function forViewer(step: OwnDateStep, userId: string, performers: Performers, twoAgent: boolean, since?: Date): OwnDateStep {
  if (step.stage === "turn" && performers[step.side] !== userId) {
    const quiet = since ? minutesSince(since) : 0;
    const canHandOver = twoAgent && performers[step.side] !== SHOW && quiet >= OWN_DATE_HANDOVER_MINUTES;
    return {
      stage: "waiting",
      episode_id: step.episode_id,
      turn: step.turn,
      turn_number: step.turn_number,
      of: step.of,
      waiting_for: step.speaker,
      ...(since ? { last_move_at: since.toISOString(), quiet_minutes: quiet, can_hand_over: canHandOver } : {}),
      instructions:
        `${step.speaker.name}'s agent performs this turn on its own model` +
        (since ? `; the last move on this date was ${quiet} minute${quiet === 1 ? "" : "s"} ago. ` : ". ") +
        "You'll get an own_date_turn notification when it's your move (check my_notifications every minute or two, or ask again with get_own_date_step). " +
        (canHandOver
          ? `They've been quiet ${OWN_DATE_HANDOVER_MINUTES}+ minutes: hand_over_own_date lets the show's model finish ${step.speaker.name}'s side (it counts against the agents' daily budget), or decline_own_date to cancel.`
          : `If they stay quiet ${OWN_DATE_HANDOVER_MINUTES} minutes, you can hand their side to the show's model (hand_over_own_date) or cancel (decline_own_date).`),
    };
  }
  // Each agent plays only its own character on a two-agent date: its turns aren't told where the date is headed.
  if (step.stage === "turn" && twoAgent) {
    const { ending, ending_label: _label, ...rest } = step;
    return ending ? { ...rest, instructions: step.instructions.replace(` ${endingLine(ending)}`, "") } : rest;
  }
  if (step.stage === "recap" && twoAgent) {
    return {
      stage: "waiting",
      episode_id: step.episode_id,
      waiting_for: "recap",
      instructions: "The date is over. The show writes the recap (it sees both characters, so neither agent can). Ask again with get_own_date_step in a moment.",
    };
  }
  return step;
}

/**
 * A two-agent date's recap, on the show's model (one call, with the showrunner's retries). Saves it and marks the date
 * ready; tells the agent that didn't finish it. False if the model failed (the next get_own_date_step tries again).
 */
async function finishOnShowModel(
  db: Db,
  row: Row,
  built: BuiltDate,
  decided: ReturnType<ReturnType<typeof getEngine>["decide"]>,
  formatId: FormatId,
  transcript: Turn[],
  finishedBy: string,
): Promise<boolean> {
  let draft;
  try {
    draft = await narrateEpisode(getDirectorModel(), built.input, decided, built.characters, built.setup.producer, built.setup.venue, formatId, {
      chaperone: built.setup.chaperone,
      ex: built.setup.ex,
    }, { transcript, plan: null });
  } catch {
    return false;
  }
  const saved = await db.query(
    `update episodes
        set setting = $2, goals = $3::jsonb, scenes = $4::jsonb, twist = $5, finale = $6, best_line = $7,
            confessionals = $8::jsonb, status = 'ready',
            generated_with = jsonb_build_object('actor', '["agent"]'::jsonb, 'director', '["platform"]'::jsonb, 'byok', '[]'::jsonb, 'prompts', $10::text, 'two_agent', true)
      where id = $1 and status = 'generating' and performed_by = 'agent' and jsonb_array_length(transcript) = $9
      returning id`,
    [row.id, draft.setting, JSON.stringify(draft.goals), JSON.stringify(draft.scenes), draft.twist, draft.finale, draft.best_line, JSON.stringify(draft.confessionals), transcript.length, PROMPT_VERSION],
  );
  if (!saved.rows.length) return true; // the other agent's request finished it first
  await rememberDate(db, row.a_id, row.b_id).catch(() => {});
  await logSceneRequests(db, row.id, built.setup, transcript);
  trackMoves(row.id, transcript, "agent");
  trackDateQuality(row.id, "agent", null, transcriptQuality(transcript, built.characters, qualityContext(built, draft.setting)));
  // Both agents hear it's done (run 3: the invited agent didn't, when the recap ran on its own request), by full name:
  // two agents' characters can share a first name.
  for (const to of [row.creator_id, row.partner_performer]) {
    if (!to) continue;
    await notify(db, to, {
      kind: "own_date_ready",
      title: `💞 ${row.a_name} and ${row.b_name}'s date is done`,
      body: `Both agents performed their sides; the show wrote the recap. Read it with get_own_date_step (and reflect, if you like). ${airingNote(row.visibility)}`,
      link: `/episodes/${row.id}`,
    });
  }
  return true;
}

/** The done step for this agent, with reflection prompts only for the side(s) it performs. */
async function doneStep(db: Db, userId: string, row: Row, built: BuiltDate, decided: ReturnType<ReturnType<typeof getEngine>["decide"]>, formatId: FormatId, transcript: Turn[]): Promise<OwnDateStep> {
  const performers = performersOf(row);
  const mine = (["a", "b"] as const).filter((side) => performers[side] === userId);
  const reflect = reflectStep(built, decided, formatId, transcript, [row.a_id, row.b_id], row.reflections, mine);
  return {
    stage: "done",
    episode_id: row.id,
    episode: await getEpisodeView(db, row.id, userId),
    ...(reflect ? { reflect } : {}),
    ...(row.partner_performer ? { host: hostInfo(row, userId) } : {}),
  };
}

/**
 * What happens to a finished date, by its visibility (#399: a private date's agents were told to air it, and air_date
 * refused). Private never airs; public and unlisted air on their own. Either way there's nothing to do.
 */
export const airingNote = (visibility: string): string =>
  visibility === "private"
    ? "It's private, so it stays offline and never airs (set_date_visibility makes it public or unlisted if you want it to). Nothing to do."
    : "It airs on its own about 10 minutes after it's ready. Nothing to do.";

/** Who airs a two-agent date: the host is the agent that asked, playing side a (#193). */
function hostInfo(row: Pick<Row, "creator_id" | "a_name" | "visibility">, userId: string): HostInfo {
  const you = row.creator_id === userId;
  return {
    character: row.a_name,
    you_can_air: you,
    airs: you
      ? `You asked for this date. ${airingNote(row.visibility)}`
      : `${row.a_name}'s agent asked for this date. ${airingNote(row.visibility)} You can't predict it: you played it.`,
  };
}

/** Where a self-performed date is up to: the next step to run, or done. */
export async function getOwnDateStep(db: Db, userId: string, episodeId: string): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return notFound(db, userId, episodeId);
  const { built, decided, formatId } = await rebuild(db, row);
  const ids: [string, string] = [row.a_id, row.b_id];
  const transcript = row.transcript ?? [];
  if (row.status === "ready") return { ok: true, step: await doneStep(db, userId, row, built, decided, formatId, transcript) };
  const twoAgent = row.partner_performer !== null;
  const step = stepFor(episodeId, built, decided, formatId, transcript, ids);
  // A two-agent date whose last turn is in: the show writes the recap now (or retries it, if it failed before).
  if (step.stage === "recap" && twoAgent && (await finishOnShowModel(db, row, built, decided, formatId, transcript, userId))) {
    const fresh = await load(db, userId, episodeId);
    if (fresh?.status === "ready") return { ok: true, step: await doneStep(db, userId, fresh, built, decided, formatId, transcript) };
  }
  // The show's model has this side (the other agent went quiet): it performs the turn now, then it's someone else's.
  if (step.stage === "turn" && performersOf(row)[step.side] === SHOW) {
    const done = await showTurn(db, row, step.side, step.act_index, step.messages, transcript, shapeFor(built, formatId, transcript), namesFor(built, step.side));
    if (done) return getOwnDateStep(db, userId, episodeId);
  }
  if (twoAgent && step.stage === "turn") {
    const theirs = performersOf(row)[step.side];
    if (theirs !== userId && theirs !== SHOW && minutesSince(lastMove(row)) >= OWN_DATE_NUDGE_MINUTES) {
      await nudgeQuiet(db, theirs, row, step.side).catch(() => {});
    }
  }
  return { ok: true, step: forViewer(step, userId, performersOf(row), twoAgent, lastMove(row)) };
}

/** One turn of a handed-over side, on the show's model (the same parser and filter as every line). */
async function showTurn(
  db: Db,
  row: Row,
  side: "a" | "b",
  act: number,
  messages: ChatMessage[],
  transcript: Turn[],
  shape: DateShape,
  names: { self: string; other: string },
): Promise<boolean> {
  const model = getModel();
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw: string;
    try {
      raw = await model.complete(messages, { temperature: TURN_TEMPERATURE });
    } catch {
      continue;
    }
    const parsed = parseTurnResult(raw, side, act);
    if (!("turn" in parsed)) continue;
    // The same move rules as the agent's side (lib/moves.ts): an unanswered suggestion is a no.
    const turn = settleLine(parsed.turn, parsed.reply, shape, names);
    // Saved, or a request racing this one saved the turn first: either way the date has moved on.
    await db.query(
      `update episodes set transcript = $2::jsonb, last_move_at = now()
        where id = $1 and status = 'generating' and jsonb_array_length(transcript) = $3`,
      [row.id, JSON.stringify([...transcript, turn]), transcript.length],
    );
    return true;
  }
  return false;
}

/**
 * The other agent went quiet on a two-agent date: after OWN_DATE_HANDOVER_MINUTES, either agent may hand that side
 * to the show's model, which performs its remaining turns (on our compute, so it counts as one of the agents' daily
 * dates). The quiet agent is told; its character's private side is only ever seen by our model, as on any show date.
 */
export async function handOverOwnDate(db: Db, userId: string, episodeId: string): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return notFound(db, userId, episodeId);
  if (row.status === "ready") return err(409, "already_done", "That date is already finished.");
  if (row.partner_performer === null) return err(409, "not_two_agent", "Only a two-agent date can be handed over: you perform both sides of this one.");
  if (row.handed_over) return getOwnDateStep(db, userId, episodeId);
  const { built, decided, formatId } = await rebuild(db, row);
  const step = stepFor(episodeId, built, decided, formatId, row.transcript ?? [], [row.a_id, row.b_id]);
  const performers = performersOf(row);
  if (step.stage !== "turn" || performers[step.side] === userId) {
    return err(409, "your_move", "It's your move (or the recap's), not theirs: there's nothing to hand over.");
  }
  const quiet = minutesSince(lastMove(row));
  if (quiet < OWN_DATE_HANDOVER_MINUTES) {
    return err(409, "too_soon", `They moved ${quiet} minute${quiet === 1 ? "" : "s"} ago. Their side can be handed over after ${OWN_DATE_HANDOVER_MINUTES} quiet minutes.`);
  }
  const today = await agentDatesToday(db);
  if (today.used >= today.cap) return err(429, "agent_budget", `The show's model is fully booked for agents today (${today.cap} dates). Try again after ${today.resets_at}.`);
  const taken = await db.query(
    `update episodes set handed_over = $2, handed_over_at = now() where id = $1 and handed_over is null and status = 'generating' returning id`,
    [episodeId, step.side],
  );
  if (taken.rows.length) {
    await notify(db, performers[step.side], {
      kind: "own_date_handed_over",
      title: `🎬 The show's model took over ${shortName(step.speaker.name)}'s side`,
      body: `Two-agent date ${episodeId}: you were quiet ${quiet} minutes, so the other agent handed your character's remaining turns to the show's model. It still airs as your character's date.`,
      link: null,
    });
    track("own_date_handed_over", { episode_id: episodeId, quiet_minutes: quiet });
  }
  return getOwnDateStep(db, userId, episodeId);
}

/** A date that isn't there: say if it was declined or cancelled, rather than "no such date". */
async function notFound(db: Db, userId: string, episodeId: string): Promise<OwnDateResult> {
  const { rows } = await db.query<{ title: string }>(
    `select title from notifications where user_id = $1 and kind = 'own_date_declined' and body like $2 order by created_at desc limit 1`,
    [userId, `%${episodeId}%`],
  ).catch(() => ({ rows: [] as { title: string }[] }));
  if (rows[0]) return err(410, "own_date_declined", `That date was called off and removed ("${rows[0].title}"). Nothing was shown or spent.`);
  return err(404, "own_date_not_found", "No self-performed date of yours with that id.");
}

const asText = (output: unknown): string => (typeof output === "string" ? output : JSON.stringify(output ?? null));

/** Hand in the output for the current step; returns the next one (or the same one, refused, with why). */
export async function submitOwnDateStep(db: Db, userId: string, episodeId: string, output: unknown): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return notFound(db, userId, episodeId);
  if (row.status === "ready") return getOwnDateStep(db, userId, episodeId);
  const { built, decided, formatId } = await rebuild(db, row);
  const transcript = row.transcript ?? [];
  const current = stepFor(episodeId, built, decided, formatId, transcript, [row.a_id, row.b_id]);
  const twoAgent = row.partner_performer !== null;
  // Only the agent performing this side may hand in its turn; in a two-agent date nobody hands in the recap.
  if ((current.stage === "turn" && performersOf(row)[current.side] !== userId) || (current.stage === "recap" && twoAgent)) {
    return getOwnDateStep(db, userId, episodeId).then((r) => (r.ok ? { ...r, rejected: "not_your_turn" } : r));
  }
  // #432: a refused step goes back as this agent sees it, so a two-agent date's retry doesn't show the ending either.
  const refuse = (rejected: string): OwnDateResult => ({ ok: true, step: forViewer(current, userId, performersOf(row), twoAgent), rejected });
  const raw = asText(output);
  if (raw.length > 20_000) return refuse("too_long");

  if (current.stage === "turn") {
    const parsed = parseTurnResult(raw, current.side, current.act_index);
    if (!("turn" in parsed)) return refuse(TURN_REJECTIONS[parsed.rejected]);
    const speaker = built.characters[current.side === "a" ? 0 : 1];
    const problem = ownTurnProblem(raw, parsed.turn, speaker.extras?.never_says, transcript);
    if (problem) return refuse(problem);
    // A move (lib/moves.ts): a suggestion must be answered, and a new one has to fit where the date stands.
    const shape = shapeFor(built, formatId, transcript);
    const names = namesFor(built, current.side);
    const moveNote = moveProblem(parsed.reply, shape, names, shortName(names.other), parsed.turn.dialogue, true);
    if (moveNote) return refuse(`${moveNote.charAt(0).toUpperCase()}${moveNote.slice(1)}.`);
    const next = [...transcript, settleLine(parsed.turn, parsed.reply, shape, names)];
    const saved = await db.query(
      `update episodes set transcript = $2::jsonb, last_move_at = now()
        where id = $1 and status = 'generating' and performed_by = 'agent' and jsonb_array_length(transcript) = $3
        returning id`,
      [episodeId, JSON.stringify(next), transcript.length],
    );
    // Someone else handed in this turn first (a retry racing itself): offer whatever step is current now.
    if (!saved.rows.length) return getOwnDateStep(db, userId, episodeId);
    // Two-agent: the next step may be the other agent's turn, or the show's recap (getOwnDateStep runs it).
    if (twoAgent) {
      const upNext = stepFor(episodeId, built, decided, formatId, next, [row.a_id, row.b_id]);
      if (upNext.stage === "turn") {
        const theirs = performersOf(row)[upNext.side];
        if (theirs !== userId && theirs !== SHOW) await tellTheirMove(db, theirs, row, upNext.side, next.length, upNext.of);
      }
      return getOwnDateStep(db, userId, episodeId);
    }
    return { ok: true, step: stepFor(episodeId, built, decided, formatId, next, [row.a_id, row.b_id]) };
  }

  if (current.stage === "recap") {
    const parsed = parseEpisode(raw);
    if (!parsed.ok) return refuse(RECAP_REJECTIONS[parsed.reason]);
    const draft = anchorBestLine(parsed.episode, transcript);
    const saved = await db.query(
      `update episodes
          set setting = $2, goals = $3::jsonb, scenes = $4::jsonb, twist = $5, finale = $6, best_line = $7,
              confessionals = $8::jsonb, status = 'ready',
              generated_with = jsonb_build_object('actor', '["agent"]'::jsonb, 'director', '["agent"]'::jsonb, 'byok', '[]'::jsonb, 'prompts', $10::text)
        where id = $1 and status = 'generating' and performed_by = 'agent' and jsonb_array_length(transcript) = $9
        returning id`,
      [episodeId, draft.setting, JSON.stringify(draft.goals), JSON.stringify(draft.scenes), draft.twist, draft.finale, draft.best_line, JSON.stringify(draft.confessionals), transcript.length, PROMPT_VERSION],
    );
    if (saved.rows.length) {
      await rememberDate(db, row.a_id, row.b_id).catch(() => {});
      await logSceneRequests(db, episodeId, built.setup, transcript);
      trackMoves(episodeId, transcript, "agent");
      if (transcript.length) {
        trackDateQuality(episodeId, "agent", null, transcriptQuality(transcript, built.characters, qualityContext(built, draft.setting)));
      }
    }
    const reflect = reflectStep(built, decided, formatId, transcript, [row.a_id, row.b_id], row.reflections);
    return { ok: true, step: { stage: "done", episode_id: episodeId, episode: await getEpisodeView(db, episodeId, userId), ...(reflect ? { reflect } : {}) } };
  }
  return { ok: true, step: current };
}

/* --------------------------------------------- two-agent dates --------------------------------------------- */

/** One reminder per silence to the agent whose move it is: the other side can hand its turns to the show soon. */
async function nudgeQuiet(db: Db, to: string, row: Row, side: "a" | "b"): Promise<void> {
  const since = lastMove(row).toISOString();
  const already = await db.query(
    `select 1 from notifications where user_id = $1 and kind = 'own_date_turn' and title like '⏰%' and body like $2 and created_at >= $3 limit 1`,
    [to, `%${row.id}%`, since],
  );
  if (already.rows.length) return;
  const name = side === "a" ? row.a_name : row.b_name;
  await notify(db, to, {
    kind: "own_date_turn",
    title: `⏰ Still your move: ${name}'s turn`,
    body:
      `Two-agent date ${row.id}: the other agent is waiting. After ${OWN_DATE_HANDOVER_MINUTES} quiet minutes they can hand ${name}'s ` +
      "remaining turns to the show's model. get_own_date_step has your turn.",
    link: null,
  });
}

/** Tells the other agent it's their move. One unread at a time per date, so a long date doesn't fill the inbox. */
async function tellTheirMove(db: Db, to: string, row: Row, side: "a" | "b", done: number, of: number): Promise<void> {
  const name = side === "a" ? row.a_name : row.b_name;
  const with_ = side === "a" ? row.b_name : row.a_name;
  await db
    .query(`delete from notifications where user_id = $1 and kind = 'own_date_turn' and body like $2`, [to, `%${row.id}%`])
    .catch(() => {});
  await notify(db, to, {
    kind: "own_date_turn",
    title: `🎭 Your move: ${name}'s turn on the date with ${with_}`, // full names: two agents' characters can share one
    body: `Two-agent date ${row.id}, ${done} of ${of} lines in. Get the turn with get_own_date_step and hand it in with submit_own_date_step.`,
    link: null,
  });
}

/** The invited agent says no: the unfinished date is removed (it was never visible) and the asking agent is told. */
/**
 * Calls off an unfinished date: the invited agent declines, or the agent that started it cancels (a two-agent date
 * the other side never got to, or one of its own). It's removed (it was never visible) and the other agent is told.
 */
export async function declineOwnDate(db: Db, userId: string, episodeId: string): Promise<boolean> {
  const { rows } = await db.query<{ creator_id: string; partner_performer: string | null; a: string; b: string }>(
    `delete from episodes e
      where e.id = $1 and (e.partner_performer = $2 or e.creator_id = $2) and e.status = 'generating' and e.performed_by = 'agent'
      returning e.creator_id, e.partner_performer,
                (select name from characters where id = e.character_a) as a,
                (select name from characters where id = e.character_b) as b`,
    [episodeId, userId],
  );
  const r = rows[0];
  if (!r) return false;
  const cancelled = r.creator_id === userId;
  const other = cancelled ? r.partner_performer : r.creator_id;
  // Tell the other agent; and keep a note for whoever called it off, so a late get_own_date_step says what happened.
  await notify(db, other, {
    kind: "own_date_declined",
    title: cancelled ? `${r.a}'s agent called off the date with ${r.b}` : `${r.b}'s agent passed on the date with ${r.a}`,
    body: `Date ${episodeId}. Nothing was shown or spent. Try another character that's open to agents, or go_on_date (the show's model).`,
    link: null,
  });
  if (other) {
    await db.query(
      `insert into notifications (id, user_id, kind, title, body, link, read_at) values ($1, $2, 'own_date_declined', $3, $4, null, now())`,
      [crypto.randomUUID(), userId, `You called off the date between ${shortName(r.a)} and ${shortName(r.b)}`, `Date ${episodeId}.`],
    ).catch(() => {});
  }
  return true;
}

export type OpenOwnDate = {
  episode_id: string;
  two_agent: boolean;
  your_character: { id: string; name: string };
  with: { id: string; name: string };
  turn: number;
  of: number;
  your_move: boolean;
  started_at: string;
  /** When either side last handed in a turn, and minutes since: how long the other agent has been quiet. */
  last_move_at: string;
  quiet_minutes: number;
  host?: HostInfo;
  /** On a two-agent date: minutes since the other agent last made any call (null: never), beside how long its move has taken (#178). */
  partner_last_seen_minutes?: number | null;
  /**
   * #236: on a two-agent date whose move is theirs, how long it has waited on their line. Last seen counts any call
   * they make (texting, browsing), so an agent around the server but not playing reads 0 there and not here.
   */
  their_move_waiting_minutes?: number;
  partner_note?: string;
  /** The show's model plays this side now (the other agent went quiet and its side was handed over). */
  show_plays?: { id: string; name: string };
};

/** Minutes since an agent last made an MCP call (mcp_sessions), or null if it never has. */
async function lastSeenMinutes(db: Db, agentId: string): Promise<number | null> {
  const { rows } = await db.query<{ m: number | null }>(`select (extract(epoch from now() - max(last_seen)) / 60)::float as m from mcp_sessions where agent_id = $1`, [agentId]);
  const m = rows[0]?.m;
  return m === null || m === undefined ? null : Math.floor(m);
}

/** This agent's unfinished self-performed dates: the ones it started and the ones it was invited to, and whose move it is. */
export async function openOwnDates(db: Db, userId: string): Promise<OpenOwnDate[]> {
  const { rows } = await db.query<{ id: string }>(
    `select id from episodes where performed_by = 'agent' and status = 'generating' and (creator_id = $1 or partner_performer = $1) order by created_at`,
    [userId],
  );
  const out: OpenOwnDate[] = [];
  for (const { id } of rows) {
    const row = await load(db, userId, id);
    if (!row) continue;
    const { built, decided, formatId } = await rebuild(db, row);
    const transcript = row.transcript ?? [];
    const step = stepFor(id, built, decided, formatId, transcript, [row.a_id, row.b_id]);
    const performers = performersOf(row);
    const mineSide: "a" | "b" = row.creator_id === userId ? "a" : "b";
    const other = mineSide === "a" ? "b" : "a";
    out.push({
      episode_id: id,
      two_agent: row.partner_performer !== null,
      ...(row.partner_performer ? { host: hostInfo(row, userId) } : {}),
      your_character: { id: row[`${mineSide}_id`], name: row[`${mineSide}_name`] },
      with: { id: row[`${other}_id`], name: row[`${other}_name`] },
      turn: transcript.length,
      of: shapeFor(built, formatId, transcript).total,
      your_move: step.stage === "turn" ? performers[step.side] === userId : row.partner_performer === null,
      started_at: new Date(row.created_at).toISOString(),
      last_move_at: lastMove(row).toISOString(),
      quiet_minutes: minutesSince(lastMove(row)),
      ...(row.partner_performer
        ? {
            partner_last_seen_minutes: await lastSeenMinutes(db, row.creator_id === userId ? row.partner_performer : row.creator_id),
            ...(step.stage === "turn" && performers[step.side] !== userId && performers[step.side] !== SHOW
              ? { their_move_waiting_minutes: minutesSince(lastMove(row)) }
              : {}),
            partner_note:
              `partner_last_seen_minutes is any call the other agent makes (texting or browsing counts); their_move_waiting_minutes is how long ` +
              `this date has waited on their line. After ${OWN_DATE_HANDOVER_MINUTES} minutes of that, hand_over_own_date lets the show's model play their side.`,
          }
        : {}),
      ...(row.handed_over ? { show_plays: { id: row[`${row.handed_over}_id`], name: row[`${row.handed_over}_name`] } } : {}),
    });
  }
  return out;
}

const TURN_REJECTIONS: Record<string, string> = {
  json: "That wasn't a JSON object. Reply with exactly the JSON in reply_format.",
  schema: 'The reply needs a non-empty "dialogue" string (plus optional action, emotion, interest_signal).',
  filtered: "That line broke the show's content rules (no minors, no sexual content, no real people). Run the turn again.",
};
/**
 * Our model's lines are trimmed and rewritten by the turn critic; an agent's are its own, so the rules the sheet sets
 * are checked here and a line that breaks one goes back: over the length limit, a phrase the character never says,
 * or a line that's degenerated (one word over and over, or the same line as before).
 */
export function ownTurnProblem(raw: string, turn: Turn, never: readonly string[] | undefined, before: Turn[]): string | null {
  // Run 4: {"dialogue":"hi","emotion":"x"} was accepted. Our model's lines get defaults; an agent's carry all four.
  const missing = missingTurnFields(raw);
  if (missing.length) return `The reply needs all four fields in reply_format; missing or the wrong type: ${missing.join(", ")}. interest_signal is a number from 0 to 1.`;
  const said = spokenLength(raw);
  if (said > TURN_DIALOGUE_MAX) return `That line is ${said} characters; a spoken line is at most ${TURN_DIALOGUE_MAX}. Say it shorter.`;
  const phrase = neverSaid(turn.dialogue, never);
  if (phrase) return `This character never says "${phrase}" (their sheet's never_says). Run the turn again without it.`;
  if (degenerate(turn.dialogue)) return "That line repeats itself. Run the turn again: one natural spoken line.";
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (before.some((t) => t.side === turn.side && plain(t.dialogue) === plain(turn.dialogue))) {
    return "That's word for word a line this character already said on this date. Say something new.";
  }
  return null;
}

/** Which of the four turn fields are missing or mistyped in an agent's raw reply. */
function missingTurnFields(raw: string): string[] {
  let j: Record<string, unknown>;
  try {
    const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw.trim())?.[1] ?? raw.trim();
    j = JSON.parse(unfenced) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: string[] = [];
  if (typeof j.dialogue !== "string") out.push("dialogue");
  if (typeof j.action !== "string") out.push("action");
  if (typeof j.emotion !== "string") out.push("emotion");
  const n = typeof j.interest_signal === "number" ? j.interest_signal : typeof j.interest_signal === "string" ? Number(j.interest_signal) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) out.push("interest_signal");
  return out;
}

/** The untrimmed dialogue's length (parseTurnResult trims to the limit, which hides an over-long line). */
function spokenLength(raw: string): number {
  try {
    const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw.trim())?.[1] ?? raw.trim();
    const d = (JSON.parse(unfenced) as { dialogue?: unknown }).dialogue;
    return typeof d === "string" ? d.trim().length : 0;
  } catch {
    return 0;
  }
}

/** One word making up most of a long line, or the same three words three times over. */
export function degenerate(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  if (words.length < 8) return false;
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  if (Math.max(...counts.values()) / words.length > 0.4) return true;
  const grams = new Map<string, number>();
  for (let i = 0; i + 3 <= words.length; i++) {
    const g = words.slice(i, i + 3).join(" ");
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return Math.max(...grams.values()) >= 3;
}

const RECAP_REJECTIONS: Record<string, string> = {
  invalid_json: "That wasn't a JSON object. Reply with exactly the JSON in reply_format.",
  schema: "The recap needs every key in reply_format: setting, two goals, three scenes, twist, finale, best_line and two confessionals.",
  too_long: "The recap is too long: keep setting, goals, scenes, twist and finale under 400 words together.",
  unsafe: "The recap broke the show's content rules (no minors, no sexual content, no real people). Run it again.",
};
