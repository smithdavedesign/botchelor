import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as readSoul, PUT as writeSoul } from "@/app/api/characters/[id]/soul/route";
import { POST as proposeRoute } from "@/app/api/couples/[a]/[b]/proposal/route";
import { signSession, verifySession } from "@/lib/auth";
import { proposalView } from "@/lib/date-proposals";
import { doubleView, type GroupNight } from "@/lib/group-dates";
import { authFromCookieStore, authFromRequest, bareIdsAllowed, internalRequest, isInternalRequest, MCP_CALL_PATH, passOn } from "@/lib/http";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { hideOtherOwners, OTHER_OWNER } from "@/lib/mcp/owner-ids";
import { api, BASE_URL, HOUSE_PARTNER_ID, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";
import { seasonCastIds } from "@/lib/season-cast";

/**
 * The 2026-11-21 audit: a user id is a name, never a password. Production signs sessions, and there a bare `bz_uid`
 * cookie that names someone is nobody; an agent's reply never carries another owner's id; and an agent can't pass a
 * website visitor's id as its own. Every test here runs as production does: sessions signed, LEGACY_BARE_UID off (the
 * rest of the suite keeps it on, tests/setup-legacy-ids.ts).
 */
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const rpc = async (method: string, params: Any = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Any = {}, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string, cookie?: string) => new Request(`${BASE_URL}${path}`, { headers: cookie ? { cookie } : {} });
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("LEGACY_BARE_UID", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A visitor as production makes one: no cookie in, a signed anonymous session out. Their id, that cookie, their character. */
async function visitor(name = "Ada Lumen") {
  const res = await api.createCharacter(validCharacter({ name }));
  expect(res.status).toBe(201);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("bz_sess="))!;
  const claims = verifySession(cookie.slice("bz_sess=".length))!;
  expect(claims.authenticated).toBe(false);
  return { id: claims.uid, cookie, bare: `bz_uid=${claims.uid}`, characterId: ((await res.json()) as Any).id as string };
}

/** An agent over MCP, and one character of its own. */
async function agent(name: string) {
  const ctx: McpContext = { userAgent: "test-agent/1.0" };
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "bare-id-test", version: "1" } }, ctx);
  const session: McpContext = { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
  const made = (await call("create_character", { ...validCharacter({ name }), extras: PROFILE }, session)).structuredContent;
  return { ctx: session, characterId: made.character.id as string, agentId: made.agent_id as string };
}

describe("when a bare id counts", () => {
  it("never in an app that signs, unless the tests' switch is on", () => {
    expect(bareIdsAllowed({ SESSION_SECRET: TEST_SESSION_SECRET })).toBe(false);
    expect(bareIdsAllowed({ SESSION_SECRET: TEST_SESSION_SECRET, LEGACY_BARE_UID: "1" })).toBe(true);
    expect(bareIdsAllowed({})).toBe(true); // an app that can't sign at all behaves as before accounts
    expect(bareIdsAllowed({ SESSION_SECRET: TEST_SESSION_SECRET, LEGACY_BARE_UID: "0" })).toBe(false);
  });

  it("a browser's bare cookie is nobody; its signed session is who it says", () => {
    const id = crypto.randomUUID();
    expect(authFromRequest(get("/api/me", `bz_uid=${id}`))).toBeNull();
    expect(authFromCookieStore({ get: (n) => (n === "bz_uid" ? { value: id } : undefined) })).toBeNull();
    const signed = `bz_sess=${signSession({ uid: id, authenticated: false })}`;
    expect(authFromRequest(get("/api/me", signed))).toEqual({ userId: id, authenticated: false });
    // A signed session and a bare cookie for someone else: the signature wins, the bare one is never read.
    expect(authFromRequest(get("/api/me", `bz_uid=${crypto.randomUUID()}; ${signed}`))).toEqual({ userId: id, authenticated: false });
  });

  it("the server's own call carries an id; the same request built by hand does not", () => {
    const id = crypto.randomUUID();
    const own = internalRequest(id, { body: { a: 1 } });
    expect(isInternalRequest(own)).toBe(true);
    expect(new URL(own.url).pathname).toBe(MCP_CALL_PATH);
    expect(authFromRequest(own)).toEqual({ userId: id, authenticated: false });
    // Same address, same cookie, made outside lib/http.ts: a stranger.
    const forged = new Request(`${BASE_URL}${MCP_CALL_PATH}`, { method: "POST", headers: { "content-type": "application/json", cookie: `bz_uid=${id}` }, body: "{}" });
    expect(isInternalRequest(forged)).toBe(false);
    expect(authFromRequest(forged)).toBeNull();
  });

  it("a route handing its request on keeps what it was: the server's call stays one, a browser's stays a browser's", () => {
    const id = crypto.randomUUID();
    const next = () => new Request(`${BASE_URL}/api/episodes`, { method: "POST", headers: { cookie: `bz_uid=${id}` }, body: "{}" });
    expect(authFromRequest(passOn(internalRequest(id), next()))).toEqual({ userId: id, authenticated: false });
    expect(authFromRequest(passOn(get("/api/overnight", `bz_uid=${id}`), next()))).toBeNull();
  });
});

