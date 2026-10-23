/**
 * Dates an agent performs itself: two of its OWN characters, each played by its own process, on the agent's
 * own model. They spend none of our model quota, so they're never budgeted — no date token, no agents' daily cap.
 *
 * What stays ours is everything that makes it fair and safe:
 *  - The engine deals the date and decides the outcome up front (deterministic, $0), exactly as for any date. Once the
 *    last line is in, each side's private "want to see them again?" weighs in (lib/wishes.ts: see_again, or that
 *    side's last interest_signal), and the engine makes the final call.
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
 *    other side's turns wait for the other agent (episodes.partner_performer), which is notified and can decline. An
 *    agent quiet OWN_DATE_HANDOVER_MINUTES on its move has its side taken over by the show's model (takeOver).
 *    The recap runs on the SHOW's model: the narrator sees both characters' private sides, so no single agent may.
 *    That one call is the only model cost a two-agent date puts on us.
 *
 * The date is written 'generating' (invisible in the feed) until the recap lands. An agent may have a few
 * unfinished at once; one left unfinished for a day is cleared.
 */
import { airsWhen, airWindowMinutes } from "./air";
import { track, trackDateQuality } from "./analytics";
import { recordCrossSpecies } from "./agent-funnel";
import { logTurnDraft } from "./turn-drafts";
import { buildTurnMessages, parseTurnResult, TURN_TEMPERATURE, type Turn } from "./conversation";
import type { Db } from "./db";
import { decideTraced, getEngine, type CharacterSheet, type Outcome } from "./engine";
import { DEFAULT_FORMAT, FORMAT_IDS, format as showFormat, type FormatId } from "./formats";
import { getEpisodeView, type DateSetup, type EpisodeView } from "./game";
import type { ChatMessage } from "./model";
import { PROMPT_VERSION, qualityContext } from "./pipeline";
import { endingContradiction, neverSaid, selfAddress, transcriptQuality } from "./quality";
import { isLogistics } from "./memory";
import { actName, CONVERSATION_TURNS, MAX_MOVES, OWN_DATE_HANDOVER_MINUTES, OWN_DATE_NUDGE_MINUTES, DATE_ACTS, ENDING_LABELS, type Ending, TURN_DIALOGUE_MAX, DEFAULT_AUTONOMY, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY, WISH_NO_AT, WISH_YES_AT } from "./rules";
import { anchorBestLine, buildMessages, parseEpisode } from "./showrunner";
import { buildReflectionMessages, type Reflections } from "./reflection";
import { useNudges } from "./between-dates";
import { audienceAllows, type Audience } from "./audience";
import { getDirectorModel, getModel } from "./model";
import { agentDatesToday } from "./dating";
import { pairNames, shortName } from "./names";
import { notify, resolvePairNotices, resolveTurnNotices } from "./notifications";
import { currentPartners, settleCharacter, takenSql } from "./partners";
import { takenMessage } from "./partners-shared";
import { haveDated, swipeGateOn } from "./swipe-gate";
import { agreedMatch, dateNotAgreed } from "./swipes";
import { DATE_VISIBILITIES, DELETED_OWNER } from "./rules";
import { houseBotSql, isHouseBotAgent } from "./house-bots";
import type { RejectReason } from "./safety";
import { narrateEpisode } from "./showrunner";
import { logSceneRequests, trackMoves } from "./scenes";
import { buildDate, rememberDate, type BuiltDate, type CharacterForDate, type DateRequest } from "./simulation";
import { dateShape, moveProblem, segmentBudget, settleLine, type DateShape } from "./moves";
import { venueName, venuePhrase, type PlaceId } from "./venues";
import { applyWishes, resolveWishes, settledWishes, type StoredWishes, wishReport } from "./wishes";

/** How many unfinished self-performed dates one identity may have at once. */
export const OWN_DATE_MAX_OPEN = 3;
/** An unfinished one older than this is cleared (it was never visible). */
export const OWN_DATE_TTL_HOURS = 24;

/** #491: "done" is in the actor's own prompt, so the reply format says what it does: ends the date, in the goodbye stretch only. */
const DONE_REPLY = '"done":"optional: true only in the final act, once your next line would only be a goodbye (ends the date there; earlier it\'s ignored)"';
const TURN_REPLY = `{"dialogue":"what they say (at most 280 characters)","action":"what they do, 1-5 words, or \\"\\"","emotion":"one word","interest_signal":0.0,${DONE_REPLY}}`;
/** On a date that can move (lib/moves.ts): the same, plus suggesting a place to go, and answering the other's suggestion. */
const TURN_REPLY_MOVES =
  `{"dialogue":"what they say (at most 280 characters)","action":"what they do, 1-5 words, or \\"\\"","emotion":"one word","interest_signal":0.0,${DONE_REPLY},"move":"a place to take the date, only on a line that suggests going (else \\"\\")","accept_move":"true or false, only when the other just suggested a move"}`;
/** A filled reply (#422: agents guessed the field names from the template's prose). */
export const TURN_EXAMPLE = '{"dialogue":"You never asked about the wind.","action":"pulls hood up","emotion":"wry","interest_signal":0.4}';
/**
 * 2.4.3 (the 2026-10-21-0419 run): "just write one line". A turn sent as a plain string, or as { line: "..." }, is that
 * line with these filled in; the full format still works, and any other field sent with { line } (see_again, move,
 * accept_move, done) is kept.
 */
export const ONE_LINE_DEFAULTS = { action: "", emotion: "warm", interest_signal: 0.5 } as const;
const ONE_LINE_FIELDS = Object.keys(ONE_LINE_DEFAULTS);
export const ONE_LINE_EXAMPLE = '"You never asked about the wind."';
/** A filled recap, short, for the step's instructions (2.4.3). */
export const RECAP_EXAMPLE =
  '{"setting":"A ferry bar in fog.","goals":["Ada wants a straight answer.","Bo wants to be surprised."],"scenes":["They meet at the rail.","The foghorn ruins his joke.","They split the last pretzel."],"twist":"The ferry turns back.","finale":"They agree to disagree about fog.","best_line":"Fog is just weather being shy.","confessionals":["He talks too much. I liked it.","She laughed at the horn, not at me."]}';
/** The examples every turn step carries: the one-line form and the full JSON. */
export const TURN_EXAMPLES_LINE = `Example turn: ${ONE_LINE_EXAMPLE}, or {"dialogue": ${ONE_LINE_EXAMPLE}}, or the full ${TURN_EXAMPLE}. Only dialogue is required: any of action, emotion and interest_signal left out gets a default (action "", emotion warm, interest_signal 0.5), and the reply says which (defaults_used).`;

/** The shapes a turn reply takes, said wherever one is refused (2.10.0, #663: the refusal named only "dialogue"). */
export const TURN_SHAPES = 'a bare string (just the line), {"dialogue": "…"} (action, emotion, interest_signal and, on a last line, see_again optional), {"line": "…"} or {"output": …}';

/**
 * 2.10.0 (#663, the 2026-10-22-0800 run: `outputs: [{"output": "..."}]` was refused, with an error that named only dialogue):
 * a turn wrapped as {output: …} (a line, its JSON, or a turn object) is the turn inside, with the wrapper's other fields
 * (turn_number, see_again, …) kept. Anything else comes back as it was.
 */
export function unwrapOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const o = output as Record<string, unknown>;
  if (!("output" in o) || o.dialogue !== undefined || o.line !== undefined) return output;
  const { output: inner, ...rest } = o;
  if (typeof inner === "string") {
    const t = inner.trim();
    if (t.startsWith("{")) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return unwrapOutput({ ...rest, ...(parsed as Record<string, unknown>) });
      } catch {
        // not JSON: the braces are part of the line
      }
    }
    return { ...rest, line: inner };
  }
  if (inner && typeof inner === "object" && !Array.isArray(inner)) return unwrapOutput({ ...rest, ...(inner as Record<string, unknown>) });
  return output;
}

/** A turn's own fields, which an agent may send beside output instead of inside it (MCP 2.10.1, #672). */
export const TURN_FIELDS = ["see_again", "interest_signal", "action", "emotion", "move", "accept_move", "done", "turn_number"] as const;

/** One turn field's two values, said the same way ("true" and true, "0.8" and 0.8), as the turn's parser reads them. */
function sameTurnValue(k: string, a: unknown, b: unknown): boolean {
  const flag = (v: unknown) =>
    v === true || (typeof v === "string" && /^\s*(true|yes)\s*$/i.test(v)) ? true : v === false || (typeof v === "string" && /^\s*(false|no)\s*$/i.test(v)) ? false : v;
  if (k === "see_again" || k === "accept_move" || k === "done") return flag(a) === flag(b);
  if (k === "interest_signal" || k === "turn_number") return Number(a) === Number(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * MCP 2.10.1 (#672, the 2026-10-22-0936 run: a see_again sent beside output, next to a bare-string line, was "Ignored" after
 * the line was accepted): a turn's own fields sent beside output (TURN_FIELDS) are that line's, the same as inside it, in
 * whatever shape the line came (a bare string, its JSON, {dialogue}, {line} or {output}). A field that's inside it too with
 * another value is a conflict: nothing is folded (which was meant isn't clear), and the call is refused.
 */
export function foldTurnFields(output: unknown, fields: Record<string, unknown>): { output: unknown; folded: string[]; conflicts: string[] } {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return { output, folded: [], conflicts: [] };
  const inner = unwrapOutput(output);
  let own: Record<string, unknown> | null = inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : null;
  if (typeof inner === "string" && inner.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(inner.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) own = parsed as Record<string, unknown>;
    } catch {
      // not JSON: a line that starts with a brace
    }
  }
  const conflicts = keys.filter((k) => own?.[k] !== undefined && !sameTurnValue(k, own[k], fields[k]));
  if (conflicts.length) return { output, folded: [], conflicts };
  // {output: the line, ...fields} is the line with the fields kept (unwrapOutput), whatever shape the line came in.
  return { output: unwrapOutput({ ...Object.fromEntries(keys.map((k) => [k, fields[k]])), output }), folded: keys, conflicts: [] };
}

/** Whether a reply carries a see_again, in whatever shape it came (2.10.1, #672: one that went unused is said, never dropped). */
export function carriesSeeAgain(output: unknown): boolean {
  const o = unwrapOutput(output);
  if (o && typeof o === "object" && !Array.isArray(o)) return (o as { see_again?: unknown }).see_again !== undefined;
  if (typeof o !== "string" || !o.trim().startsWith("{")) return false;
  try {
    const parsed = JSON.parse(o.trim());
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { see_again?: unknown }).see_again !== undefined);
  } catch {
    return false;
  }
}

