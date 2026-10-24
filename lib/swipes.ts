/**
 * The swipe deck: match before you date (David, 2026-10-17; docs/swipes.md).
 *
 * People swipe for their characters (/swipe), agents for theirs (MCP swipe_deck / swipe). A like from both sides is a
 * match. A house character on this season's cast likes everyone back: they're the template characters anyone can meet.
 * A match opens the couple's phone (lib/text-chain.ts). Whether each wants a date is the character's own call, not its
 * owner's ("some control over their destiny, none over how the chat or the date goes"):
 *  - a house character says yes;
 *  - a person's character decides from how well they suit each other (the deck's score, seeded: $0 and repeatable),
 *    and mostly says yes;
 *  - an agent's character decides through its agent (answer_match).
 * The first texts perform those answers (lib/between-dates.ts, matched mode). When both say yes, the date is agreed
 * and can be booked like any other. Likes stay secret, and a match is the two owners' until a date airs.
 */
import { AFTERGLOW_TEXT_MAX, parseAfterglowLine } from "./afterglow";
import { audienceAllows } from "./audience";
import { buildTextMessages, dayOf, insertText, SHOW_THREAD_CHARS, threadFor } from "./between-dates";
import { loadCharacter, type Character } from "./character";
import { PUBLIC_COLUMNS, rankFor, toProfile, type DatingProfile, type MadeBy, type ProfileRow } from "./dating";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { factLine, PROFILE_PROMPTS, profileComplete, profileMissing } from "./extras";
import { inlineGenerationEnabled } from "./jobs";
import { capHouseBots, houseBotCharacterIds, isHouseBotAgent } from "./house-bots";
import { archetypeLabel, drawnToBoost, goalLabel, kindLabel, kindName } from "./kinds";
import { getModel, type ChatMessage, type Model } from "./model";
import { shortName } from "./names";
import { notify } from "./notifications";
import { takenSql } from "./partners";
import { REOPEN_HOW } from "./partners-shared";
import { pairKey, type End } from "./relationships";
import { seasonCastIds } from "./season-cast";
import { loadChain, PUBLIC_VIEWER } from "./text-chain";
import { critiqueText, writeCritiquedText, type ThreadText } from "./text-critic";

/** How many cards the deck deals at a time. */
export const DECK_PAGE = 10;
/** The opening chat after a match: up to this many texts, on the show's free model. */
export const MATCH_CHAT_TEXTS = 4;

/** How many matches a day get their opening chat on the show's model, show-wide. MATCH_CHATS_DAILY overrides; 0 stops it. */
export function matchChatDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MATCH_CHATS_DAILY?.trim() || 50);
  return Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.floor(n))) : 50;
}

export type DeckCard = {
  id: string;
  name: string;
  age: number;
  pronouns: string | null;
  bio: string;
  traits: string[];
  looking_for: string;
  occupation: string | null;
  hometown: string | null;
  prompts: { prompt: string; answer: string }[];
  interests: string[];
  /** What they are, the type they play and what they're here for (lib/kinds.ts), as shown; null when unsaid. */
  kind: string | null;
  archetype: string | null;
  here_for: string | null;
  /** Its creator's public facts, as "Label: value". */
  facts: string[];
  portrait: string | null;
  hue: number | null;
  house: boolean;
  made_by: MadeBy;
  /** Why your character might click with them, from the deck's ranking (lib/dating.ts rankFor). */
  why: string[];
  /**
   * #443 (David, 2026-10-21): this character already liked yours, so a like back is a match ("Liked you" on the card).
   * Only this flag, on its own card: never a list of who liked you.
   */
  liked_you: boolean;
};

type Refusal = { ok: false; status: number; error: string; message: string; missing?: string[] };
const refuse = (status: number, error: string, message: string, missing?: string[]): Refusal => ({ ok: false, status, error, message, ...(missing ? { missing } : {}) });

/** `scores`: each card's deck score, for the impression log only (callers send `for` and `cards`, never these). */
export type DeckResult = { ok: true; for: { id: string; name: string }; cards: DeckCard[]; scores: Record<string, number> } | Refusal;

/** A match as its owners see it: the two characters (lower id first), each one's answer about a date, and the state. */
export type MatchView = {
  lo: string;
  hi: string;
  matched_at: string;
  yes_lo: boolean | null;
  yes_hi: boolean | null;
  agreed: boolean;
};

export type SwipeResult = { ok: true; liked: boolean; match: MatchView | null } | Refusal;

const promptLabel = new Map<string, string>(PROFILE_PROMPTS.map((p) => [p.id, p.label]));

function toCard(p: DatingProfile, why: string[], likedYou = false): DeckCard {
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    pronouns: p.pronouns,
    bio: p.bio,
    traits: p.traits,
    looking_for: p.want,
    occupation: p.extras.occupation ?? null,
    hometown: p.extras.hometown ?? null,
    prompts: (p.extras.prompts ?? []).map((q) => ({ prompt: promptLabel.get(q.id) ?? q.id, answer: q.answer })),
    interests: p.extras.hobbies ?? [],
    kind: kindLabel(p.extras),
    archetype: archetypeLabel(p.extras.archetype),
    here_for: goalLabel(p.extras.here_for),
    facts: (p.extras.facts ?? []).map(factLine), // public only: the profile came through toProfile
    portrait: p.portrait,
    hue: p.hue,
    house: p.made_by === "house",
    made_by: p.made_by,
    why,
    liked_you: likedYou,
  };
}

type Mine = ProfileRow & { taken: boolean };

/** One of the user's own characters (never a house one), and whether it's taken (with a partner and wanting one). */
async function loadMine(db: Db, userId: string, characterId: string): Promise<Mine | null> {
  const { rows } = await db.query<Mine>(
    `select ${PUBLIC_COLUMNS}, ${takenSql("c")} as taken from characters c where c.id = $1 and c.owner_id = $2 and not c.is_house`,
    [characterId, userId],
  );
  return rows[0] ?? null;
}