describe("a visitor's id typed into a cookie gets nothing of theirs", () => {
  it("their private soul, an edit and a delete all answer not found; their own signed session works", async () => {
    const v = await visitor();
    const soul = { values: "Keeps her word, even when it costs her." };
    const put = await writeSoul(new Request(`${BASE_URL}/api/characters/${v.characterId}/soul`, { method: "PUT", headers: { cookie: v.cookie, "content-type": "application/json" }, body: JSON.stringify(soul) }), params(v.characterId));
    expect(put.status).toBe(200);

    expect((await readSoul(get(`/api/characters/${v.characterId}/soul`, v.bare), params(v.characterId))).status).toBe(404);
    expect((await api.editCharacter(v.characterId, { bio: "Rewritten by someone who only knew her id." }, v.bare)).status).toBe(404);
    expect((await api.deleteCharacter(v.characterId, v.bare)).status).toBe(404);
    const row = (await t.db.query<Any>(`select owner_id, bio from characters where id = $1`, [v.characterId])).rows[0];
    expect(row.owner_id).toBe(v.id);
    expect(row.bio).not.toMatch(/Rewritten/);

    const mine = await readSoul(get(`/api/characters/${v.characterId}/soul`, v.cookie), params(v.characterId));
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as Any).soul.values).toBe(soul.values);
  });

  it("the bare cookie is a new visitor: it lists none of their characters and is handed an id of its own", async () => {
    const v = await visitor();
    const res = await api.myCharacters(v.bare);
    expect(JSON.stringify(await res.json())).not.toContain(v.characterId);
    expect((await api.myCharacters(v.cookie).then((r) => r.json()) as Any).characters.map((c: Any) => c.id)).toContain(v.characterId);
  });

  it("signing up with someone's bare id makes an account of its own, never theirs", async () => {
    const v = await visitor();
    const res = await register(
      new Request(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { cookie: v.bare, "content-type": "application/json" },
        body: JSON.stringify({ handle: "taker_one", password: ["a", "good", "password"].join("-"), attest: true }),
      }),
    );
    expect(res.status).toBe(201);
    const accounts = (await t.db.query<Any>(`select user_id from accounts where handle = 'taker_one'`)).rows;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].user_id).not.toBe(v.id);
    expect((await t.db.query(`select 1 from accounts where user_id = $1`, [v.id])).rows).toHaveLength(0);
    expect((await t.db.query<Any>(`select owner_id from characters where id = $1`, [v.characterId])).rows[0].owner_id).toBe(v.id);
  });
});

describe("agents over MCP, with production's rule on", () => {
  it("an agent still acts as itself: its tools call the site's routes as the server's own requests", async () => {
    const a = await agent("Juni Marsh");
    const status = await call("my_status", {}, a.ctx);
    expect(status.isError).toBeFalsy();
    expect(JSON.stringify(status.structuredContent)).toContain(a.characterId);
    const edited = await call("update_character", { character_id: a.characterId, bio: "Keeps a paper map in the glovebox and trusts it over the phone." }, a.ctx);
    expect(edited.isError).toBeFalsy();
    expect((await t.db.query<Any>(`select bio, owner_id from characters where id = $1`, [a.characterId])).rows[0]).toMatchObject({ owner_id: a.agentId, bio: expect.stringContaining("paper map") });
  });

  it("a website visitor's id is refused as an agent_id, and nothing of theirs is read or changed", async () => {
    const v = await visitor("Mara Quill");
    const a = await agent("Juni Marsh");
    const out = await call("my_status", { agent_id: v.id }, a.ctx);
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.content)).toMatch(/playing on the website/);
    expect(JSON.stringify(out)).not.toContain(v.characterId);
    const gone = await call("delete_character", { character_id: v.characterId, agent_id: v.id, confirm: true }, a.ctx);
    expect(gone.isError).toBe(true);
    expect((await t.db.query(`select 1 from characters where id = $1`, [v.characterId])).rows).toHaveLength(1);
    // The agent's own id still works, given or remembered by its connection.
    expect((await call("my_status", { agent_id: a.agentId }, a.ctx)).isError).toBeFalsy();
  });

  it("the double-date list says you or them, and never carries the other booker's id", async () => {
    const a = await agent("Juni Marsh");
    const b = await agent("Pia Voss");
    const house2 = seasonCastIds().find((id) => id !== HOUSE_PARTNER_ID)!;
    const invite = await call("double_date", { character_id: a.characterId, partner_id: HOUSE_PARTNER_ID, with_character: b.characterId, with_partner: house2 }, a.ctx);
    expect(invite.isError).toBeFalsy();

    const asked = await call("double_date", { list: true }, b.ctx);
    expect(asked.isError).toBeFalsy();
    expect(JSON.stringify(asked)).not.toContain(a.agentId);
    const night = asked.structuredContent.nights[0];
    expect(night).toMatchObject({ id: invite.structuredContent.invited, status: "invited", proposed_by: "them", waiting_on: "you" });
    expect(night).not.toHaveProperty("created_by");
    expect(night).not.toHaveProperty("invite_to");
    expect(night).not.toHaveProperty("rotations");

    const sent = await call("double_date", { list: true }, a.ctx);
    expect(JSON.stringify(sent)).not.toContain(b.agentId);
    expect(sent.structuredContent.nights[0]).toMatchObject({ proposed_by: "you", waiting_on: "them" });
  });
});