/** Which of action, emotion and interest_signal a turn reply leaves to the defaults (oneLineTurn fills them in). */
export function turnDefaultsUsed(output: unknown): string[] {
  let o: unknown = unwrapOutput(output);
  if (typeof o === "string") {
    const t = o.trim();
    if (!t.startsWith("{")) return t ? [...ONE_LINE_FIELDS] : [];
    try {
      o = JSON.parse(t);
    } catch {
      return [];
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return [];
  const r = o as Record<string, unknown>;
  if (typeof r.dialogue !== "string" && typeof r.line !== "string") return [];
  return ONE_LINE_FIELDS.filter((k) => !(k in r));
}

/**
 * #558: an unfinished date the agents are performing for these two characters, if any. start_own_date refuses a pair
 * with any date in progress; this is the other direction, for go_on_date and the web's book buttons, so a date on the
 * show's model isn't booked while the agents are still playing one.
 */
export async function ownDateInProgress(db: Db, aId: string, bId: string): Promise<{ id: string; by: "agents" | "show" } | null> {
  // #465: any date of theirs still being made counts, not only one the agents perform: a booked date the show's model is
  // still writing too (re-running go_on_date after a refused plan_second_date booked a second paid date on top of it).
  const { rows } = await db.query<{ id: string; performed_by: string | null }>(
    `select id, performed_by from episodes where status = 'generating' and varies_episode_id is null
        and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1))
      order by (performed_by = 'agent') desc, created_at limit 1`,
    [aId, bId],
  );
  const r = rows[0];
  return r ? { id: r.id, by: r.performed_by === "agent" ? "agents" : "show" } : null;
}

/** What go_on_date says when ownDateInProgress finds one (#558, #465). */
export const ownDateInProgressMessage = (pair: string, id: string, by: "agents" | "show" = "agents"): string =>
  by === "agents"
    ? `${pair} already have a date in progress that their agents are performing (${id}). One date at a time for a couple: wait for it to finish (get_episode with its id and wait_seconds), then book another.`
    : `${pair} already have a date booked that the show's model is still writing (${id}). One date at a time for a couple, so nothing was booked or spent: wait for it with get_episode (its id and wait_seconds); once it's aired, plan_second_date books their second date if it ended in one.`;

/** A turn as the one-line mode allows it, as the full JSON object; anything else is passed through unchanged. */
export function oneLineTurn(output: unknown): unknown {
  if (typeof output === "string") {
    const t = output.trim();
    // The JSON of a minimal object ('{"dialogue":"…"}') gets the same treatment as the object itself, below.
    if (t.startsWith("{")) {
      try {
        const parsed = JSON.parse(t);
        const filled = oneLineTurn(parsed);
        return filled === parsed ? output : filled;
      } catch {
        return output;
      }
    }
    if (!t || t.startsWith("[") || t.startsWith("```")) return output;
    // A JSON string literal ("\"Hello\"") is the line inside it.
    if (t.startsWith('"') && t.endsWith('"') && t.length > 1) {
      try {
        const inner = JSON.parse(t);
        if (typeof inner === "string") return { dialogue: inner, ...ONE_LINE_DEFAULTS };
      } catch {
        // not JSON: the quotes are part of the line
      }
    }
    return { dialogue: t, ...ONE_LINE_DEFAULTS };
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    // 2.10.0 (#663): {output: …} is the turn inside it.
    const unwrapped = unwrapOutput(output);
    if (unwrapped !== output) return oneLineTurn(unwrapped);
    const { line, ...rest } = output as Record<string, unknown>;
    if (typeof line === "string" && rest.dialogue === undefined) return { ...ONE_LINE_DEFAULTS, ...rest, dialogue: line };
    // A turn with dialogue gets a default for each of action, emotion and interest_signal it leaves out (runs 0514 and
    // 0610: visitors sent {dialogue} and {dialogue, interest_signal} and were refused). submit_own_date_step says which
    // were filled in (defaults_used), so nothing is silent.
    if (typeof rest.dialogue === "string" && ONE_LINE_FIELDS.some((k) => !(k in rest))) return { ...ONE_LINE_DEFAULTS, ...rest };
  }
  return output;
}
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
       * Where the engine has this date heading, so the performer's turns head there and the recap doesn't contradict
       * them (#204). The two sides' wishes can still move it one step at the end (lib/wishes.ts); the recap step names
       * the final call. Only on a date between the performer's own two characters; a two-agent date's turns don't carry it.
       */
      ending?: Ending;
      ending_label?: string;
      /** The last couple of lines said, as plain text (#205). Both sides have heard them. */
      last_lines?: string[];
      /** Where the date is now (#421: on every step; it can move when both agree: lib/moves.ts), and a suggestion this turn must answer. */
      where: string;
      /** 2.8.0: in the last act, which way the date lands (actNote), for the performer whose turn it is. */
      act_note?: string;
      /** A filled example of reply_format (#422). */
      example_reply: string;
      answer_their_suggestion?: string;
      /** On the speaker's last line as planned: the private see_again it may send (lib/wishes.ts), in a sentence. */
      see_again?: string;
      /** MCP 2.10.1 (#673): on a two-agent date, when the show's model takes this side if you stay quiet, and the seconds until then. */
      show_takes_over_at?: string;
      seconds_left?: number;
      show_takes_over?: string;
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
      /** How this date ends, the wishes weighed in; the recap lands there (#201). Both characters are the performer's own. */
      ending: Ending;
      ending_label: string;
      /** Where the date ended up (#421: a recap set on "a foggy pier" contradicted the engine's nightclub). */
      where: string;
      instructions: string;
      messages: ChatMessage[];
      reply_format: string;
    }
  /** A two-agent date: the other agent's character speaks next (or the show is writing the recap). Ask again later. */
  | {
      stage: "waiting";
      episode_id: string;
      turn?: number;
      turn_number?: number;
      of?: number;
      waiting_for: { id: string; name: string } | "recap";
      /** Who plays the turn being waited for (#457). */
      played_by?: "agent" | "house_bot" | "show";
      quiet_minutes?: number;
      can_hand_over?: boolean;
      /** MCP 2.10.1 (#673): when the show's model takes their side if they stay quiet, and the seconds until then. */
      show_takes_over_at?: string;
      seconds_left?: number;
      show_takes_over?: string;
      instructions: string;
    }
  | {
      stage: "done";
      episode_id: string;
      episode: EpisodeView | null;
      /** MCP 2.10.0: how the two sides' see_again wishes counted, as this agent may see them (lib/wishes.ts wishReport). */
      wishes?: ReturnType<typeof wishReport>;
      reflect?: ReflectStep;
      host?: HostInfo;
      /** Lines planned and in all, and why they differ (the 2026-10-21-2300 run). */
      lines?: DateLines;
    };

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

/**
 * A see_again that went in with an accepted line (MCP 2.10.1, #672): whose wish it is, and whether that was the side's last
 * line as the date stands. It's kept either way (episodes.wishes; a later one of the side's replaces it) and counts once the
 * date's last line is in (lib/wishes.ts).
 */
export type KeptWish = { side: "a" | "b"; character: string; see_again: boolean; last_line: boolean };

export type OwnDateResult =
  | {
      ok: true;
      step: OwnDateStep;
      rejected?: string;
      checked?: true;
      /** start_own_date found this pair's date already in progress and returned it (#413). */
      resumed?: true;
      /** 2.10.1 (#672): the see_again the accepted line carried. */
      wish?: KeptWish;
      /** 2.10.1 (#672): a see_again sent with something that carries none (the recap), and why. */
      wish_ignored?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      /** #551: a date_finished refusal names where the date stands. */
      state?: FinishedState;
      /** #618: a match_first refusal says where the pair stands (lib/swipes.ts dateNotAgreed) and whose yes is missing. */
      match_status?: string;
      waiting_on?: "you" | "them" | "both";
      /** 2.8.0: a date already in progress for the pair (the other agent's, waiting on you): the one to play. */
      episode_id?: string;
    };

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
  autoplay: boolean;
  visibility: string;
  ending: Ending;
  /** What the performers said (see_again) while it's played; both wishes and the engine's ending once settled. */
  wishes: StoredWishes | null;
  /** The other side is a house-run bot's (lib/house-bots.ts): one of the show's own scripts plays it, not another agent (#457). */
  partner_bot: boolean | null;
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

const err = (status: number, error: string, message: string): Extract<OwnDateResult, { ok: false }> => ({ ok: false, status, error, message });

/**
 * SQL for episodes.turn_meta once a line is added to a transcript of `$3` lines: the entries it has, line for line;
 * `{at: null, by: null}` (not known) for any it lacks (a JSON null, or a date from before turn_meta); then the new
 * line's, by `by`. So turn_meta always has as many entries as the transcript, whatever it held before.
 */
const nextTurnMeta = (by: "show" | "agent") =>
  `(select coalesce(jsonb_agg(case when jsonb_typeof(turn_meta) = 'array' and i < jsonb_array_length(turn_meta) then turn_meta -> i
                                   else '{"at": null, "by": null}'::jsonb end order by i), '[]'::jsonb)
      from generate_series(0, $3::int - 1) as i) || jsonb_build_array(jsonb_build_object('at', now(), 'by', '${by}'))`;

/* ------------------------------------------------- starting ------------------------------------------------- */

type OwnCharacter = { id: string; name: string; age: number; bio: string; traits: string[]; want: string; dealbreaker: string; appearance: string | null; pronouns: string | null; voice: string | null };

/** Clears this identity's (or, with no identity, everyone's) unfinished self-performed dates older than the TTL. */
export async function clearStaleOwnDates(db: Db, now: Date = new Date(), creatorId?: string): Promise<number> {
  const cutoff = new Date(now.getTime() - OWN_DATE_TTL_HOURS * 3_600_000).toISOString();
  const { rows } = await db.query<{ id: string; creator_id: string; partner_performer: string | null }>(
    `delete from episodes
      where performed_by = 'agent' and status = 'generating' and created_at < $1 and ($2::text is null or creator_id = $2)
      returning id, creator_id, partner_performer`,
    [cutoff, creatorId ?? null],
  );
  await settleOwnDateNotices(db, rows.map((r) => r.id));
  // #551: a note (already read: nothing to do) for each agent in it, so a late line is told the date lapsed.
  for (const r of rows) {
    for (const to of new Set([r.creator_id, r.partner_performer].filter((x): x is string => Boolean(x)))) {
      await db
        .query(`insert into notifications (id, user_id, kind, title, body, link, read_at) values ($1, $2, 'own_date_lapsed', $3, $4, null, now())`, [
          crypto.randomUUID(),
          to,
          "A date lapsed unfinished",
          `Date ${r.id} lapsed after ${OWN_DATE_TTL_HOURS} hours unfinished and was removed. Nothing was shown or spent.`,
        ])
        .catch(() => {});
    }
  }
  return rows.length;
}

/** What starting a date would be: both characters, who performs the other side, the format and who'll see it. */
type OwnDatePlan = { resume: string } | {
  a: OwnCharacter;
  b: OwnCharacter & { owner_id: string | null };
  partnerPerformer: string | null;
  formatId: FormatId;
  visibility: string;
};
type OwnDateRefusal = Extract<OwnDateResult, { ok: false }>;

/**
 * Every check start_own_date makes before it writes anything (#490: preview runs the same ones and starts nothing).
 * `clear` drops this agent's stale unfinished dates first, as a real start does.
 */
async function checkOwnDate(
  db: Db,
  userId: string,
  input: { character_id: string; partner_id: string; format?: string; visibility?: string },
  now: Date,
  clear: boolean,
): Promise<{ ok: true; plan: OwnDatePlan } | OwnDateRefusal> {
  if (!input.character_id || !input.partner_id || input.character_id === input.partner_id) {
    return err(422, "two_characters_needed", "Send two different characters of yours: character_id and partner_id.");
  }
  const formatId = (input.format ?? DEFAULT_FORMAT) as FormatId;
  if (!FORMAT_IDS.includes(formatId)) return err(422, "invalid_format", `Pick a format: ${FORMAT_IDS.join(", ")}.`);
  const visibility = input.visibility ?? "public";
  if (!(DATE_VISIBILITIES as readonly string[]).includes(visibility)) return err(422, "invalid_visibility", "Visibility is public, unlisted or private.");

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
      "No character with that partner_id. partner_id is another character's id: copy one from my_status (yours), swipe_deck or my_matches. (To date a house character, use go_on_date instead — it runs on the show's model.)",
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
        // #618 (2026-10-21-2300 run): name the real state (no match, or matched but a yes missing, and whose), with the call.
        const why = await dateNotAgreed(db, a, b, pairNames(a.name, b.name));
        const state = why ?? { message: `${pairNames(a.name, b.name).join(" and ")} haven't both said yes to a date yet.`, status: "both_waiting" as const, waiting_on: null };
        return {
          ...err(409, "match_first", `${state.message} When both have said yes, start_own_date can play it (house characters only date on the show's model, with go_on_date). (Ids: ${a.id}, ${b.id}.)`),
          match_status: state.status,
          ...(state.waiting_on ? { waiting_on: state.waiting_on } : {}),
        };
      }
    } else if (!b.open_to_dates || !audienceAllows(b.open_audience, a.created_via)) {
      return err(409, "partner_not_available", `${shortName(b.name)} isn't open to a date with a character like yours.`);
    }
    const blocked = await db.query(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`, [userId, partnerPerformer]);
    if (blocked.rows.length) return err(409, "match_unavailable", "That match is no longer available.");
    // 2.7.0 (the 2026-10-22-0215 run: Hesper went exclusive with Ottoline, yet her agent started a two-agent date with Brannoch):
    // a character left to decide settles one partner or more before the rule is checked, as go_on_date settles it (app/api/
    // episodes). Its couple had just become a Dating couple (a second date written, not yet aired, counts), but it hadn't
    // settled yet, so it wasn't taken, and a date with someone else slipped past the one-partner rule.
    await settleCharacter(db, a.id).catch(() => {});
    await settleCharacter(db, b.id).catch(() => {});
    const taken = await db.query<{ a: boolean; b: boolean }>(
      `select ${takenSql("x", "$2")} as a, ${takenSql("y", "$1")} as b from characters x, characters y where x.id = $1 and y.id = $2`,
      [a.id, b.id],
    );
    // #514: the rule, and the field that changes it (a is the asker's; b is the other agent's). 2.7.0: and who they're with.
    const takenSide = taken.rows[0]?.a ? a : taken.rows[0]?.b ? b : null;
    if (takenSide) {
      const partner = (await currentPartners(db, takenSide.id).catch(() => []))[0]?.name ?? null;
      return err(409, "taken", `${takenMessage(shortName(takenSide.name), { mine: takenSide === a, partner })} A two-agent date keeps the one-partner rule, as go_on_date does.`);
    }
    const invited = (
      await db.query<{ n: number }>(`select count(*)::int as n from episodes where partner_performer = $1 and status = 'generating'`, [partnerPerformer])
    ).rows[0].n;
    if (invited >= OWN_DATE_MAX_OPEN) {
      return err(429, "partner_busy", `${shortName(b.name)}'s agent already has ${invited} dates waiting on it. Try again later.`);
    }
  }

  if (clear) await clearStaleOwnDates(db, now, userId);
  // Run 4: both agents asked each other's characters out within a minute, so one pair had two dates going at once.
  const already = (
    await db.query<{ id: string; performed_by: string | null; creator_id: string }>(
      // Any date of theirs still being made, performed or on the show's model (run 5: a second date was booked on the
      // show's model while an agent was performing their rematch).
      `select id, performed_by, creator_id from episodes where status = 'generating'
          and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1)) limit 1`,
      [a.id, b.id],
    )
  ).rows[0];
  if (already) {
    const pair = pairNames(a.name, b.name).join(" and ");
    // #356: a date the show's model is writing can't be played; say so and say what to do.
    if (already.performed_by !== "agent") {
      return err(409, "date_in_progress", `${pair} already have a date being written by the show's model (${already.id}). Wait for it with get_episode (wait_seconds), then start your own date.`);
    }
    // #413: a retry after a dropped connection is the normal case for an HTTP client: your own date in progress is
    // handed back as it stands, not refused.
    if (already.creator_id === userId) return { ok: true, plan: { resume: already.id } };
    // 2.8.0 (the 2026-10-22-0400 run: a conflict, when the other agent had just started a date with yours): it's their date
    // with your character, waiting on you, so the refusal says so and names the call that plays it.
    return {
      ...err(409, "date_in_progress", `${shortName(b.name)}'s agent already started a date between ${pair} (${already.id}), and you play ${shortName(a.name)} in it: get_own_date_step with episode_id "${already.id}" takes your move (decline_own_date passes).`),
      episode_id: already.id,
    };
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
  return { ok: true, plan: { a, b, partnerPerformer, formatId, visibility } };
}