/** Why `mine` can't swipe right now, or null. */
function cantSwipe(mine: Mine | null): Refusal | null {
  if (!mine) return refuse(404, "not_your_character", "Swipe for one of your own characters.");
  // #514: the rule and the field that changes it, named.
  if (mine.taken) {
    return refuse(409, "taken", `${shortName(mine.name)} is with someone and wants one partner (a Dating couple), so they're out of the deck and closed to other dates. To reopen them, ${REOPEN_HOW}.`);
  }
  const missing = profileMissing(mine.extras);
  if (missing.length) return refuse(409, "profile_incomplete", `Finish ${shortName(mine.name)}'s dating profile to swipe: ${missing.join(", ")}.`, missing);
  return null;
}

/**
 * Who could be in `mine`'s deck: this season's house cast, and characters in the deck (open to dates, a complete
 * dating profile, open to characters like this one) that aren't yours, taken or across a block. Never someone it has
 * matched or dated already. `only` narrows it to one character (a swipe's target). Swiped ones are left out unless
 * `includeSwiped`.
 */
async function deckPool(db: Db, userId: string, mine: Mine, opts: { only?: string; includeSwiped?: boolean } = {}): Promise<ProfileRow[]> {
  const { rows } = await db.query<ProfileRow>(
    `select ${PUBLIC_COLUMNS} from characters c
      where c.id <> $2 and ($4::text is null or c.id = $4)
        and ((c.is_house and c.premium_sku is null and c.id = any($3))
             or (not c.is_house and c.open_to_dates and c.visibility <> 'private' and c.owner_id <> $1 and not ${takenSql("c")}
                 and not exists (select 1 from blocks bl
                                  where (bl.blocker_id = $1 and bl.blocked_id = c.owner_id) or (bl.blocker_id = c.owner_id and bl.blocked_id = $1))))
        and ($5::boolean or not exists (select 1 from swipes s where s.swiper = $2 and s.target = c.id))
        and not exists (select 1 from matches m
                         where (m.character_lo = c.id and m.character_hi = $2) or (m.character_lo = $2 and m.character_hi = c.id))
        and not exists (select 1 from relationships r
                         where r.dates > 0 and ((r.character_a = c.id and r.character_b = $2) or (r.character_a = $2 and r.character_b = c.id)))
      order by c.created_at desc, c.id
      limit 300`,
    [userId, mine.id, seasonCastIds(), opts.only ?? null, Boolean(opts.includeSwiped)],
  );
  return rows.filter((r) => r.is_house || (audienceAllows(r.open_audience, mine.created_via) && profileComplete(r.extras)));
}

/**
 * The next cards in one of your characters' deck, best first: ranked like find_matches (shared traits and interests,
 * what each wants, what the show has learned, a popularity damper), with the reasons. Someone who already liked your
 * character ranks a little higher, and (#443, David 2026-10-21) its card says so: liked_you, "Liked you". Only on its
 * own card, as a flag: there's no list of who liked you anywhere.
 *
 * `only`: just that one card, scored as the deck scores it, even once it's been swiped (what logShownCard records).
 */
export async function deckFor(db: Db, userId: string, characterId: string, limit = DECK_PAGE, opts: { only?: string } = {}): Promise<DeckResult> {
  const mine = await loadMine(db, userId, characterId);
  const no = cantSwipe(mine);
  if (no || !mine) return no!;
  const pool = (await deckPool(db, userId, mine, opts.only ? { only: opts.only, includeSwiped: true } : {})).map((r) => toProfile(r));
  if (!pool.length) return { ok: true, for: { id: mine.id, name: mine.name }, cards: [], scores: {} };
  const [ranked, likers] = await Promise.all([
    rankFor(db, userId, toProfile(mine), pool),
    db.query<{ swiper: string }>(`select swiper from swipes where target = $1 and liked`, [mine.id]),
  ]);
  const likedMine = new Set(likers.rows.map((r) => r.swiper));
  // Drawn-to (lib/kinds.ts): a small nudge toward the kinds this character is into. Only the deck's order: rankFor also
  // decides a person's character's answer to a match and find_matches, which stay as they were. Never a filter.
  const drawnTo = toProfile(mine).extras.drawn_to ?? [];
  const kindOf = new Map(pool.map((p) => [p.id, p.extras.kind ?? null]));
  const boost = (id: string) => (likedMine.has(id) ? 2 : 0) + drawnToBoost(drawnTo, kindOf.get(id));
  for (const m of ranked) {
    const kind = kindOf.get(m.id);
    if (drawnToBoost(drawnTo, kind)) m.why.push(`${shortName(mine.name)} is drawn to ${kindName(kind!, "many").toLowerCase()}`);
  }
  ranked.sort((a, b) => b.score + boost(b.id) - (a.score + boost(a.id)));
  // The house crowd (lib/house-bots.ts) fills in around everyone else: at most a third of a page.
  const bots = opts.only ? new Set<string>() : await houseBotCharacterIds(db, ranked.map((m) => m.id));
  const dealt = capHouseBots(ranked, bots, Math.max(1, Math.min(30, limit)));
  return {
    ok: true,
    for: { id: mine.id, name: mine.name },
    cards: dealt.map((m) => toCard(m, m.why, likedMine.has(m.id))),
    scores: Object.fromEntries(dealt.map((m) => [m.id, m.score + boost(m.id)])),
  };
}

/**
 * A viewer and a card make one impression at most this often, whatever the surface or serve: an agent calling
 * swipe_deck again, or a person reloading the deck, sees the same cards again, and counting each repeat would inflate
 * the shown-and-skipped record (the 2026-10-22 review of the data plan).
 */
export const IMPRESSION_DEDUPE_MINUTES = 10;
/** The highest rank stored (swipe_impressions.rank is a smallint; nobody sees a thousand cards in one sitting). */
const MAX_RANK = 1000;

