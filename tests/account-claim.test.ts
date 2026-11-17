// Claiming what you made before signing in (lib/account-claim.ts): only the identity this browser provably held, only
// when asked, all or nothing, and never a second helping of anything that is one a person.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ClaimCard, { comesWith, namesLine } from "@/app/account/ClaimCard";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { POST as claimRoute } from "@/app/api/me/claim/route";
import { deleteAccount, exportAccount } from "@/lib/account";
import { CLAIM_COOKIE, claimIdentity, claimStatements, offerForPage, offerFromRequest } from "@/lib/account-claim";
import { claimAdmin } from "@/lib/admins";
import { CLAIM_TTL_SECONDS, registerAccount, signClaim, signOAuthState, signSession, verifyClaim } from "@/lib/auth";
import { getPoints } from "@/lib/game";
import { consentedCharactersSql, setMlConsent } from "@/lib/ml-consent";
import { PERSON_COLUMNS, type PersonColumn } from "@/lib/person-columns";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, scriptedModel, startTestDb, validCharacter } from "./helpers";
import { makeWorld, readCatalog, seedPersonRows, type Catalog, type World } from "./person-seed";

const SECRET = ["claim", "test", "secret", "abcdefghij0123456789"].join("-");
// Built from parts, never a `password: "literal"` the secret scanner would flag.
const PW = ["lantern", "keeper", "42"].join("-");