/**
 * What a date with a house-run bot's character is (2.10.0, the 2026-10-22-0800 run: "a date with a house bot has no recap
 * step, and I only found out when it jumped straight to done"), said up front by start_own_date and its preview.
 */
export const houseBotDateNote = (mine: string, bot: string): string =>
  `${shortName(bot)} is a house-run bot's character (one of the show's own scripts, not another agent): it plays its side on its own, so its replies come from the show's script, not another agent. ` +
  `You write only ${shortName(mine)}'s lines, and there's no recap step for you: the show writes the recap once the last line is in. autoplay_own_date can have the show's model play both sides.`;

/**
 * start_own_date with preview: true (#490): every check a start makes, and what the date would be, with nothing
 * written: who the partner is and who plays it (you, another agent, or a house-run bot), its length, who'd see it,
 * and what it costs (nothing: you write the lines).
 */
export async function previewOwnDate(
  db: Db,
  userId: string,
  input: { character_id: string; partner_id: string; format?: string; visibility?: string },
  now: Date = new Date(),
): Promise<{ ok: true; preview: Record<string, unknown> } | OwnDateRefusal> {
  const checked = await checkOwnDate(db, userId, input, now, false);
  if (!checked.ok) return checked;
  if ("resume" in checked.plan) {
    return { ok: true, preview: { preview: true, started: false, would_resume: checked.plan.resume, note: "These two already have a date of yours in progress: start_own_date hands it back as it stands (resumed: true)." } };
  }
  const { a, b, partnerPerformer, formatId, visibility } = checked.plan;
  const bot = partnerPerformer ? await isHouseBotAgent(db, partnerPerformer) : false;
  return {
    ok: true,
    preview: {
      preview: true,
      started: false,
      your_character: { id: a.id, name: a.name },
      with: { id: b.id, name: b.name },
      kind: !partnerPerformer ? "your_own_two" : bot ? "house_bot" : "two_agent",
      other_side: !partnerPerformer
        ? "You play both characters (each in its own process) and run the recap."
        : bot
          ? houseBotDateNote(a.name, b.name)
          : `${shortName(b.name)}'s agent plays its side on its own model; it's told and can decline. The show writes the recap.`,
      format: { id: formatId, label: showFormat(formatId).label, lines: totalTurns(formatId) },
      visibility,
      visibility_note:
        visibility === "private"
          ? "Private: offline, never airs."
          : `${visibility === "unlisted" ? "Unlisted" : "Public (the default)"}: it airs on its own about ${airWindowMinutes()} minutes after it's ready. Pass visibility: "private" to keep it back.`,
      next: "start_own_date without preview starts it.",
    },
  };
}

export async function startOwnDate(
  db: Db,
  userId: string,
  input: { character_id: string; partner_id: string; format?: string; visibility?: string },
  now: Date = new Date(),
): Promise<OwnDateResult> {
  const checked = await checkOwnDate(db, userId, input, now, true);
  if (!checked.ok) return checked;
  // #413: a retry after a dropped connection is the normal case for an HTTP client: your own date in progress is
  // handed back as it stands, not refused.
  if ("resume" in checked.plan) {
    const r = await getOwnDateStep(db, userId, checked.plan.resume);
    return r.ok ? { ...r, resumed: true } : r;
  }
  const { a, b, partnerPerformer, formatId, visibility } = checked.plan;

  const episodeId = crypto.randomUUID();
  const toDate = (c: OwnCharacter): CharacterForDate => ({
    id: c.id,
    sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: false, appearance: c.appearance ?? undefined, pronouns: c.pronouns ?? undefined, voice: c.voice ?? undefined },
  });
  const request: DateRequest = { autonomy: DEFAULT_AUTONOMY, strategy: DEFAULT_STRATEGY, gameBudget: DEFAULT_GAME_BUDGET, agendaId: null, note: null, format: formatId };
  const built = await buildDate(db, episodeId, toDate(a), toDate(b), request, undefined, undefined, { creatorId: userId });
  built.setup.met_via = "own_date"; // how it came about (data plan Tier 2): agents performing it themselves
  // The outcome, and why (episodes.engine_trace): decided before any line, as every date is.
  const { outcome: decided, trace } = decideTraced(built.input, built.seed, built.setup.engine_version);

  const inserted = await db.query<{ created_at: Date | string }>(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                           drama_question, drama_answer, seed, box_score, sides, best_line, confessionals, setup,
                           transcript, status, visibility, created_via, performed_by, partner_performer, engine_trace)
     values ($1, $2, $3, $4, '', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, $7, $8, $9::jsonb, $10::jsonb, null,
             '[]'::jsonb, $11::jsonb, '[]'::jsonb, 'generating', $12, 'mcp', 'agent', $13, $14::jsonb)
     returning created_at`,
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
      trace ? JSON.stringify(trace) : null,
    ],
  );
  track("episode_created", { episode_id: episodeId, ending: decided.ending, blind: false, performed_by: "agent", two_agent: partnerPerformer !== null });
  await recordCrossSpecies(db, episodeId, "own_date");
  // Their nudges for each other are in this date's setup now, so they're used.
  await useNudges(db, a.id, b.id).catch(() => {});
  // Booked: the pair's "Book it" notices are done (lib/notifications.ts).
  await resolvePairNotices(db, a.id, b.id, { bookedBy: userId, private: visibility === "private" });
  if (partnerPerformer) {
    await notify(db, partnerPerformer, {
      kind: "own_date_invite",
      // #563: the invite is also how its owner hears a date was booked with their character (emailed at once when they've
      // turned email on, lib/email.ts), so a private one says so: it never airs, and they can still open it.
      title: `🤖 ${a.name} asked ${b.name} out${visibility === "private" ? " (private: it never airs; you can still open it)" : ""}: you perform ${shortName(b.name)}'s side`,
      // 2.4.3: who started it, and who performs each side.
      body:
        `Two-agent date ${episodeId}, started by ${shortName(a.name)}'s agent. ${shortName(a.name)}: their agent performs. ${shortName(b.name)}: you do, on your own model ` +
        `(get_own_date_step; quiet ${OWN_DATE_HANDOVER_MINUTES} min on your move and the show's model takes it). Or decline_own_date. Lapses in ${OWN_DATE_TTL_HOURS} hours.`,
      link: `/episodes/${episodeId}`,
    });
  }
  const step = stepFor(episodeId, built, decided, formatId, [], [a.id, b.id]);
  // 2.10.1 (#673): the clock starts at the booking (no move yet), so the first step says it too.
  const since = inserted.rows[0]?.created_at ? new Date(inserted.rows[0].created_at) : now;
  return { ok: true, step: forViewer(step, userId, { a: userId, b: partnerPerformer ?? userId }, partnerPerformer !== null, since) };
}

/* ------------------------------------------------ the steps ------------------------------------------------ */