/**
 * Logs the cards a deck actually showed (data plan Tier 1): who saw whom, at what rank and score, on which surface.
 * With the swipes, that's the shown-and-skipped record a preference model needs (a swipe alone has no negatives).
 *  - MCP: what swipe_deck returns is what the agent sees, ranked 1..N in that reply.
 *  - Web: one card at a time, the one on top when it's shown (logShownCard), never the whole hand that was dealt.
 * `ranks`: each card's rank in what was seen (default its position here); `serveId`: the deck session it belongs to
 * (default a new one). A card this viewer was shown in the last IMPRESSION_DEDUPE_MINUTES isn't logged again. One
 * insert per call; best effort, so a failed log never costs anyone their deck. Returns how many rows went in. Pruned
 * after 400 days (lib/retention.ts).
 */
export async function logImpressions(
  db: Db,
  viewer: string,
  cards: { id: string; liked_you: boolean }[],
  scores: Record<string, number>,
  via: "web" | "mcp",
  opts: { serveId?: string; ranks?: number[] } = {},
): Promise<number> {
  if (!cards.length) return 0;
  const ranks = cards.map((_, i) => Math.max(1, Math.min(MAX_RANK, Math.floor(opts.ranks?.[i] ?? i + 1))));
  return db
    .query<{ card: string }>(
      `insert into swipe_impressions (viewer, card, serve_id, rank, score, liked_you, served_via)
       select $1, x.card, $2, x.rank, x.score, x.liked_you, $3
         from unnest($4::text[], $5::int[], $6::real[], $7::boolean[]) as x(card, rank, score, liked_you)
        where not exists (select 1 from swipe_impressions p
                           where p.viewer = $1 and p.card = x.card and p.at > now() - ($8 || ' minutes')::interval)
       returning card`,
      [
        viewer,
        opts.serveId ?? crypto.randomUUID(),
        via,
        cards.map((c) => c.id),
        ranks,
        cards.map((c) => scores[c.id] ?? null),
        cards.map((c) => c.liked_you),
        String(IMPRESSION_DEDUPE_MINUTES),
      ],
    )
    .then((r) => r.rows.length)
    .catch(() => 0);
}

/** A web deck session's id (the swipe page makes one per visit): what logShownCard groups a sitting's cards by. */
export const SERVE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The web deck's impression (/swipe, app/api/swipes/seen): the card on top, logged when it's shown, with its rank in
 * what this person has seen in this deck session (`rank`, counted by the page) and the score the deck gives it (kept on
 * the server, never sent to the page). Only a card in this character's deck, for its owner; a repeat within
 * IMPRESSION_DEDUPE_MINUTES is a no-op. `logged`: whether a row went in.
 */
export async function logShownCard(
  db: Db,
  userId: string,
  characterId: string,
  cardId: string,
  serveId: string,
  rank: number,
): Promise<{ ok: true; logged: boolean } | Refusal> {
  if (!SERVE_ID.test(serveId)) return refuse(422, "invalid_serve", "serve_id is the deck session's id.");
  if (!cardId || cardId === characterId) return refuse(422, "invalid_card", "card_id is a card in your deck.");
  const deck = await deckFor(db, userId, characterId, 1, { only: cardId });
  if (!deck.ok) return deck;
  if (!deck.cards.length) return refuse(404, "not_in_deck", "That card isn't in this character's deck.");
  return { ok: true, logged: (await logImpressions(db, deck.for.id, deck.cards, deck.scores, "web", { serveId, ranks: [rank] })) > 0 };
}

/**
 * One swipe for one of your characters. Final, once per pair and direction. A like that's mutual (or on a house
 * character) is a match: both owners hear about it, and its opening chat follows (`scheduleMatchChat`).
 */
export async function swipe(db: Db, userId: string, characterId: string, targetId: string, liked: boolean): Promise<SwipeResult> {
  const mine = await loadMine(db, userId, characterId);
  const no = cantSwipe(mine);
  if (no || !mine) return no!;
  if (!targetId || targetId === mine.id) return refuse(422, "invalid_target", "Swipe on someone else: target_id is a character in your deck.");
  const target = (await deckPool(db, userId, mine, { only: targetId, includeSwiped: true }))[0];
  if (!target) {
    const exists = (await db.query(`select 1 from characters where id::text = $1`, [targetId])).rows.length > 0;
    if (!exists) return refuse(404, "not_found", "No character has that id: swipe_deck lists the ids you can swipe on.");
    return refuse(404, "not_in_deck", await notInDeckWhy(db, userId, mine, targetId));
  }
  const stored = await db.query(`insert into swipes (swiper, target, liked) values ($1, $2, $3) on conflict do nothing returning swiper`, [mine.id, target.id, liked]);
  if (!stored.rows.length) {
    return refuse(409, "already_swiped", `${shortName(mine.name)} already swiped on ${shortName(target.name)}, and a swipe is once per pair (#221): a pass is final, and a like can only be undone while it's unanswered, within ${UNDO_MINUTES} minutes.`);
  }
  if (!liked) return { ok: true, liked: false, match: null };
  const likesBack = target.is_house || (await db.query(`select 1 from swipes where swiper = $1 and target = $2 and liked`, [target.id, mine.id])).rows.length > 0;
  return { ok: true, liked: true, match: likesBack ? await createMatch(db, mine.id, target.id) : null };
}

/** How long a like stays undoable while it's unanswered (#622, David 2026-10-22). */
export const UNDO_MINUTES = 10;

export type SwipePreview = {
  ok: true;
  target: { id: string; name: string; house: boolean; liked_you: boolean };
  /** What a like would do now: "match" only when the card already shows liked_you (or it's the house cast, which always likes back). */
  like_would: "match" | "like";
  already_swiped: boolean;
};

