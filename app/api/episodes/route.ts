import { after } from "next/server";
import { z } from "zod";
import { releaseEpisode, reserveEpisode, type Reservation } from "@/lib/allowance";
import { PACK_5 } from "@/lib/catalog";
import { getDb, type Db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { getEpisodeView, listFeed, toEpisodeJson, type CharacterRef, type StoredEpisode } from "@/lib/game";
import { handle, json, parseBody, readJson, session, userIdFromRequest, type Session } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { generationPaused, PAUSED_MESSAGE } from "@/lib/compute";
import { track } from "@/lib/analytics";
import { enqueueGeneration, inlineGenerationEnabled, runGenerationJob } from "@/lib/jobs";
import { ownsSku } from "@/lib/payments";
import { DEFAULT_FORMAT, format as showFormat, FORMAT_IDS } from "@/lib/formats";
import {
  AGENDA_IDS,
  AUTONOMY_LEVELS,
  FREE_EPISODES_PER_SEASON,
  GAME_BUDGETS,
  STRATEGIES,
  ENDINGS,
  type GameBudget,
} from "@/lib/rules";
import { checkFields } from "@/lib/safety";
import { seasonAt } from "@/lib/seasons";
import { buildDate, type CharacterForDate, type DateRequest } from "@/lib/simulation";
import { type CharacterSheet } from "@/lib/showrunner";

// The request itself is instant (the engine, no model). Generation runs in after(), which keeps the
// function alive past the response, so the budget still covers the ~20s of model calls.
export const maxDuration = 60;

const id = z.string().min(1).max(64);
const gameBudget = z.union(GAME_BUDGETS.map((b) => z.literal(b)) as [z.ZodLiteral<GameBudget>, ...z.ZodLiteral<GameBudget>[]]);

// Either a chosen house partner, or a blind date the show picks. Never a chosen stranger's OC. The
// date settings (PRD budget & autonomy) are all optional, with balanced defaults.
const EpisodeInput = z
  .object({
    character_id: id,
    partner_id: id.optional(),
    blind: z.literal(true).optional(),
    autonomy: z.enum(AUTONOMY_LEVELS).optional(),
    strategy: z.enum(STRATEGIES).optional(),
    game_budget: gameBudget.optional(),
    agenda: z.enum(AGENDA_IDS).optional(),
    note: z.string().trim().max(200).optional(),
    self_pick: z.enum(ENDINGS).optional(),
    format: z.enum(FORMAT_IDS).optional(),
  })
  .refine((v) => (v.partner_id === undefined) !== (v.blind === undefined), {
    message: "Send either partner_id (a house character) or blind: true.",
    path: ["partner_id"],
  });

type CharacterRow = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  dealbreaker: string;
  is_house: boolean;
  premium_sku: string | null;
  appearance: string | null;
  avatar_hue: number | null;
  pronouns: string | null;
  voice: string | null;
};

const CHARACTER_COLUMNS =
  "c.id, c.name, c.age, c.bio, c.traits, c.want, c.dealbreaker, c.is_house, c.premium_sku, c.appearance, c.avatar_hue, c.pronouns, c.voice";