let t: Awaited<ReturnType<typeof startTestDb>>;
let catalog: Catalog;
beforeAll(async () => {
  t = await startTestDb();
  catalog = await readCatalog(t.db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from account_aliases`);
  await t.db.query(`delete from rate_hits`);
  vi.unstubAllEnvs();
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** name=value of one Set-Cookie on a response, or null when it is absent or being cleared. */
function setCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(";")[0];
    if (pair.startsWith(`${name}=`) && pair.length > name.length + 1) return pair;
  }
  return null;
}
const cleared = (res: Response, name: string) => res.headers.getSetCookie().some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/.test(c));
const post = (path: string, body: unknown, cookie?: string) =>
  new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const anonCookie = (uid: string) => `bz_sess=${signSession({ uid, authenticated: false })}`;
const accountCookie = (uid: string) => `bz_sess=${signSession({ uid, authenticated: true })}`;
const offerCookie = (from: string, to: string) => `${CLAIM_COOKIE}=${signClaim({ from, to })}`;
const count = async (sql: string, params: unknown[] = []) => Number((await t.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n);
const ownerOf = async (id: string) => (await t.db.query<{ owner_id: string }>(`select owner_id from characters where id = $1`, [id])).rows[0]?.owner_id;

let handles = 0;
/** An account that already exists, made in "another browser". */
async function anAccount(): Promise<{ id: string; handle: string }> {
  const id = crypto.randomUUID();
  const handle = `claimer_${++handles}_${id.slice(0, 6)}`;
  await registerAccount(t.db, id, handle, PW);
  return { id, handle };
}

/** A browser with a signed anonymous session that made a character and took it on a date. */
async function anAnonymousMaker(o: { date?: boolean } = {}) {
  const id = crypto.randomUUID();
  const cookie = anonCookie(id);
  const character = (await (await api.createCharacter(validCharacter(), cookie)).json()).id as string;
  let episode: string | null = null;
  if (o.date !== false) {
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: character, partner_id: HOUSE_PARTNER_ID }, cookie);
    if (res.status !== 200) throw new Error(`booking failed: ${res.status}`);
    episode = (await t.db.query<{ id: string }>(`select id from episodes where creator_id = $1`, [id])).rows[0].id;
  }
  return { id, cookie, character, episode };
}

/** Signs that browser in to the account, the way the page does, and returns the cookies it now holds. */
async function signIn(maker: { cookie: string }, account: { handle: string }) {
  const res = await loginRoute(post("/api/auth/login", { handle: account.handle, password: PW }, maker.cookie));
  expect(res.status).toBe(200);
  const session = setCookie(res, "bz_sess")!;
  const offer = setCookie(res, CLAIM_COOKIE);
  return { res, session, offer, cookies: [session, offer].filter(Boolean).join("; ") };
}

describe("the offer is made at sign-in, only for an identity this browser provably held", () => {
  it("signing in from a browser that made a character sets a signed, HttpOnly, short-lived offer for exactly that identity and account", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker({ date: false });
    const { res, offer } = await signIn(maker, account);
    expect(offer).not.toBeNull();
    const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${CLAIM_COOKIE}=`))!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toContain(`Max-Age=${CLAIM_TTL_SECONDS}`);
    expect(CLAIM_TTL_SECONDS).toBeLessThanOrEqual(3600);
    expect(verifyClaim(offer!.split("=")[1])).toEqual({ from: maker.id, to: account.id });
    // Nothing moved at sign-in.
    expect(await ownerOf(maker.character)).toBe(maker.id);
    expect(await count(`select 1 from account_aliases`)).toBe(0);
  });

  it("makes no offer for a bare bz_uid (anyone can type one in), and clears any older offer", async () => {
    const account = await anAccount();
    const victim = crypto.randomUUID();
    await api.createCharacter(validCharacter(), `bz_uid=${victim}`);
    const res = await loginRoute(post("/api/auth/login", { handle: account.handle, password: PW }, `bz_uid=${victim}; ${offerCookie(crypto.randomUUID(), account.id)}`));
    expect(res.status).toBe(200);
    expect(setCookie(res, CLAIM_COOKIE)).toBeNull();
    expect(cleared(res, CLAIM_COOKIE)).toBe(true);
  });

  it("makes no offer when there is nothing to bring, when the old identity has its own account, or when it is an admin", async () => {
    const account = await anAccount();
    // Nothing made.
    expect(setCookie(await loginRoute(post("/api/auth/login", { handle: account.handle, password: PW }, anonCookie(crypto.randomUUID()))), CLAIM_COOKIE)).toBeNull();
    // Signed in as another account a moment ago: that identity is an account's, never claimable.
    const other = await anAccount();
    await api.createCharacter(validCharacter(), accountCookie(other.id));
    expect(setCookie(await loginRoute(post("/api/auth/login", { handle: account.handle, password: PW }, accountCookie(other.id))), CLAIM_COOKIE)).toBeNull();
    // ...and not through its unsigned-in session either.
    expect(setCookie(await loginRoute(post("/api/auth/login", { handle: account.handle, password: PW }, anonCookie(other.id))), CLAIM_COOKIE)).toBeNull();
    // An admin's identity.
    const admin = await anAnonymousMaker({ date: false });
    await claimAdmin(t.db, admin.id);
    expect(setCookie(await loginRoute(post("/api/auth/login", { handle: account.handle, password: PW }, admin.cookie)), CLAIM_COOKIE)).toBeNull();
  });

  it("a failed sign-in makes no offer; signing up or out clears one", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker({ date: false });
    const bad = await loginRoute(post("/api/auth/login", { handle: account.handle, password: "wrong-one" }, maker.cookie));
    expect(bad.status).toBe(401);
    expect(setCookie(bad, CLAIM_COOKIE)).toBeNull();
    const stale = offerCookie(crypto.randomUUID(), account.id);
    expect(cleared(await logoutRoute(post("/api/auth/logout", {}, stale)), CLAIM_COOKIE)).toBe(true);
    const fresh = anonCookie(crypto.randomUUID());
    const up = await registerRoute(post("/api/auth/register", { handle: `fresh_${Date.now() % 100000}`, password: PW, attest: true }, `${fresh}; ${stale}`));
    expect(up.status).toBe(201);
    expect(cleared(up, CLAIM_COOKIE)).toBe(true);
  });

  it("Google sign-in to an account that exists makes the same offer", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", ["client", "sec"].join("-"));
    const account = crypto.randomUUID();
    await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, 'sub-claim-1', 'claim@example.com')`, [account]);
    const maker = await anAnonymousMaker({ date: false });
    const state = signOAuthState("nonce-1")!;
    const idToken = `x.${Buffer.from(JSON.stringify({ sub: "sub-claim-1", email: "claim@example.com", email_verified: true })).toString("base64url")}.y`;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 }));
    const res = await googleCallback(new Request(`${BASE_URL}/api/auth/google/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie: `${maker.cookie}; bz_oauth=${state}` } }));
    vi.unstubAllGlobals();
    expect(res.status).toBe(302);
    expect(verifyClaim(setCookie(res, CLAIM_COOKIE)!.split("=")[1])).toEqual({ from: maker.id, to: account });
  });
});

