/**
 * Claiming what you made before signing in (the connected model, stage 7; docs/accounts-and-byok.md "Claiming what
 * you made before signing in").
 *
 * Signing UP adopts this browser's anonymous id, so nothing moves. Signing IN to an account that already exists
 * switches the session to that account's id, and the characters, dates and conversations made under the anonymous id
 * were left behind with no way back to them. Now the server remembers, at the moment of a successful sign-in, which
 * anonymous identity this browser held, and the account page offers once to bring what it made into the account.
 *
 * What makes it safe:
 *  - PROOF. The only identity that can be claimed is the one this browser held immediately before signing in, and
 *    only when that identity was a SIGNED anonymous session (`bz_sess`, which only this server mints, and only for an
 *    id it generated or carried for that browser). A bare `bz_uid`, which anyone can type in, is never claimable; nor
 *    is an id that has ever been an agent's (a bearer token that travels the same way), an admin's, or one with a
 *    sign-in of its own. At sign-in the server puts
 *    {old id, account id} into a signed, HttpOnly, half-hour cookie (lib/auth.ts signClaim). The claim reads the old id
 *    from that cookie and from nowhere else: no body field, query string or header names an id.
 *  - EXPLICIT. Nothing moves at sign-in. The account page shows one card; the person presses the button or declines.
 *  - ONE TRANSACTION. claimIdentity sends every statement as one simple-protocol batch, which Postgres runs as a single
 *    implicit transaction (as the schema script is run): any failing statement undoes all of it. Its first statements
 *    re-check, inside that transaction, everything the route checked before it.
 *  - NOTHING DOUBLED. What moves and what stays is the person-column registry's `move` rule for each column
 *    (lib/person-columns.ts): things a person made are reassigned; a vote, a prediction, a rating, an allowance, a
 *    balance, a setting or a consent stays where it is, so the account never gets a second helping and no tally
 *    changes. Where a rule allows one row a person, the account's own row wins.
 *  - ONCE. The claim records {old id → account} in account_aliases (old id is its primary key), so the same identity
 *    can never be claimed twice, by anyone.
 *  - NO CONSENT CARRIED. The account's settings are its own; what it agreed to (machine-learning use) covers a claimed
 *    character from the claim on (characters.claimed_at), never the dates it had before (lib/ml-consent.ts).
 *
 * After Dark is never read or written here: all of its tables are `skip` (lib/adult/person-columns.ts), and this module
 * reads only the show's registry.
 */
import { CLAIM_TTL_SECONDS, signClaim, verifyClaim, verifySession, type ClaimOffer } from "./auth";
import type { Db } from "./db";
import { readUserId, SESSION_COOKIE } from "./http";
import { PERSON_COLUMNS, type PersonColumn } from "./person-columns";
import { PERSONA_OWNER_PREFIX } from "./step-in-shared";

/** The offer's cookie: signed (lib/auth.ts signClaim), HttpOnly, gone in half an hour or once answered. */
export const CLAIM_COOKIE = "bz_claim";

/** ACCOUNT_CLAIM: on unless "0" (docs/hosting.md). Off: no offer is made at sign-in, no card shows, the route refuses. */
export const accountClaimOn = (env: Record<string, string | undefined> = process.env): boolean => env.ACCOUNT_CLAIM !== "0";

/** Six tries an hour and twelve a day from one account: a claim is a rare, deliberate act. */
export const CLAIM_LIMITS = { perHour: 6, perDay: 12 };

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

