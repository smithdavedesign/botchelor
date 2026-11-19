/**
 * The past-PG door (2026-11-19, David: "yes go build 1 and 2"). In the week to Nov 19, two of the three people who tried
 * the one-sentence builder were refused for going past PG, and the refusal ended there: their words went into the bio
 * and the form told them to keep it PG. The people the show's posts bring (Character.AI and Janitor refugees) expect
 * spicier characters, and After Dark is where those go. So a past-PG refusal now offers a choice: keep the character PG
 * for the show, or After Dark (an invite request while it's invite only; the subscription once a payment processor is
 * set up, the same page either way).
 *
 * What it is not. Only a refusal for sexual content or innuendo opens it: a minor, a real person, a language the check
 * can't read, never. It carries no words of theirs anywhere (the link is a source label, nothing more), adds no
 * auto-approval and opens no public door: the invite request and the subscription page already exist (lib/adult/bridge.ts
 * leads to the same page from the verdict card).
 *
 * Who sees it (pastPgDoorShows; every one must hold):
 *  - the switch: PAST_PG_DOOR=0 turns it off without a deploy (default on);
 *  - After Dark is on at all;
 *  - the viewer has said they're 18 or older (the gate's cookie);
 *  - After Dark is allowed where they are (lib/jurisdiction.ts: never where it's blocked, where nothing may say it exists);
 *  - they aren't in already (an admin, a pass, a subscription);
 *  - while it's invite only, they haven't asked already (a request, whatever became of it, is asked once);
 *  - not a crawler or an agent.
 *
 * This file is pure (a client component imports the copy); lib/adult/past-pg-viewer.ts reads the database and the request.
 */
import type { AfterDarkMode } from "../jurisdiction";

/** The refusals that open the door (lib/safety.ts, where the show's reasons live): past PG, and nothing else. */
export { isPastPg } from "../safety";

type Env = Record<string, string | undefined>;

/** PAST_PG_DOOR=0 turns the door off; anything else, or nothing, leaves it on. */
export function pastPgDoorOn(env: Env = process.env): boolean {
  return env.PAST_PG_DOOR?.trim() !== "0";
}

/** The source the door's link carries (adult_invites.source), so the owner's review says where a request came from. */
export const PAST_PG_SOURCE = "past_pg";

/** The door for one viewer: where it leads, and whether that page asks for an invite or sells the subscription. */
export type PastPgDoor = { href: string; kind: "invite" | "join" };

export type PastPgFacts = {
  /** PAST_PG_DOOR isn't 0. */
  on: boolean;
  /** After Dark is switched on at all (lib/adult/mode.ts adultAvailable). */
  available: boolean;
  /** No payment processor is set up: the way in is an invite. */
  inviteOnly: boolean;
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

/** Whether the door shows. Pure, so the rule is tested without a page. Asking twice only matters while it's invite only. */
export function pastPgDoorShows(f: PastPgFacts): boolean {
  return f.on && f.available && f.attested && f.mode !== "blocked" && !f.entitled && !(f.inviteOnly && f.asked) && !f.bot;
}

/** What the door says, in one place so the test that keeps it clean reads what the card shows. Nothing explicit. */
export const PAST_PG_COPY = {
  lead: "The show is PG, so they can't go on it as written.",
  choose: "Two ways on:",
  keep: "Keep them PG",
  keepHint: "Tone the description down below, and they can date on the show.",
  adLead: "After Dark is the show's 18+ side, apart from the show.",
  invite: "It's invite only:",
  inviteLink: "ask for an invite",
  join: "Join After Dark",
} as const;
