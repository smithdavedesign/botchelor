/**
 * Draw ahead (docs/PRDs/theater-immersion.md #5; David, 2026-10-29: "Yes draw ahead is a good idea, but we would need to
 * limit per chapter and pre charge people tokens if they choose it"). The viewer's choice for a pair's nights, from the
 * theater's ⋯ menu: each moment worth a picture (lib/adult/beats.ts) starts drawing as soon as its step is written, so
 * it's on the stage when its line plays, without "Picture this?" first (Redraw stays).
 *
 * Paid by the chapter: `draw_ahead_tokens` are taken before a chapter's first moment is drawn ahead (admins don't pay,
 * and it's included with a subscription: #1005, David 2026-10-30, lib/adult/pricing.ts),
 * and the chapter may then draw its own pictures (`pictures_per_chapter`) and up to `draw_ahead_pictures` more. A chapter
 * that drew nothing ahead (no moment came, or each one drawn ahead failed) gives its tokens back when it closes, starts
 * over, or it's turned off. A viewer who can't pay for the next chapter has it turned off, and the theater says why
 * (picture_note). Offered while the settings' `draw_ahead` is on.
 */
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import type { Db } from "../db";
import { tokensWord } from "./price-words";
import { includedPrice } from "./pricing";
import { getAdultSettings } from "./settings";

/**
 * What the theater shows: offered at all, on for this pair, its price a chapter for this viewer (`included` with their
 * subscription), how many more pictures.
 */
export type DrawAhead = { offered: boolean; on: boolean; price: number; included: boolean; pictures: number; paid: boolean };

type Row = { id: string; owner_id: string; chapter: number; draw_ahead: boolean; draw_ahead_chapter: number | null; draw_ahead_paid: number; draw_ahead_used: number };

async function rowOf(db: Db, sceneId: string): Promise<Row | null> {
  return (await db.query<Row>(`select id, owner_id, chapter, draw_ahead, draw_ahead_chapter, draw_ahead_paid, draw_ahead_used from adult_scenes where id = $1`, [sceneId])).rows[0] ?? null;
}

const priceFor = async (db: Db, viewer: string, tokens: number) => (await includedPrice(db, viewer, tokens)).tokens;

export async function drawAheadView(db: Db, viewer: string, sceneId: string): Promise<DrawAhead> {
  const s = await getAdultSettings(db);
  const r = await rowOf(db, sceneId);
  const price = await includedPrice(db, viewer, s.draw_ahead_tokens);
  return {
    offered: s.draw_ahead,
    on: Boolean(s.draw_ahead && r?.draw_ahead),
    price: price.tokens,
    included: price.included,
    pictures: s.draw_ahead_pictures,
    paid: Boolean(r && r.draw_ahead_chapter === r.chapter),
  };
}

/** Turns it on or off for the pair's nights; off gives back the running chapter's tokens when nothing was drawn ahead yet. */
export async function setDrawAhead(db: Db, viewer: string, sceneId: string, on: boolean): Promise<{ ok: true; refunded: number } | { ok: false; status: number; message: string }> {
  const s = await getAdultSettings(db);
  if (on && !s.draw_ahead) return { ok: false, status: 409, message: "Drawing ahead is off in After Dark's settings." };
  const r = await rowOf(db, sceneId);
  if (!r || r.owner_id !== viewer) return { ok: false, status: 404, message: "Pick two characters who are in after dark." };
  await db.query(`update adult_scenes set draw_ahead = $2 where id = $1`, [sceneId, on]);
  return { ok: true, refunded: on ? 0 : await settleDrawAhead(db, sceneId, r.chapter) };
}

/**
 * The chapter's picture budget while it's drawn ahead: its own and draw_ahead_pictures more. Its price is taken first,
 * once a chapter, before its first moment is drawn ahead (the last chapter's settled before); a viewer who can't pay has
 * it turned off, with why. Null when it isn't drawn ahead (off, not offered, or not paid for).
 */
