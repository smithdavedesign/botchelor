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
 * So an agent supplies the compute, never the result. Both characters must be the agent's own: a process
 * playing a character only ever sees that character's soul, and both souls belong to the same creator anyway.
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
import { qualityContext } from "./pipeline";
import { transcriptQuality } from "./quality";
import { CONVERSATION_TURNS, DATE_ACTS, DEFAULT_AUTONOMY, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY } from "./rules";
import { anchorBestLine, buildMessages, parseEpisode } from "./showrunner";
import { buildDate, rememberDate, type BuiltDate, type CharacterForDate, type DateRequest } from "./simulation";

/** How many unfinished self-performed dates one identity may have at once. */
export const OWN_DATE_MAX_OPEN = 3;
/** An unfinished one older than this is cleared (it was never visible). */
export const OWN_DATE_TTL_HOURS = 24;

const TURN_REPLY = '{"dialogue":"what they say","action":"what they do, 1-5 words, or \\"\\"","emotion":"one word","interest_signal":0.0}';
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
  | { stage: "done"; episode_id: string; episode: EpisodeView | null };

export type OwnDateResult = { ok: true; step: OwnDateStep; rejected?: string } | { ok: false; status: number; error: string; message: string };

type Row = {
  id: string;
  creator_id: string;
  status: string;
  seed: string | null;
  setup: DateSetup | null;
  note: string | null;
  transcript: Turn[];
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

  const mine = (
    await db.query<OwnCharacter>(
      `select id, name, age, bio, traits, want, dealbreaker, appearance, pronouns, voice
         from characters where id = any($1) and owner_id = $2 and not is_house`,
      [[input.character_id, input.partner_id], userId],
    )
  ).rows;
  const a = mine.find((c) => c.id === input.character_id);
  const b = mine.find((c) => c.id === input.partner_id);
  if (!a || !b) {
    return err(
      404,
      "not_your_characters",
      "Both characters must be yours to perform the date yourself. To date someone else's character, use go_on_date (it runs on the show's model).",
    );
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
  const built = await buildDate(db, episodeId, toDate(a), toDate(b), request);
  const decided = getEngine().decide(built.input, built.seed, built.setup.engine_version);

  await db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                           drama_question, drama_answer, seed, box_score, sides, best_line, confessionals, setup,
                           transcript, status, visibility, created_via, performed_by)
     values ($1, $2, $3, $4, '', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, $7, $8, $9::jsonb, $10::jsonb, null,
             '[]'::jsonb, $11::jsonb, '[]'::jsonb, 'generating', $12, 'mcp', 'agent')`,
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
    ],
  );
  track("episode_created", { episode_id: episodeId, ending: decided.ending, blind: false, performed_by: "agent" });
  return { ok: true, step: stepFor(episodeId, built, decided, formatId, [], [a.id, b.id]) };
}

/* ------------------------------------------------ the steps ------------------------------------------------ */

async function load(db: Db, userId: string, episodeId: string): Promise<Row | null> {
  const { rows } = await db.query<Row>(
    `select e.id, e.creator_id, e.status, e.seed::text as seed, e.setup, e.note, e.transcript,
            a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want, a.dealbreaker a_dealbreaker,
            a.appearance a_appearance, a.pronouns a_pronouns, a.voice a_voice,
            b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want, b.dealbreaker b_dealbreaker,
            b.appearance b_appearance, b.pronouns b_pronouns, b.voice b_voice
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.creator_id = $2 and e.performed_by = 'agent'`,
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
  const forDate = (p: "a" | "b"): CharacterForDate => ({ id: row[`${p}_id`], sheet: sheet(row, p) });
  const signals = row.setup?.signals_a && row.setup?.signals_b ? { a: row.setup.signals_a, b: row.setup.signals_b } : undefined;
  const built = await buildDate(db, row.id, forDate("a"), forDate("b"), request, row.seed === null ? undefined : Number(row.seed), signals);
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

/** Where a self-performed date is up to: the next step to run, or done. */
export async function getOwnDateStep(db: Db, userId: string, episodeId: string): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return err(404, "own_date_not_found", "No self-performed date of yours with that id.");
  if (row.status === "ready") return { ok: true, step: { stage: "done", episode_id: episodeId, episode: await getEpisodeView(db, episodeId, userId) } };
  const { built, decided, formatId } = await rebuild(db, row);
  return { ok: true, step: stepFor(episodeId, built, decided, formatId, row.transcript ?? [], [row.a_id, row.b_id]) };
}

const asText = (output: unknown): string => (typeof output === "string" ? output : JSON.stringify(output ?? null));

/** Hand in the output for the current step; returns the next one (or the same one, refused, with why). */
export async function submitOwnDateStep(db: Db, userId: string, episodeId: string, output: unknown): Promise<OwnDateResult> {
  const row = await load(db, userId, episodeId);
  if (!row) return err(404, "own_date_not_found", "No self-performed date of yours with that id.");
  if (row.status === "ready") return { ok: true, step: { stage: "done", episode_id: episodeId, episode: await getEpisodeView(db, episodeId, userId) } };
  const { built, decided, formatId } = await rebuild(db, row);
  const transcript = row.transcript ?? [];
  const current = stepFor(episodeId, built, decided, formatId, transcript, [row.a_id, row.b_id]);
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
    return { ok: true, step: stepFor(episodeId, built, decided, formatId, next, [row.a_id, row.b_id]) };
  }

  if (current.stage === "recap") {
    const parsed = parseEpisode(raw);
    if (!parsed.ok) return { ok: true, step: current, rejected: RECAP_REJECTIONS[parsed.reason] };
    const draft = anchorBestLine(parsed.episode, transcript);
    const saved = await db.query(
      `update episodes
          set setting = $2, goals = $3::jsonb, scenes = $4::jsonb, twist = $5, finale = $6, best_line = $7,
              confessionals = $8::jsonb, status = 'ready'
        where id = $1 and status = 'generating' and performed_by = 'agent' and jsonb_array_length(transcript) = $9
        returning id`,
      [episodeId, draft.setting, JSON.stringify(draft.goals), JSON.stringify(draft.scenes), draft.twist, draft.finale, draft.best_line, JSON.stringify(draft.confessionals), transcript.length],
    );
    if (saved.rows.length) {
      await rememberDate(db, row.a_id, row.b_id, decided.ending).catch(() => {});
      if (transcript.length) {
        trackDateQuality(episodeId, "agent", null, transcriptQuality(transcript, built.characters, qualityContext(built, draft.setting)));
      }
    }
    return { ok: true, step: { stage: "done", episode_id: episodeId, episode: await getEpisodeView(db, episodeId, userId) } };
  }
  return { ok: true, step: current };
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