/**
 * What a swipe would do, without swiping (#622's preview, David 2026-10-22): the same checks as swipe, and from the target's
 * deck card only. Likes are secret, so "would match" rests on what the swiper can already see: the card's liked_you flag
 * (#443: on every card whose character already liked yours, people's, agents' and house-run bots' alike) and the rule that
 * the house cast always likes back. Without either it's "a like; whether it matches depends on them": never a peek.
 */
export async function previewSwipe(db: Db, userId: string, characterId: string, targetId: string): Promise<SwipePreview | Refusal> {
  const mine = await loadMine(db, userId, characterId);
  const no = cantSwipe(mine);
  if (no || !mine) return no!;
  if (!targetId || targetId === mine.id) return refuse(422, "invalid_target", "Swipe on someone else: target_id is a character in your deck.");
  const target = (await deckPool(db, userId, mine, { only: targetId, includeSwiped: true }))[0];
  if (!target) {
    const exists = (await db.query(`select 1 from characters where id::text = $1`, [targetId])).rows.length > 0;
    if (!exists) return refuse(404, "not_found", "No character has that id: swipe_deck lists the ids you can swipe on.");
    return refuse(404, "not_in_deck", await notInDeckWhy(db, userId, mine, targetId));
  }
  // The same flag deckFor puts on this character's card (likedMine), read the same way: nothing a card wouldn't show.
  const [likedYou, swiped] = await Promise.all([
    db.query(`select 1 from swipes where swiper = $1 and target = $2 and liked`, [target.id, mine.id]).then((q) => q.rows.length > 0),
    db.query(`select 1 from swipes where swiper = $1 and target = $2`, [mine.id, target.id]).then((q) => q.rows.length > 0),
  ]);
  return {
    ok: true,
    target: { id: target.id, name: target.name, house: target.is_house, liked_you: likedYou },
    like_would: target.is_house || likedYou ? "match" : "like",
    already_swiped: swiped,
  };
}

export type UndoResult = { ok: true; undone: { target: { id: string; name: string }; liked_at: string } } | Refusal;

/**
 * Takes back one of your own likes (#622's undo, David 2026-10-22): only while it's unanswered (no match), and within
 * UNDO_MINUTES of it. A pass stays final, and so does a like that made a match (both owners were told).
 *
 * Why it can't reveal anything (likes are secret): an undo is allowed exactly when there's no match, and the swipe's own
 * reply already said so (matched: false: they haven't liked you back yet), while a like they'd already given shows on their
 * card (liked_you) before you ever swipe. So undoing tells the swiper nothing it didn't know, and since a like alone tells
 * the other side nothing (no notice, no list; only a liked_you flag on its own deck card), taking it back leaves no trace
 * there either: the flag goes with it, and the card comes back to the swiper's deck.
 */
export async function undoLike(db: Db, userId: string, characterId: string, targetId: string): Promise<UndoResult> {
  const mine = (await db.query<{ id: string; name: string }>(`select id, name from characters where id = $1 and owner_id = $2 and not is_house`, [characterId, userId])).rows[0];
  if (!mine) return refuse(404, "not_your_character", "Undo a like for one of your own characters.");
  const them = (await db.query<{ id: string; name: string }>(`select id, name from characters where id::text = $1`, [targetId])).rows[0];
  if (!them) return refuse(404, "not_found", "No character has that id.");
  const row = (
    await db.query<{ liked: boolean; at: string | Date; minutes: number }>(
      `select liked, created_at as at, extract(epoch from now() - created_at)::float / 60 as minutes from swipes where swiper = $1 and target = $2`,
      [mine.id, them.id],
    )
  ).rows[0];
  const [x, y] = [shortName(mine.name), shortName(them.name)];
  if (!row) return refuse(404, "no_swipe", `${x} hasn't swiped on ${y}: there's nothing to undo.`);
  if (!row.liked) return refuse(409, "pass_is_final", `${x} passed on ${y}, and a pass is final: only an unanswered like can be undone.`);
  if (await matchView(db, mine.id, them.id)) {
    return refuse(409, "already_matched", `${x} and ${y} have matched, so the like can't be undone: both owners were told. answer_match with yes: false says no to a date instead.`);
  }
  if (row.minutes > UNDO_MINUTES) {
    return refuse(409, "too_late", `${x}'s like on ${y} is ${Math.floor(row.minutes)} minutes old: a like can be undone only within ${UNDO_MINUTES} minutes, so it stands.`);
  }
  // One statement, so a like back landing meanwhile can't be undone underneath it (the match check is in the same delete).
  const [lo, hi] = pairKey(mine.id, them.id);
  const gone = await db.query(
    `delete from swipes where swiper = $1 and target = $2 and liked and created_at > now() - ($3 || ' minutes')::interval
        and not exists (select 1 from matches m where m.character_lo = $4 and m.character_hi = $5)
      returning swiper`,
    [mine.id, them.id, String(UNDO_MINUTES), lo, hi],
  );
  // A like back that made the match between the check and the delete: the like is put back as it was, and it's refused.
  if (gone.rows.length && (await matchView(db, mine.id, them.id))) {
    await db.query(`insert into swipes (swiper, target, liked, created_at) values ($1, $2, true, $3) on conflict do nothing`, [mine.id, them.id, row.at]);
    return refuse(409, "already_matched", `${x} and ${y} matched just now, so the like stands.`);
  }
  if (!gone.rows.length) return refuse(409, "already_matched", `${x}'s like on ${y} can't be undone now: it was just answered, or is ${UNDO_MINUTES} minutes old.`);
  return { ok: true, undone: { target: { id: them.id, name: them.name }, liked_at: new Date(row.at).toISOString() } };
}

/**
 * Why a character that exists isn't in `mine`'s deck, as the one reason that applied (#492: one message listed four
 * causes). A block is never named (the generic line covers it), and nor is a private character's privacy.
 */
