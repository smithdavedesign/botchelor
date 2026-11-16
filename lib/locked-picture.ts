/**
 * A picture they kept from the night, locked in the show's texts (David, 2026-11-16: "put in PG text but blur it, use
 * it as a marketing opportunity to get subscribers"). After a couple leaves an overnight date together, or (rarely)
 * after a steady couple's date ends in another, the character texts the people it texts one PG line with a locked tile
 * under it. Whoever After Dark is open to opens the couple's night there; everyone else is one tap from the way in.
 *
 * THE SHOW SIDE HOLDS PG PIXELS ONLY. The tile is a locked door, never the picture:
 *  - it is the character's own approved PG portrait, shrunk to a dozen pixels and blown back up on the server
 *    (app/api/locked-picture/[id]; lib/teaser-image.ts blurredTeaser), with a lock and "In After Dark · adults only"
 *    printed over it in HTML. Nothing of After Dark is drawn for it, kept for it or sent with it, and no copy says the
 *    blur IS the picture;
 *  - the real picture is the night's own first picture in After Dark, drawn there by After Dark's own pipeline when an
 *    entitled adult continues the night: this feature makes no picture and adds no cost;
 *  - the show's subscription (the Companion Plan, billed through Stripe) buys nothing adult and is never mentioned here.
 *
 * This file is the switch, the rules and the words: pure, with no server imports, so the thread's client component and
 * the tests share it. Who is sent it is lib/locked-picture-texts.ts; what After Dark's own rules say about a person
 * (entitled, where they are, the 18+ answer) is lib/adult/locked-picture.ts.
 *
 * Sacred rule: presentation only. Nothing here reads into or changes points, odds, pairings or endings.
 */
import { STEADY_STAGES, type Stage } from "./relationship-stages";

type Env = Record<string, string | undefined>;

/** LOCKED_PICTURE_TEXTS=0: nothing is sent, and the ones already in a thread read as plain texts (no tile, no prompt line). */
export function lockedPictureTextsOn(env: Env = process.env): boolean {
  return env.LOCKED_PICTURE_TEXTS?.trim() !== "0";
}

/** The numbers, in one place. */
export const LOCKED_PICTURE_RULES = {
  /** At most one such text a thread in this many days. */
  perThreadDays: 7,
  /** A steady couple's date that ended in another: one date in this many sends it (seeded by the date, so it never re-rolls). */
  steadyOneIn: 5,
  /** How recently the person must have been seen, 18+ and somewhere After Dark's pictures are allowed, to be sent one. */
  seenWithinDays: 30,
  /** The most texts one airing sends, across every thread. */
  perAiring: 20,
  /** How long the companion's prompt carries the line about it. */
  promptDays: 14,
} as const;

/** What set it off: the pair left an overnight date together, or a steady couple's date ended in another. */
export type LockedPictureTrigger = "overnight" | "steady";

/**
 * "Going steady or more" as the couple is SHOWN (lib/relationship-stages.ts): going steady, official, moved in, engaged,
 * married, and keeping it casual (they have left an overnight date together). Read for presentation only.
 */
export const LOCKED_PICTURE_STAGES: readonly Stage[] = [...STEADY_STAGES, "casual"];
export const steadyOrMore = (stage: Stage | null | undefined): boolean => Boolean(stage) && LOCKED_PICTURE_STAGES.includes(stage!);

/* ------------------------------------------------------ the tag ------------------------------------------------------ */

/** The text's tag (companion_messages.action; lib/companion-shared.ts TEXT_TAG): a thread gets one per date. */
export const LOCKED_PICTURE_KIND = "locked_picture";
export const lockedPictureTag = (episodeId: string): string => `${LOCKED_PICTURE_KIND}:${episodeId}`;
const TAG = /^locked_picture:([A-Za-z0-9_-]{1,64})$/;
/** The date a tag is about, or null for any other tag. */
export const lockedPictureEpisode = (tag: string | null | undefined): string | null => (tag ? (TAG.exec(tag)?.[1] ?? null) : null);
/** Every such tag, as a SQL pattern. */
export const LOCKED_PICTURE_TAG_SQL = `'^locked_picture:'`;

/* ----------------------------------------------------- the words ----------------------------------------------------- */

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** FNV-1a: the variant and the steady roll need no server import (lib/overnight-shared.ts does the same). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The lines, by trigger: templates, no model writes any of them, and none says what happened or what is in the picture.
 * {p} is the partner's first name. Each is two bubbles: the notice a person gets is the first.
 */
