/**
 * A step-in date's verdict, shared (2026-11-15): "I got a second date with Juniper", a link and a card, so someone who
 * just played has something to send and the reader lands on the same start screen with the same cast member.
 *
 * Stateless and signed, like the calls card (lib/share-record.ts, lib/share-record-name.ts): the link carries the cast
 * member's id and first name, the ending's family (one of the show's three) and two opaque checks, and nothing else.
 *  - `t` is derived from the date's id under SESSION_SECRET (the id itself never rides the link: the date is private);
 *  - `k` signs the cast member, their name, the ending and `t`.
 * So a link can only say what a real date ended as: a "disaster" can't be edited into a "second date", and nobody can
 * put words on the card. It names the cast member (a house character) and never the person, their lines or the date.
 * The page (/step-in?with=…) and the card (/api/og/step-in) show the verdict only when the signature checks out;
 * anything else is the plain start screen. Without a secret nothing is signed and there's no share. $0, no database
 * read on the card. Server-only (node:crypto): the page gets the finished path in its view (lib/step-in.ts viewOf); the
 * words are in lib/step-in-shared.ts, which the browser can load.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { shortName } from "./names";
import { ENDINGS, type Ending } from "./rules";
import { STEP_IN_SHARE_REF } from "./step-in-shared";

export type StepInShare = { with: string; name: string; got: Ending; t: string; k: string };

const secretOf = (env: Record<string, string | undefined>): string | null => env.SESSION_SECRET || null;
const CHECK = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{12}$/;
/** A first name as the show writes them: letters, and the few marks names carry; short. */
const NAME = /^[\p{L}][\p{L}' .-]{0,29}$/u;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const sign = (secret: string, parts: string[]): string => createHmac("sha256", secret).update(`step-in-share\n${parts.join("\n")}`).digest("base64url");
const tokenOf = (secret: string, episodeId: string) => sign(secret, ["t", episodeId]).slice(0, 12);
const checkOf = (secret: string, s: Omit<StepInShare, "k">) => sign(secret, ["k", s.with, s.name, s.got, s.t]).slice(0, 22);

/** The shared link's path for a finished step-in date, or null when this app can't sign (no SESSION_SECRET). */
export function stepInSharePath(v: { episodeId: string; castId: string; castName: string; ending: Ending }, env: Record<string, string | undefined> = process.env): string | null {
  const secret = secretOf(env);
  const name = shortName(v.castName);
  if (!secret || !ID.test(v.castId) || !NAME.test(name)) return null;
  const share = { with: v.castId, name, got: v.ending, t: tokenOf(secret, v.episodeId) };
  const q = new URLSearchParams({ with: share.with, n: share.name, got: share.got, t: share.t, k: checkOf(secret, share), ref: STEP_IN_SHARE_REF });
  return `/step-in?${q.toString()}`;
}

/** A shared link's verdict back, only when it's exactly what the show signed; anything else is null. */
export function readStepInShare(params: Record<string, string | string[] | undefined>, env: Record<string, string | undefined> = process.env): StepInShare | null {
  const secret = secretOf(env);
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const share = { with: one("with"), name: one("n"), got: one("got") as Ending, t: one("t") };
  const k = one("k");
  if (!secret || !ID.test(share.with) || !NAME.test(share.name) || !(ENDINGS as readonly string[]).includes(share.got) || !TOKEN.test(share.t) || !CHECK.test(k)) return null;
  const want = Buffer.from(checkOf(secret, share));
  const got = Buffer.from(k);
  return want.length === got.length && timingSafeEqual(want, got) ? { ...share, k } : null;
}

/** The card's address for a verified share (the same parameters, so the same link is the same picture). */
export function stepInShareImage(s: StepInShare): string {
  return `/api/og/step-in?${new URLSearchParams({ with: s.with, n: s.name, got: s.got, t: s.t, k: s.k }).toString()}`;
}