export async function aheadBudget(db: Db, sceneId: string, chapter: number): Promise<number | null> {
  const s = await getAdultSettings(db);
  if (!s.draw_ahead) return null;
  const r = await rowOf(db, sceneId);
  if (!r?.draw_ahead) return null;
  const budget = s.pictures_per_chapter + s.draw_ahead_pictures;
  if (r.draw_ahead_chapter === chapter) return budget;
  if (r.draw_ahead_chapter !== null) await settleDrawAhead(db, sceneId, r.draw_ahead_chapter, { closing: true });
  const price = await priceFor(db, r.owner_id, s.draw_ahead_tokens);
  // The chapter claimed first, so two steps at once can't both take its price.
  const claimed = await db.query(
    `update adult_scenes set draw_ahead_chapter = $2, draw_ahead_paid = $3, draw_ahead_used = 0, draw_ahead_at = now()
      where id = $1 and draw_ahead and draw_ahead_chapter is distinct from $2 returning id`,
    [sceneId, chapter, price],
  );
  if (!claimed.rows.length) return (await rowOf(db, sceneId))?.draw_ahead_chapter === chapter ? budget : null;
  if (price > 0 && !(await spendBoughtTokens(db, r.owner_id, price))) {
    await db.query(`update adult_scenes set draw_ahead = false, draw_ahead_chapter = null, draw_ahead_paid = 0, picture_note = $2 where id = $1`, [
      sceneId,
      `Draw ahead is off: it takes ${tokensWord(price)} a chapter. Get more on the shop page, then turn it on again in ⋯.`,
    ]);
    return null;
  }
  return budget;
}

/** Counts moments drawn ahead in the chapter paid for (`n` more, or one fewer when one of them failed). */
export async function countAhead(db: Db, sceneId: string, n: number, since?: Date | string | null): Promise<void> {
  if (n > 0) await db.query(`update adult_scenes set draw_ahead_used = draw_ahead_used + $2 where id = $1`, [sceneId, n]);
  else if (since) await db.query(`update adult_scenes set draw_ahead_used = greatest(0, draw_ahead_used - 1) where id = $1 and draw_ahead_at <= $2`, [sceneId, since]);
}

/**
 * The chapter paid for, settled: when nothing was drawn ahead in it, its tokens go back (turning it off, its close, Start
 * over). `closing`: the chapter is over, so it's no longer paid for either way (Start over counts chapters from 1 again).
 * The tokens given back, or 0.
 */
export async function settleDrawAhead(db: Db, sceneId: string, chapter: number, opts: { closing?: boolean } = {}): Promise<number> {
  const back = await db.query<{ owner_id: string; paid: number; used: number }>(
    `update adult_scenes s set draw_ahead_paid = 0, draw_ahead_chapter = null
       from (select draw_ahead_paid as paid, draw_ahead_used as used from adult_scenes where id = $1) old
      where s.id = $1 and s.draw_ahead_chapter = $2 and ($3 or (s.draw_ahead_used = 0 and s.draw_ahead_paid > 0))
      returning s.owner_id, old.paid, old.used`,
    [sceneId, chapter, Boolean(opts.closing)],
  );
  const r = back.rows[0];
  if (!r || r.used > 0 || r.paid <= 0) return 0;
  await refundBoughtTokens(db, r.owner_id, r.paid);
  return r.paid;
}

/** What the theater says when it's turned on. */
export const drawAheadNote = (v: Pick<DrawAhead, "price" | "pictures"> & { included?: boolean }): string =>
  `⚡ Drawing ahead: each moment is drawn as soon as it's written, so it's on the stage when its line plays (up to ${v.pictures} more pictures a chapter${v.price > 0 ? `, ${tokensWord(v.price)} a chapter, taken before its first one and given back if none is drawn` : v.included ? ", included with your subscription" : ""}).`;