export const LOCKED_PICTURE_LINES: Record<LockedPictureTrigger, readonly (readonly [string, string])[]> = {
  overnight: [
    ["Last night with {p} isn't for the show.", "I took one picture. It's yours if you want it."],
    ["One more thing about the overnight date with {p}.", "There's a picture from after. It stays off the show, but you can have it."],
    ["The cameras stayed behind last night. My phone didn't.", "One picture of the night with {p}. It's yours if you want it."],
  ],
  steady: [
    ["You saw the date with {p}. You didn't see after.", "I kept one picture. It isn't for the show, but it's yours if you want it."],
    ["After the date with {p}, the cameras went home.", "I took one picture of the rest of the night. It's yours if you want it."],
    ["Some of tonight with {p} was just for us.", "There's one picture from after. Not for the show. Yours if you want it."],
  ],
};

/** The two bubbles this character sends about this date: the same character and date always get the same variant. */
export function lockedPictureLines(trigger: LockedPictureTrigger, partnerName: string, seed: string): string[] {
  const variants = LOCKED_PICTURE_LINES[trigger];
  const pick = variants[hash(`locked-picture:${seed}`) % variants.length];
  return pick.map((l) => l.replaceAll("{p}", firstNameOf(partnerName)));
}

/** Whether a steady couple's date sends it: one in `steadyOneIn`, decided by the date's id alone (pure, repeatable). */
export const steadyRoll = (episodeId: string): boolean => hash(`locked-picture-steady:${episodeId}`) % LOCKED_PICTURE_RULES.steadyOneIn === 0;

/** Every word the tile and the line under it say. */
export const LOCKED_PICTURE_COPY = {
  /** Printed over the blurred tile. */
  label: "In After Dark · adults only",
  /** The tile's button for someone After Dark is open to. */
  open: "Open in After Dark",
  /** ...and for everyone else: while it's invite only, once they have asked, and once a subscription can be bought. */
  invite: "Ask for an invite",
  asked: "See your invite request",
  subscribe: "See After Dark",
  /** The plain line under the tile. The tile is a lock: never "this is the picture". */
  openLine: "The picture is in After Dark, with the rest of their night. This tile is only the lock.",
  inviteLine: "After Dark is the show's adult side: 18+, optional and separate from the show. It's invite only for now. This tile is only the lock, not the picture.",
  subscribeLine: "After Dark is the show's adult side: 18+, optional, with its own subscription, separate from the show. This tile is only the lock, not the picture.",
  /** The tile image's alt text. */
  alt: "A locked picture, blurred",
} as const;

/** Where the tile's bytes come from: the sending character's blurred PG portrait (app/api/locked-picture/[id]). */
export const lockedTilePath = (characterId: string): string => `/api/locked-picture/${encodeURIComponent(characterId)}`;
/** The tile's shape, width over height: the thread holds the box before the image loads. */
export const LOCKED_TILE_ASPECT = { width: 4, height: 5 } as const;

/** The source an invite request from the tile carries (lib/adult/bridge.ts inviteSource; counted on /invites/review). */
export const LOCKED_PICTURE_SOURCE = "locked_picture";

/**
 * What the tile is for one viewer, decided on the server for this request (lib/adult/locked-picture.ts lockedDoors):
 *  - `open`: After Dark is open to them and pictures are allowed where they are; `href` is the couple's night there;
 *  - `way_in`: an adult it isn't open to; `href` is the existing way in (the invite request while it can't take money,
 *    the subscription once it can: the same page, lib/adult/bridge.ts invitePath).
 * No door at all (a blocked or text-only place, no 18+ answer, a guest, a locked device, the switch off): the text
 * stays a plain line.
 */
export type LockedDoor = { state: "open"; href: string } | { state: "way_in"; href: string; invite_only: boolean; asked: boolean };

/** The words for a door (pure): the button and the line under the tile. */
export function lockedDoorWords(door: LockedDoor): { button: string; line: string } {
  if (door.state === "open") return { button: LOCKED_PICTURE_COPY.open, line: LOCKED_PICTURE_COPY.openLine };
  if (!door.invite_only) return { button: LOCKED_PICTURE_COPY.subscribe, line: LOCKED_PICTURE_COPY.subscribeLine };
  return { button: door.asked ? LOCKED_PICTURE_COPY.asked : LOCKED_PICTURE_COPY.invite, line: LOCKED_PICTURE_COPY.inviteLine };
}

/**
 * The one line of data the companion's prompt carries while such a text is recent, so the character can answer "what
 * picture?" in PG words: where it is, and that it is never described. It names no product: the lock under the text says
 * where it leads, and only to someone who may be told.
 */
export const lockedPicturePromptLine = (partnerName: string | null): string =>
  `You texted them that you kept one picture from a night${partnerName ? ` with ${firstNameOf(partnerName)}` : ""}, and that it isn't for the show. It is not in this chat: it sits behind the lock under that text, on the show's separate adults-only side. If they ask, say that much in your own words and leave it there. You never describe the picture or what happened that night, you can't send it or another one here, and you don't push them to go and look.`;