const toSheet = (c: CharacterRow): CharacterSheet => ({
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
const toRef = (c: CharacterRow): CharacterRef => ({ id: c.id, name: c.name, house: c.is_house, hue: c.avatar_hue });
const forDate = (c: CharacterRow): CharacterForDate => ({ id: c.id, sheet: toSheet(c) });

/**
 * Blind date: a random OC from another creator, skipping any pair where either creator blocked the
 * other; a random free house character when there is nobody (yet). Never fails, never premium.
 */
async function blindMatch(db: Db, userId: string): Promise<CharacterRow> {
  const other = (
    await db.query<CharacterRow>(
      `select ${CHARACTER_COLUMNS}
         from characters c
        where not c.is_house and c.owner_id <> $1
          and not exists (
            select 1 from blocks bl
             where (bl.blocker_id = $1 and bl.blocked_id = c.owner_id)
                or (bl.blocker_id = c.owner_id and bl.blocked_id = $1))
        order by random()
        limit 1`,
      [userId],
    )
  ).rows[0];
  if (other) return other;
  const { rows } = await db.query<CharacterRow>(
    `select ${CHARACTER_COLUMNS} from characters c where c.is_house and c.premium_sku is null order by random() limit 1`,
  );
  return rows[0];
}

export const POST = handle(async (req) => {
  const sess = session(req);
  // M10 kill switch: a paused system takes no date and spends nothing (PRD: an episode fails closed).
  if (generationPaused()) return json({ error: "generation_paused", message: PAUSED_MESSAGE }, 503, sess);
  const input = parseBody(EpisodeInput, await readJson(req), "invalid_request");

  if (input.note) {
    const verdict = checkFields({ note: input.note });
    if (!verdict.ok) {
      return json({ error: "content_rejected", reason: verdict.reason, field: "note", message: "Keep the note clean: no real people, minors or sexual content." }, 422, sess);
    }
  }

  const db = await getDb();

  const own = (
    await db.query<CharacterRow>(
      `select ${CHARACTER_COLUMNS} from characters c where c.id = $1 and c.owner_id = $2 and not c.is_house`,
      [input.character_id, sess.userId],
    )
  ).rows[0];
  if (!own) return json({ error: "character_not_found" }, 404, sess);

  let partner: CharacterRow | undefined;
  if (input.blind) {
    partner = await blindMatch(db, sess.userId);
  } else {
    partner = (
      await db.query<CharacterRow>(`select ${CHARACTER_COLUMNS} from characters c where c.id = $1 and c.is_house`, [
        input.partner_id,
      ])
    ).rows[0];
    if (!partner) {
      return json(
        {
          error: "partner_must_be_house_character",
          message: "Pick one of the house characters, or ask for a blind date with blind: true.",
        },
        422,
        sess,
      );
    }
    // Premium house characters date only their buyers. Checked before the model call, so it costs nothing.
    if (partner.premium_sku && !(await ownsSku(db, sess.userId, partner.premium_sku))) {
      return json(
        {
          error: "premium_character_locked",
          sku: partner.premium_sku,
          shop_path: "/shop",
          message: `${partner.name} is a premium house character. Unlock them in the shop first.`,
        },
        402,
        sess,
      );
    }
  }

  // A premium format pack: checked before the date is reserved, so it costs nothing. All formats are free
  // today (premiumSku null), so this is a no-op; the seam lets a pack be switched on without more plumbing.
  const fmt = showFormat(input.format ?? DEFAULT_FORMAT);
  if (fmt.premiumSku && !(await ownsSku(db, sess.userId, fmt.premiumSku))) {
    return json(
      {
        error: "format_locked",
        sku: fmt.premiumSku,
        shop_path: "/shop",
        message: `${fmt.label} is a premium format. Unlock it in the shop first.`,
      },
      402,
      sess,
    );
  }

  // One of this week's free dates, or a pack date (M4). Taken before the model call, so parallel requests
  // can't write more episodes than the creator has dates; given back below if no episode gets saved
  // (a failed generation costs no date, so it doesn't cap retries: see BUILD.md, "Review").
  const reservation = await reserveEpisode(db, sess.userId);
  if (!reservation) {
    return json(
      {
        error: "episode_limit_reached",
        resets_at: seasonAt(new Date()).ends_at,
        shop_path: "/shop",
        message: `No dates left: you've used this week's ${FREE_EPISODES_PER_SEASON} free ones (and any pack dates). Free dates come back Monday 00:00 UTC, or get ${PACK_5.name} in the shop. Packs add dates, never points.`,
      },
      429,
      sess,
    );
  }
  // The frontier model only when this request carries the owner's key; recorded on the job so the
  // background worker (which has no request) knows which model to use.
  const useFrontier = frontierAuthorized(req);
  const outcome = { saved: false };
  try {
    return await writeAndSave(db, sess, useFrontier, reservation, own, partner, input, outcome);
  } finally {
    if (!outcome.saved) {
      await releaseEpisode(db, sess.userId, reservation).catch((err: unknown) => {
        console.error("[episodes] could not give back a reserved date:", err instanceof Error ? err.message : "unknown");
      });
    }
  }
});

type EpisodeInputData = z.infer<typeof EpisodeInput>;

/**
 * Decides the outcome with the engine (instant, no model), writes the episode in a 'generating' state,
 * and queues the slow part — narration + the turn-by-turn conversation — to run in the background
 * (lib/jobs.ts), kicked off with after() and backstopped by the cron worker route. Returns the
 * generating episode right away; the page polls until it is 'ready'. `outcome.saved` turns true the
 * moment the episode row exists (so a reserved date isn't given back). 409 only when the pair is blocked.
 */
async function writeAndSave(
  db: Db,
  sess: Session,
  useFrontier: boolean,
  reservation: Reservation | null,
  own: CharacterRow,
  partner: CharacterRow,
  input: EpisodeInputData,
  saveState: { saved: boolean },
): Promise<Response> {
  const episodeId = crypto.randomUUID();
  const dateRequest: DateRequest = {
    autonomy: input.autonomy ?? "balanced",
    strategy: input.strategy ?? "genuine_chemistry",
    gameBudget: input.game_budget ?? 25,
    agendaId: input.agenda ?? null,
    note: input.note ?? null,
    format: input.format ?? DEFAULT_FORMAT,
  };
  const built = await buildDate(db, episodeId, forDate(own), forDate(partner), dateRequest);
  const decided = getEngine().decide(built.input, built.seed, built.setup.engine_version);

  // Write the episode 'generating' with the engine outcome but placeholder narration; the background job
  // fills the scenes + transcript and flips it to 'ready'. The block re-check stays here, so a blocked
  // pair never even creates a generating row.
  const saved = await db.query<{ id: string }>(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                           drama_question, drama_answer, seed, box_score, sides, best_line, confessionals, setup,
                           note, self_pick, transcript, status)
     select $1, $2, $3, $4, '', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, $7, $8, $9::jsonb, $10::jsonb, null,
            '[]'::jsonb, $11::jsonb, $12, $13, '[]'::jsonb, 'generating'
      where not exists (
        select 1 from characters pc
          join blocks bl on (bl.blocker_id = $2 and bl.blocked_id = pc.owner_id)
                         or (bl.blocker_id = pc.owner_id and bl.blocked_id = $2)
         where pc.id = $4)
     returning id`,
    [
      episodeId,
      sess.userId,
      own.id,
      partner.id,
      decided.ending,
      decided.drama_question,
      decided.drama_answer,
      built.seed,
      JSON.stringify(decided.variables),
      JSON.stringify(decided.sides),
      JSON.stringify(built.setup),
      input.note ?? null,
      input.self_pick ?? null,
    ],
  );
  if (!saved.rows.length) {
    return json(
      { error: "match_unavailable", message: "That match is no longer available. Nothing was saved; try another date." },
      409,
      sess,
    );
  }
  saveState.saved = true;

  // Queue the slow part (narration + conversation). In production it runs after the response (and the
  // cron route re-runs anything after() misses); inline — tests — it runs now so the episode is ready.
  await enqueueGeneration(db, episodeId, useFrontier, sess.userId, reservation);
  track("episode_created", { episode_id: episodeId, ending: decided.ending, blind: input.blind === true });
  if (inlineGenerationEnabled()) {
    // No after() lifecycle here, so run the job now: ready → the full episode; a failure deletes the
    // episode and gives the date back, which we surface as the old fail-closed 502.
    await runGenerationJob(db, episodeId);
    const view = await getEpisodeView(db, episodeId, sess.userId);
    if (view && view.status === "ready") return json(view, 200, sess);
    return json(
      { error: "showrunner_unavailable", message: "No model produced a valid episode. Nothing was saved; try again in a minute." },
      502,
      sess,
    );
  }
  try {
    after(() => runGenerationJob(db, episodeId).catch(() => {}));
  } catch {
    // No request scope (a direct unit-test call): the job stays queued for the cron/inline path instead.
  }

  // The creator lands on the episode as it's "being filmed"; the page polls until it is ready.
  const stored: StoredEpisode = {
    id: episodeId,
    characters: [toRef(own), toRef(partner)],
    setting: "",
    goals: [],
    scenes: [],
    twist: "",
    finale: "",
    ending: decided.ending,
    drama_question: decided.drama_question,
    drama_answer: decided.drama_answer,
    revealed: false,
    best_line: null,
    box_score: decided.variables,
    confessionals: null,
    sides: decided.sides,
    setup: built.setup,
    transcript: [],
    afterglow: [],
    status: "generating",
  };
  return json(toEpisodeJson(stored, { full: true, showConfessionals: true }), 200, sess);
}

/** The public feed: newest episodes, minus hidden ones and creators the viewer blocked (or who blocked them). */
export const GET = handle(async (req) => {
  const episodes = await listFeed(await getDb(), userIdFromRequest(req));
  return json({ episodes });
});
