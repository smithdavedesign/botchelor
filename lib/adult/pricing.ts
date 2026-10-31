/**
 * What After Dark costs a viewer (#1005; David, 2026-10-30: "follow a similar payment methodology [to competitors: a
 * subscription that includes an allowance, tokens for extras], but since we're brand new just break even overall is the
 * goal until adoption is higher"):
 *  - Included with an active subscription (or a reviewer pass): every chapter, the menu's pictures and Draw ahead, at no
 *    tokens. The month's caps (lib/adult/usage.ts: cap_writes, cap_pictures) still bound them.
 *  - Included clips: a subscriber's first `included_clips` clips on demand each calendar month (3 by default) cost
 *    nothing; each after that costs `clip_tokens` (1, about cost).
 *  - Extras at about cost: the video of the night (`reel_tokens`, 7), clips past the allowance, talking moments, setting
 *    the scene.
 * Admins never pay. The chapter/picture/Draw ahead prices stay in the settings for a viewer with no subscription, who
 * can't open After Dark anyway (lib/adult/entitlement.ts).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { canAfterDark } from "./entitlement";
import { DEFAULT_CLIP_TOKENS, DEFAULT_INCLUDED_CLIPS, DEFAULT_REEL_TOKENS, getAdultSettings, type AdultSettings } from "./settings";
import { DEFAULT_CAPS, includedClipsUsed } from "./usage";

/** A price for one viewer: its bought tokens, and whether it's covered by their subscription. */
export type Price = { tokens: number; included: boolean };

/** Whether a viewer has a subscription that includes the allowance: an active one, a reviewer pass or a beta pass. */
export async function hasSubscription(db: Db, viewer: string, now: Date = new Date()): Promise<boolean> {
  const e = await canAfterDark(db, { userId: viewer, authenticated: true }, now);
  return e.ok && (e.why === "subscribed" || e.why === "reviewer" || e.why === "beta");
}

/** Whether the viewer's included clips apply: a subscription or reviewer pass, never a beta pass (video is on them). */
export async function clipsIncluded(db: Db, viewer: string, now: Date = new Date()): Promise<boolean> {
  const e = await canAfterDark(db, { userId: viewer, authenticated: true }, now);
  return e.ok && (e.why === "subscribed" || e.why === "reviewer");
}

/** An item a subscription includes (a chapter, a menu picture, Draw ahead): 0 for an admin or a subscriber, else `tokens`. */
export async function includedPrice(db: Db, viewer: string, tokens: number): Promise<Price> {
  if (tokens <= 0 || (await isAdmin(db, viewer))) return { tokens: 0, included: false };
  if (await hasSubscription(db, viewer)) return { tokens: 0, included: true };
  return { tokens, included: false };
}

/** A clip's price for a viewer: included while the month's allowance lasts, then clip_tokens; and what's left of it. */
export type ClipPrice = Price & {
  /** The month's included clips left (null: no allowance, an admin or no subscription), out of `included_of`. */
  included_left: number | null;
  included_of: number;
};

export async function clipPrice(db: Db, viewer: string, settings?: AdultSettings, now: Date = new Date()): Promise<ClipPrice> {
  const s = settings ?? (await getAdultSettings(db));
  const of = Math.max(0, s.included_clips);
  if (await isAdmin(db, viewer)) return { tokens: 0, included: false, included_left: null, included_of: of };
  if (of > 0 && (await clipsIncluded(db, viewer, now))) {
    const left = Math.max(0, of - (await includedClipsUsed(db, viewer, now)));
    return left > 0 ? { tokens: 0, included: true, included_left: left, included_of: of } : { tokens: s.clip_tokens, included: false, included_left: 0, included_of: of };
  }
  return { tokens: s.clip_tokens, included: false, included_left: null, included_of: of };
}

/**
 * What the subscription includes and what the extras cost, as the settings have them (the defaults when they can't be
 * read), for the subscribe page: the month's scene steps (fair use on unlimited chapters), pictures and included clips,
 * and the price of a clip past those and of the video of the night.
 */
export function includedPlan(s: AdultSettings | null) {
  return {
    steps: s?.caps.writes ?? DEFAULT_CAPS.writes,
    pictures: s?.caps.pictures ?? DEFAULT_CAPS.pictures,
    clips: s?.included_clips ?? DEFAULT_INCLUDED_CLIPS,
    clipTokens: s?.clip_tokens ?? DEFAULT_CLIP_TOKENS,
    reelTokens: s?.reel_tokens ?? DEFAULT_REEL_TOKENS,
  };
}
