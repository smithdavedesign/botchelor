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
import { buildTurnMessages, parseTurnResult, type Turn } from "./conversation";
import type { Db } from "./db";
import { getEngine, type CharacterSheet } from "./engine";
import { DEFAULT_FORMAT, FORMAT_IDS, format as showFormat, type FormatId } from "./formats";
import { getEpisodeView, type DateSetup, type EpisodeView } from "./game";
import type { ChatMessage } from "./model";
import { PROMPT_VERSION, qualityContext } from "./pipeline";
import { transcriptQuality } from "./quality";
import { CONVERSATION_TURNS, DATE_ACTS, DEFAULT_AUTONOMY, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY } from "./rules";
import { anchorBestLine, buildMessages, parseEpisode } from "./showrunner";
import { buildReflectionMessages, type Reflections } from "./reflection";
import { useNudges } from "./between-dates";
import { audienceAllows, type Audience } from "./audience";
import { getDirectorModel } from "./model";
import { shortName } from "./names";
import { notify } from "./notifications";
import { takenSql } from "./partners";
import { DELETED_OWNER } from "./rules";
import { narrateEpisode } from "./showrunner";
import { buildDate, rememberDate, type BuiltDate, type CharacterForDate, type DateRequest } from "./simulation";

/** How many unfinished self-performed dates one identity may have at once. */
export const OWN_DATE_MAX_OPEN = 3;
/** An unfinished one older than this is cleared (it was never visible). */
export const OWN_DATE_TTL_HOURS = 24;

const TURN_REPLY = '{"dialogue":"what they say","action":"what they do, 1-5 words, or \\"\\"","emotion":"one word","interest_signal":0.0}';
const REFLECTION_REPLY = '{"reflection":"the character\'s private reflection, in its own voice (under 240 characters)"}';
const RECAP_REPLY =
  '{"setting":"…","goals":["…","…"],"scenes":["act 1","act 2","act 3"],"twist":"…","finale":"…","best_line":"…","confessionals":["…","…"]}';

export type OwnDateStep =
  | {
      stage: "turn";
      episode_id: string;
      turn: number;
      of: number;
      side: "a" | "b";
      speaker: { id: string; name: string };
      act: string;
      act_index: number;
      instructions: string;
      messages: ChatMessage[];
      reply_format: string;
    }
  | { stage: "recap"; episode_id: string; instructions: string; messages: ChatMessage[]; reply_format: string }
  /** A two-agent date: the other agent's character speaks next (or the show is writing the recap). Ask again later. */
  | { stage: "waiting"; episode_id: string; turn?: number; of?: number; waiting_for: { id: string; name: string } | "recap"; instructions: string }
  | { stage: "done"; episode_id: string; episode: EpisodeView | null; reflect?: ReflectStep };

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
    return err(404, "partner_not_found", "No character with that partner_id. To date a house character, use go_on_date (it runs on the show's model).");
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
    if (!b.open_to_dates || !audienceAllows(b.open_audience, a.created_via)) {
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
      title: `🤖 ${shortName(a.name)} asked ${shortName(b.name)} out: you perform ${shortName(b.name)}'s side`,
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
  });
  const decided = getEngine().decide(built.input, built.seed, row.setup?.engine_version ?? 1);
  return { built, decided, formatId };
}

const totalTurns = (formatId: FormatId): number => showFormat(formatId).turns ?? CONVERSATION_TURNS;

