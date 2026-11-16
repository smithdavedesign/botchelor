/**
 * What a casting invite's page and its browser parts share (lib/casting-invites.ts holds the rules): the code's shape,
 * its address, and the cookie that remembers it while the person makes or imports a character. Nothing here reads the
 * database, so a client component can import it.
 */

/**
 * The invite the person opened last, kept while they make or import a character: the builder brings them back to it
 * (app/create/page.tsx) and their character's page says it once (app/characters/[id]/page.tsx). Set and cleared by the
 * invite page itself (app/casting/invite/[code]/InviteCookie.tsx), so it is never HttpOnly; applying clears it too.
 */
export const INVITE_COOKIE = "bz_cast_invite";

/** The most days the cookie is kept: an invite's default life. A code that runs out sooner takes the cookie with it. */
export const INVITE_COOKIE_MAX_DAYS = 30;

/** A code: 10 url-safe characters (60 random bits), so it can't be walked and still pastes into a DM. */
const CODE = /^[A-Za-z0-9_-]{10}$/;

export const isInviteCode = (value: unknown): value is string => typeof value === "string" && CODE.test(value);

export const invitePath = (code: string): string => `/casting/invite/${code}`;

/** The invite page's own address prefix: the analytics count every code as this one page (app/funnel.ts). */
export const INVITE_PAGE = "/casting/invite";

/** The code a cookie holds, or null for none or anything that isn't one. */
export const inviteFromCookie = (value: string | null | undefined): string | null => (isInviteCode(value) ? value : null);

/** A path that is an invite's page (the gate's `from` included): its code stays out of the analytics. */
export const isInvitePath = (path: string): boolean => path.startsWith(`${INVITE_PAGE}/`);

/**
 * The invite's terms, shown above the button that applies (app/casting/invite/[code]). The owner's words (2026-11-15),
 * adjusted only where the code says otherwise: credit is by the creator name they choose (lib/showcase.ts
 * creator_profiles, shown on the character's page and its casting card), and withdrawing takes it out of the casting,
 * while only deleting it stops every new date (a public character still gets the house's dates and a Sunday rose from a
 * date it already had). docs/casting-invites.md says the same.
 */
export const INVITE_TERMS =
  "Your character stays yours, and we credit you by your creator name wherever it appears. By applying you let Botchelor feature your character, " +
  "its dates and clips of them on the show and on Botchelor's social accounts while it's on the show. You can withdraw it at any time, and it " +
  "leaves the casting at once; delete it, and nothing new is made with it after that. It must be your own original character: a fictional " +
  "adult, nothing taken from someone else's work, no real people. On the show it stays PG.";