async function notInDeckWhy(db: Db, userId: string, mine: Mine, targetId: string): Promise<string> {
  const generic = "They're not in your deck: swipe_deck lists who is.";
  const c = (
    await db.query<ProfileRow & { owner_id: string | null; visibility: string; taken: boolean; matched: boolean; dated: boolean }>(
      `select ${PUBLIC_COLUMNS}, c.owner_id, c.visibility, ${takenSql("c")} as taken,
              exists (select 1 from matches m where (m.character_lo = c.id and m.character_hi = $2) or (m.character_lo = $2 and m.character_hi = c.id)) as matched,
              exists (select 1 from relationships r where r.dates > 0 and ((r.character_a = c.id and r.character_b = $2) or (r.character_a = $2 and r.character_b = c.id))) as dated
         from characters c where c.id = $1`,
      [targetId, mine.id],
    )
  ).rows[0];
  if (!c) return generic;
  const them = shortName(c.name);
  if (c.matched) return `${shortName(mine.name)} and ${them} are already matched: text them (send_text), or answer_match about a date.`;
  if (c.dated) return `${shortName(mine.name)} and ${them} have dated already, so there's nothing to swipe: go_on_date with them books the next one.`;
  if (c.owner_id === userId) return `${them} is one of your own characters: a character doesn't swipe on its owner's others (start_own_date plays a date between two of yours).`;
  if (c.is_house) return `${them} is off this season's house cast, so they can't be swiped or booked until they're back on it.`;
  if (c.taken) return `${them} is with someone and wants one partner, so they're out of every deck for now.`;
  if (!c.open_to_dates || c.visibility === "private") return `${them} isn't in the swipe deck: their creator hasn't opened them to dates.`;
  if (!audienceAllows(c.open_audience, mine.created_via)) return `${them} is open only to characters made by ${c.open_audience === "people" ? "people" : "agents"}, not to ${shortName(mine.name)}.`;
  if (!profileComplete(c.extras)) return `${them} isn't in the deck yet: their dating profile isn't finished.`;
  return generic;
}

type Side = { id: string; name: string; owner_id: string | null; is_house: boolean; created_via: string };

/** A person's character's own answer about a date with `other`: likelier the better they suit, seeded so it's repeatable. */
async function personAnswers(db: Db, me: Side, other: Side, lo: string, hi: string): Promise<boolean> {
  const rows = (await db.query<ProfileRow>(`select ${PUBLIC_COLUMNS} from characters c where c.id = any($1)`, [[me.id, other.id]])).rows;
  const meRow = rows.find((r) => r.id === me.id);
  const otherRow = rows.find((r) => r.id === other.id);
  const score = meRow && otherRow ? ((await rankFor(db, me.owner_id ?? "", toProfile(meRow), [toProfile(otherRow)]))[0]?.score ?? 0) : 0;
  const chance = Math.max(0.4, Math.min(0.95, 0.75 + 0.05 * score));
  return (seedFrom("match-yes", lo, hi, me.id) % 10_000) / 10_000 < chance;
}

/**
 * Where a match answer came from (matches.answer_source_*): the house character's automatic yes, the seeded coin that
 * answers for a person's character (`personAnswers`: synthetic, not a choice anyone made), or an agent (answerMatch;
 * house_bot when it's one of the show's own scripts). Only the agent's is a real decision, which is what a model of
 * who wants whom must know. 'person' is kept for when people answer for their own characters.
 */
export type AnswerSource = "house" | "synthetic" | "agent" | "house_bot" | "person";

/** Each side's answer about a date: a house character says yes, a person's character decides, an agent's waits for its agent. */
async function decideAnswers(
  db: Db,
  lo: Side,
  hi: Side,
): Promise<{ lo: boolean | null; hi: boolean | null; source_lo: AnswerSource | null; source_hi: AnswerSource | null }> {
  const answer = async (me: Side, other: Side) =>
    me.is_house ? true : me.created_via === "mcp" ? null : await personAnswers(db, me, other, lo.id, hi.id);
  const source = (me: Side): AnswerSource | null => (me.is_house ? "house" : me.created_via === "mcp" ? null : "synthetic");
  return { lo: await answer(lo, hi), hi: await answer(hi, lo), source_lo: source(lo), source_hi: source(hi) };
}

async function sides(db: Db, lo: string, hi: string): Promise<[Side, Side] | null> {
  const { rows } = await db.query<Side>(`select id, name, owner_id, is_house, created_via from characters where id = any($1)`, [[lo, hi]]);
  const a = rows.find((r) => r.id === lo);
  const b = rows.find((r) => r.id === hi);
  return a && b ? [a, b] : null;
}

/** Makes the match (idempotent), decides each side's answer, and tells both owners. */
export async function createMatch(db: Db, x: string, y: string): Promise<MatchView> {
  const [lo, hi] = pairKey(x, y);
  const made = await db.query(`insert into matches (character_lo, character_hi) values ($1, $2) on conflict do nothing returning matched_at`, [lo, hi]);
  const pair = await sides(db, lo, hi);
  if (made.rows.length && pair) {
    const answers = await decideAnswers(db, pair[0], pair[1]);
    await db.query(
      `update matches set yes_lo = $3, yes_hi = $4, answer_source_lo = $5, answer_source_hi = $6 where character_lo = $1 and character_hi = $2`,
      [lo, hi, answers.lo, answers.hi, answers.source_lo, answers.source_hi],
    );
    const owners = new Set([pair[0].owner_id, pair[1].owner_id].filter((o): o is string => Boolean(o)));
    for (const owner of owners) {
      await notify(db, owner, {
        kind: "matched",
        title: `💘 It's a match: ${pair[0].name} and ${pair[1].name}`,
        body: matchedBody(pair, owner),
        link: `/messages/${lo}/${hi}`,
      });
    }
  }
  return (await matchView(db, lo, hi))!;
}

export type MatchStatus = "waiting_on_them" | "waiting_on_you" | "both_waiting" | "they_said_no" | "you_said_no" | "agreed";

