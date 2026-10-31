import { pairNames, shortName } from "@/lib/names";
import { ownDateInProgress, ownDateInProgressMessage } from "@/lib/own-date";
import { after } from "next/server";
import { z } from "zod";
import { releaseEpisode, reserveEpisode, reserveSecondDate, type Reservation } from "@/lib/allowance";
import { releaseOperatorDate, reserveOperatorDate } from "@/lib/operator-pass";
import { portraitPathSql } from "@/lib/assets";
import { PACK_5 } from "@/lib/catalog";
import { jobUsability } from "@/lib/connections";
import { getDb, type Db } from "@/lib/db";
import { decideTraced } from "@/lib/engine";
import { getEpisodeView, listFeed, toEpisodeJson, type CharacterRef, type StoredEpisode } from "@/lib/game";
import { handle, json, parseBody, readJson, session, userIdFromRequest, type Session } from "@/lib/http";
import { crisisAware, str } from "@/lib/crisis";
import { frontierAuthorized } from "@/lib/model";
import { generationPaused, PAUSED_MESSAGE } from "@/lib/compute";
import { DATE_START_LIMITS, overLimit, visitorKey } from "@/lib/limits";
import { track } from "@/lib/analytics";
import { recordCrossSpecies } from "@/lib/agent-funnel";
import { enqueueGeneration, inlineGenerationEnabled, runGenerationJob } from "@/lib/jobs";
import { ownsSku } from "@/lib/payments";
import { DEFAULT_FORMAT, format as showFormat, FORMAT_IDS } from "@/lib/formats";
import {
  AGENDA_IDS,
  AUTONOMY_LEVELS,
  DATE_VISIBILITIES,
  DELETED_OWNER,
  FREE_EPISODES_PER_SEASON,
  GAME_BUDGETS,
  STRATEGIES,
  ENDINGS,
  type GameBudget,
  dateLabel,
} from "@/lib/rules";
import { checkFields } from "@/lib/safety";
import { coupledSql, currentPartners, settleCharacter, takenSql } from "@/lib/partners";
import { takenMessage } from "@/lib/partners-shared";
import { seasonCastIds } from "@/lib/season-cast";
import { weekAt } from "@/lib/seasons";
import { checkSecondDate } from "@/lib/second-date";
import { acceptableProposal, markAccepted } from "@/lib/date-proposals";
import { bookingAsk, roleplayForBooking } from "@/lib/date-roleplays";
import { ROLEPLAY_PREMISE_MAX, ROLEPLAY_ROLE_MAX, ROLEPLAY_TITLE_MAX, type DateRoleplay } from "@/lib/roleplays";
import { datedSql, MATCH_FIRST, swipeGateOn } from "@/lib/swipe-gate";
import { agreedMatchSql } from "@/lib/swipes";
import { movePlace } from "@/lib/places";
import { audienceAllowsSql } from "@/lib/audience";
import { useNudges } from "@/lib/between-dates";
import { notify, notifyDateBooked, resolvePairNotices } from "@/lib/notifications";
import { buildDate, type CharacterForDate, type DateRequest } from "@/lib/simulation";
import { groupBookingFor, markNightBooked, type GroupBooking } from "@/lib/group-dates";
import { type CharacterSheet } from "@/lib/showrunner";

// The request itself is instant (the engine, no model). Generation runs in after(), which keeps the
// function alive past the response, so the budget still covers the ~20s of model calls.
export const maxDuration = 300; // the after() worker generates the full date (~21 model calls); a paid/slower model needs well over 60s

const id = z.string().min(1).max(64);
const gameBudget = z.union(GAME_BUDGETS.map((b) => z.literal(b)) as [z.ZodLiteral<GameBudget>, ...z.ZodLiteral<GameBudget>[]]);