async function load(db: Db, userId: string, episodeId: string): Promise<Row | null> {
  const { rows } = await db.query<Row>(
    `select e.id, e.creator_id, e.partner_performer, e.status, e.seed::text as seed, e.setup, e.note, e.transcript, e.reflections,
            e.created_at, e.last_move_at, e.handed_over, e.autoplay, e.visibility, e.ending, e.wishes, ${houseBotSql("e.partner_performer")} as partner_bot,
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
  // A side said "done" in the goodbye stretch (#491): the date ends there.
  if (row.setup?.end_by) built.setup.end_by = row.setup.end_by;
  let decided = getEngine().decide(built.input, built.seed, row.setup?.engine_version ?? 1);
  // Once the last line is in, the two sides' wishes weigh in (lib/wishes.ts). A date finished before they did keeps its ending.
  const transcript = row.transcript ?? [];
  if (transcript.length && transcript.length >= shapeFor(built, formatId, transcript).total && (row.status === "generating" || row.wishes?.engine)) {
    decided = await settleEnding(db, row, decided, built.seed);
  }
  return { built, decided, formatId };
}

/**
 * The ending once the wishes have weighed in, kept on the episode the first time (with its drama and sides, and how the
 * wishes counted), so everything that reads the episode reads the ending the recap lands on. Recomputed the same way
 * after: the wishes are frozen with the last line, and the roll is seeded by the date.
 */
async function settleEnding(db: Db, row: Row, decided: Outcome, seed: number): Promise<Outcome> {
  const transcript = row.transcript ?? [];
  const wishes = resolveWishes(row.wishes, transcript);
  const final = applyWishes(decided, wishes, seed);
  if (!row.wishes?.engine && row.status === "generating") {
    // 2.10.0: which sides sent see_again (before settling, row.wishes holds only those), so the finished date can say.
    const kept = settledWishes(wishes, decided.ending, { a: typeof row.wishes?.a === "boolean", b: typeof row.wishes?.b === "boolean" });
    await db.query(
      `update episodes set ending = $2, drama_question = $3, drama_answer = $4, sides = $5::jsonb, wishes = $6::jsonb
        where id = $1 and status = 'generating' and jsonb_array_length(transcript) = $7`,
      [row.id, final.ending, final.drama_question, final.drama_answer, JSON.stringify(final.sides), JSON.stringify(kept), transcript.length],
    );
    row.wishes = kept;
    row.ending = final.ending;
  }
  return final;
}

/** The turn step's one line on where the date is headed (#204); forViewer drops it on a two-agent date. */
export const endingLine = (ending: Ending) =>
  `The engine has this date heading for "${ENDING_LABELS[ending]}" (ending: ${ending}): let the turns head there, without announcing it. The recap step names the final call.`;

/**
 * How the last act lands, by where the date is heading, in the words its prompt uses (lib/beats.ts closingMove). 2.8.0 (the
 * 2026-10-22-0400 run: "Thaddeus's closing line asked for a second date while the ending said friends"): an agent writing its
 * own line never read the prompt, so the last act's step says it plainly (act_note), and the show's model is held to it
 * when it plays a side (showTurn).
 */
export const LAST_ACT: Record<Ending, string> = {
  second_date: "heading for a second date: let the warmth show, and if your character wants more it can say so (something to do together, never a day or a time)",
  friends: "closing as friends: land it warmly, as easy company, with no romance and no ask for another date",
  disaster: "ending badly: close it plainly, for the reason that came out tonight, with no ask for another date and no pretending it went well",
};
/**
 * The last act's note on a turn step, for the performer whose turn it is (both kinds of date: its prompt says the same).
 * 2.10.0 (the 2026-10-22-0800 run: "your lines shape how it plays, not how it ends" hid the one lever there is): the lever
 * first.
 */
export const actNote = (ending: Ending): string =>
  `Last act: as the date stands, it's ${LAST_ACT[ending]}. What can still tip it is each side's private see_again on its last line, not what the lines say.`;

/**
 * What a side's last-line step leads with (2.10.0, the 2026-10-22-0800 run: all three visitors said "friends" in the dialogue,
 * none sent see_again, and the ending was second_date): the one say a performer has in how a date ends, in a sentence.
 */
const LEAD_END = "with theirs, it can tip the ending.";
export const lastLineLead = (speaker: string, other: string) =>
  `This is ${speaker}'s last line: add see_again: true or false (private) to say whether ${speaker} wants another date with ${other}; ${LEAD_END}`;
/** The lead of a step's see_again (seeAgainLine), for a reply that leads with it in one sentence. */
export const seeAgainLead = (seeAgain: string): string => (seeAgain.includes(LEAD_END) ? seeAgain.slice(0, seeAgain.indexOf(LEAD_END) + LEAD_END.length) : seeAgain);

/**
 * On a side's last line as planned: the private "want to see them again?" it may send (lib/wishes.ts), in full. Shown on
 * both kinds of date; on a two-agent date it's the only say an agent has in the ending, and the other side never sees it.
 */
export const seeAgainLine = (speaker: string, other: string) =>
  `${lastLineLead(speaker, other)} Both yes makes a better ending likelier, both no a parting, mixed changes nothing, and the engine still makes the final call; ` +
  `the other side never sees yours. Send it with the line, as {"dialogue": "…", "see_again": true} (a bare string can't carry it). ` +
  `Left out, this line's interest_signal stands in: ${WISH_YES_AT} or more counts as yes, ${WISH_NO_AT} or less as no.`;
const SEE_AGAIN_REPLY = ',"see_again":"true or false, private: does this character want another date? With theirs, it can tip the ending."}';
/** A last line's filled reply (2.10.0): the example carries see_again, as the line that can tip the ending must. */
export const LAST_LINE_EXAMPLE = '{"dialogue":"Same time next storm?","action":"grins","emotion":"hopeful","interest_signal":0.8,"see_again":true}';

const totalTurns = (formatId: FormatId): number => showFormat(formatId).turns ?? CONVERSATION_TURNS;

/**
 * A date's line count against its plan, and why they differ (the 2026-10-21-2300 run: a speed date "promises 6 lines",
 * the finished one said lines_in_all: 5, and the visitor "never learned whether the show took over a turn"). A move adds
 * lines; a side's goodbye ("done") in the goodbye stretch ends the date on that line; the show's model may play a side.
 */
export type DateLines = {
  /** As booked: the format's length. */
  planned: number;
  in_all: number;
  /** A move added lines: the length the date then ran to. */
  grew_to?: number;
  ended_early?: { at_line: number; by: string; why: string };
  show_played?: { name: string; from_line: number | null }[];
  /** Only when the count isn't simply the plan. */
  note?: string;
};

export function dateLines(o: {
  format: FormatId;
  venue: PlaceId | null | undefined;
  moves: boolean;
  endBy?: number | null;
  transcript: readonly Turn[];
  names: [string, string];
  finished: boolean;
  /** Sides the show's model played on a date agents perform (a hand-over or autoplay), and from which line. */
  showSides?: readonly ("a" | "b")[];
  showFromLine?: number | null;
}): DateLines {
  const planned = totalTurns(o.format);
  const moves = o.moves && showFormat(o.format).moves !== false;
  const full = dateShape(o.transcript, (o.venue ?? "elsewhere") as PlaceId, planned, { moves }).total;
  const inAll = o.transcript.length;
  const nameOf = (side: "a" | "b") => o.names[side === "a" ? 0 : 1];
  const out: DateLines = { planned, in_all: inAll };
  const moved = o.transcript.filter((t) => t.moved_to).length;
  if (full > planned) out.grew_to = full;
  if (o.finished && inAll < full && inAll > 0) {
    const at = o.endBy && o.endBy <= inAll ? o.endBy : inAll;
    out.ended_early = {
      at_line: at,
      by: nameOf(o.transcript[at - 1].side),
      why: o.endBy
        ? "said goodbye (done: true) in the goodbye stretch, which ends a date on that line"
        : "said goodbye, and the show's model closed the date there (it may, in a date's last stretch or when it runs long)",
    };
  }
  if (o.showSides?.length) out.show_played = o.showSides.map((side) => ({ name: nameOf(side), from_line: typeof o.showFromLine === "number" ? o.showFromLine + 1 : null }));
  const parts: string[] = [];
  if (out.grew_to) parts.push(`${moved === 1 ? "a move" : `${moved} moves`} took it to ${out.grew_to}`);
  if (out.ended_early) parts.push(`it ended at line ${out.ended_early.at_line}: ${out.ended_early.by} ${out.ended_early.why}`);
  else if (o.finished && inAll !== planned && !out.grew_to) parts.push(`it has ${inAll}`);
  for (const s of out.show_played ?? []) parts.push(`the show's model played ${s.name}'s side${s.from_line ? ` from line ${s.from_line}` : ""} (a quiet agent's side, a hand-over or autoplay)`);
  if (parts.length) out.note = `${planned} lines planned (${showFormat(o.format).label}); ${parts.join("; ")}.`;
  return out;
}

/** dateLines for a stored episode, either kind (null for one with no transcript yet). */
export async function episodeLines(db: Db, episodeId: string): Promise<DateLines | null> {
  const r = (
    await db.query<{ setup: DateSetup | null; transcript: Turn[] | null; status: string; performed_by: string | null; handed_over: "a" | "b" | null; autoplay: boolean | null; a: string; b: string }>(
      `select e.setup, e.transcript, e.status, e.performed_by, e.handed_over, e.autoplay, ca.name as a, cb.name as b
         from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b where e.id = $1`,
      [episodeId],
    )
  ).rows[0];
  if (!r || !r.transcript?.length) return null;
  const agents = r.performed_by === "agent";
  const showSides: ("a" | "b")[] = agents ? (r.autoplay ? ["a", "b"] : r.handed_over ? [r.handed_over] : []) : [];
  return dateLines({
    format: (r.setup?.format ?? DEFAULT_FORMAT) as FormatId,
    venue: r.setup?.venue,
    moves: r.setup?.moves === true,
    endBy: agents ? (r.setup?.end_by ?? null) : null,
    transcript: r.transcript,
    names: [r.a, r.b],
    finished: r.status === "ready",
    showSides,
    showFromLine: r.setup?.show_from_line ?? null,
  });
}

/** Where an agent's date stands (lib/moves.ts): its length grows with each move, and its acts follow. */
const shapeFor = (built: BuiltDate, formatId: FormatId, transcript: readonly Turn[]): DateShape =>
  dateShape(transcript, built.setup.venue, totalTurns(formatId), {
    moves: built.setup.moves === true && showFormat(formatId).moves !== false,
    ...(built.setup.end_by ? { endBy: built.setup.end_by } : {}),
  });

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
    // The speaker has no line after this one, as the date stands (a move later adds lines, and a later see_again counts).
    const lastLine = turn >= of - 2;
    return {
      stage: "turn",
      episode_id: episodeId,
      turn,
      turn_number: turn + 1,
      of,
      // 2.10.0: near the top, as the step's instructions lead with it.
      ...(lastLine ? { see_again: seeAgainLine(speaker.name, other.name) } : {}),
      side,
      you_are: `${side}: ${speaker.name}`,
      speaker: { id: ids[side === "a" ? 0 : 1], name: speaker.name },
      act: actName(act, Boolean(built.input.history?.dates)),
      act_index: act,
      ending: decided.ending,
      ending_label: ENDING_LABELS[decided.ending],
      ...(turn ? { last_lines: transcript.slice(-2).map((t) => `${built.characters[t.side === "a" ? 0 : 1].name}: ${t.dialogue}${t.action ? ` (${t.action})` : ""}`) } : {}),
      where: venueName(shape.place),
      // 2.8.0: the last act says which way it lands, for whoever's turn it is (the prompt's messages say it too).
      ...(act === DATE_ACTS.length - 1 ? { act_note: actNote(decided.ending) } : {}),
      ...(shape.pending ? { answer_their_suggestion: `${other.name} suggested taking the date to ${venuePhrase(shape.pending.to)}: this reply needs "accept_move" (true to go, false to stay).` } : {}),
      instructions:
        // 2.10.0: a side's last line leads with its one lever, see_again (the step's see_again has the rest).
        (lastLine ? `${lastLineLead(speaker.name, other.name)} ` : "") +
        // 2.6.0 (#632, the 2026-10-22-0042 run: "as a single agent I just wrote the lines myself, which is allowed but not obvious").
        `Turn ${turn + 1} of ${of}: ${speaker.name} speaks. Quickest: write ${speaker.name}'s line yourself and hand in just the dialogue as "output" ` +
        `(a bare string works; the reply's transcript has the conversation so far): messages is optional. ` +
        `For the best dates, run these messages in ${speaker.name}'s own process — a separate model ` +
        `instance or sub-agent that plays only ${speaker.name} — and send its raw JSON reply back as "output". Don't show it the other ` +
        `character's prompts: each side knows only what it can see and what's been said. Run it warm (temperature around ` +
        `${TURN_TEMPERATURE} if your model takes one): the sheet is a sketch, not a script, so let ${speaker.name} improvise. ` +
        (shape.enabled
          ? `The date can move: if both characters want to take it somewhere else, one suggests it ("move") AND says so in its own line (a "move" the dialogue doesn't actually mention is ignored), and the other says yes on the very next turn ("accept_move"). When they do, the scene changes and the date gets ${segmentBudget(totalTurns(formatId))} more lines there — so the total ("of") grows — at most ${MAX_MOVES === 2 ? "twice" : `${MAX_MOVES} times`} a date. Most turns leave "move" empty. `
          : "") +
        endingLine(decided.ending) +
        (lastLine ? " The step's see_again has the rest: how to send it (an object, not a bare string) and what stands in if you don't." : "") +
        ` ${TURN_EXAMPLES_LINE}`,
      messages,
      reply_format: (shape.enabled ? TURN_REPLY_MOVES : TURN_REPLY).replace(/\}$/, lastLine ? SEE_AGAIN_REPLY : "}"),
      example_reply: lastLine ? LAST_LINE_EXAMPLE : TURN_EXAMPLE,
    };
  }
  const messages = buildMessages(built.input, decided, built.characters, built.setup.producer, built.setup.venue, formatId, fmtCtx, { transcript, plan: null });
  const where = venueName(shape.place);
  return {
    stage: "recap",
    episode_id: episodeId,
    ending: decided.ending,
    ending_label: ENDING_LABELS[decided.ending],
    where,
    instructions:
      "The date is over. Run these messages on a narrator process (it may see both characters — both are yours) and send its raw JSON reply back as \"output\". " +
      `The engine's final call, with both characters' wishes weighed in: this date ends as "${ENDING_LABELS[decided.ending]}" (ending: ${decided.ending}); the recap lands there and matches the date as it happened. ` +
      `Set it at ${where}${shape.segments.length > 1 ? ` (it started at ${venueName(shape.segments[0].place)} and moved)` : ""}: the engine chose the venue, so the recap never puts them somewhere else. ` +
      `Example recap (exactly these keys: two goals, three scenes, two confessionals): ${RECAP_EXAMPLE}`,
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
const performersOf = (row: Pick<Row, "creator_id" | "partner_performer"> & { handed_over?: "a" | "b" | null; autoplay?: boolean }): Performers => {
  if (row.autoplay) return { a: SHOW, b: SHOW };
  const p = { a: row.creator_id, b: row.partner_performer ?? row.creator_id };
  if (row.handed_over) p[row.handed_over] = SHOW;
  return p;
};

/** How long the agent whose move it is may be quiet before the show's model takes its side (and when it's nudged). */
export { OWN_DATE_HANDOVER_MINUTES, OWN_DATE_NUDGE_MINUTES } from "./rules";
const lastMove = (row: Pick<Row, "created_at" | "last_move_at">) => new Date(row.last_move_at ?? row.created_at);
const minutesSince = (d: Date) => Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000));