/**
 * A match's answers in words (#323): null is "hasn't answered yet", false is "said no". A no carries no reason.
 * #618 (2026-10-21-2300 run, three visitors): "matched" read as "can date", so every note says which of the two it is:
 * matched, and a date needs both to say yes.
 */
export function matchStatus(you: boolean | null, them: boolean | null): { status: MatchStatus; note: string } {
  if (you === true && them === true) return { status: "agreed", note: "Matched, and both said yes: the date is agreed and yours to book." };
  if (you === false) return { status: "you_said_no", note: "Matched, but your character said no to a date (answers are final). You can still text." };
  if (them === false) return { status: "they_said_no", note: "Matched, but they said no to a date. You can still text." };
  if (you === null && them === null) return { status: "both_waiting", note: "Matched, not agreed yet: a date needs both to say yes, and neither side has answered (yours: answer_match)." };
  if (you === null) return { status: "waiting_on_you", note: "Matched, not agreed yet: they said yes to a date and your character hasn't answered (answer_match)." };
  return { status: "waiting_on_them", note: "Matched, not agreed yet: your character said yes and they haven't answered. my_status lists it under dates_to_book once they do." };
}

/** Who a match's date waits on, from the asking side: its own yes, the other's, or both. */
const WAITING_ON: Partial<Record<MatchStatus, "you" | "them" | "both">> = { waiting_on_you: "you", waiting_on_them: "them", both_waiting: "both" };

/**
 * Why two characters can't have a first date yet, naming the real state (#618, the 2026-10-21-2300 run: start_own_date
 * told two visitors "haven't matched yet" when they had matched; what was missing was a yes to a date). Null once both
 * said yes. `mine` is the asking agent's character, so answer_match is its own call; `pair` is how to name the two
 * (pairNames: full names when the first names collide).
 */
export async function dateNotAgreed(
  db: Db,
  mine: { id: string },
  theirs: { id: string },
  pair: [string, string],
): Promise<{ status: MatchStatus | "not_matched"; waiting_on: "you" | "them" | "both" | null; message: string } | null> {
  const m = await matchView(db, mine.id, theirs.id);
  const [x, y] = pair;
  if (!m) {
    return {
      status: "not_matched",
      waiting_on: null,
      message: `${x} and ${y} haven't matched yet. Match first: swipe_deck, then swipe (a like back makes the match); then a date needs both to say yes (answer_match).`,
    };
  }
  if (m.agreed) return null;
  const mineLo = m.lo === mine.id;
  const you = mineLo ? m.yes_lo : m.yes_hi;
  const them = mineLo ? m.yes_hi : m.yes_lo;
  const { status } = matchStatus(you, them);
  const yes = `answer_match (character_id: "${mine.id}", with: "${theirs.id}", yes: true)`;
  const message =
    status === "both_waiting"
      ? `${x} and ${y} have matched, but a date needs both to say yes and neither has answered yet. ${x}'s yes: ${yes}; then it waits on ${y}'s side.`
      : status === "waiting_on_you"
        ? `${x} and ${y} have matched and ${y} said yes to a date; ${x} hasn't answered. ${yes} agrees it, and then it can be booked.`
        : status === "waiting_on_them"
          ? `${x} and ${y} have matched and ${x} said yes; a date needs ${y}'s yes too, and ${y}'s side hasn't answered. my_status lists it under dates_to_book once it does (text them meanwhile: send_text).`
          : status === "they_said_no"
            ? `${x} and ${y} have matched, but ${y} said no to a date, so it can't be booked. They can still text.`
            : `${x} said no to a date with ${y} (answers are final), so it can't be booked. They can still text.`;
  return { status, waiting_on: WAITING_ON[status] ?? null, message };
}

/** The match between two characters, or null. */
export async function matchView(db: Db, x: string, y: string): Promise<MatchView | null> {
  const [lo, hi] = pairKey(x, y);
  const r = (
    await db.query<{ matched_at: string | Date; yes_lo: boolean | null; yes_hi: boolean | null }>(
      `select matched_at, yes_lo, yes_hi from matches where character_lo = $1 and character_hi = $2`,
      [lo, hi],
    )
  ).rows[0];
  return r ? { lo, hi, matched_at: new Date(r.matched_at).toISOString(), yes_lo: r.yes_lo, yes_hi: r.yes_hi, agreed: r.yes_lo === true && r.yes_hi === true } : null;
}

/** SQL that's true when the character (`alias`) and `otherParam` matched and both said yes to a date. */
export const agreedMatchSql = (alias: string, otherParam: string) => `exists (
  select 1 from matches m
   where m.yes_lo and m.yes_hi
     and ((m.character_lo = ${alias}.id and m.character_hi = ${otherParam}::text) or (m.character_lo = ${otherParam}::text and m.character_hi = ${alias}.id)))`;

/** True when two characters have matched and both said yes to a date: the date can be booked. */
export async function agreedMatch(db: Db, x: string, y: string): Promise<boolean> {
  return (await matchView(db, x, y))?.agreed ?? false;
}

/**
 * What a match means for this owner (2.4.2's notice audit): a person's characters text on their own and get booked from
 * their page; an agent has neither, so its notice names the calls (texting is the agent's to do, and so is the yes).
 */
function matchedBody(pair: [Side, Side], owner: string): string {
  const mine = pair.find((c) => c.owner_id === owner && c.created_via === "mcp");
  if (!mine) return "They're texting now. If they both want a date, you can book it from their page.";
  const other = mine === pair[0] ? pair[1] : pair[0];
  return `Text them with send_text (character_id: "${mine.id}", to: "${other.id}") and say whether ${shortName(mine.name)} wants a date with answer_match. When both say yes, the date can be booked.`;
}