// Either a chosen partner, or a blind date the show picks. A chosen partner is a house character, or
// another creator's OC only if that creator opened it to dates (characters.open_to_dates: consent to be
// asked out by name). The date settings (PRD budget & autonomy) are all optional, with balanced defaults.
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
    // M16: who can see the date. Defaults public (the feed). 'private' is the creator's alone (tracked,
    // never public, never scored); 'unlisted' is viewable by link only.
    visibility: z.enum(DATE_VISIBILITIES).optional(),
    // A second date (lib/second-date.ts): the date whose morning-after plan this is. partner_id is the other
    // character in it; consent is checked there instead of "house or open to dates".
    second_date_of: id.optional(),
    // Accepting another owner's date proposal (lib/date-proposals.ts): partner_id is their character; their proposal
    // is the consent, in place of "house or open to dates".
    proposal_id: id.optional(),
    // David, 2026-10-23: where the date happens, in a few words ("the night market", "my place", "under the old
    // footbridge"). Left out, a place they agreed by text is used, else the show deals one.
    place: z.string().trim().min(2).max(80).optional(),
    // A double date (lib/group-dates.ts): this booking is one table of that night. The night sets the venue and the
    // table line; the caller must be this couple's booker and the night accepted. Never with `place`.
    group_night: id.optional(),
    // David, 2026-10-31: a roleplay for the date (lib/date-roleplays.ts): one of the show's by id (lib/roleplays.ts),
    // one written for it ({ title, premise, roles? }), or "none" to leave the pair's agreed one for another date. Left
    // out, a roleplay the two agreed on plays. With a house character (or two of your own) a named one plays at once;
    // with someone else's character it has to be the one their owner agreed to. `my_role`: which role yours plays.
    roleplay: z
      .union([
        z.string().trim().min(1).max(40),
        z.object({
          title: z.string().trim().max(ROLEPLAY_TITLE_MAX * 2),
          premise: z.string().trim().max(ROLEPLAY_PREMISE_MAX * 2),
          roles: z.array(z.string().trim().max(ROLEPLAY_ROLE_MAX * 2)).length(2).optional(),
        }),
      ])
      .optional(),
    my_role: z.union([z.string().trim().max(ROLEPLAY_ROLE_MAX * 2), z.number().int().min(0).max(1)]).optional(),
  })
  .refine((v) => (v.partner_id === undefined) !== (v.blind === undefined), {
    message:
      "Send either partner_id (a house character or one that's open to dates) or blind: true. Partner ids: my_status lists the house cast; swipe_deck, search_characters and my_matches list others, and a match's id works too.",
    path: ["partner_id"],
  });

type CharacterRow = {
  id: string;
  owner_id: string | null;
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
  portrait: string | null;
  pronouns: string | null;
  voice: string | null;
};

const CHARACTER_COLUMNS = `c.id, c.owner_id, c.name, c.age, c.bio, c.traits, c.want, c.dealbreaker, c.is_house, c.premium_sku, c.appearance, c.avatar_hue,
  ${portraitPathSql("c")} as portrait, c.pronouns, c.voice`;

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
const toRef = (c: CharacterRow): CharacterRef => ({ id: c.id, name: c.name, house: c.is_house, hue: c.avatar_hue, portrait: c.portrait });
const forDate = (c: CharacterRow): CharacterForDate => ({ id: c.id, sheet: toSheet(c) });

/**
 * Blind date: a random OC from another creator, skipping any pair where either creator blocked the
 * other and any character whose creator deleted their account; a random free house character when there is
 * nobody (yet). Never fails, never premium.
 */