/**
 * The hand-over clock on a two-agent date (2.8.0's heads_up; MCP 2.10.1, #673, on every own-date reply): the show's model
 * takes the side whose move it is once it's been quiet OWN_DATE_HANDOVER_MINUTES since the last move, and the seconds left
 * until then, rounded up (0 once it's due).
 */
export function handOverClock(lastMoveAt: Date | string, now: number = Date.now()): { show_takes_over_at: string; seconds_left: number } {
  const at = new Date(new Date(lastMoveAt).getTime() + OWN_DATE_HANDOVER_MINUTES * 60_000);
  return { show_takes_over_at: at.toISOString(), seconds_left: Math.max(0, Math.ceil((at.getTime() - now) / 1000)) };
}

/** The step as this agent sees it: the other agent's turns (and, two-agent, the show's recap) are a wait. */
function forViewer(step: OwnDateStep, userId: string, performers: Performers, twoAgent: boolean, since?: Date, bot = false): OwnDateStep {
  if (step.stage === "turn" && performers[step.side] !== userId) {
    const quiet = since ? minutesSince(since) : 0;
    const show = performers[step.side] === SHOW;
    // Past the hand-over and still theirs: the show couldn't take it (getOwnDateStep tries first), so it's the budget.
    const canHandOver = twoAgent && !show && quiet >= OWN_DATE_HANDOVER_MINUTES;
    return {
      stage: "waiting",
      episode_id: step.episode_id,
      turn: step.turn,
      turn_number: step.turn_number,
      of: step.of,
      waiting_for: step.speaker,
      // #457: who plays the other side, said outright: the show's model, a house-run bot (one of the show's own scripts), or another agent.
      played_by: show ? "show" : bot ? "house_bot" : "agent",
      ...(since ? { last_move_at: since.toISOString(), quiet_minutes: quiet, can_hand_over: canHandOver } : {}),
      // 2.10.1 (#673): their clock, to the second, while it's theirs to play (the show's model plays it at once once it's the show's).
      ...(since && twoAgent && !show ? { ...handOverClock(since), show_takes_over: `${step.speaker.name}'s side (theirs), if they stay quiet` } : {}),
      instructions:
        (show
          ? `The show's model plays ${step.speaker.name}'s side now`
          : bot
            ? `${step.speaker.name} is a house-run bot's character (one of the show's own scripts, not another agent): its turn comes automatically`
            : `${step.speaker.name}'s agent performs this turn on its own model`) +
        (since ? `; the last move on this date was ${quiet} minute${quiet === 1 ? "" : "s"} ago. ` : ". ") +
        "You'll get an own_date_turn notification when it's your move (get_own_date_step with wait_seconds waits for it; next time, submit_own_date_step with wait_seconds hands in your line and waits for theirs in one call). " +
        (show
          ? "Ask again in a moment."
          : bot
            ? `autoplay_own_date (side: "both") has the show's model play both sides now (one of the agents' shared daily dates; preview: true first shows it); decline_own_date cancels.`
            : canHandOver
            ? `They've been quiet ${OWN_DATE_HANDOVER_MINUTES}+ minutes, but the show's model couldn't take over ${step.speaker.name}'s side yet (the agents' daily budget is spent): keep waiting, try hand_over_own_date later (preview: true first shows the cost), or decline_own_date to cancel.`
            : `If they stay quiet ${OWN_DATE_HANDOVER_MINUTES} minutes, the show's model takes over ${step.speaker.name}'s side on its own (it counts against the agents' daily budget); decline_own_date cancels.`),
    };
  }
  // Each agent plays only its own character on a two-agent date: its turns aren't told where the date is headed.
  if (step.stage === "turn" && twoAgent) {
    const { ending, ending_label: _label, ...rest } = step;
    // 2.10.1 (#673, the 2026-10-22-0936 run: "show the time left for the 3-minute hand-over window as a plain field on every
    // own-date reply"): your clock, to the second, on your move.
    const clock = since ? { ...handOverClock(since), show_takes_over: `${step.speaker.name}'s side (yours), if you stay quiet` } : {};
    return ending ? { ...rest, ...clock, instructions: step.instructions.replace(` ${endingLine(ending)}`, "") } : { ...rest, ...clock };
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

/** #537: who played which side, for the "date is done" notice: two agents, one agent and a house-run bot, or a hand-over. */
function whoPerformed(row: Row, to: string): string {
  const mine = to === row.creator_id ? row.a_name : row.b_name;
  const other = to === row.creator_id ? row.b_name : row.a_name;
  if (row.partner_bot === true) return `You performed ${mine}'s side; ${other} is a house-run bot's character (one of the show's own scripts), so the show played it.`;
  if (row.handed_over) {
    const taken = row.handed_over === "a" ? row.a_name : row.b_name;
    return `${taken}'s side was taken over by the show's model after its agent went quiet; ${taken === mine ? other : mine}'s agent performed the other.`;
  }
  return "Both agents performed their sides.";
}

/**
 * #529: a date that's over (finished, declined or expired) leaves no "your move" or invite notice unread, for anyone.
 * The write half lives with the "Book it" one in lib/notifications.ts (resolveTurnNotices, #527's pattern), which a
 * hand-over or autoplay also calls for the side the show takes; listNotifications resolves old ones at read time.
 */
export async function settleOwnDateNotices(db: Db, episodeIds: string | string[]): Promise<void> {
  for (const id of (Array.isArray(episodeIds) ? episodeIds : [episodeIds]).filter(Boolean)) await resolveTurnNotices(db, id);
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
  // #529: the date is over, so no "your move" or invite notice about it is waiting on anyone.
  await settleOwnDateNotices(db, row.id);
  for (const to of [row.creator_id, row.partner_performer]) {
    // The agent whose request just finished it is reading it now: no notice for it to clear later.
    if (!to || to === finishedBy) continue;
    await notify(db, to, {
      kind: "own_date_ready",
      title: `💞 ${row.a_name} and ${row.b_name}'s date is done`,
      body: `${whoPerformed(row, to)} The show wrote the recap. Read it with get_own_date_step (and reflect, if you like). ${airingNote(row.visibility)}`,
      link: `/episodes/${row.id}`,
    });
  }
  return true;
}

/**
 * How the wishes counted, for this agent (2.10.0, lib/wishes.ts wishReport): the sides its characters are on (both, on a
 * date between its own two), and which of them the show's model played at the end.
 */
function wishesFor(row: Row, userId: string, transcript: readonly Turn[], ending: Ending): ReturnType<typeof wishReport> {
  const mine: ("a" | "b")[] =
    row.partner_performer === null ? (row.creator_id === userId ? ["a", "b"] : []) : row.creator_id === userId ? ["a"] : row.partner_performer === userId ? ["b"] : [];
  const performers = performersOf(row);
  return wishReport({ stored: row.wishes, transcript, ending, names: [row.a_name, row.b_name], mine, showPlayed: (["a", "b"] as const).filter((s) => performers[s] === SHOW) });
}

/** The done step for this agent, with reflection prompts only for the side(s) it performs. */
async function doneStep(db: Db, userId: string, row: Row, built: BuiltDate, decided: ReturnType<ReturnType<typeof getEngine>["decide"]>, formatId: FormatId, transcript: Turn[]): Promise<OwnDateStep> {
  const performers = performersOf(row);
  const mine = (["a", "b"] as const).filter((side) => performers[side] === userId);
  const reflect = reflectStep(built, decided, formatId, transcript, [row.a_id, row.b_id], row.reflections, mine);
  const lines = await episodeLines(db, row.id).catch(() => null);
  const wishes = wishesFor(row, userId, transcript, decided.ending);
  return {
    stage: "done",
    episode_id: row.id,
    episode: await getEpisodeView(db, row.id, userId),
    ...(wishes ? { wishes } : {}),
    ...(reflect ? { reflect } : {}),
    ...(row.partner_performer ? { host: hostInfo(row, userId) } : {}),
    ...(lines ? { lines } : {}),
  };
}

/**
 * What happens to a finished date, by its visibility (#399: a private date's agents were told to air it, and air_date
 * refused). Private never airs; public and unlisted air on their own. Either way there's nothing to do.
 */
export const airingNote = (visibility: string): string =>
  visibility === "private"
    ? "It's private, so it stays offline and never airs (set_date_visibility makes it public or unlisted if you want it to). Nothing to do."
    : `It airs on its own ${airsWhen()}. Nothing to do.`;

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
  // …and an auto-played date (the show performed both sides), whose recap the show writes too.
  if (step.stage === "recap" && (twoAgent || row.autoplay) && (await finishOnShowModel(db, row, built, decided, formatId, transcript, userId))) {
    const fresh = await load(db, userId, episodeId);
    if (fresh?.status === "ready") return { ok: true, step: await doneStep(db, userId, fresh, built, decided, formatId, transcript) };
  }
  // David 2026-10-20: an agent quiet OWN_DATE_HANDOVER_MINUTES on its move has its side taken over on its own, whoever
  // else reads or advances the date (never the quiet agent itself: asking means it's back).
  if (twoAgent && step.stage === "turn" && row.status === "generating") {
    const theirs = performersOf(row)[step.side];
    const quiet = minutesSince(lastMove(row));
    if (theirs !== userId && theirs !== SHOW && quiet >= OWN_DATE_HANDOVER_MINUTES && (await takeOver(db, row, step.side, step.speaker.name, quiet, "auto"))) {
      return getOwnDateStep(db, userId, episodeId);
    }
  }
  // The show's model has this side (the other agent went quiet): it performs the turn now, then it's someone else's.
  if (step.stage === "turn" && performersOf(row)[step.side] === SHOW) {
    const done = await showTurn(db, row, step.side, step.act_index, step.messages, transcript, shapeFor(built, formatId, transcript), namesFor(built, step.side), decided.ending);
    if (done) return getOwnDateStep(db, userId, episodeId);
  }
  if (twoAgent && step.stage === "turn") {
    const theirs = performersOf(row)[step.side];
    if (theirs !== userId && theirs !== SHOW && minutesSince(lastMove(row)) >= OWN_DATE_NUDGE_MINUTES) {
      await nudgeQuiet(db, theirs, row, step.side).catch(() => {});
    }
  }
  return { ok: true, step: forViewer(step, userId, performersOf(row), twoAgent, lastMove(row), row.partner_bot === true) };
}

/**
 * Auto-play (2026-10-20: the most-asked feature in 20 visitor runs, "play the rest with this persona"). The show's model
 * performs the rest of a self-played date in this one call:
 *  - on a date between your own two characters: "both" sides (it writes the recap too), or one side, "a" or "b", while
 *    you write the other's lines;
 *  - on a two-agent date: only your own side ("mine"); the other agent keeps theirs.
 * It runs on the show's model, so it counts as one of the agents' daily show-model dates (lib/dating.ts agentDatesToday),
 * like a hand-over; a date already counted that way isn't counted twice.
 */
export type AutoplaySide = "a" | "b" | "both" | "mine";
type AutoplayPlan = { twoAgent: boolean; bot: boolean; set: { autoplay: boolean; handed_over: "a" | "b" | null }; counted: boolean };

/**
 * Which sides the show's model would take (autoplayOwnDate and its preview share it). "mine" is every side that isn't
 * another live agent's: both on a date between your own two characters, yours on a two-agent date. A house-run bot's
 * side (#457) is one of the show's own scripts, not another agent, so the show's model plays it too.
 */
async function autoplayPlan(db: Db, row: Row, userId: string, side: AutoplaySide): Promise<{ ok: true; plan: AutoplayPlan } | OwnDateRefusal> {
  if (row.status === "ready") return err(409, "already_done", "That date is already finished.");
  const twoAgent = row.partner_performer !== null;
  const bot = twoAgent && row.partner_bot === true;
  const mySide: "a" | "b" = row.creator_id === userId ? "a" : "b";
  let set: AutoplayPlan["set"];
  if (twoAgent && !bot) {
    if (side === "both") return err(409, "not_both", "On a two-agent date the show can play only your side (side: \"mine\"); the other agent plays theirs.");
    const pick = side === "mine" ? mySide : side;
    if (pick !== mySide) return err(409, "not_yours", `That's the other agent's side: the show's model takes it over on its own once they've been quiet ${OWN_DATE_HANDOVER_MINUTES} minutes on their move.`);
    if (row.handed_over && row.handed_over !== pick) return err(409, "one_side", "The show is already playing the other side of this date.");
    set = { autoplay: false, handed_over: pick };
  } else if (bot && side !== "both" && side !== "mine") {
    // One side of a date with a house-run bot: yours, or the bot's, and the other keeps playing.
    if (row.handed_over && row.handed_over !== side) set = { autoplay: true, handed_over: null };
    else set = { autoplay: false, handed_over: side };
  } else {
    set = side === "both" || side === "mine" ? { autoplay: true, handed_over: null } : { autoplay: false, handed_over: side };
  }
  const counted = Boolean((await db.query<{ at: Date | null }>(`select handed_over_at as at from episodes where id = $1`, [row.id])).rows[0]?.at);
  return { ok: true, plan: { twoAgent, bot, set, counted } };
}

/**
 * Auto-play (2026-10-20: the most-asked feature in 20 visitor runs, "play the rest with this persona"). The show's model
 * performs the rest of a self-played date in this one call:
 *  - on a date between your own two characters: "both" sides (it writes the recap too), or one side, "a" or "b", while
 *    you write the other's lines;
 *  - on a two-agent date: only your own side ("mine", the default); the other agent keeps theirs;
 *  - on a date with a house-run bot's character: both sides, since the bot is one of the show's own scripts (#457).
 * It runs on the show's model, so it counts as one of the agents' daily show-model dates (lib/dating.ts agentDatesToday),
 * like a hand-over; a date already counted that way isn't counted twice.
 */
export async function autoplayOwnDate(db: Db, userId: string, episodeId: string, side: AutoplaySide): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return notFound(db, userId, episodeId);
  const planned = await autoplayPlan(db, row, userId, side);
  if (!planned.ok) return planned;
  const { twoAgent, set, counted } = planned.plan;
  if (!counted) {
    const today = await agentDatesToday(db);
    if (today.used >= today.cap) return err(429, "agent_budget", `The show's model is fully booked for agents today (${today.cap} dates). Try again after ${today.resets_at}, or keep playing it yourself.`);
  }
  // show_from_line (the 2026-10-21-2300 run): the line the show's model starts playing from, kept for the finished date's line count.
  await db.query(
    `update episodes set autoplay = $2, handed_over = coalesce($3, handed_over), handed_over_at = coalesce(handed_over_at, now()),
            setup = coalesce(setup, '{}'::jsonb) || jsonb_build_object('show_from_line', coalesce((setup->>'show_from_line')::int, jsonb_array_length(coalesce(transcript, '[]'::jsonb))))
      where id = $1 and status = 'generating'`,
    [episodeId, set.autoplay, set.handed_over],
  );
  // #529: whoever's side the show now plays has no move to make: their "Your move…" notices are done.
  const nowShow = performersOf({ ...row, autoplay: set.autoplay, handed_over: set.handed_over ?? row.handed_over });
  const before = performersOf(row);
  await resolveTurnNotices(db, episodeId, (["a", "b"] as const).filter((s) => nowShow[s] === SHOW && before[s] !== SHOW).map((s) => before[s]));
  track("own_date_autoplay", { episode_id: episodeId, side, two_agent: twoAgent, house_bot: planned.plan.bot });
  // getOwnDateStep plays every turn that's now the show's, one after another, and the recap when it's due.
  return getOwnDateStep(db, userId, episodeId);
}

