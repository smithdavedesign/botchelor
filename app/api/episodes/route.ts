import { z } from "zod";
import { releaseEpisode, reserveEpisode } from "@/lib/allowance";
import { getDb, type Db } from "@/lib/db";
import { listFeed, toEpisodeJson, type CharacterRef } from "@/lib/game";
import { handle, json, parseBody, readJson, session, userIdFromRequest, type Session } from "@/lib/http";
import { getModel } from "@/lib/model";
import { ownsSku } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { seasonAt } from "@/lib/seasons";
import { generateEpisode, ShowrunnerError, type CharacterSheet, type EpisodeDraft } from "@/lib/showrunner";

// Two model calls at up to 25 s each.
export const maxDuration = 60;

const id = z.string().min(1).max(64);

// Either a chosen house partner, or a blind date the show picks. Never a chosen stranger's OC.
const EpisodeInput = z
  .object({ character_id: id, partner_id: id.optional(), blind: z.literal(true).optional() })
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
};

const CHARACTER_COLUMNS = "c.id, c.name, c.age, c.bio, c.traits, c.want, c.dealbreaker, c.is_house, c.premium_sku";

const toSheet = (c: CharacterRow): CharacterSheet => ({
  name: c.name,
  age: c.age,
  bio: c.bio,
  traits: c.traits,
  want: c.want,
  dealbreaker: c.dealbreaker,
  house: c.is_house,
});
const toRef = (c: CharacterRow): CharacterRef => ({ id: c.id, name: c.name, house: c.is_house });

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
  const input = parseBody(EpisodeInput, await readJson(req), "invalid_request");
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
        message: `No dates left: you've used this week's ${FREE_EPISODES_PER_SEASON} free ones (and any pack dates). Free dates come back Monday 00:00 UTC, or add an episode pack in the shop. Packs add dates, never points.`,
      },
      429,
      sess,
    );
  }
  const outcome = { saved: false };
  try {
    return await writeAndSave(db, sess, own, partner, outcome);
  } finally {
    if (!outcome.saved) {
      await releaseEpisode(db, sess.userId, reservation).catch((err: unknown) => {
        console.error("[episodes] could not give back a reserved date:", err instanceof Error ? err.message : "unknown");
      });
    }
  }
});

/**
 * Writes the episode with one showrunner call and saves it: 200, or 502 / 409 with nothing stored.
 * `outcome.saved` turns true the moment the episode row exists, even if something throws after it.
 */
async function writeAndSave(
  db: Db,
  sess: Session,
  own: CharacterRow,
  partner: CharacterRow,
  outcome: { saved: boolean },
): Promise<Response> {
  let draft: EpisodeDraft;
  try {
    draft = await generateEpisode(getModel(), toSheet(own), toSheet(partner));
  } catch (err) {
    if (!(err instanceof ShowrunnerError)) throw err;
    console.warn("[episodes] showrunner failed:", err.reasons.join(", "));
    return json(
      { error: "showrunner_unavailable", message: "No free model produced a valid episode. Nothing was saved; try again in a minute." },
      502,
      sess,
    );
  }

  const episodeId = crypto.randomUUID();
  // The model call takes seconds; re-check at insert time that neither creator blocked the other meanwhile.
  const saved = await db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                           drama_question, drama_answer)
     select $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12
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
      draft.setting,
      JSON.stringify(draft.goals),
      JSON.stringify(draft.scenes),
      draft.twist,
      draft.finale,
      draft.ending,
      draft.drama_question,
      draft.drama_answer,
    ],
  );
  if (!saved.rows.length) {
    return json(
      { error: "match_unavailable", message: "That match is no longer available. Nothing was saved; try another date." },
      409,
      sess,
    );
  }
  outcome.saved = true;

  // The creator watches the full episode right away; spectators get the teaser until the finale airs.
  // No creator names: nobody has consented to a reveal yet.
  const episode = toEpisodeJson({ id: episodeId, characters: [toRef(own), toRef(partner)], ...draft, revealed: false }, true);
  return json(episode, 200, sess);
}

/** The public feed: newest episodes, minus hidden ones and creators the viewer blocked (or who blocked them). */
export const GET = handle(async (req) => {
  const episodes = await listFeed(await getDb(), userIdFromRequest(req));
  return json({ episodes });
});