async function blindMatch(db: Db, userId: string, ownId: string): Promise<CharacterRow> {
  // Behind the swipe gate (lib/swipe-gate.ts), a blind date is one of your agreed matches, or one of this season's
  // house cast: never a stranger.
  if (swipeGateOn()) {
    const matched = (
      await db.query<CharacterRow>(
        `select ${CHARACTER_COLUMNS} from characters c
          where not c.is_house and c.owner_id <> $1 and c.owner_id <> $3 and ${agreedMatchSql("c", "$2")} and not ${takenSql("c", "$2")}
            and not exists (
              select 1 from blocks bl
               where (bl.blocker_id = $1 and bl.blocked_id = c.owner_id)
                  or (bl.blocker_id = c.owner_id and bl.blocked_id = $1))
          order by random() limit 1`,
        [userId, ownId, DELETED_OWNER],
      )
    ).rows[0];
    if (matched) return matched;
    const { rows } = await db.query<CharacterRow>(
      `select ${CHARACTER_COLUMNS} from characters c where c.is_house and c.premium_sku is null and c.id = any($1) order by random() limit 1`,
      [seasonCastIds()],
    );
    return rows[0];
  }
  const other = (
    await db.query<CharacterRow>(
      `select ${CHARACTER_COLUMNS}
         from characters c
        where not c.is_house and c.owner_id <> $1 and c.owner_id <> $2
          and not ${takenSql("c")}
          and ${audienceAllowsSql("c", "(select o.created_via from characters o where o.id = $3)")}
          and not exists (
            select 1 from blocks bl
             where (bl.blocker_id = $1 and bl.blocked_id = c.owner_id)
                or (bl.blocker_id = c.owner_id and bl.blocked_id = $1))
        order by random()
        limit 1`,
      [userId, DELETED_OWNER, ownId],
    )
  ).rows[0];
  if (other) return other;
  // Nobody else around: one of this season's house cast (lib/season-cast.ts).
  const { rows } = await db.query<CharacterRow>(
    `select ${CHARACTER_COLUMNS} from characters c
      where c.is_house and c.premium_sku is null and c.id = any($1)
      order by random() limit 1`,
    [seasonCastIds()],
  );
  return rows[0];
}