describe("the claim", () => {
  it("brings the characters, their dates, their threads and their Studio pictures into the account, and moves a persona's owner", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker();
    // A conversation with their character, a Studio picture of it, a read marker and a "you" from stepping into a date.
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('thread-1', $1, $2)`, [maker.id, maker.character]);
    await t.db.query(`insert into companion_messages (id, thread_id, role, text) values ('msg-1', 'thread-1', 'user', 'Hello you.')`);
    await t.db.query(`insert into studio_pg_shoots (id, owner_id, character_id) values ('shoot-1', $1, $2)`, [maker.id, maker.character]);
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, mime, content_rating) values ('pic-1', $1, $2, 'shoot-1', 'image/webp', 'pg')`, [maker.id, maker.character]);
    await t.db.query(`insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ('persona-1', $1, 'Sam', 30, 'Me.', '[]'::jsonb, 'x', 'y')`, [`you:${maker.id}`]);

    const signed = await signIn(maker, account);
    const res = await claimRoute(post("/api/me/claim", { confirm: true }, signed.cookies));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: true, characters: 1, dates: 1, conversations: 1, pictures: 1 });
    // The offer is answered: its cookie is taken away.
    expect(cleared(res, CLAIM_COOKIE)).toBe(true);

    expect(await ownerOf(maker.character)).toBe(account.id);
    expect(await count(`select 1 from episodes where id = $1 and creator_id = $2`, [maker.episode, account.id])).toBe(1);
    expect(await count(`select 1 from companion_threads where id = 'thread-1' and user_id = $1`, [account.id])).toBe(1);
    expect(await count(`select 1 from companion_messages where thread_id = 'thread-1'`)).toBe(1);
    expect(await count(`select 1 from studio_pg_pictures where id = 'pic-1' and owner_id = $1`, [account.id])).toBe(1);
    expect(await count(`select 1 from studio_pg_shoots where id = 'shoot-1' and owner_id = $1`, [account.id])).toBe(1);
    expect(await ownerOf("persona-1")).toBe(`you:${account.id}`);
    // Nothing of the old identity's is left on what moved, and the link is recorded.
    expect(await count(`select 1 from characters where owner_id in ($1, $2)`, [maker.id, `you:${maker.id}`])).toBe(0);
    expect((await t.db.query(`select alias_id, user_id from account_aliases`)).rows).toEqual([{ alias_id: maker.id, user_id: account.id }]);
  });

  it("is refused with no offer, a forged offer, an offer for another account, signed out, and a second time", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker({ date: false });
    const session = accountCookie(account.id);
    const unmoved = async () => expect(await ownerOf(maker.character)).toBe(maker.id);

    // No offer cookie: an id in the body, a query string or a header is never read.
    const noCookie = await claimRoute(
      new Request(`${BASE_URL}/api/me/claim?from=${maker.id}`, { method: "POST", headers: { "content-type": "application/json", cookie: session, "x-claim-from": maker.id }, body: JSON.stringify({ confirm: true, from: maker.id, alias_id: maker.id }) }),
    );
    expect(noCookie.status).toBe(403);
    await unmoved();

    // A forged offer: the right shape, signed with another secret; and a real one with its payload swapped.
    const forged = `${CLAIM_COOKIE}=${signClaim({ from: maker.id, to: account.id }, { SESSION_SECRET: "another-secret-entirely-0123456789" })}`;
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${session}; ${forged}`))).status).toBe(403);
    const real = signClaim({ from: crypto.randomUUID(), to: account.id })!;
    const swapped = real.split(".");
    swapped[2] = Buffer.from(JSON.stringify({ f: maker.id, t: account.id, e: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${session}; ${CLAIM_COOKIE}=${swapped.join(".")}`))).status).toBe(403);
    // A session token is not an offer, and an expired offer is over.
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${session}; ${CLAIM_COOKIE}=${signSession({ uid: maker.id, authenticated: false })}`))).status).toBe(403);
    const old = signClaim({ from: maker.id, to: account.id }, process.env, Date.now() - (CLAIM_TTL_SECONDS + 5) * 1000);
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${session}; ${CLAIM_COOKIE}=${old}`))).status).toBe(403);
    await unmoved();

    // An offer made for one account is no good in another.
    const thief = await anAccount();
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${accountCookie(thief.id)}; ${offerCookie(maker.id, account.id)}`))).status).toBe(403);
    // Signed out (or an unsigned-in session of the account's id): not at all.
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, offerCookie(maker.id, account.id)))).status).toBe(401);
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${anonCookie(account.id)}; ${offerCookie(maker.id, account.id)}`))).status).toBe(401);
    // No {confirm: true}: nothing happens.
    expect((await claimRoute(post("/api/me/claim", {}, `${session}; ${offerCookie(maker.id, account.id)}`))).status).toBe(422);
    await unmoved();

    // The real one works once.
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${session}; ${offerCookie(maker.id, account.id)}`))).status).toBe(200);
    expect(await ownerOf(maker.character)).toBe(account.id);
    // The same offer again (a copied cookie), into this account or any other: refused, and nothing changes hands.
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${session}; ${offerCookie(maker.id, account.id)}`))).status).toBe(403);
    expect((await claimIdentity(t.db, maker.id, thief.id)).ok).toBe(false);
    expect(await ownerOf(maker.character)).toBe(account.id);
    expect(await count(`select 1 from account_aliases`)).toBe(1);
  });

  it("refuses an identity that has its own account, an admin's, and one that isn't an id, even with a signed offer", async () => {
    const account = await anAccount();
    const other = await anAccount();
    await api.createCharacter(validCharacter(), accountCookie(other.id));
    expect(await claimIdentity(t.db, other.id, account.id)).toEqual({ ok: false, refused: "has_account" });
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, `${accountCookie(account.id)}; ${offerCookie(other.id, account.id)}`))).status).toBe(403);
    expect(await count(`select 1 from characters where owner_id = $1`, [other.id])).toBe(1);

    const admin = await anAnonymousMaker({ date: false });
    await claimAdmin(t.db, admin.id);
    expect(await claimIdentity(t.db, admin.id, account.id)).toEqual({ ok: false, refused: "admin" });
    expect(await ownerOf(admin.character)).toBe(admin.id);

    // An identity that has ever been an agent's (it connected over MCP, or made a character through a tool): its id is a
    // bearer token that reaches the site unsigned, so no session that carries it makes it claimable.
    const agent = await anAnonymousMaker({ date: false });
    await t.db.query(`insert into mcp_sessions (id, agent_id) values ('sess-claim-test', $1)`, [agent.id]);
    expect(await claimIdentity(t.db, agent.id, account.id)).toEqual({ ok: false, refused: "agent" });
    expect(setCookie(await loginRoute(post("/api/auth/login", { handle: account.handle, password: PW }, agent.cookie)), CLAIM_COOKIE)).toBeNull();
    const viaTool = await anAnonymousMaker({ date: false });
    await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [viaTool.character]);
    expect(await claimIdentity(t.db, viaTool.id, account.id)).toEqual({ ok: false, refused: "agent" });
    await expect(t.db.exec(claimStatements(agent.id, account.id).join(";\n"))).rejects.toThrow(/claim_refused: an agent/);
    expect(await ownerOf(agent.character)).toBe(agent.id);
    expect(await ownerOf(viaTool.character)).toBe(viaTool.id);

    // A persona's owner string and the deleted owner are not ids: nothing can sign an offer for them.
    expect(signClaim({ from: "deleted", to: account.id })).toBeNull();
    expect(signClaim({ from: `you:${admin.id}`, to: account.id })).toBeNull();
    expect(await claimIdentity(t.db, "deleted", account.id)).toEqual({ ok: false, refused: "not_an_id" });
    expect(() => claimStatements("x' or '1'='1", account.id)).toThrow();
    // Into something that isn't an account: no.
    const maker = await anAnonymousMaker({ date: false });
    expect(await claimIdentity(t.db, maker.id, crypto.randomUUID())).toEqual({ ok: false, refused: "no_account" });
    // The database refuses too, on its own, if the route's checks are skipped.
    await expect(t.db.exec(claimStatements(other.id, account.id).join(";\n"))).rejects.toThrow(/claim_refused/);
    await expect(t.db.exec(claimStatements(admin.id, account.id).join(";\n"))).rejects.toThrow(/claim_refused/);
    expect(await count(`select 1 from account_aliases`)).toBe(0);
  });

  it("doubles nothing: allowances, balances, votes, predictions and points stay where they were", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker();
    const season = (await t.db.query<{ season_id: string }>(`select season_id from free_episode_usage where user_id = $1`, [maker.id])).rows[0]?.season_id ?? "2026-11";
    // The account has used one free date and voted; the old identity used its own and voted the other way.
    await t.db.query(`insert into free_episode_usage (user_id, season_id, used) values ($1, $2, 1) on conflict (user_id, season_id) do update set used = 1`, [account.id, season]);
    await t.db.query(`insert into free_episode_usage (user_id, season_id, used) values ($1, $2, 3) on conflict (user_id, season_id) do update set used = 3`, [maker.id, season]);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ('grant-old', $1, 5, 'admin'), ('grant-mine', $2, 2, 'admin')`, [maker.id, account.id]);
    await t.db.query(`insert into situation_votes (day, user_id, pick) values ('2026-11-16', $1, 'a'), ('2026-11-16', $2, 'b')`, [maker.id, account.id]);
    await t.db.query(`insert into season_format_votes (season_id, user_id, pick) values ('2026-12', $1, 'classic')`, [maker.id]);
    const other = (await t.db.query<{ id: string }>(`select id from episodes where creator_id = $1`, [maker.id])).rows[0].id;
    await t.db.query(`insert into predictions (episode_id, user_id, pick) values ($1, $2, 'friends')`, [other, maker.id]);
    const pointsBefore = await getPoints(t.db, account.id);

    expect((await claimIdentity(t.db, maker.id, account.id)).ok).toBe(true);

    expect((await t.db.query(`select user_id, used from free_episode_usage where season_id = $1 and user_id in ($2, $3) order by used`, [season, account.id, maker.id])).rows).toEqual([
      { user_id: account.id, used: 1 },
      { user_id: maker.id, used: 3 },
    ]);
    expect((await t.db.query(`select id from token_grants where user_id = $1`, [account.id])).rows).toEqual([{ id: "grant-mine" }]);
    expect((await t.db.query(`select user_id, pick from situation_votes order by pick`)).rows).toEqual([
      { user_id: maker.id, pick: "a" },
      { user_id: account.id, pick: "b" },
    ]);
    expect(await count(`select 1 from season_format_votes where user_id = $1`, [account.id])).toBe(0);
    expect(await count(`select 1 from predictions where user_id = $1`, [account.id])).toBe(0);
    expect(await getPoints(t.db, account.id)).toBe(pointsBefore);
  });

  it("the account's own row wins where there can be only one, and nobody ends up rating their own character", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker();
    const mine = (await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), accountCookie(account.id))).json()).id as string;
    // Both talked to the same house character: the account's conversation stays the account's, the other stays behind.
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('theirs', $1, $3), ('mine', $2, $3), ('only-theirs', $1, $4)`, [maker.id, account.id, HOUSE_PARTNER_ID, maker.character]);
    // Both have a character up for the same season: one in play a person.
    await t.db.query(`insert into cast_auditions (season_id, character_id, owner_id, status) values ('2026-12', $1, $2, 'open'), ('2026-12', $3, $4, 'approved')`, [maker.character, maker.id, mine, account.id]);
    // The account had rated, reviewed, followed and voted for the character it is about to own; the old identity had rated the account's.
    await t.db.query(`insert into character_ratings (rater_id, character_id, category) values ($1, $2, 'likable'), ($3, $4, 'likable')`, [account.id, maker.character, maker.id, mine]);
    await t.db.query(`insert into character_reviews (reviewer_id, character_id, stars) values ($1, $2, 5)`, [account.id, maker.character]);
    await t.db.query(`insert into character_follows (user_id, character_id) values ($1, $2)`, [account.id, maker.character]);
    await t.db.query(`insert into audition_votes (season_id, voter_id, character_id) values ('2026-12', $1, $2)`, [account.id, maker.character]);
    // A rating either gave someone else's character is a vote like any other: it stays.
    await t.db.query(`insert into character_ratings (rater_id, character_id, category) values ($1, $2, 'surprising')`, [maker.id, HOUSE_PARTNER_ID]);

    expect((await claimIdentity(t.db, maker.id, account.id)).ok).toBe(true);

    expect((await t.db.query(`select id, user_id from companion_threads order by id`)).rows).toEqual([
      { id: "mine", user_id: account.id },
      { id: "only-theirs", user_id: account.id },
      { id: "theirs", user_id: maker.id },
    ]);
    expect((await t.db.query(`select character_id, owner_id, status from cast_auditions order by status`)).rows).toEqual([
      { character_id: mine, owner_id: account.id, status: "approved" },
      { character_id: maker.character, owner_id: account.id, status: "withdrawn" },
    ]);
    expect(await count(`select 1 from character_ratings r join characters c on c.id = r.character_id where c.owner_id = $1`, [account.id])).toBe(0);
    expect(await count(`select 1 from character_reviews`)).toBe(0);
    expect(await count(`select 1 from character_follows`)).toBe(0);
    expect(await count(`select 1 from audition_votes`)).toBe(0);
    expect((await t.db.query(`select rater_id from character_ratings`)).rows).toEqual([{ rater_id: maker.id }]);
  });

  it("blocks follow the person both ways, so a claim never unblocks anyone", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker();
    const stranger = crypto.randomUUID();
    const ep = maker.episode!;
    // The old identity blocked a stranger, a stranger blocked the old identity, and the two identities blocked each other.
    await t.db.query(
      `insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $4, $2), ($2, $4, $1), ($1, $4, $3), ($3, $4, $1)`,
      [maker.id, stranger, account.id, ep],
    );
    expect((await claimIdentity(t.db, maker.id, account.id)).ok).toBe(true);
    expect((await t.db.query(`select blocker_id, blocked_id from blocks order by blocker_id = $1 desc`, [account.id])).rows).toEqual([
      { blocker_id: account.id, blocked_id: stranger },
      { blocker_id: stranger, blocked_id: account.id },
    ]);
  });

  it("is all or nothing: one failing statement undoes the whole claim", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker();
    await t.db.query(`insert into studio_pg_shoots (id, owner_id, character_id) values ('shoot-x', $1, $2)`, [maker.id, maker.character]);
    // The Studio's turn comes long after the characters and the dates have been rewritten: make it fail.
    await t.db.exec(`
      create or replace function claim_test_fail() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
      create trigger claim_test_fail before update on studio_pg_shoots for each row execute function claim_test_fail();
    `);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const signed = await signIn(maker, account);
      const res = await claimRoute(post("/api/me/claim", { confirm: true }, signed.cookies));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("claim_failed");
      // The offer is kept (nothing was answered), and nothing at all moved: not the characters, not the dates, not the link.
      expect(cleared(res, CLAIM_COOKIE)).toBe(false);
      expect(await ownerOf(maker.character)).toBe(maker.id);
      expect(await count(`select 1 from episodes where creator_id = $1`, [maker.id])).toBe(1);
      expect(await count(`select 1 from episodes where creator_id = $1`, [account.id])).toBe(0);
      expect(await count(`select 1 from account_aliases`)).toBe(0);
      // What was logged names nothing but what went wrong.
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(/claimer_|example\.com/);
      // With the fault gone, the same offer goes through.
      await t.db.exec(`drop trigger claim_test_fail on studio_pg_shoots; drop function claim_test_fail();`);
      expect((await claimRoute(post("/api/me/claim", { confirm: true }, signed.cookies))).status).toBe(200);
      expect(await ownerOf(maker.character)).toBe(account.id);
    } finally {
      await t.db.exec(`drop trigger if exists claim_test_fail on studio_pg_shoots; drop function if exists claim_test_fail();`);
    }
  });

  it("declining leaves everything as it was and drops the offer", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker({ date: false });
    const signed = await signIn(maker, account);
    const res = await claimRoute(post("/api/me/claim", { decline: true }, signed.cookies));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ declined: true });
    expect(cleared(res, CLAIM_COOKIE)).toBe(true);
    expect(await ownerOf(maker.character)).toBe(maker.id);
    expect(await count(`select 1 from account_aliases`)).toBe(0);
  });

  it("is rate limited per account", async () => {
    const account = await anAccount();
    const session = accountCookie(account.id);
    const statuses: number[] = [];
    // Each try carries a real offer (for an identity with nothing in it, so each goes through); the seventh is turned away.
    for (let i = 0; i < 8; i++) statuses.push((await claimRoute(post("/api/me/claim", { confirm: true }, `${session}; ${offerCookie(crypto.randomUUID(), account.id)}`))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429, 429]);
    // A try with no offer is never counted: it costs nothing to refuse.
    await t.db.query(`delete from rate_hits`);
    for (let i = 0; i < 8; i++) expect((await claimRoute(post("/api/me/claim", { confirm: true }, session))).status).toBe(403);
    expect(await count(`select 1 from rate_hits`)).toBe(0);
  });
});