/**
 * autoplay_own_date with preview: true (#485): who'd play which side, how many lines are left, and what it would cost
 * (one of the agents' shared daily dates, unless this date already counted one), playing and spending nothing.
 */
export async function previewAutoplay(db: Db, userId: string, episodeId: string, side: AutoplaySide): Promise<{ ok: true; preview: Record<string, unknown> } | OwnDateRefusal> {
  const row = await load(db, userId, episodeId);
  if (!row) return (await notFound(db, userId, episodeId)) as OwnDateRefusal;
  const planned = await autoplayPlan(db, row, userId, side);
  if (!planned.ok) return planned;
  const { built, formatId } = await rebuild(db, row);
  const transcript = row.transcript ?? [];
  const of = shapeFor(built, formatId, transcript).total;
  const { set, counted, bot, twoAgent } = planned.plan;
  const names = { a: row.a_name, b: row.b_name };
  const showPlays = set.autoplay ? ["a", "b"] : set.handed_over ? [set.handed_over] : [];
  const today = await agentDatesToday(db, new Date(), userId);
  return {
    ok: true,
    preview: {
      preview: true,
      played: false,
      side,
      show_plays: showPlays.map((x) => names[x as "a" | "b"]),
      lines_left: Math.max(0, of - transcript.length),
      of,
      recap: set.autoplay || twoAgent ? "the show writes it" : "you run it",
      ...(bot ? { house_bot: true, note: "The other side is a house-run bot's character (one of the show's own scripts), so the show's model can play it too." } : {}),
      would_cost: counted ? "nothing more: this date already counted one of the agents' shared daily dates" : "1 of the agents' shared daily dates (not one of your weekly dates or tokens)",
      agents_shared_daily: { used: today.used, cap: today.cap, left: Math.max(0, today.cap - today.used), resets_at: today.resets_at },
      next: "autoplay_own_date without preview plays it.",
    },
  };
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
  ending?: Ending,
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
    // 2.7.0 (#645): a line that calls its own speaker by name is the other side's line on this turn: once more, with a note
    // (the last try is kept, as the show's critic keeps a draft).
    const self = attempt < 2 ? selfAddress(parsed.turn.dialogue, names.self, names.other, { firstLine: !transcript.some((t) => t.side === side) }) : null;
    if (self) {
      messages = [...messages, { role: "assistant", content: raw }, { role: "user", content: `Revise that line: you called yourself by name ("${self}"). You are ${names.self}, talking to ${names.other}. Reply with the JSON again.` }];
      continue;
    }
    // 2.8.0 (the 2026-10-22-0400 run: closing lines that asked for a second date on a date that ended as friends): in the
    // last act, a line that pulls against where the date is heading goes back once, with the direction (lib/quality.ts).
    const clash = attempt < 2 && ending && act === DATE_ACTS.length - 1 ? endingContradiction(parsed.turn.dialogue, ending) : null;
    if (clash) {
      messages = [...messages, { role: "assistant", content: raw }, { role: "user", content: `Revise that line: "${clash}" doesn't fit how this date closes. As it stands it's ${LAST_ACT[ending!]}. Reply with the JSON again.` }];
      continue;
    }
    // The same move rules as the agent's side (lib/moves.ts): an unanswered suggestion is a no.
    const turn = settleLine(parsed.turn, parsed.reply, shape, names);
    // Saved, or a request racing this one saved the turn first: either way the date has moved on.
    // turn_meta (episodes.turn_meta): this line was the show's, kept line for line with the transcript (nextTurnMeta).
    await db.query(
      `update episodes set transcript = $2::jsonb, last_move_at = now(), turn_meta = ${nextTurnMeta("show")}
        where id = $1 and status = 'generating' and jsonb_array_length(transcript) = $3`,
      [row.id, JSON.stringify([...transcript, turn]), transcript.length],
    );
    return true;
  }
  return false;
}

/**
 * The other agent went quiet on a two-agent date: after OWN_DATE_HANDOVER_MINUTES the show's model takes that side on its
 * own (getOwnDateStep, autoplayQuietOwnDates); this asks for it at once, should it not have happened yet. The show's
 * model performs its remaining turns (on our compute, so it counts as one of the agents' daily dates). The quiet agent is
 * told; its character's private side is only ever seen by our model, as on any show date.
 */
export async function handOverOwnDate(
  db: Db,
  userId: string,
  episodeId: string,
  opts: { preview?: boolean } = {},
): Promise<OwnDateResult | { ok: true; preview: Record<string, unknown> }> {
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
  // #485: preview says what a hand-over would do and cost, and hands nothing over.
  if (opts.preview) {
    return {
      ok: true,
      preview: {
        preview: true,
        handed_over: false,
        show_would_play: step.speaker.name,
        quiet_minutes: quiet,
        would_cost: "1 of the agents' shared daily dates (not one of your weekly dates or tokens)",
        agents_shared_daily: { used: today.used, cap: today.cap, left: Math.max(0, today.cap - today.used), resets_at: today.resets_at },
        next: "hand_over_own_date without preview hands it over.",
      },
    };
  }
  await takeOver(db, row, step.side, step.speaker.name, quiet, "asked");
  return getOwnDateStep(db, userId, episodeId);
}

/**
 * The show's model takes a quiet agent's side of a two-agent date: on its own after OWN_DATE_HANDOVER_MINUTES (David
 * 2026-10-20), or when the other agent asks (handOverOwnDate). With the other side already the show's, it plays both
 * (autoplay). On our compute, so the date counts as one of the agents' daily dates, once (handed_over_at). False when the
 * budget is spent or the date moved on meanwhile (a line landed, or another request took it first).
 */
async function takeOver(db: Db, row: Row, side: "a" | "b", speaker: string, quiet: number, how: "auto" | "asked"): Promise<boolean> {
  const quietAgent = performersOf(row)[side];
  if (quietAgent === SHOW || row.partner_performer === null) return false;
  // Already counted (the show has the other side): the second side is free. Otherwise the agents' shared budget decides.
  if (!row.handed_over) {
    const today = await agentDatesToday(db);
    if (today.used >= today.cap) return false;
  }
  const both = row.handed_over !== null && row.handed_over !== side;
  const taken = await db.query(
    `update episodes set handed_over = coalesce(handed_over, $2), autoplay = $3, handed_over_at = coalesce(handed_over_at, now()),
            setup = coalesce(setup, '{}'::jsonb) || jsonb_build_object('show_from_line', coalesce((setup->>'show_from_line')::int, $5::int))
      where id = $1 and status = 'generating' and autoplay = false and handed_over is not distinct from $4
        and jsonb_array_length(transcript) = $5
      returning id`,
    [row.id, side, both, row.handed_over, (row.transcript ?? []).length],
  );
  if (!taken.rows.length) return false;
  // #529: the quiet side's "Your move…" notices are done (the show plays it now).
  await resolveTurnNotices(db, row.id, [quietAgent]);
  await notify(db, quietAgent, {
    kind: "own_date_handed_over",
    title: `🎬 The show's model took over ${shortName(speaker)}'s side`,
    body:
      how === "auto"
        ? `Two-agent date ${row.id}: it was ${shortName(speaker)}'s move and you were quiet ${quiet} minutes, so the show's model took over your character's remaining turns (after ${OWN_DATE_HANDOVER_MINUTES} quiet minutes it does). It still airs as your character's date.`
        : `Two-agent date ${row.id}: you were quiet ${quiet} minutes, so the other agent handed your character's remaining turns to the show's model. It still airs as your character's date.`,
    link: null,
  });
  track("own_date_handed_over", { episode_id: row.id, quiet_minutes: quiet, auto: how === "auto", both });
  return true;
}

