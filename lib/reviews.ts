/**
 * Reviews of a character (David, 2026-10-19: "top 2 survive a new season, by popularity; bots and humans can give a
 * review"). One per reviewer per character, 1 to 5 stars and an optional line, from a person on the site or an agent
 * over MCP (review_character). Writing again replaces your review. You can't review your own character.
 *
 * Like the ratings (lib/ratings.ts), a review never touches the engine, a date's outcome or anyone's points. It feeds
 * the character's card and, for the house cast, which two stay on for the next season (lib/season-cast.ts).
 */
import { recordChoice } from "./choice-history";
import type { Db } from "./db";
import { checkFields } from "./safety";

export const REVIEW_MAX = 280;
/**
 * A review is said to someone's face (their character's card, which its owner reads), so on top of the show's rules
 * (checkFields): no telling anyone to hurt themselves.
 */
const ABUSE = /\b(?:kill|hang|neck|end) (?:yo)?u?r ?(?:self|selves)\b|\bkys\b|\bgo (?:and )?die\b|\bhope (?:you|u|they|he|she) dies?\b/i;
/** Popularity's prior: a character with few reviews is pulled toward PRIOR_MEAN as if it had PRIOR_WEIGHT of them. */
const PRIOR_MEAN = 3;
const PRIOR_WEIGHT = 5;

export type Review = { stars: number; body: string | null; via: "web" | "mcp"; at: string; mine: boolean };
export type ReviewSummary = { count: number; average: number | null; mine: Review | null; latest: Review[] };

export type ReviewResult = { ok: true; summary: ReviewSummary } | { ok: false; status: number; error: string; message: string };

/** A house character takes reviews only while on this season's cast (the reviews decide who stays on). */
export async function reviewableNow(characterId: string, now: Date = new Date()): Promise<boolean> {
  // Imported here: lib/season-cast.ts reads this module's popularity.
  const { isOnSeasonCast } = await import("./season-cast");
  return isOnSeasonCast(characterId, now);
}

export async function reviewCharacter(
  db: Db,
  reviewerId: string,
  characterId: string,
  input: { stars: number; body?: string | null },
  via: "web" | "mcp" = "web",
): Promise<ReviewResult> {
  const c = (await db.query<{ owner_id: string | null; is_house: boolean }>(`select owner_id, is_house from characters where id = $1`, [characterId])).rows[0];
  if (!c) return { ok: false, status: 404, error: "character_not_found", message: "No character with that character_id." };
  if (c.owner_id === reviewerId) {
    return { ok: false, status: 403, error: "cannot_review_own", message: "You can't review your own character: character_id is the character being reviewed, not the reviewer." };
  }
  if (c.is_house && !(await reviewableNow(characterId))) {
    return { ok: false, status: 409, error: "not_in_season", message: "Reviews open while a house character is on this season's cast." };
  }
  const stars = Math.round(input.stars);
  if (!(stars >= 1 && stars <= 5)) return { ok: false, status: 400, error: "invalid_stars", message: "Stars are 1 to 5." };
  const body = input.body?.trim().slice(0, REVIEW_MAX) || null;
  if (body) {
    const check = checkFields({ review: body });
    if (!check.ok || ABUSE.test(body)) return { ok: false, status: 422, error: "review_not_allowed", message: "That review can't be posted. Keep it about the character, and kind enough to say to their face." };
  }
  await db.query(
    `insert into character_reviews (reviewer_id, character_id, stars, body, via) values ($1, $2, $3, $4, $5)
     on conflict (reviewer_id, character_id) do update set stars = excluded.stars, body = excluded.body, via = excluded.via, updated_at = now()`,
    [reviewerId, characterId, stars, body, via],
  );
  await recordChoice(db, { kind: "review", userId: reviewerId, characterId, value: { stars, body, via } });
  return { ok: true, summary: await reviewSummary(db, characterId, reviewerId) };
}

/** A character's reviews: how many, the average, the viewer's own, and the latest few with a line. */
export async function reviewSummary(db: Db, characterId: string, viewerId: string | null, latest = 5): Promise<ReviewSummary> {
  const [agg, rows] = await Promise.all([
    db.query<{ n: number; avg: number | null }>(`select count(*)::int as n, avg(stars)::float as avg from character_reviews where character_id = $1`, [characterId]),
    db.query<{ reviewer_id: string; stars: number; body: string | null; via: "web" | "mcp"; updated_at: string }>(
      `(select reviewer_id, stars, body, via, updated_at from character_reviews where character_id = $1 and body is not null order by updated_at desc limit $2)
       union
       (select reviewer_id, stars, body, via, updated_at from character_reviews where character_id = $1 and reviewer_id = $3)`,
      [characterId, latest, viewerId ?? ""],
    ),
  ]);
  const toReview = (r: (typeof rows.rows)[number]): Review => ({ stars: r.stars, body: r.body, via: r.via, at: new Date(r.updated_at).toISOString(), mine: r.reviewer_id === viewerId });
  const all = rows.rows.map(toReview);
  const { n, avg } = agg.rows[0];
  return {
    count: n,
    average: n ? Math.round(avg! * 10) / 10 : null,
    mine: all.find((r) => r.mine) ?? null,
    latest: all.filter((r) => r.body).sort((a, b) => b.at.localeCompare(a.at)).slice(0, latest),
  };
}

export type Popularity = { id: string; score: number; reviews: number; likes: number };

/**
 * How loved each character was in a window: the reviews written in it, averaged with a prior so three 5-star reviews
 * don't beat forty 4.6s, then the ratings (lib/ratings.ts) as a tiebreak. Most loved first; a full tie goes by id.
 */
export async function popularity(db: Db, ids: string[], from: Date, to: Date): Promise<Popularity[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<{ id: string; total: number; n: number; likes: number }>(
    `select c.id,
            coalesce((select sum(stars) from character_reviews r where r.character_id = c.id and r.updated_at >= $2 and r.updated_at < $3), 0)::int as total,
            (select count(*) from character_reviews r where r.character_id = c.id and r.updated_at >= $2 and r.updated_at < $3)::int as n,
            (select count(*) from character_ratings g where g.character_id = c.id)::int as likes
       from unnest($1::text[]) as c(id)`,
    [ids, from.toISOString(), to.toISOString()],
  );
  return rows
    .map((r) => ({ id: r.id, score: (r.total + PRIOR_MEAN * PRIOR_WEIGHT) / (r.n + PRIOR_WEIGHT), reviews: r.n, likes: r.likes }))
    .sort((a, b) => b.score - a.score || b.reviews - a.reviews || b.likes - a.likes || a.id.localeCompare(b.id));
}