describe("the net under every reply (lib/mcp/owner-ids.ts)", () => {
  it("another owner's id is replaced wherever it sits; the caller's own id, and characters' ids, stay", async () => {
    const a = await agent("Juni Marsh");
    const b = await agent("Pia Voss");
    const v = await visitor("Mara Quill");
    const reply = {
      mine: a.agentId,
      character: b.characterId,
      booked_by: b.agentId,
      note: `Asked by ${b.agentId}, and again by ${v.id}.`,
      by_owner: { [b.agentId]: 2, [v.id]: 1, [a.agentId]: 3 },
      list: [{ owner: v.id }, { owner: a.agentId }],
    };
    const { value, hidden } = await hideOtherOwners(t.db, reply, a.agentId);
    const text = JSON.stringify(value);
    expect(text).not.toContain(b.agentId);
    expect(text).not.toContain(v.id);
    expect(hidden).toBe(6);
    expect(value.mine).toBe(a.agentId);
    expect(value.character).toBe(b.characterId);
    expect(value.booked_by).toBe(OTHER_OWNER);
    expect(value.note).toBe(`Asked by ${OTHER_OWNER}, and again by ${OTHER_OWNER}.`);
    expect(Object.keys(value.by_owner).sort()).toEqual([OTHER_OWNER, `${OTHER_OWNER}-2`, a.agentId].sort());
    expect(value.list).toEqual([{ owner: OTHER_OWNER }, { owner: a.agentId }]);
  });

  it("a reply with no one else's id comes back untouched, and a caller with no identity sees no owner's id at all", async () => {
    const a = await agent("Juni Marsh");
    const plain = { character: a.characterId, note: "No ids here but a character's." };
    const same = await hideOtherOwners(t.db, plain, a.agentId);
    expect(same.hidden).toBe(0);
    expect(same.value).toBe(plain);
    expect((await hideOtherOwners(t.db, { who: a.agentId }, null)).value).toEqual({ who: OTHER_OWNER });
  });
});

describe("what leaves the server names characters, not owners", () => {
  const night: GroupNight = {
    id: "n1",
    kind: "double",
    venue: "double_date",
    created_by: "owner-a",
    status: "invited",
    invite_to: "owner-b",
    couple_a: { character_id: "c1", partner_id: "c2" },
    couple_b: { character_id: "c3", partner_id: "c4" },
    episode_a: null,
    episode_b: null,
    rotations: [{ a: "c1", b: "c3", booker: "owner-b" }],
    created_at: "2026-11-21T00:00:00.000Z",
  };

  it("a double date's view has neither booker's id, for either of them", () => {
    for (const who of ["owner-a", "owner-b"]) {
      const view = doubleView(night, who);
      expect(JSON.stringify(view)).not.toMatch(/owner-[ab]/);
      expect(view.proposed_by).toBe(who === "owner-a" ? "you" : "them");
      expect(view.waiting_on).toBe(who === "owner-b" ? "you" : "them");
    }
    expect(doubleView({ ...night, status: "booked" }, "owner-a")).not.toHaveProperty("waiting_on");
  });

  it("a proposal's view has its two characters and no owner", () => {
    const view = proposalView({ id: "p1", from_character: "c1", to_character: "c2", from_user: "owner-a", to_user: "owner-b", created_at: "2026-11-21T00:00:00.000Z" });
    expect(view).toEqual({ id: "p1", from_character: "c1", to_character: "c2", created_at: "2026-11-21T00:00:00.000Z" });
  });

  it("the proposal route is one of the routes that answers with that view", () => {
    // Its happy path is covered in tests/date-proposals.test.ts, which checks the reply carries no owner's id.
    expect(typeof proposeRoute).toBe("function");
  });
});

describe("only lib/http.ts makes the server's own request", () => {
  const root = join(__dirname, "..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
      return /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  }

  /**
   * The rest of the suite runs with LEGACY_BARE_UID=1, so a route or job that writes a bare id cookie by hand, or
   * builds a request to MCP_CALL_PATH itself, passes every other test and then acts as a stranger in production (its
   * request isn't one internalRequest made). This is the test that catches it.
   */
  it("no other file writes a bare id cookie or builds a request to MCP_CALL_PATH by hand", () => {
    const BY_HAND = [/\$\{USER_COOKIE\}=/, /bz_uid=\$\{/, /["'`]bz_uid=["'`]\s*\+/, /new Request\([^;]*MCP_CALL_PATH/];
    const offenders = [...sources(join(root, "app")), ...sources(join(root, "lib"))]
      .map((p) => relative(root, p))
      .filter((p) => p !== join("lib", "http.ts"))
      .filter((p) => BY_HAND.some((re) => re.test(readFileSync(join(root, p), "utf8"))));
    expect(offenders, "build it with internalRequest (lib/http.ts), or hand a request on with passOn").toEqual([]);
  });
});
