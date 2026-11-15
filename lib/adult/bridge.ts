/**
 * The After Dark bridge (2026-11-15): one quiet line on the creator's verdict card, when their own character's date
 * ended in a second date: "What happened after is After Dark. It's invite only: ask for an invite", to the invite
 * request that already exists (lib/adult/invites.ts; David, 2026-10-31: he approves every one by email).
 *
 * What it is not. It doesn't open the public door (adult_settings.rollout public_door stays where David left it: the
 * header's door, the arrival screen and /after-dark's landing for everyone are his switch alone, docs/after-dark.md).
 * It adds no code, no auto-approval and no payment, and nothing explicit: the line names After Dark and says it's
 * invite only. The invite request it leads to was already reachable from the show (the looks builder's locked After
 * Dark tab on /create links the same page), so this is a second, better-timed link to the same door.
 *
 * Who sees it (bridgeShows; every one must hold):
 *  - the switch: AD_BRIDGE=0 turns it off without a deploy (default on);
 *  - After Dark is on at all, and it's still invite only (with a payment processor set up the page it leads to sells a
 *    subscription, and "invite only" would be untrue);
 *  - the date ended in a second date, and it's the viewer's own character's date (the verdict card only shows then);
 *  - the viewer has said they're 18 or older (the gate's cookie: the builder's own 18+ box sets it);
 *  - After Dark is allowed where they are (lib/jurisdiction.ts: never where it's blocked, where nothing may say it exists);
 *  - they aren't in already, and haven't asked already (a request, whatever became of it, is asked once);
 *  - not a crawler or an agent (search engines index the show, not After Dark).
 */
import type { AfterDarkMode } from "../jurisdiction";

type Env = Record<string, string | undefined>;

/** AD_BRIDGE=0 turns the bridge off; anything else, or nothing, leaves it on. */
export function adBridgeOn(env: Env = process.env): boolean {
  return env.AD_BRIDGE?.trim() !== "0";
}

/** The source the verdict card's link carries. */
export const VERDICT_SOURCE = "verdict";
/** The longest source kept. */
export const SOURCE_MAX = 40;

/**
 * Where an invite request came from, as kept (adult_invites.source): a short lowercase label from a link's ?source=
 * ("verdict" from the bridge, "refugees" from an outreach post). Anything else (too long, other characters) is no
 * source at all, never a guess, and never free text an outsider could put in front of the owner.
 */
export function inviteSource(raw: unknown): string | null {
  const s = (Array.isArray(raw) ? raw[0] : raw);
  if (typeof s !== "string") return null;
  const label = s.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]*$/.test(label) && label.length <= SOURCE_MAX ? label : null;
}

/** The invite request's page, carrying where the visitor came from. */
export const invitePath = (source: string | null): string => `/after-dark/subscribe${source ? `?source=${encodeURIComponent(source)}` : ""}`;

export type BridgeFacts = {
  /** AD_BRIDGE isn't 0. */
  on: boolean;
  /** After Dark is switched on at all (lib/adult/mode.ts adultAvailable). */
  available: boolean;
  /** No payment processor is set up: the way in is an invite. */
  inviteOnly: boolean;
  /** How the date ended. */
  ending: string | null;
  /** The viewer has said they're 18 or older (the gate's cookie). */
  attested: boolean;
  /** What After Dark may be where they are. */
  mode: AfterDarkMode;
  /** After Dark is already open to them. */
  entitled: boolean;
  /** They've asked for an invite before (pending, approved or declined). */
  asked: boolean;
  /** A crawler or an agent. */
  bot: boolean;
};

/** Whether the line shows. Pure, so the rule is tested without a page. */
export function bridgeShows(f: BridgeFacts): boolean {
  return f.on && f.available && f.inviteOnly && f.ending === "second_date" && f.attested && f.mode !== "blocked" && !f.entitled && !f.asked && !f.bot;
}

/** The line itself, in one place so the test that keeps it clean reads what the card shows. */
export const BRIDGE_COPY = { lead: "What happened after is After Dark.", invite: "It's invite only:", link: "ask for an invite" } as const;