/** How the owner books it (#314): an agent has no 📅 Book date button, so its character's notice names the tool call. */
function agreedBody(pair: [Side, Side], owner: string, starter: Side | null, texter: Side | null = null): string {
  // 2.4.3 (the 2026-10-21-0419 run): whose like came first and who performs each side, however it's booked. A body keeps
  // to 300 characters (lib/notifications.ts), ids included. 2.6.0 (the 2026-10-22-0042 run: "Started by Hector (liked
  // first)" read as "Hector started the conversation", when Hollis had texted first): each said as what it is.
  const liked = starter ? `${shortName(starter.name)} liked first` : "They liked each other";
  const started = `${liked}${texter ? `; ${shortName(texter.name)} texted first` : ""}. `;
  const mine = pair.find((c) => c.owner_id === owner && c.created_via === "mcp");
  if (!mine) return `${started}Book it from their chat: 📅 Book date, at the top. The show's model performs both sides.`;
  const other = mine === pair[0] ? pair[1] : pair[0];
  const call = `go_on_date (character_id: "${mine.id}", partner_id: "${other.id}")`;
  const show = "the show's model performs both sides.";
  if (other.owner_id === owner) return `${started}Book it with ${call}: ${show} Or start_own_date: you perform both.`;
  return other.created_via === "mcp"
    ? `${started}Book it with ${call}: ${show} Or start_own_date, same ids: you perform ${shortName(mine.name)}, their agent ${shortName(other.name)}.`
    : `${started}Book it with ${call}: ${show}`;
}

/** Records the moment both said yes (the chain's "📅 Date agreed") and tells both owners, once. */
export async function settleAgreement(db: Db, x: string, y: string): Promise<boolean> {
  const [lo, hi] = pairKey(x, y);
  const settled = await db.query(
    `update matches set agreed_at = now() where character_lo = $1 and character_hi = $2 and yes_lo and yes_hi and agreed_at is null returning agreed_at`,
    [lo, hi],
  );
  if (!settled.rows.length) return false;
  const pair = await sides(db, lo, hi);
  if (pair) {
    const owners = new Set([pair[0].owner_id, pair[1].owner_id].filter((o): o is string => Boolean(o)));
    const first = (await db.query<{ swiper: string }>(`select swiper from swipes where liked and ((swiper = $1 and target = $2) or (swiper = $2 and target = $1)) order by created_at limit 1`, [lo, hi]).catch(() => ({ rows: [] as { swiper: string }[] }))).rows[0]?.swiper;
    const starter = pair.find((c) => c.id === first) ?? null;
    // 2.6.0: and whose text came first, when they've texted.
    const firstText = (await db.query<{ who: "lo" | "hi" }>(`select who from couple_texts where character_lo = $1 and character_hi = $2 order by created_at, day, seq limit 1`, [lo, hi]).catch(() => ({ rows: [] as { who: "lo" | "hi" }[] }))).rows[0]?.who;
    const texter = firstText === "lo" ? pair[0] : firstText === "hi" ? pair[1] : null;
    for (const owner of owners) {
      await notify(db, owner, {
        kind: "date_agreed",
        title: `📅 ${pair[0].name} and ${pair[1].name} want to go on a date`,
        body: agreedBody(pair, owner, starter, texter),
        link: `/messages/${lo}/${hi}`,
      });
    }
  }
  return true;
}

export type AnswerResult = { ok: true; match: MatchView; status: MatchStatus; note: string } | Refusal;

/** An agent answers for its own character: does it want a date with the one it matched? Final. */
export async function answerMatch(db: Db, userId: string, characterId: string, withId: string, yes: boolean): Promise<AnswerResult> {
  const own = (await db.query<{ created_via: string }>(`select created_via from characters where id = $1 and owner_id = $2 and not is_house`, [characterId, userId])).rows[0];
  if (!own) return refuse(404, "not_your_character", "Answer for one of your own characters.");
  if (own.created_via !== "mcp") return refuse(409, "decides_itself", "A person's character answers for itself: its owner swipes, the character decides.");
  const m = await matchView(db, characterId, withId);
  if (!m) return refuse(404, "no_match", "They haven't matched. Swipe first (swipe_deck, swipe).");
  const side: End = characterId === m.lo ? "lo" : "hi";
  if ((side === "lo" ? m.yes_lo : m.yes_hi) !== null) return refuse(409, "already_answered", "Your character already answered.");
  // A real decision, unlike a person's character's synthetic answer: tagged so a preference model can tell (AnswerSource).
  const source: AnswerSource = (await isHouseBotAgent(db, userId).catch(() => false)) ? "house_bot" : "agent";
  await db.query(
    `update matches set ${side === "lo" ? "yes_lo" : "yes_hi"} = $3, ${side === "lo" ? "answer_source_lo" : "answer_source_hi"} = $4
      where character_lo = $1 and character_hi = $2`,
    [m.lo, m.hi, yes, source],
  );
  await settleAgreement(db, m.lo, m.hi);
  const after = (await matchView(db, m.lo, m.hi))!;
  const [you, them] = side === "lo" ? [after.yes_lo, after.yes_hi] : [after.yes_hi, after.yes_lo];
  return { ok: true, match: after, ...matchStatus(you, them) };
}

/* ------------------------------------------ the opening chat ------------------------------------------ */

let matchChatEnabled = true;
/** Tests switch the opening chat off (the shared harness), like the afterglow; the chat's own tests call it directly. */
export function setMatchChatEnabledForTests(on: boolean): void {
  matchChatEnabled = on;
}

/** What a character privately knows about how this chat ends, at this point in it (`last`: its final text for now). */
function answerNote(yes: boolean, last: boolean): string {
  if (yes) {
    return last
      ? "You'd like to go on a date with them. In this text, suggest something specific to do together, or say yes to their idea."
      : "You'd like to go on a date with them. For now, be curious about something on their profile.";
  }
  return last ? "You're not feeling it. Wind it down kindly, and don't agree to a date." : "You're not feeling it. Stay friendly and light.";
}

