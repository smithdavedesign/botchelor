/**
 * Set the scene on a date while it's filmed (David, 2026-10-19: "set the venue to any scene… for 1 token… if they
 * agree to move"). The creator types any place and pays a bought token; the show's producer slips the next speaker a
 * note to propose going there, and the date only goes if the other one says yes, exactly like a move of their own
 * (lib/moves.ts: mutual, counted against the date's moves, the engine still decides how it ends). If they never go
 * (no yes, no move left, the date ends first, or it fails), the token comes back.
 *
 * Statuses: pending (waiting for a line that can propose it) → proposed (said on the date) → moved | declined.
 */
import { isAdmin } from "./admins";
import { refundBoughtTokens, SET_SCENE_TOKEN_COST, spendBoughtTokens } from "./allowance";
import type { Turn } from "./conversation";
import type { Db } from "./db";
import { placeFor } from "./places";
import { checkShowText } from "./safety";
import { ensureSet } from "./sets";
import { PLACE_LABEL_MAX, type PlaceId } from "./venues";

export const SUGGESTION_MAX = 60;

export type Suggestion = { id: string; to: PlaceId };

export type SuggestResult = { ok: true; suggestion: Suggestion & { label: string } } | { ok: false; status: number; error: string; message: string };

/**
 * The place a typed suggestion means: one of their homes when it says so ("back to mine"), else exactly the place typed
 * ("literally any scene"), never the nearest library venue ("a rooftop pool" isn't the rooftop bar). Its own set is
 * drawn once (lib/sets.ts).
 */
export function suggestedPlace(text: string, names: [string, string]): PlaceId {
  const label = text.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").slice(0, PLACE_LABEL_MAX);
  const resolved = placeFor(label, names[0], names[1]);
  return resolved?.startsWith("home@") ? resolved : (`elsewhere@${label}` as PlaceId);
}

/** The creator sets the scene on their date while it's filmed. Spends the token last, so a refusal costs nothing. */
export async function suggestScene(db: Db, userId: string, episodeId: string, text: string): Promise<SuggestResult> {
  const label = text.trim().replace(/\s+/g, " ").slice(0, SUGGESTION_MAX);
  if (!label) return { ok: false, status: 400, error: "invalid_request", message: "Say where to take them." };
  if (!checkShowText({ place: label }).ok) return { ok: false, status: 422, error: "content_rejected", message: "That place isn't one the show can use." };
  const ep = (
    await db.query<{ mine: boolean; status: string; moves: boolean; performed_by: string; a: string; b: string }>(
      `select ($2::text in (e.creator_id, ca.owner_id, cb.owner_id)) as mine, e.status, coalesce((e.setup->>'moves')::boolean, false) as moves, e.performed_by, ca.name as a, cb.name as b
         from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
        where e.id = $1`,
      [episodeId, userId],
    )
  ).rows[0];
  if (!ep || !ep.mine) return { ok: false, status: 404, error: "not_found", message: "No date of yours with that id." };
  if (ep.status !== "generating") return { ok: false, status: 409, error: "not_filming", message: "The scene can only be set while the date is being filmed." };
  // An agent performing its own date writes its own lines: the show's producer can't slip it a note.
  if (ep.performed_by !== "platform") return { ok: false, status: 409, error: "self_performed", message: "This date is performed by its own agent, so the show can't set the scene." };
  if (!ep.moves) return { ok: false, status: 409, error: "no_moves", message: "This date can't move (a speed date or a set format)." };
  const waiting = await db.query(`select 1 from scene_suggestions where episode_id = $1 and status in ('pending', 'proposed')`, [episodeId]);
  if (waiting.rows.length) return { ok: false, status: 409, error: "already_suggested", message: "There's already a place waiting for their answer." };
  const pays = !(await isAdmin(db, userId));
  if (pays && !(await spendBoughtTokens(db, userId, SET_SCENE_TOKEN_COST))) {
    return { ok: false, status: 402, error: "needs_tokens", message: `Setting the scene costs ${SET_SCENE_TOKEN_COST} token. Get more on the shop page.` };
  }
  const to = suggestedPlace(label, [ep.a, ep.b]);
  const id = crypto.randomUUID();
  await db.query(`insert into scene_suggestions (id, episode_id, user_id, place, label, tokens) values ($1, $2, $3, $4, $5, $6)`, [
    id,
    episodeId,
    userId,
    to,
    label,
    pays ? SET_SCENE_TOKEN_COST : 0,
  ]);
  // Start drawing its set now, so it's there if they go (a no-op for the library's venues and homes).
  void ensureSet(db, to);
  return { ok: true, suggestion: { id, to, label } };
}

/** The suggestion waiting for a line to propose it, if any (read by the date's loop before each line). */
export async function pendingSuggestion(db: Db, episodeId: string): Promise<Suggestion | null> {
  const { rows } = await db.query<{ id: string; place: string }>(`select id, place from scene_suggestions where episode_id = $1 and status = 'pending' order by created_at limit 1`, [episodeId]);
  return rows[0] ? { id: rows[0].id, to: rows[0].place as PlaceId } : null;
}

export async function markProposed(db: Db, id: string): Promise<void> {
  await db.query(`update scene_suggestions set status = 'proposed', updated_at = now() where id = $1 and status = 'pending'`, [id]);
}

/**
 * When the date's done (or failed, with no transcript): a suggestion they went to is kept; any other is declined and
 * its token given back. Never throws.
 */
export async function settleSuggestions(db: Db, episodeId: string, transcript: readonly Turn[]): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string; user_id: string; place: string; tokens: number }>(
      `select id, user_id, place, tokens from scene_suggestions where episode_id = $1 and status in ('pending', 'proposed')`,
      [episodeId],
    );
    for (const s of rows) {
      const went = transcript.some((t) => t.moved_to === s.place);
      const done = await db.query(`update scene_suggestions set status = $2, updated_at = now() where id = $1 and status in ('pending', 'proposed') returning 1`, [
        s.id,
        went ? "moved" : "declined",
      ]);
      if (!went && done.rows.length && s.tokens > 0) await refundBoughtTokens(db, s.user_id, s.tokens);
    }
  } catch (err) {
    console.error("[scene-suggestions] could not settle", episodeId, err instanceof Error ? err.message : "unknown");
  }
}

/** The suggestions on a date, for its stage: what was asked and what happened. */
export async function listSuggestions(db: Db, episodeId: string): Promise<{ label: string; status: string }[]> {
  const { rows } = await db.query<{ label: string; status: string }>(`select label, status from scene_suggestions where episode_id = $1 order by created_at`, [episodeId]);
  return rows;
}