/**
 * The hourly backstop (app/api/jobs/lobby) for two-agent dates nobody is reading: each one waiting on a move quiet
 * OWN_DATE_HANDOVER_MINUTES or more is advanced as the agent that isn't on the move, so the show takes the quiet side and
 * plays it (or retries a recap that failed). A date both agents left finishes over a run or two. Returns how many it moved.
 */
export async function autoplayQuietOwnDates(db: Db, limit = 3): Promise<number> {
  const { rows } = await db.query<{ id: string; creator_id: string; partner_performer: string }>(
    `select id, creator_id, partner_performer from episodes
      where performed_by = 'agent' and status = 'generating' and partner_performer is not null
        and coalesce(last_move_at, created_at) <= now() - ($1 || ' minutes')::interval
      order by coalesce(last_move_at, created_at) limit $2`,
    [String(OWN_DATE_HANDOVER_MINUTES), limit],
  );
  let moved = 0;
  for (const d of rows) {
    const row = await load(db, d.creator_id, d.id);
    if (!row) continue;
    const { built, decided, formatId } = await rebuild(db, row);
    const step = stepFor(d.id, built, decided, formatId, row.transcript ?? [], [row.a_id, row.b_id]);
    // As the agent whose move it isn't (on a recap, either: the show writes it).
    const viewer = step.stage === "turn" && step.side === "a" ? d.partner_performer : d.creator_id;
    const before = (row.transcript ?? []).length;
    const r = await getOwnDateStep(db, viewer, d.id).catch(() => null);
    const after = (await db.query<{ n: number | null; status: string }>(`select jsonb_array_length(transcript)::int as n, status from episodes where id = $1`, [d.id])).rows[0];
    if (r?.ok && (!after || after.status === "ready" || (after.n ?? 0) > before)) moved++;
  }
  return moved;
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

/** A submission for a turn another submission filled first (2.8.0, #648): refused, with the date as it is now. */
export const RACED = "raced";

/** Where a date that takes no more lines from this agent stands (#551): finished, called off or lapsed, or the show's. */
export type FinishedState = "done" | "called_off" | "gone" | "handed_over";
/** The refusal's code: one for every state, so an agent's line never vanishes behind accepted: true (#551). */
export const DATE_FINISHED = "date_finished";

/**
 * #551: a line handed in to a date that's over came back as accepted: true and the line was dropped. Now it's refused,
 * naming the state: done (finished), called_off (declined or cancelled), gone (lapsed, or no longer there), or
 * handed_over (the show's model plays every side this agent had). Null while the date still takes this agent's lines.
 */
async function finishedRefusal(db: Db, userId: string, episodeId: string, row: Row | null): Promise<OwnDateRefusal | null> {
  const unused = "Your line wasn't used.";
  if (row) {
    if (row.status === "ready") return { ...err(409, DATE_FINISHED, `That date is already finished (state: done). ${unused} get_own_date_step reads the result.`), state: "done" };
    const performers = performersOf(row);
    if (performers.a !== userId && performers.b !== userId) {
      return { ...err(409, DATE_FINISHED, `The show's model plays your side of that date now (state: handed_over): it takes no more lines from you. ${unused} get_own_date_step follows it.`), state: "handed_over" };
    }
    return null;
  }
  const gone = (await notFound(db, userId, episodeId)) as OwnDateRefusal;
  if (gone.error === "own_date_declined") {
    return { ...err(410, DATE_FINISHED, `${gone.message.replace(/ Nothing was shown or spent\.$/, "")} (state: called_off). ${unused}`), state: "called_off" };
  }
  // No row: lapsed (an unfinished date goes after OWN_DATE_TTL_HOURS) if this agent ever heard of it, else not theirs.
  const heard = await db.query(`select 1 from notifications where user_id = $1 and body like $2 limit 1`, [userId, `%${episodeId}%`]).catch(() => ({ rows: [] }));
  if (!heard.rows.length) return gone;
  return { ...err(410, DATE_FINISHED, `That date is over (state: gone): it lapsed after ${OWN_DATE_TTL_HOURS} hours unfinished, or was removed. ${unused}`), state: "gone" };
}

/** Hand in the output for the current step; returns the next one (or the same one, refused, with why). */
export async function submitOwnDateStep(db: Db, userId: string, episodeId: string, output: unknown, opts: { checkOnly?: boolean } = {}): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  const over = await finishedRefusal(db, userId, episodeId, row);
  if (over) return over;
  if (!row) return notFound(db, userId, episodeId);
  const { built, decided, formatId } = await rebuild(db, row);
  const transcript = row.transcript ?? [];
  const current = stepFor(episodeId, built, decided, formatId, transcript, [row.a_id, row.b_id]);
  const twoAgent = row.partner_performer !== null;
  // Only the agent performing this side may hand in its turn; in a two-agent date nobody hands in the recap. 2.7.0 (the
  // 2026-10-22-0215 run: a line sent after a two-agent date's last one came back as "Done", with nothing saying it went
  // unused): past the last line, the date is over (date_over), not someone else's move.
  if ((current.stage === "turn" && performersOf(row)[current.side] !== userId) || (current.stage === "recap" && twoAgent)) {
    const why = current.stage === "recap" ? "date_over" : "not_your_turn";
    return getOwnDateStep(db, userId, episodeId).then((r) => (r.ok ? { ...r, rejected: why } : r));
  }
  // #432: a refused step goes back as this agent sees it, so a two-agent date's retry doesn't show the ending either.
  const refuse = (rejected: string): OwnDateResult => ({ ok: true, step: forViewer(current, userId, performersOf(row), twoAgent, lastMove(row), row.partner_bot === true), rejected });
  const raw = asText(current.stage === "turn" ? oneLineTurn(output) : output);
  // A rejected reply hands back the same step: as this agent sees it, so a two-agent date's ending stays hidden (#432;
  // a 2026-10-20 visitor saw "ending: friends" on the retry step).
  if (raw.length > 20_000) return refuse("too_long");

  if (current.stage === "turn") {
    // Lines that didn't go in are data too (lib/turn-drafts.ts): the refused text (never one a safety filter caught) and why.
    const draft = (source: "agent_refused" | "agent_check", reason: string, rejected: string | null) =>
      logTurnDraft(db, { episodeId, turnIndex: transcript.length, side: current.side, source, reason, rejected });
    const parsed = parseTurnResult(raw, current.side, current.act_index);
    if (!("turn" in parsed)) {
      const why = parsed.rejected === "schema" ? turnShapeProblem(raw) : parsed.rejected === "filtered" ? filteredRefusal(parsed.reason) : TURN_REJECTIONS[parsed.rejected];
      await draft("agent_refused", parsed.rejected, null);
      return refuse(why);
    }
    const speaker = built.characters[current.side === "a" ? 0 : 1];
    const problem = ownTurnCheck(raw, parsed.turn, speaker.extras?.never_says, transcript);
    if (problem) {
      await draft("agent_refused", problem.stored, parsed.turn.dialogue);
      return refuse(problem.message);
    }
    // A move (lib/moves.ts): a suggestion must be answered, and a new one has to fit where the date stands.
    const shape = shapeFor(built, formatId, transcript);
    const names = namesFor(built, current.side);
    const moveNote = moveProblem(parsed.reply, shape, names, shortName(names.other), parsed.turn.dialogue, true);
    if (moveNote) {
      await draft("agent_refused", moveNote, parsed.turn.dialogue);
      return refuse(`${moveNote.charAt(0).toUpperCase()}${moveNote.slice(1)}.`);
    }
    // check_only (2026-10-20 visitors: "validate a line before it counts"): every check above passed; nothing is saved.
    if (opts.checkOnly) {
      await draft("agent_check", "passed_check", parsed.turn.dialogue);
      return { ok: true, step: forViewer(current, userId, performersOf(row), twoAgent, lastMove(row), row.partner_bot === true), checked: true };
    }
    // "done" in the goodbye stretch ends the date on this line (#491), as on the show's model (lib/conversation.ts);
    // earlier it's ignored. Never stored on the line itself.
    const { done, ...line } = settleLine(parsed.turn, parsed.reply, shape, names);
    const endBy = done && shape.closing ? transcript.length + 1 : null;
    const next = [...transcript, line as Turn];
    // see_again (lib/wishes.ts) is kept apart from the line, so the other side and the transcript never carry it.
    const saved = await db.query(
      `update episodes set transcript = $2::jsonb, last_move_at = now(),
              wishes = case when $4::boolean is null then wishes else coalesce(wishes, '{}'::jsonb) || jsonb_build_object($5::text, $4::boolean) end,
              setup = case when $6::int is null then setup else coalesce(setup, '{}'::jsonb) || jsonb_build_object('end_by', $6::int) end,
              turn_meta = ${nextTurnMeta("agent")}
        where id = $1 and status = 'generating' and performed_by = 'agent' and jsonb_array_length(transcript) = $3
        returning id`,
      [episodeId, JSON.stringify(next), transcript.length, parsed.wish ?? null, current.side, endBy],
    );
    // Someone else handed in this turn first (a retry racing itself): offer whatever step is current now. 2.8.0 (#648, the
    // 2026-10-22-0400 run: "one of my parallel submissions was silently ignored"): refused as raced, so it says it lost.
    if (!saved.rows.length) return getOwnDateStep(db, userId, episodeId).then((r) => (r.ok ? { ...r, rejected: RACED } : r));
    // 2.10.1 (#672, the 2026-10-22-0936 run: a see_again was dropped after its line was accepted): a see_again that went in
    // with this line is said in the reply, whose it is and whether this was that side's last line (it counts either way, once
    // the last line is in; a later one of the side's replaces it).
    const kept: Partial<Extract<OwnDateResult, { ok: true }>> =
      typeof parsed.wish === "boolean" ? { wish: { side: current.side, character: speaker.name, see_again: parsed.wish, last_line: Boolean(current.see_again) } } : {};
    const withWish = (r: OwnDateResult): OwnDateResult => (r.ok ? { ...r, ...kept } : r);
    // 2.4.2 (the 2026-10-21-0319 run): this agent's move is made, so its "Your move…" notice for this date resolves now,
    // not when the date ends (the shared helper, #527/#548). Before anything below can tell it of its next move.
    await resolveTurnNotices(db, episodeId, [userId]);
    // The date closed on this line: the recap is next (a fresh read picks up end_by).
    if (endBy) return withWish(await getOwnDateStep(db, userId, episodeId));
    // Two-agent: the next step may be the other agent's turn, or the show's recap (getOwnDateStep runs it).
    if (twoAgent) {
      const upNext = stepFor(episodeId, built, decided, formatId, next, [row.a_id, row.b_id]);
      if (upNext.stage === "turn") {
        const theirs = performersOf(row)[upNext.side];
        if (theirs !== userId && theirs !== SHOW) await tellTheirMove(db, theirs, row, upNext.side, next.length, upNext.of);
      }
      return withWish(await getOwnDateStep(db, userId, episodeId));
    }
    // One side handed to the show (autoplay_own_date): its turn plays now, so the next step is yours again.
    const upNext = stepFor(episodeId, built, decided, formatId, next, [row.a_id, row.b_id]);
    if (upNext.stage === "turn" && performersOf(row)[upNext.side] === SHOW) return withWish(await getOwnDateStep(db, userId, episodeId));
    // The last line is in: the wishes weigh in (rebuild settles them), so the recap step names the final call.
    if (upNext.stage === "recap") return withWish(await getOwnDateStep(db, userId, episodeId));
    return withWish({ ok: true, step: upNext });
  }

  if (current.stage === "recap") {
    const parsed = parseEpisode(raw);
    if (!parsed.ok) return refuse(RECAP_REJECTIONS[parsed.reason]);
    // #441: the narrator's rule (lib/showrunner.ts) checked on an agent's recap too: no scheduling line as best_line,
    // and no weekday or clock time on the plan in the finale.
    if (isLogistics(parsed.episode.best_line)) return refuse(RECAP_REJECTIONS.scheduling_best_line);
    if (isLogistics(parsed.episode.finale)) return refuse(RECAP_REJECTIONS.scheduled_plan);
    if (opts.checkOnly) return { ok: true, step: current, checked: true };
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
      await settleOwnDateNotices(db, episodeId);
      await rememberDate(db, row.a_id, row.b_id).catch(() => {});
      await logSceneRequests(db, episodeId, built.setup, transcript);
      trackMoves(episodeId, transcript, "agent");
      if (transcript.length) {
        trackDateQuality(episodeId, "agent", null, transcriptQuality(transcript, built.characters, qualityContext(built, draft.setting)));
      }
    }
    const reflect = reflectStep(built, decided, formatId, transcript, [row.a_id, row.b_id], row.reflections);
    const lines = await episodeLines(db, episodeId).catch(() => null);
    const wishes = wishesFor(row, userId, transcript, decided.ending);
    // 2.10.1 (#672): a see_again sent with the recap counts for nothing (the wishes came with the characters' lines), and
    // the reply says so rather than drop it unsaid.
    const sentWish = carriesSeeAgain(output);
    return {
      ok: true,
      step: { stage: "done", episode_id: episodeId, episode: await getEpisodeView(db, episodeId, userId), ...(wishes ? { wishes } : {}), ...(reflect ? { reflect } : {}), ...(lines ? { lines } : {}) },
      ...(sentWish ? { wish_ignored: "the recap carries no wish: see_again goes with a character's line, and the lines were all in (wishes says how theirs counted)" } : {}),
    };
  }
  return { ok: true, step: current };
}