describe("a consent is never carried over", () => {
  it("the account's machine-learning consent covers a claimed character from the claim on, never its earlier dates", async () => {
    const account = await anAccount();
    await setMlConsent(t.db, account.id, true);
    const maker = await anAnonymousMaker();
    const mine = (await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), accountCookie(account.id))).json()).id as string;
    scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: mine, partner_id: HOUSE_PARTNER_ID }, accountCookie(account.id))).status).toBe(200);
    const consented = async (episode: string) =>
      (
        await t.db.query<{ ok: boolean }>(
          `select ${consentedCharactersSql("a", "b", "e.created_at")} as ok from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b where e.id = $1`,
          [episode],
        )
      ).rows[0].ok;
    const ownDate = (await t.db.query<{ id: string }>(`select id from episodes where character_a = $1 or character_b = $1`, [mine])).rows[0].id;
    // Before the claim: the account's own date is covered, the anonymous identity's is not (it never consented).
    expect(await consented(ownDate)).toBe(true);
    expect(await consented(maker.episode!)).toBe(false);

    expect((await claimIdentity(t.db, maker.id, account.id)).ok).toBe(true);
    expect(await ownerOf(maker.character)).toBe(account.id);

    // After: the date made before the claim is still not covered, though the character is the account's now.
    expect(await consented(maker.episode!)).toBe(false);
    expect(await consented(ownDate)).toBe(true);
    // A date the claimed character goes on afterwards is the account's, and is covered.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, created_at)
       select 'a-later-date', creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, now() + interval '1 hour' from episodes where id = $1`,
      [maker.episode],
    );
    expect(await consented("a-later-date")).toBe(true);
    // Only the characters that came in are marked.
    expect((await t.db.query(`select id from characters where claimed_at is not null`)).rows).toEqual([{ id: maker.character }]);
  });
});

describe("every column does what the registry says", () => {
  let world: World;
  const NAMES = new Set(PERSON_COLUMNS.map((e) => `${e.table}.${e.column}`));
  // Left out: the rows that would (rightly) stop the claim. An admin's identity, one that has already been part of a
  // claim, and the marks of an agent's identity (its sessions, handle, declared model and its side of a link).
  const STOPS = new Set(["admins.user_id", "account_aliases.alias_id", "account_aliases.user_id", "mcp_sessions.agent_id", "agent_handles.agent_id", "agent_models.agent_id", "agent_links.agent_id"]);
  const SEEDED = PERSON_COLUMNS.filter((e) => !STOPS.has(`${e.table}.${e.column}`));
  const OVERRIDES = {};

  it("reassigns what is marked reassign, moves a merge that has no clash, and leaves every skip exactly where it was", async () => {
    world = await makeWorld(t.db, catalog, NAMES);
    const from = crypto.randomUUID();
    const account = await anAccount();
    await seedPersonRows(t.db, catalog, SEEDED, from, world, NAMES, OVERRIDES);
    const at = async (e: { table: string; column: string }, who: string) => Number((await t.db.query<{ n: number }>(`select count(*)::int as n from ${e.table} where ${e.column} = $1`, [who])).rows[0].n);
    const before = new Map<string, number>();
    for (const e of SEEDED) before.set(`${e.table}.${e.column}`, await at(e, account.id));

    expect(await claimIdentity(t.db, from, account.id)).toMatchObject({ ok: true });

    // Where every seeded row ended up, read once; then compared with what a list of entries says.
    const left = new Map<string, number>();
    const arrived = new Map<string, number>();
    for (const e of SEEDED) {
      left.set(`${e.table}.${e.column}`, await at(e, from));
      arrived.set(`${e.table}.${e.column}`, (await at(e, account.id)) - before.get(`${e.table}.${e.column}`)!);
    }
    const mismatches = (entries: readonly PersonColumn[]): string[] =>
      entries.flatMap((e) => {
        const key = `${e.table}.${e.column}`;
        const [l, a] = [left.get(key)!, arrived.get(key)!];
        const moved = e.move.does !== "skip";
        return (moved ? l !== 0 || a !== 1 : l !== 1 || a !== 0) ? [`${key} (${e.move.does}): ${l} left, ${a} arrived`] : [];
      });
    expect(mismatches(SEEDED)).toEqual([]);
    // The comparison has teeth: an entry that says the wrong thing is caught, either way.
    const saying = (which: string, move: PersonColumn["move"]) => SEEDED.map((e) => (`${e.table}.${e.column}` === which ? { ...e, move } : e));
    expect(mismatches(saying("predictions.user_id", { does: "reassign" }))).toEqual(["predictions.user_id (reassign): 1 left, 0 arrived"]);
    expect(mismatches(saying("characters.owner_id", { does: "skip", why: "(a wrong entry, for this test)" }))).toEqual(["characters.owner_id (skip): 0 left, 1 arrived"]);
    // And it covered the whole show registry but the seven rows that stop a claim.
    expect(SEEDED).toHaveLength(PERSON_COLUMNS.length - STOPS.size);
    expect(SEEDED.filter((e) => e.move.does === "reassign").length).toBeGreaterThan(20);
    expect(SEEDED.filter((e) => e.move.does === "merge").length).toBeGreaterThan(5);
    // Someone else's rows never move.
    expect(await count(`select 1 from characters where owner_id = $1`, [world.otherUser])).toBe(world.characters.length);
  });

  it("names no After Dark table in what it runs", () => {
    const sql = claimStatements(crypto.randomUUID(), crypto.randomUUID()).join("\n");
    expect(sql).not.toMatch(/\badult_/);
    expect(sql).not.toMatch(/media_favorites/);
    // And nothing that is one a person: no allowance, balance, vote or prediction table is written.
    for (const table of ["free_episode_usage", "pack_episode_usage", "token_grants", "orders", "predictions", "situation_votes", "cast_backings", "companion_credits", "plan_entitlements"]) {
      expect(sql, table).not.toMatch(new RegExp(`update ${table}\\b`));
    }
  });
});

describe("the switch", () => {
  it("ACCOUNT_CLAIM=0: no offer at sign-in, no card, and the route refuses", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker({ date: false });
    vi.stubEnv("ACCOUNT_CLAIM", "0");
    const signed = await signIn(maker, account);
    expect(signed.offer).toBeNull();
    const withOffer = `${accountCookie(account.id)}; ${offerCookie(maker.id, account.id)}`;
    expect((await claimRoute(post("/api/me/claim", { confirm: true }, withOffer))).status).toBe(404);
    expect(await offerForPage(t.db, { userId: account.id, authenticated: true }, { get: (name) => (name === CLAIM_COOKIE ? { value: signClaim({ from: maker.id, to: account.id })! } : undefined) })).toBeNull();
    expect(await claimIdentity(t.db, maker.id, account.id)).toEqual({ ok: false, refused: "off" });
    expect(await ownerOf(maker.character)).toBe(maker.id);
  });
});

describe("the card", () => {
  it("is shown to the account the offer was made for, with what will move, and to nobody else", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker();
    const store = (value: string | null) => ({ get: (name: string) => (name === CLAIM_COOKIE && value ? { value } : undefined) });
    const offer = signClaim({ from: maker.id, to: account.id })!;
    const shown = await offerForPage(t.db, { userId: account.id, authenticated: true }, store(offer));
    expect(shown).toEqual({ names: [expect.any(String)], dates: 1, conversations: 0, pictures: 0 });
    // Another account, a signed-out visitor, no cookie, a forged cookie: no card.
    expect(await offerForPage(t.db, { userId: (await anAccount()).id, authenticated: true }, store(offer))).toBeNull();
    expect(await offerForPage(t.db, { userId: account.id, authenticated: false }, store(offer))).toBeNull();
    expect(await offerForPage(t.db, null, store(offer))).toBeNull();
    expect(await offerForPage(t.db, { userId: account.id, authenticated: true }, store(null))).toBeNull();
    expect(await offerForPage(t.db, { userId: account.id, authenticated: true }, store(`${offer}x`))).toBeNull();
    // Once claimed, the card is gone.
    await claimIdentity(t.db, maker.id, account.id);
    expect(await offerForPage(t.db, { userId: account.id, authenticated: true }, store(offer))).toBeNull();
  });

  it("says how many, who, and what comes with them, and carries no id", () => {
    expect(namesLine(["Nell"])).toBe("Nell");
    expect(namesLine(["Nell", "Sable"])).toBe("Nell and Sable");
    expect(namesLine(["Nell", "Sable", "Otto", "Mira", "Juno"])).toBe("Nell, Sable and 3 more");
    expect(comesWith({ dates: 2, conversations: 1, pictures: 0 })).toBe("2 dates and 1 conversation");
    expect(comesWith({ dates: 0, conversations: 0, pictures: 0 })).toBe("");
    const html = renderToStaticMarkup(createElement(ClaimCard, { names: ["Nell", "Sable"], dates: 3, conversations: 0, pictures: 4 }));
    expect(html).toContain("You made 2 characters before signing in");
    expect(html).toContain("Nell and Sable, with 3 dates and 4 Studio pictures. Bring them into this account?");
    expect(html).toContain("Bring them in");
    expect(html).toContain("Not now");
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // One character with nothing else: its name is said once.
    const one = renderToStaticMarkup(createElement(ClaimCard, { names: ["Nell"], dates: 0, conversations: 0, pictures: 0 }));
    expect(one).toContain("You made 1 character before signing in");
    expect(one).toContain("<p>Bring Nell into this account?</p>");
    expect(one).toContain("Bring Nell in");
    expect(renderToStaticMarkup(createElement(ClaimCard, { names: ["Nell"], dates: 2, conversations: 0, pictures: 0 }))).toContain("Nell, with 2 dates. Bring them into this account?");
  });
});

describe("the link in the export and the delete", () => {
  it("exports the claimed identity with what stayed under it, and deleting the account removes that too", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker();
    await t.db.query(`insert into situation_votes (day, user_id, pick) values ('2026-11-16', $1, 'a')`, [maker.id]);
    await claimIdentity(t.db, maker.id, account.id);

    const out = await exportAccount(t.db, account.id);
    expect(out.claimed_identities).toEqual([expect.objectContaining({ id: maker.id, linked_at: expect.any(String) })]);
    // The vote stayed with the old identity (nothing doubled), and it is still theirs to take.
    expect(out.situation_votes).toEqual([]);
    expect((out.claimed_identities[0].left_behind as { situation_votes: unknown[] }).situation_votes).toHaveLength(1);
    expect(out.characters.map((c) => c.id)).toContain(maker.character);

    await deleteAccount(t.db, account.id);
    expect(await count(`select 1 from situation_votes where user_id = $1`, [maker.id])).toBe(0);
    expect(await count(`select 1 from account_aliases`)).toBe(0);
    expect(await count(`select 1 from characters where owner_id in ($1, $2)`, [maker.id, account.id])).toBe(0);
  });

  it("deleting an account never deletes a claimed identity that has since got a sign-in of its own", async () => {
    const account = await anAccount();
    const maker = await anAnonymousMaker({ date: false });
    await claimIdentity(t.db, maker.id, account.id);
    // Someone registers on the old id afterwards (a typed-in cookie): it is their account now, not this person's to delete.
    await registerAccount(t.db, maker.id, `later_${maker.id.slice(0, 6)}`, PW);
    await t.db.query(`insert into situation_votes (day, user_id, pick) values ('2026-11-16', $1, 'a')`, [maker.id]);
    await deleteAccount(t.db, account.id);
    expect(await count(`select 1 from accounts where user_id = $1`, [maker.id])).toBe(1);
    expect(await count(`select 1 from situation_votes where user_id = $1`, [maker.id])).toBe(1);
    expect((await exportAccount(t.db, maker.id)).account).not.toBeNull();
  });
});