// The date's note is the owner's own words: checked for self-harm intent (lib/crisis.ts), the reply then carries
// crisis_resources whatever else it says.
export const POST = crisisAware("date_note", (body) => [str(body.note)], handle(async (req) => {
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

  // Connections M3: someone who chose to pause when their own key can't be used (at its cap, out of credit, revoked)
  // books no date until it can; the free model doesn't stand in for them. Dates others book with their character still
  // happen, on the show's model.
  const usable = await jobUsability(db, sess.userId, "text");
  if ((usable.state === "over_cap" && usable.cap.on_cap === "pause") || usable.state === "failing") {
    return json({ error: "key_paused", message: usable.message, connect: "/account/keys#dates" }, 409, sess);
  }

  // One partner (lib/partners.ts): a character that's with someone dates only them until it cools off. One left to
  // decide, and already with someone, decides now.
  await settleCharacter(db, own.id).catch(() => {});
  const ownTaken = (
    await db.query<{ taken: boolean }>(`select ${takenSql("c", "$2")} as taken from characters c where c.id = $1`, [own.id, input.blind ? null : (input.partner_id ?? null)])
  ).rows[0]?.taken;
  if (ownTaken) {
    const [with_] = await currentPartners(db, own.id);
    return json(
      {
        error: "taken",
        field: "partner_id",
        // #514: name the rule and the exact fields that reopen them (the card, for people; update_character, for agents).
        message: takenMessage(shortName(own.name), { mine: true, partner: with_?.name ?? null }),
      },
      409,
      sess,
    );
  }

  // A group night's table (lib/group-dates.ts): resolved before the partner, because a mixer rotation's partner is
  // there by the night's own consent (joining was the yes), not by being open to dates. Refused nights cost nothing.
  let group: GroupBooking | null = null;
  if (input.group_night) {
    if (!input.partner_id) return json({ error: "invalid_request", message: "A group night's table names its partner_id." }, 400, sess);
    const g = await groupBookingFor(db, input.group_night, sess.userId, own.id, input.partner_id);
    if (!g.ok) return json({ error: g.error, message: g.message }, g.status, sess);
    group = g.booking;
  }

  let partner: CharacterRow | undefined;
  let secondDate: { followupOf: string; visibility: "public" | "private" | "unlisted"; dateNumber: number } | null = null;
  if (group?.kind === "mixer") {
    // The mixer drew this pair and both joined: load the partner plainly, still never taken elsewhere or across a block.
    partner = (
      await db.query<CharacterRow>(
        `select ${CHARACTER_COLUMNS} from characters c
          where c.id = $1 and not ${takenSql("c", "$3")}
            and not exists (select 1 from blocks bl
                             where (bl.blocker_id = $2 and bl.blocked_id = c.owner_id) or (bl.blocker_id = c.owner_id and bl.blocked_id = $2))`,
        [input.partner_id, sess.userId, own.id],
      )
    ).rows[0];
    if (!partner) return json({ error: "partner_not_available", message: "That match from the night isn't available any more (taken, gone, or a block)." }, 422, sess);
  } else if (input.second_date_of) {
    // Both characters wanted it, this is the other one, and its owner has agreed (lib/second-date.ts).
    if (!input.partner_id) return json({ error: "invalid_request", message: "A second date needs partner_id." }, 400, sess);
    const check = await checkSecondDate(db, sess.userId, own.id, input.partner_id, input.second_date_of, input.visibility);
    if (!check.ok) return json({ error: check.error, message: check.message }, check.status, sess);
    secondDate = { followupOf: check.followupOf, visibility: check.visibility, dateNumber: check.dateNumber };
    partner = (await db.query<CharacterRow>(`select ${CHARACTER_COLUMNS} from characters c where c.id = $1`, [input.partner_id])).rows[0];
    if (!partner) return json({ error: "partner_not_available", message: "That character isn't here any more." }, 422, sess);
  } else if (input.blind) {
    partner = await blindMatch(db, sess.userId, own.id);
  } else {
    if (input.proposal_id && !(await acceptableProposal(db, sess.userId, input.proposal_id, own.id, input.partner_id ?? ""))) {
      return json({ error: "proposal_unavailable", message: "That proposal isn't open any more." }, 409, sess);
    }
    // One of this season's house cast (or a premium one, checked below, or one this character has dated before: a
    // couple can always meet again), or someone else's OC that's open to dates (or the partner your character is
    // with, or whose owner proposed this date, or one it matched with where both said yes) — never your own, never
    // across a block. Behind the swipe gate (lib/swipe-gate.ts, $6), open to dates is enough only for a couple that's
    // dated before: a first date with someone else's character takes a match.
    partner = (
      await db.query<CharacterRow>(
        `select ${CHARACTER_COLUMNS} from characters c
          where c.id = $1
            and ((c.is_house and (c.premium_sku is not null or c.id = any($3) or ${agreedMatchSql("c", "$4")} or ${datedSql("c", "$4")}))
                 or (((c.open_to_dates and ${audienceAllowsSql("c", "(select o.created_via from characters o where o.id = $4)")}
                       and (not $6::boolean or ${datedSql("c", "$4")}))
                      or ${coupledSql("c", "$4")} or c.id = $5::text or ${agreedMatchSql("c", "$4")}) and c.owner_id <> $2 and not ${takenSql("c", "$4")}
                     and not exists (
                       select 1 from blocks bl
                        where (bl.blocker_id = $2 and bl.blocked_id = c.owner_id)
                           or (bl.blocker_id = c.owner_id and bl.blocked_id = $2))))`,
        [input.partner_id, sess.userId, seasonCastIds(), own.id, input.proposal_id ? (input.partner_id ?? null) : null, swipeGateOn()],
      )
    ).rows[0];
    if (!partner && input.partner_id && !(await db.query(`select 1 from characters where id::text = $1`, [input.partner_id])).rows.length) {
      // #473: name the argument that failed; #494: a name was passed where an id goes.
      const looksLikeName = /\s/.test(input.partner_id.trim());
      return json(
        {
          error: "partner_not_found",
          field: "partner_id",
          message: looksLikeName
            ? `No character with partner_id "${input.partner_id}": that looks like a name, and partner_id takes a character id. search_characters finds the id by name; my_status lists the house cast's.`
            : "No character with that partner_id. my_status lists the house cast; search_characters and my_matches give other ids.",
        },
        404,
        sess,
      );
    }
    if (!partner) {
      return json(
        {
          error: "partner_not_available",
          message: swipeGateOn()
            ? `That character can't be asked out yet. ${MATCH_FIRST}`
            : "That character can't be asked out: pick one of this season's house cast or a character that's open to dates (and to characters like yours: some are open only to people's characters, some only to agents'), or ask for a blind date with blind: true.",
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

  // #558, #465: one date at a time for a couple, whichever way round it was started: not while their agents are performing
  // one, nor while one booked on the show's model is still being written.
  if (partner) {
    const performing = await ownDateInProgress(db, own.id, partner.id);
    if (performing) {
      return json(
        { error: "date_in_progress", episode_id: performing.id, message: ownDateInProgressMessage(pairNames(own.name, partner.name).join(" and "), performing.id, performing.by) },
        409,
        sess,
      );
    }
  }

  // The roleplay (lib/date-roleplays.ts), checked before the date is reserved so a refusal costs nothing. A group
  // night's table plays the night, and a blind date can't name one (nobody knows who they'll meet yet); a pair's agreed
  // roleplay still plays on a blind date that draws them.
  let roleplay: DateRoleplay | null = null;
  if (input.roleplay !== undefined && (input.blind || group)) {
    return json(
      { error: "roleplay_not_here", field: "roleplay", message: input.blind ? "A blind date can't name a roleplay: you don't know who you'll meet yet. Book them by name for one." : "A group night's tables play the night itself, without a roleplay." },
      422,
      sess,
    );
  }
  if (!group) {
    const r = await roleplayForBooking(db, sess.userId, own, partner, bookingAsk(input.roleplay, input.my_role));
    if (!r.ok) return json({ error: r.error, field: "roleplay", message: r.message }, r.status, sess);
    roleplay = r.roleplay;
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

  // The frontier model only when this request carries the owner's key; recorded on the job so the
  // background worker (which has no request) knows which model to use.
  const useFrontier = frontierAuthorized(req);

  // Per visitor, not per cookie (lib/limits.ts): free dates are counted per anonymous cookie, and a fresh cookie
  // costs nothing, so this is what stops a script minting identities to flood the show. In-process calls (the
  // MCP front door) carry no IP and have the agents' own daily cap; the owner's key skips it.
  const visitor = useFrontier ? null : visitorKey(req.headers);
  if (visitor && (await overLimit(db, "date_start", visitor, DATE_START_LIMITS))) {
    return json(
      {
        error: "too_many_dates",
        message: "That's a lot of dates from one connection. Take a breather: you can start another within the hour.",
      },
      429,
      sess,
    );
  }

  // One of this week's free dates, or a pack date (M4). Taken before the model call, so parallel requests
  // can't write more episodes than the creator has dates; given back below if no episode gets saved
  // (a failed generation costs no date, so it doesn't cap retries: see docs/history/build-log-2026-10-13-to-16.md, "Review").
  // A second date may be this season's free one (FREE_WEEKLY_SECOND_DATE); otherwise it costs a date like any other.
  // An operator pass (lib/operator-pass) spends a reserved date first: it leaves this week's free/pack dates untouched
  // and (marked operator_reserved) stays out of the shared agent cap. Gated off, so false for everyone until it's on.
  const passDate = await reserveOperatorDate(db, sess.userId);
  const reservation = passDate ? null : (secondDate ? await reserveSecondDate(db, sess.userId) : null) ?? (await reserveEpisode(db, sess.userId));
  if (!passDate && !reservation) {
    return json(
      {
        error: "episode_limit_reached",
        resets_at: weekAt(new Date()).ends_at,
        shop_path: "/shop",
        message: `No dates left: you've used this week's ${FREE_EPISODES_PER_SEASON} free ones (and any pack dates). Free dates come back Monday 00:00 UTC, or get ${PACK_5.name} in the shop. Packs add dates, never points.`,
      },
      429,
      sess,
    );
  }
  const outcome = { saved: false };
  try {
    return await writeAndSave(db, sess, useFrontier, reservation, own, partner, input, outcome, secondDate, passDate, group, roleplay);
  } finally {
    if (!outcome.saved) {
      const giveBack = passDate ? releaseOperatorDate(db, sess.userId) : reservation ? releaseEpisode(db, sess.userId, reservation) : Promise.resolve();
      await giveBack.catch((err: unknown) => {
        console.error("[episodes] could not give back a reserved date:", err instanceof Error ? err.message : "unknown");
      });
    }
  }
}));

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
  secondDate: { followupOf: string; visibility: "public" | "private" | "unlisted"; dateNumber: number } | null = null,
  operatorReserved = false,
  group: GroupBooking | null = null,
  roleplay: DateRoleplay | null = null,
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
  // A place named at booking (lib/places.ts movePlace): one of their homes, a venue we have, or their own words for it.
  const chosenPlace = input.place ? movePlace(input.place, own.name, partner.name) : null;
  if (input.place && !chosenPlace) {
    return json({ error: "place_not_allowed", field: "place", message: "That place can't host a date on the show: keep it short, PG and public (no bedrooms, cars or links)." }, 422, sess);
  }
  const built = await buildDate(db, episodeId, forDate(own), forDate(partner), dateRequest, undefined, undefined, {
    creatorId: sess.userId,
    followupOf: secondDate?.followupOf ?? null,
    ...(secondDate ? { dateNumber: secondDate.dateNumber } : {}),
    chosenPlace: group ? null : chosenPlace,
    // A double date (lib/group-dates.ts): both tables share the night's venue, and each knows who else is there.
    ...(group ? { venueOverride: group.venue, table: group.table } : {}),
    roleplay,
  });
  // Which date this is for the couple (lib/rules dateLabel): the badge says "Third date", not always "Second".
  if (secondDate) built.setup.date_number = secondDate.dateNumber;
  // How this date came about (data plan Tier 2). A blind date behind the swipe gate is one of your matches unless it fell
  // back to the house cast; a date by name is a match when the two both said yes to one, else a pick. Best effort: if the
  // match lookup fails, the date is booked without a met_via (as dates before it were), never refused.
  const byName = secondDate || input.blind || input.proposal_id
    ? null
    : await db
        .query(`select 1 from characters c where c.id = $1 and ${agreedMatchSql("c", "$2")}`, [partner.id, own.id])
        .then((r): "match" | "chosen" => (r.rows.length ? "match" : "chosen"))
        .catch(() => undefined);
  built.setup.met_via = secondDate
    ? "second_date"
    : input.blind
      ? swipeGateOn() && !partner.is_house
        ? "match"
        : "blind"
      : input.proposal_id
        ? "proposal"
        : (byName ?? undefined);
  // The outcome, and why (episodes.engine_trace: margin, reason codes, terms; never a cue word).
  const { outcome: decided, trace } = decideTraced(built.input, built.seed, built.setup.engine_version);

  // Write the episode 'generating' with the engine outcome but placeholder narration; the background job
  // fills the scenes + transcript and flips it to 'ready'. The block re-check stays here, so a blocked
  // pair never even creates a generating row.
  const saved = await db.query<{ id: string }>(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                           drama_question, drama_answer, seed, box_score, sides, best_line, confessionals, setup,
                           note, self_pick, transcript, status, visibility, followup_of, engine_trace, operator_reserved, group_id)
     select $1, $2, $3, $4, '', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, $7, $8, $9::jsonb, $10::jsonb, null,
            '[]'::jsonb, $11::jsonb, $12, $13, '[]'::jsonb, 'generating', $14, $15, $16::jsonb, $17, $18
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
      secondDate?.visibility ?? input.visibility ?? "public",
      secondDate?.followupOf ?? null,
      trace ? JSON.stringify(trace) : null,
      operatorReserved,
      group?.nightId ?? null,
    ],
  ).catch((err: unknown) => {
    // Two owners booking the same second date at once: the unique followup_of lets exactly one through.
    if (secondDate && (err as { code?: string })?.code === "23505") return { rows: [] as { id: string }[], raced: true };
    throw err;
  });
  if (secondDate && "raced" in saved) {
    return json({ error: "already_planned", message: "Their second date is already booked." }, 409, sess);
  }
  if (!saved.rows.length) {
    return json(
      { error: "match_unavailable", message: "That match is no longer available. Nothing was saved; try another date." },
      409,
      sess,
    );
  }
  saveState.saved = true;
  // A double date's table is booked: the night carries each side's episode (lib/group-dates.ts).
  if (group) await markNightBooked(db, group, episodeId).catch(() => {});
  // North-star: a web-made × MCP-made pair's date, once per pair (best effort; never breaks a booking).
  await recordCrossSpecies(db, episodeId, "booking");
  // Their nudges for each other go into this date (snapshotted on the setup), so they're used now.
  await useNudges(db, own.id, partner.id).catch(() => {});
  // Booked (the web's book buttons, the thread's Book date, go_on_date and plan_second_date all land here): the pair's
  // "want to go on a date. Book it" notices are done, for both owners (lib/notifications.ts).
  await resolvePairNotices(db, own.id, partner.id, { bookedBy: sess.userId, private: (secondDate?.visibility ?? input.visibility) === "private" });

  // Queue the slow part (narration + conversation). In production it runs after the response (and the
  // cron route re-runs anything after() misses); inline — tests — it runs now so the episode is ready.
  await enqueueGeneration(db, episodeId, useFrontier, sess.userId, reservation);
  track("episode_created", { episode_id: episodeId, ending: decided.ending, blind: input.blind === true, second_date: secondDate !== null });
  if (secondDate) {
    track("second_date_planned", { episode_id: episodeId, followup_of: secondDate.followupOf, planned_venue: built.setup.plan?.length ? built.setup.venue : null });
    // The other character's creator hears it's happening (house characters have none).
    const partnerOwner = (await db.query<{ owner_id: string | null }>(`select owner_id from characters where id = $1`, [partner.id])).rows[0]?.owner_id;
    if (partnerOwner && partnerOwner !== sess.userId) {
      await notify(db, partnerOwner, {
        kind: "second_date_booked",
        title: `💞 ${shortName(own.name)} and ${shortName(partner.name)} have a ${dateLabel(secondDate.dateNumber).toLowerCase()}`,
        // 2.4.3: who started it and who performs it (a second date always runs on the show's model).
        // Who first: a body keeps to 300 characters, and a plan can be long.
        body: [
          `Started by ${shortName(own.name)}'s side (their owner booked it). The show's model performs both sides, ${shortName(own.name)} and ${shortName(partner.name)}: nothing for you to write.`,
          built.setup.plan?.length ? `As planned: “${built.setup.plan[0]}”` : null,
        ]
          .filter(Boolean)
          .join(" "),
        link: `/episodes/${episodeId}`,
      });
    }
  }
  if (input.proposal_id) {
    const proposal = await acceptableProposal(db, sess.userId, input.proposal_id, own.id, partner.id);
    if (proposal) await markAccepted(db, proposal, episodeId);
  } else if (!secondDate) {
    // #563: the other character's owner hears of it, private dates included (a second date has its own notice above, an
    // accepted proposal tells its proposer: date_accepted). House characters have no owner; the booker isn't told of their own.
    await notifyDateBooked(db, {
      episodeId,
      bookedBy: sess.userId,
      booker: { id: own.id, name: own.name },
      yours: { id: partner.id, name: partner.name },
      visibility: input.visibility ?? "public",
      performedBy: "show",
    });
  }
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