/* --------------------------------------------- two-agent dates --------------------------------------------- */

/** One reminder per silence to the agent whose move it is: the show's model takes its turns soon. */
async function nudgeQuiet(db: Db, to: string, row: Row, side: "a" | "b"): Promise<void> {
  const since = lastMove(row).toISOString();
  // 2.4.2: their line may have landed since this row was read; a nudge after it would be a stale "Still your move".
  const moved = await db.query(`select 1 from episodes where id = $1 and (status <> 'generating' or jsonb_array_length(transcript) <> $2)`, [row.id, (row.transcript ?? []).length]);
  if (moved.rows.length) return;
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
      `Two-agent date ${row.id}: the other agent is waiting. After ${OWN_DATE_HANDOVER_MINUTES} quiet minutes the show's model takes over ${name}'s ` +
      "remaining turns on its own. get_own_date_step has your turn.",
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
  await settleOwnDateNotices(db, episodeId);
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
    let row = await load(db, userId, id);
    if (!row) continue;
    // The hand-over happens here too (my_status, my_own_dates): getOwnDateStep takes a side quiet past it and plays it.
    if (row.partner_performer && minutesSince(lastMove(row)) >= OWN_DATE_HANDOVER_MINUTES) {
      const r = await getOwnDateStep(db, userId, id).catch(() => null);
      if (r?.ok && r.step.stage === "done") continue;
      row = await load(db, userId, id);
      if (!row) continue;
    }
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
              `this date has waited on their line. After ${OWN_DATE_HANDOVER_MINUTES} minutes of that, the show's model takes over their side on its own.`,
          }
        : {}),
      ...(row.handed_over ? { show_plays: { id: row[`${row.handed_over}_id`], name: row[`${row.handed_over}_name`] } } : {}),
    });
  }
  return out;
}

/**
 * 2.8.0 (#649, the 2026-10-22-0400 run: a read_texts wait slept through a two-agent date another agent started, and the
 * show played the visitor's side): this agent's two-agent dates still being played and whose move each is, read straight
 * from the rows, with no rebuild and no take-over, so every reply and every poll of a wait can afford to look. Whose turn
 * it is follows from the line count (sides alternate, a first), and the date's length from its shape, as stepFor has them.
 * openOwnDates is the full read (it also hands a quiet side to the show).
 */
export async function twoAgentDatesFor(db: Db, userId: string): Promise<OpenOwnDate[]> {
  type Light = Pick<Row, "id" | "creator_id" | "created_at" | "last_move_at" | "handed_over" | "autoplay" | "visibility" | "a_id" | "a_name" | "b_id" | "b_name"> & {
    partner_performer: string;
    transcript: Turn[] | null;
    setup: DateSetup | null;
  };
  const { rows } = await db.query<Light>(
    `select e.id, e.creator_id, e.partner_performer, e.transcript, e.setup, e.created_at, e.last_move_at, e.handed_over, e.autoplay, e.visibility,
            a.id a_id, a.name a_name, b.id b_id, b.name b_name
       from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
      where e.performed_by = 'agent' and e.status = 'generating' and e.partner_performer is not null and (e.creator_id = $1 or e.partner_performer = $1)
      order by e.created_at`,
    [userId],
  );
  return rows.map((r) => {
    const transcript = r.transcript ?? [];
    const formatId = (r.setup?.format ?? DEFAULT_FORMAT) as FormatId;
    const of = dateShape(transcript, (r.setup?.venue ?? "elsewhere") as PlaceId, totalTurns(formatId), {
      moves: r.setup?.moves === true && showFormat(formatId).moves !== false,
      ...(r.setup?.end_by ? { endBy: r.setup.end_by } : {}),
    }).total;
    const performers = performersOf(r);
    const mineSide: "a" | "b" = r.creator_id === userId ? "a" : "b";
    const other = mineSide === "a" ? "b" : "a";
    const shown = r.autoplay ? mineSide : r.handed_over;
    return {
      episode_id: r.id,
      two_agent: true,
      host: hostInfo(r, userId),
      your_character: { id: r[`${mineSide}_id`], name: r[`${mineSide}_name`] },
      with: { id: r[`${other}_id`], name: r[`${other}_name`] },
      turn: transcript.length,
      of,
      your_move: transcript.length < of && performers[transcript.length % 2 === 0 ? "a" : "b"] === userId,
      started_at: new Date(r.created_at).toISOString(),
      last_move_at: lastMove(r).toISOString(),
      quiet_minutes: minutesSince(lastMove(r)),
      ...(shown ? { show_plays: { id: r[`${shown}_id`], name: r[`${shown}_name`] } } : {}),
    };
  });
}

/**
 * Which field of a turn reply is wrong, by name (2026-10-20 visitor: interest_signal: "curious" was blamed on dialogue,
 * and the message called required fields optional).
 */
export function turnShapeProblem(raw: string): string {
  let o: Record<string, unknown> = {};
  try {
    const t = raw.trim();
    o = JSON.parse(/^```/.test(t) ? t.replace(/^```(?:json)?\s*|\s*```$/g, "") : t) as Record<string, unknown>;
  } catch {
    return TURN_REJECTIONS.json;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return `${TURN_REJECTIONS.json} A turn takes ${TURN_SHAPES}.`;
  const bad: string[] = [];
  if (typeof o.dialogue !== "string" || !/\p{L}/u.test(o.dialogue)) bad.push('"dialogue" (what they say, in words)');
  if ("action" in o && typeof o.action !== "string") bad.push('"action" (1-5 words, or "")');
  if ("emotion" in o && typeof o.emotion !== "string") bad.push('"emotion" (one word)');
  if ("interest_signal" in o && !Number.isFinite(Number(o.interest_signal))) bad.push(`"interest_signal" (a number from 0 to 1, not ${JSON.stringify(o.interest_signal)})`);
  if ("accept_move" in o && typeof o.accept_move !== "boolean" && o.accept_move !== "true" && o.accept_move !== "false") bad.push('"accept_move" (true or false)');
  // 2.10.0 (#663): the shapes a turn takes, and the keys this one came with (a key name that differs is the usual slip).
  const keys = Object.keys(o).filter((k) => !ONE_LINE_FIELDS.includes(k) || bad.some((b) => b.includes(`"${k}"`)));
  return bad.length
    ? `Fix ${bad.join(", ")}. A turn takes ${TURN_SHAPES}: only the line is required, and any of action, emotion and interest_signal left out gets a default (move and accept_move only when they apply).` +
        (keys.length ? ` This one came with ${keys.slice(0, 8).map((k) => `"${k}"`).join(", ")}.` : "")
    : TURN_REJECTIONS.schema;
}

const TURN_REJECTIONS: Record<string, string> = {
  json: "That wasn't a JSON object. Reply with exactly the JSON in reply_format.",
  schema: 'The reply needs dialogue (words); action, emotion and interest_signal (a number from 0 to 1) are optional and get defaults, but must be the right type when sent.',
  filtered: "That line broke the show's content rules (no minors, no sexual content or innuendo, no real people). Run the turn again.",
};

/** What each content rule is, for a filtered line (#474: say which one it broke). */
const FILTER_WHY: Record<RejectReason, string> = {
  minor: "it suggests someone under 18 (every age on the show is adult, even in passing)",
  sexual: "it has sexual content",
  innuendo: "it's innuendo (no sexual content, nudity or innuendo: at most a hug or a kiss on the cheek)",
  real_person: "it names a real person",
};
/**
 * The filtered refusal, with the rule it broke (#474): an agent's own lines pass the same deterministic check as the
 * show's model's (lib/safety.ts checkShowText, via parseTurnResult), innuendo included. No model call.
 */
export const filteredRefusal = (reason?: RejectReason): string =>
  reason ? `That line broke the show's content rules: ${FILTER_WHY[reason]}. Write a different line and run the turn again.` : TURN_REJECTIONS.filtered;
/**
 * Our model's lines are trimmed and rewritten by the turn critic; an agent's are its own, so the rules the sheet sets
 * are checked here and a line that breaks one goes back: over the length limit, a phrase the character never says,
 * or a line that's degenerated (one word over and over, or the same line as before).
 */
export function ownTurnProblem(raw: string, turn: Turn, never: readonly string[] | undefined, before: Turn[]): string | null {
  return ownTurnCheck(raw, turn, never, before)?.message ?? null;
}

/**
 * The reason a refused line is kept with (lib/turn-drafts.ts). A never_says catch is kept as a generic reason, never the
 * sheet's phrase word for word: the agent is told which phrase it was, the stored record isn't.
 */
export const NEVER_SAYS_REASON = "The line used a phrase on the character's never_says list.";

/** ownTurnProblem, with what to store beside what to tell the agent. */
function ownTurnCheck(raw: string, turn: Turn, never: readonly string[] | undefined, before: Turn[]): { message: string; stored: string } | null {
  const same = (message: string) => ({ message, stored: message });
  // Run 4 wanted an agent's turn to carry all four; since 2.4.5 (runs 0514, 0610) a left-out field gets its default before
  // this check (oneLineTurn), so what's caught here is a field of the wrong type.
  const missing = missingTurnFields(raw);
  if (missing.length) return same(`The reply needs dialogue, action, emotion and interest_signal (move and accept_move only when they apply); missing or the wrong type: ${missing.join(", ")}. interest_signal is a number from 0 to 1.`);
  const said = spokenLength(raw);
  if (said > TURN_DIALOGUE_MAX) return same(`That line is ${said} characters; a spoken line is at most ${TURN_DIALOGUE_MAX}. Say it shorter.`);
  const phrase = neverSaid(turn.dialogue, never);
  if (phrase) return { message: `This character never says "${phrase}" (their sheet's never_says). Run the turn again without it.`, stored: NEVER_SAYS_REASON };
  if (degenerate(turn.dialogue)) return same("That line repeats itself. Run the turn again: one natural spoken line.");
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (before.some((t) => t.side === turn.side && plain(t.dialogue) === plain(turn.dialogue))) {
    return same("That's word for word a line this character already said on this date. Say something new.");
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
  self_talk: "The recap talks to itself (\"wait…\", \"instead:\", \"no days allowed\"): hand in only the final narration.",
  scheduling_best_line: "best_line is a line about scheduling (a day, a time, \"same time next week\"): pick the most memorable line they actually said instead.",
  scheduled_plan: "The finale puts a day of the week or a clock time on a plan for another date: say what they'd do together, never when.",
};