/** One opening-chat text, critiqued for repetition (lib/text-critic.ts) like every other text. */
function writeLine(model: Model, messages: ChatMessage[], me: Character, them: Character, thread: ThreadText[]): Promise<string | null> {
  return writeCritiquedText(model, messages, (raw) => parseAfterglowLine(raw, "a", AFTERGLOW_TEXT_MAX)?.text ?? null, (text) => critiqueText(thread, text, me, them), "swipes");
}

/**
 * A new match's first texts, on the show's free model, performing each side's answer: two each when both are the
 * show's to write (a house character or a person's), one when the other side is an agent's (it writes its own, with
 * send_text). Once per match, within the show-wide daily cap. Then, if both said yes, the date is agreed. Best effort:
 * a failed text just ends the chat early. Returns how many texts it sent.
 */
export async function startMatchChat(db: Db, x: string, y: string, model: Model = getModel(undefined, false), now = new Date()): Promise<number> {
  const [lo, hi] = pairKey(x, y);
  let sent = 0;
  try {
    const m = await matchView(db, lo, hi);
    const pair = await sides(db, lo, hi);
    if (!m || !pair || !matchChatEnabled) return 0;
    const ours = (s: Side) => s.created_via !== "mcp";
    const writers = (["lo", "hi"] as const).filter((e) => ours(pair[e === "lo" ? 0 : 1]));
    if (!writers.length) return 0;
    const already = await db.query(`select 1 from couple_texts where character_lo = $1 and character_hi = $2 and via = 'match' limit 1`, [lo, hi]);
    if (already.rows.length) return 0;
    const today = await db.query<{ n: number }>(`select count(distinct (character_lo, character_hi))::int as n from couple_texts where day = $1::date and via = 'match'`, [dayOf(now)]);
    if ((today.rows[0]?.n ?? 0) >= matchChatDailyCap()) return 0;
    const [a, b] = await Promise.all([loadCharacter(db, lo), loadCharacter(db, hi)]);
    if (!a || !b) return 0;
    // Who opens: a person's character before a house one; between two of a kind, the seed decides.
    const personFirst = writers.find((e) => !pair[e === "lo" ? 0 : 1].is_house);
    const opener: End = writers.length === 1 ? writers[0] : (personFirst && pair[0].is_house !== pair[1].is_house ? personFirst : seedFrom("match-opens", lo, hi) % 2 === 0 ? "lo" : "hi");
    const other: End = opener === "lo" ? "hi" : "lo";
    const order: End[] = writers.length === 2 ? ([opener, other, opener, other] as End[]).slice(0, MATCH_CHAT_TEXTS) : [opener];
    for (let i = 0; i < order.length; i++) {
      const who = order[i];
      const me = who === "lo" ? a : b;
      const them = who === "lo" ? b : a;
      const yes = (who === "lo" ? m.yes_lo : m.yes_hi) === true;
      const last = !order.slice(i + 1).includes(who);
      const thread = threadFor(await loadChain(db, lo, hi, PUBLIC_VIEWER), a.name, b.name, SHOW_THREAD_CHARS);
      const messages = buildTextMessages(me, them, null, thread, { nudge: null, alsoSeeing: [], matched: true, reply: thread.length > 0, answer: answerNote(yes, last) });
      const line = await writeLine(model, messages, me, them, thread);
      if (!line) break;
      await insertText(db, lo, hi, who, line, "match", now);
      sent++;
    }
    return sent;
  } finally {
    await settleAgreement(db, lo, hi);
  }
}

/** Runs a new match's opening chat after the response in production, or now in tests and local runs. */
export async function scheduleMatchChat(db: Db, x: string, y: string): Promise<void> {
  const run = () => startMatchChat(db, x, y).catch((err) => console.error("[swipes] opening chat failed:", err instanceof Error ? err.message : "unknown"));
  if (inlineGenerationEnabled()) {
    await run();
    return;
  }
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
}

/* ---------------------------------------------- matches ---------------------------------------------- */

export type MyMatch = {
  with: { id: string; name: string; house: boolean; made_by: MadeBy; portrait: string | null; hue: number | null };
  matched_at: string;
  /** Your character's answer about a date, and theirs (null: not given yet). */
  you: boolean | null;
  them: boolean | null;
  agreed: boolean;
  couple_page: string;
};

/** One of your characters' matches, newest first. Null if it isn't yours. */
export async function myMatches(db: Db, userId: string, characterId: string): Promise<MyMatch[] | null> {
  const own = (await db.query(`select 1 from characters where id = $1 and owner_id = $2`, [characterId, userId])).rows.length > 0;
  if (!own) return null;
  const { rows } = await db.query<ProfileRow & { lo: string; hi: string; matched_at: string | Date; yes_lo: boolean | null; yes_hi: boolean | null }>(
    `select ${PUBLIC_COLUMNS}, m.character_lo as lo, m.character_hi as hi, m.matched_at, m.yes_lo, m.yes_hi
       from matches m
       join characters c on c.id = case when m.character_lo = $1 then m.character_hi else m.character_lo end
      where $1 in (m.character_lo, m.character_hi)
      order by m.matched_at desc
      limit 100`,
    [characterId],
  );
  return rows.map((r) => {
    const p = toProfile(r);
    const mineLo = r.lo === characterId;
    return {
      with: { id: p.id, name: p.name, house: p.made_by === "house", made_by: p.made_by, portrait: p.portrait, hue: p.hue },
      matched_at: new Date(r.matched_at).toISOString(),
      you: mineLo ? r.yes_lo : r.yes_hi,
      them: mineLo ? r.yes_hi : r.yes_lo,
      agreed: r.yes_lo === true && r.yes_hi === true,
      ...matchStatus(mineLo ? r.yes_lo : r.yes_hi, mineLo ? r.yes_hi : r.yes_lo),
      couple_page: `/couples/${r.lo}/${r.hi}`,
    };
  });
}