/** The Set-Cookie that carries an offer, or (null) the one that takes it away. */
export function claimCookie(token: string | null): string {
  return token
    ? `${CLAIM_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CLAIM_TTL_SECONDS}${secure()}`
    : `${CLAIM_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;
}

const cookieValue = (header: string | null, name: string): string | undefined => {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
};

/**
 * The anonymous identity this request provably holds: its signed session, when that session is not signed in. Never the
 * unsigned `bz_uid` (anyone can type one in), so an id that got out, or an agent's, can't be turned into a claim.
 */
export function signedAnonymousId(req: Request): string | null {
  const session = verifySession(cookieValue(req.headers.get("cookie"), SESSION_COOKIE));
  return session && !session.authenticated ? session.uid : null;
}

/** The offer in this request's cookie, if it is one this server signed and it hasn't run out. */
export function offerFromRequest(req: Request): ClaimOffer | null {
  return verifyClaim(cookieValue(req.headers.get("cookie"), CLAIM_COOKIE));
}

/** The same, from a Next.js server cookie store (the account page). */
export function offerFromCookieStore(store: { get(name: string): { value: string } | undefined }): ClaimOffer | null {
  return verifyClaim(store.get(CLAIM_COOKIE)?.value);
}

export type Refusal = "off" | "same" | "not_an_id" | "has_account" | "admin" | "agent" | "claimed" | "no_account";

/**
 * True when an id has ever been an agent's: it connected over MCP, has a handle or a declared model, is linked to an
 * account, or made a character through a tool. An agent's id is a bearer token that travels in configs and is shown to
 * the person it is linked to (Account, "Its agent id"), and it reaches the site as an unsigned cookie; so it is never
 * claimable, whatever session carries it. An agent's person sees its characters by linking it (lib/agent-links.ts).
 */
const AGENT_SQL = (id: string) =>
  `(exists (select 1 from mcp_sessions where agent_id = ${id}) or exists (select 1 from agent_handles where agent_id = ${id})
    or exists (select 1 from agent_models where agent_id = ${id}) or exists (select 1 from agent_links where agent_id = ${id})
    or exists (select 1 from characters where owner_id = ${id} and created_via = 'mcp'))`;

const CREDENTIAL_SQL = (id: string) =>
  `exists (select 1 from accounts where user_id = ${id} and (handle is not null or email is not null or google_sub is not null or password_hash is not null))`;

/**
 * Whether `from` may be claimed into `to`, and if not, why. Asked when the offer is made, when the card is shown and
 * when the button is pressed; claimIdentity asks the database the same things again inside its transaction. One read
 * (a sign-in pays for it), in the order the reasons matter.
 */
export async function claimRefusal(db: Db, from: string, to: string): Promise<Refusal | null> {
  if (!accountClaimOn()) return "off";
  // Real ids only: a persona's owner ("you:<id>") and the deleted owner are strings no session can hold.
  if (!readUserId(from) || !readUserId(to)) return "not_an_id";
  if (from === to) return "same";
  const facts = (
    await db.query<{ has_account: boolean; admin: boolean; agent: boolean; claimed: boolean; to_account: boolean }>(
      `select ${CREDENTIAL_SQL("$1")} as has_account,
              exists (select 1 from admins where user_id = $1) as admin,
              ${AGENT_SQL("$1")} as agent,
              exists (select 1 from account_aliases where alias_id = $1 or user_id = $1) as claimed,
              ${CREDENTIAL_SQL("$2")} as to_account`,
      [from, to],
    )
  ).rows[0];
  if (!facts) return "claimed";
  if (facts.has_account) return "has_account";
  if (facts.admin) return "admin";
  if (facts.agent) return "agent";
  if (facts.claimed) return "claimed";
  if (!facts.to_account) return "no_account";
  return null;
}

export type ClaimPreview = {
  /** The characters that would come in (a "you" from stepping into a date is not one: it follows quietly). */
  characters: { id: string; name: string }[];
  dates: number;
  conversations: number;
  pictures: number;
};

/** What the old identity made: the card's numbers. Four small reads, only ever run for a browser holding an offer. */
export async function claimPreview(db: Db, from: string): Promise<ClaimPreview> {
  const [characters, dates, conversations, pictures] = await Promise.all([
    db.query<{ id: string; name: string }>(`select id, name from characters where owner_id = $1 and not is_house order by created_at, id`, [from]),
    db.query<{ n: number }>(`select count(*)::int as n from episodes where creator_id = $1`, [from]),
    db.query<{ n: number }>(`select count(*)::int as n from companion_threads where user_id = $1`, [from]),
    db.query<{ n: number }>(`select count(*)::int as n from studio_pg_pictures where owner_id = $1`, [from]),
  ]);
  return { characters: characters.rows, dates: Number(dates.rows[0]?.n ?? 0), conversations: Number(conversations.rows[0]?.n ?? 0), pictures: Number(pictures.rows[0]?.n ?? 0) };
}

/**
 * The cookie a successful sign-in sets: an offer when this browser was, a moment ago, a signed anonymous identity that
 * made characters and may be claimed into the account now signed in; otherwise the cookie that clears any older offer,
 * so an offer never outlives the sign-in it was made for. Never throws: a sign-in must not fail on this.
 */
export async function offerAtSignIn(db: Db, req: Request, accountId: string): Promise<string> {
  try {
    const from = accountClaimOn() ? signedAnonymousId(req) : null;
    if (!from || from === accountId) return claimCookie(null);
    // Most browsers that sign in made nothing first: one small read settles it for them.
    const made = await db.query(`select 1 from characters where owner_id = $1 and not is_house limit 1`, [from]);
    if (!made.rows.length || (await claimRefusal(db, from, accountId))) return claimCookie(null);
    return claimCookie(signClaim({ from, to: accountId }));
  } catch {
    return claimCookie(null);
  }
}

export type ClaimCardData = { names: string[]; dates: number; conversations: number; pictures: number };

/**
 * What the account page's card shows, or null for no card: the switch is off, nobody is signed in, the browser holds no
 * offer (or a forged, expired or someone else's one), the identity can no longer be claimed, or it made no characters.
 * Never throws: the account page must not fail on an offer.
 */
export async function offerForPage(db: Db, auth: { userId: string; authenticated: boolean } | null, store: { get(name: string): { value: string } | undefined }): Promise<ClaimCardData | null> {
  try {
    if (!accountClaimOn() || !auth?.authenticated) return null;
    const offer = offerFromCookieStore(store);
    if (!offer || offer.to !== auth.userId) return null;
    if (await claimRefusal(db, offer.from, offer.to)) return null;
    const made = await claimPreview(db, offer.from);
    if (!made.characters.length) return null;
    return { names: made.characters.map((c) => c.name), dates: made.dates, conversations: made.conversations, pictures: made.pictures };
  } catch {
    return null;
  }
}

/* ------------------------------------------------ the move ------------------------------------------------ */

const lit = (id: string): string => {
  // Ids are inlined (a multi-statement batch takes no parameters), so they are checked to be nothing but a UUID first.
  if (!readUserId(id)) throw new Error("claim: not an id");
  return `'${id}'`;
};

/** One column's statements, from its registry rule. */
function moveColumn(e: PersonColumn, from: string, to: string): string[] {
  const rule = e.move;
  if (rule.does === "skip") return [];
  const t = e.table;
  const c = e.column;
  if (rule.does === "reassign") return [`update ${t} set ${c} = ${to} where ${c} = ${from}`];
  // The account's row that the claimed one would clash with: same key, and (for a rule on some rows only) covered by it.
  const clash = `exists (select 1 from ${t} x where x.${c} = ${to}${rule.key.map((k) => ` and x.${k} is not distinct from t.${k}`).join("")}${rule.when ? ` and (${rule.when})` : ""})`;
  if (rule.loser === "stays") {
    const free = rule.when ? `(not (${rule.when}) or not ${clash})` : `not ${clash}`;
    return [`update ${t} t set ${c} = ${to} where t.${c} = ${from} and ${free}`];
  }
  // The claimed row steps aside first (so it no longer clashes), then moves with the rest.
  return [`update ${t} t set ${rule.loser.set} where t.${c} = ${from}${rule.when ? ` and (${rule.when})` : ""} and ${clash}`, `update ${t} set ${c} = ${to} where ${c} = ${from}`];
}

/**
 * Every statement of a claim, in order. Exported for the tests, which run them and read them; nothing else builds SQL
 * from the registry.
 */
export function claimStatements(fromId: string, toId: string): string[] {
  const from = lit(fromId);
  const to = lit(toId);
  const credentialed = CREDENTIAL_SQL;
  const persona = (id: string) => `'${PERSONA_OWNER_PREFIX}${id.slice(1, -1)}'`;
  const ownedNow = (alias: string, column: string) => `exists (select 1 from characters c where c.id = ${alias}.${column} and c.owner_id = ${to})`;
  const either = `(${from}, ${to})`;
  return [
    // Two claims into one account wait for each other.
    `select pg_advisory_xact_lock(hashtext('account-claim:' || ${to}))`,
    // The route's checks again, where nothing can change between the check and the move.
    `do $$ begin
       if ${from} = ${to} then raise exception 'claim_refused: same identity'; end if;
       if ${credentialed(from)} then raise exception 'claim_refused: that identity has its own account'; end if;
       if exists (select 1 from admins where user_id = ${from}) then raise exception 'claim_refused: an admin''s identity'; end if;
       if ${AGENT_SQL(from)} then raise exception 'claim_refused: an agent''s identity'; end if;
       if exists (select 1 from account_aliases where user_id = ${from}) then raise exception 'claim_refused: that identity has claimed others'; end if;
       if not ${credentialed(to)} then raise exception 'claim_refused: no account to bring them into'; end if;
     end $$`,
    // The link, first: its primary key is the old id, so a second claim of the same identity fails here and moves nothing.
    `insert into account_aliases (alias_id, user_id) values (${from}, ${to})`,
    // A block between the two identities is a person blocking themselves: it goes, so no row breaks blocker <> blocked.
    `delete from blocks where (blocker_id = ${from} and blocked_id = ${to}) or (blocker_id = ${to} and blocked_id = ${from})`,
    // When each character came in: the account's consents cover it from now on, never its past (lib/ml-consent.ts).
    `update characters set claimed_at = now() where owner_id = ${from} or owner_id = ${persona(from)}`,
    ...PERSON_COLUMNS.flatMap((e) => moveColumn(e, from, to)),
    // A "you" from stepping into a date is a character owned by "you:<id>" (lib/step-in-shared.ts): it follows.
    `update characters set owner_id = ${persona(to)} where owner_id = ${persona(from)}`,
    // Nobody rates, reviews, follows or calls their own character (lib/ratings.ts, lib/reviews.ts, lib/character-follows.ts,
    // lib/arcs.ts, lib/auditions.ts). What either identity gave the characters the account now owns would break that, and
    // a rating counts toward its owner's points, so those go. Settled arc calls stay: they were scored when they were fair.
    `delete from character_ratings r where r.rater_id in ${either} and ${ownedNow("r", "character_id")}`,
    `delete from character_reviews r where r.reviewer_id in ${either} and ${ownedNow("r", "character_id")}`,
    `delete from character_follows f where f.user_id in ${either} and ${ownedNow("f", "character_id")}`,
    `delete from audition_votes v where v.voter_id in ${either} and ${ownedNow("v", "character_id")}`,
    `delete from arc_predictions p where p.user_id in ${either} and p.resolved_at is null and (${ownedNow("p", "character_lo")} or ${ownedNow("p", "character_hi")})`,
  ];
}

export type ClaimResult = { ok: true; moved: ClaimPreview } | { ok: false; refused: Refusal | "failed" };

/**
 * Brings what `from` made into the account `to`, all or nothing. The caller has proved the browser held `from` (the
 * signed offer) and is signed in as `to`. Returns what moved, or why nothing did.
 */
export async function claimIdentity(db: Db, from: string, to: string): Promise<ClaimResult> {
  const refused = await claimRefusal(db, from, to);
  if (refused) return { ok: false, refused };
  const moved = await claimPreview(db, from);
  try {
    // One simple-protocol batch: Postgres runs it as a single implicit transaction, so a failure anywhere undoes it all.
    await db.exec(claimStatements(from, to).join(";\n"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // Lost a race with another claim of the same identity (the alias is taken), or a check that changed under us.
    if (/account_aliases_pkey|duplicate key/.test(message)) return { ok: false, refused: "claimed" };
    if (/claim_refused/.test(message)) return { ok: false, refused: /own account/.test(message) ? "has_account" : /admin/.test(message) ? "admin" : /agent/.test(message) ? "agent" : /no account/.test(message) ? "no_account" : "claimed" };
    console.error("[claim] failed and was rolled back:", message.slice(0, 200));
    return { ok: false, refused: "failed" };
  }
  return { ok: true, moved };
}