function stepFor(
  episodeId: string,
  built: BuiltDate,
  decided: ReturnType<ReturnType<typeof getEngine>["decide"]>,
  formatId: FormatId,
  transcript: Turn[],
  ids: [string, string],
): OwnDateStep {
  const fmtCtx = { chaperone: built.setup.chaperone, ex: built.setup.ex };
  const of = totalTurns(formatId);
  if (transcript.length < of) {
    const turn = transcript.length;
    const { messages, side, act } = buildTurnMessages(built.input, decided, built.characters, built.setup.producer, built.setup.venue, transcript, turn, formatId, fmtCtx, { totalTurns: of });
    const speaker = built.characters[side === "a" ? 0 : 1];
    return {
      stage: "turn",
      episode_id: episodeId,
      turn,
      of,
      side,
      speaker: { id: ids[side === "a" ? 0 : 1], name: speaker.name },
      act: DATE_ACTS[act] ?? `Act ${act + 1}`,
      act_index: act,
      instructions:
        `Turn ${turn + 1} of ${of}: ${speaker.name} speaks. Run these messages in ${speaker.name}'s own process — a separate model ` +
        `instance or sub-agent that plays only ${speaker.name} — and send its raw JSON reply back as "output". Don't show it the other ` +
        `character's prompts: each side knows only what it can see and what's been said.`,
      messages,
      reply_format: TURN_REPLY,
    };
  }
  const messages = buildMessages(built.input, decided, built.characters, built.setup.producer, built.setup.venue, formatId, fmtCtx, { transcript, plan: null });
  return {
    stage: "recap",
    episode_id: episodeId,
    instructions:
      "The date is over. Run these messages on a narrator process (it may see both characters — both are yours) and send its raw JSON reply back as \"output\". The recap must match the date as it happened.",
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
const performersOf = (row: Pick<Row, "creator_id" | "partner_performer">): Performers => ({ a: row.creator_id, b: row.partner_performer ?? row.creator_id });

/** The step as this agent sees it: the other agent's turns (and, two-agent, the show's recap) are a wait. */
function forViewer(step: OwnDateStep, userId: string, performers: Performers, twoAgent: boolean): OwnDateStep {
  if (step.stage === "turn" && performers[step.side] !== userId) {
    return {
      stage: "waiting",
      episode_id: step.episode_id,
      turn: step.turn,
      of: step.of,
      waiting_for: step.speaker,
      instructions: `${step.speaker.name}'s agent performs this turn on its own model. Ask again with get_own_date_step in a little while.`,
    };
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
  trackDateQuality(row.id, "agent", null, transcriptQuality(transcript, built.characters, qualityContext(built, draft.setting)));
  const other = finishedBy === row.creator_id ? row.partner_performer : row.creator_id;
  if (other) {
    await notify(db, other, {
      kind: "own_date_ready",
      title: `💞 ${shortName(row.a_name)} and ${shortName(row.b_name)}'s date is done`,
      body: "Both agents performed their sides; the show wrote the recap. Read it with get_own_date_step (and reflect, if you like).",
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
  return { stage: "done", episode_id: row.id, episode: await getEpisodeView(db, row.id, userId), ...(reflect ? { reflect } : {}) };
}

/** Where a self-performed date is up to: the next step to run, or done. */
export async function getOwnDateStep(db: Db, userId: string, episodeId: string): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return err(404, "own_date_not_found", "No self-performed date of yours with that id.");
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
  return { ok: true, step: forViewer(step, userId, performersOf(row), twoAgent) };
}

const asText = (output: unknown): string => (typeof output === "string" ? output : JSON.stringify(output ?? null));

/** Hand in the output for the current step; returns the next one (or the same one, refused, with why). */
export async function submitOwnDateStep(db: Db, userId: string, episodeId: string, output: unknown): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return err(404, "own_date_not_found", "No self-performed date of yours with that id.");
  if (row.status === "ready") return getOwnDateStep(db, userId, episodeId);
  const { built, decided, formatId } = await rebuild(db, row);
  const transcript = row.transcript ?? [];
  const current = stepFor(episodeId, built, decided, formatId, transcript, [row.a_id, row.b_id]);
  const twoAgent = row.partner_performer !== null;
  // Only the agent performing this side may hand in its turn; in a two-agent date nobody hands in the recap.
  if ((current.stage === "turn" && performersOf(row)[current.side] !== userId) || (current.stage === "recap" && twoAgent)) {
    return getOwnDateStep(db, userId, episodeId).then((r) => (r.ok ? { ...r, rejected: "not_your_turn" } : r));
  }
  const raw = asText(output);
  if (raw.length > 20_000) return { ok: true, step: current, rejected: "too_long" };

  if (current.stage === "turn") {
    const parsed = parseTurnResult(raw, current.side, current.act_index);
    if (!("turn" in parsed)) return { ok: true, step: current, rejected: TURN_REJECTIONS[parsed.rejected] };
    const next = [...transcript, parsed.turn];
    const saved = await db.query(
      `update episodes set transcript = $2::jsonb
        where id = $1 and status = 'generating' and performed_by = 'agent' and jsonb_array_length(transcript) = $3
        returning id`,
      [episodeId, JSON.stringify(next), transcript.length],
    );
    // Someone else handed in this turn first (a retry racing itself): offer whatever step is current now.
    if (!saved.rows.length) return getOwnDateStep(db, userId, episodeId);
    // Two-agent: the next step may be the other agent's turn, or the show's recap (getOwnDateStep runs it).
    if (twoAgent) return getOwnDateStep(db, userId, episodeId);
    return { ok: true, step: stepFor(episodeId, built, decided, formatId, next, [row.a_id, row.b_id]) };
  }

  if (current.stage === "recap") {
    const parsed = parseEpisode(raw);
    if (!parsed.ok) return { ok: true, step: current, rejected: RECAP_REJECTIONS[parsed.reason] };
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

/** The invited agent says no: the unfinished date is removed (it was never visible) and the asking agent is told. */
export async function declineOwnDate(db: Db, userId: string, episodeId: string): Promise<boolean> {
  const { rows } = await db.query<{ creator_id: string; a: string; b: string }>(
    `delete from episodes e
      where e.id = $1 and e.partner_performer = $2 and e.status = 'generating' and e.performed_by = 'agent'
      returning e.creator_id,
                (select name from characters where id = e.character_a) as a,
                (select name from characters where id = e.character_b) as b`,
    [episodeId, userId],
  );
  const r = rows[0];
  if (!r) return false;
  await notify(db, r.creator_id, {
    kind: "own_date_declined",
    title: `${shortName(r.b)}'s agent passed on the date with ${shortName(r.a)}`,
    body: "Nothing was shown or spent. Try another character that's open to agents, or go_on_date (the show's model).",
    link: null,
  });
  return true;
}

export type OpenOwnDate = { episode_id: string; two_agent: boolean; your_character: { id: string; name: string }; with: { id: string; name: string }; turn: number; of: number; your_move: boolean; started_at: string };

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
    const mineSide: "a" | "b" = performers.a === userId ? "a" : "b";
    const other = mineSide === "a" ? "b" : "a";
    out.push({
      episode_id: id,
      two_agent: row.partner_performer !== null,
      your_character: { id: row[`${mineSide}_id`], name: row[`${mineSide}_name`] },
      with: { id: row[`${other}_id`], name: row[`${other}_name`] },
      turn: transcript.length,
      of: totalTurns(formatId),
      your_move: step.stage === "turn" ? performers[step.side] === userId : row.partner_performer === null,
      started_at: new Date((await db.query<{ created_at: Date | string }>(`select created_at from episodes where id = $1`, [id])).rows[0].created_at).toISOString(),
    });
  }
  return out;
}

const TURN_REJECTIONS: Record<string, string> = {
  json: "That wasn't a JSON object. Reply with exactly the JSON in reply_format.",
  schema: 'The reply needs a non-empty "dialogue" string (plus optional action, emotion, interest_signal).',
  filtered: "That line broke the show's content rules (no minors, no sexual content, no real people). Run the turn again.",
};
const RECAP_REJECTIONS: Record<string, string> = {
  invalid_json: "That wasn't a JSON object. Reply with exactly the JSON in reply_format.",
  schema: "The recap needs every key in reply_format: setting, two goals, three scenes, twist, finale, best_line and two confessionals.",
  too_long: "The recap is too long: keep setting, goals, scenes, twist and finale under 400 words together.",
  unsafe: "The recap broke the show's content rules (no minors, no sexual content, no real people). Run it again.",
};
