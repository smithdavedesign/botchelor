import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createCharacter } from "@/app/api/characters/route";
import { drawShowPortrait, SHOW_PORTRAIT_LIMITS } from "@/lib/agent-portraits";
import { CREATE_ALL_LIMITS, CREATE_CHECK_LIMITS, CREATE_LIMITS, createRefusal } from "@/lib/create-limits";
import { internalRequest } from "@/lib/http";
import { visitorKey } from "@/lib/limits";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// 2026-11-22 audit: nothing capped making characters, and each save can spend (a portrait, embeddings, a language
// reading). Caps per address (per agent over MCP) and across the site; the show's own never count.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const ADDRESS = "203.0.113.7";
const create = (body: Record<string, unknown>, opts: { address?: string; cookie?: string } = {}) =>
  createCharacter(
    new Request(`${BASE_URL}/api/characters`, {
      method: "POST",
      headers: { "content-type": "application/json", "do-connecting-ip": opts.address ?? ADDRESS, cookie: opts.cookie ?? newUserCookie() },
      body: JSON.stringify(body),
    }),
  );

/** `n` hits already in a bucket for `key`, a minute ago. */
async function used(bucket: string, key: string, n: number) {
  const at = new Date(Date.now() - 60_000).toISOString();
  for (let i = 0; i < n; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ($1, $2, $3)`, [bucket, key, at]);
}
const hits = async (bucket: string) => (await t.db.query<{ key: string }>(`select key from rate_hits where bucket = $1`, [bucket])).rows.map((r) => r.key);

describe("making characters from the web", () => {
  it("stops one address's saves at its cap with a friendly answer, and others still save", async () => {
    const me = visitorKey(new Headers({ "do-connecting-ip": ADDRESS }))!;
    expect((await create(validCharacter({ name: "Ada Lumen" }))).status).toBe(201);
    expect(await hits("character_create")).toEqual([me]);
    await used("character_create", me, CREATE_LIMITS.perHour - 1);
    const held = await create(validCharacter({ name: "Bo Quill" }), { address: ADDRESS });
    expect(held.status).toBe(429);
    const body = await held.json();
    expect(body.error).toBe("too_many_characters");
    expect(body.message).toMatch(/try again tomorrow/);
    // A made-up forwarding header doesn't reset it; another address isn't held.
    const forged = createCharacter(
      new Request(`${BASE_URL}/api/characters`, {
        method: "POST",
        headers: { "content-type": "application/json", "do-connecting-ip": ADDRESS, "x-forwarded-for": "198.51.100.1", cookie: newUserCookie() },
        body: JSON.stringify(validCharacter({ name: "Cy Brandt" })),
      }),
    );
    expect((await forged).status).toBe(429);
    expect((await create(validCharacter({ name: "Cy Brandt" }), { address: "203.0.113.8" })).status).toBe(201);
  });

  it("counts a check as a check, not a save, and holds checks at their own cap", async () => {
    const me = visitorKey(new Headers({ "do-connecting-ip": ADDRESS }))!;
    await used("character_create", me, CREATE_LIMITS.perHour);
    const check = await create({ name: "Ada Lumen", check_only: true });
    expect(check.status).toBe(200);
    expect((await hits("character_create")).length).toBe(CREATE_LIMITS.perHour);
    expect(await hits("character_check")).toEqual([me]);
    await used("character_check", me, CREATE_CHECK_LIMITS.perHour);
    const held = await create({ name: "Ada Lumen", check_only: true });
    expect(held.status).toBe(429);
    expect((await held.json()).error).toBe("too_many_checks");
  });

  it("holds everyone once the site's cap is reached, but never the show's own", async () => {
    await used("character_create_all", "all", CREATE_ALL_LIMITS.perHour);
    const held = await create(validCharacter({ name: "Ada Lumen" }));
    expect(held.status).toBe(429);
    const body = await held.json();
    expect(body.error).toBe("creates_paused");
    expect(body.message).toMatch(/breather/);
    // A signed-in admin isn't counted or held.
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    const adminId = userIdOf(newUserCookie());
    await t.db.query(`insert into admins (user_id) values ($1)`, [adminId]);
    const before = (await hits("character_create_all")).length;
    expect((await create(validCharacter({ name: "Bo Quill" }), { cookie: signedInCookie(adminId) })).status).toBe(201);
    expect((await hits("character_create_all")).length).toBe(before);
  });
});

describe("making characters as an agent", () => {
  const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
  const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
  async function connect(): Promise<McpContext> {
    const ctx: McpContext = {};
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-create-limits-test" } }, ctx);
    return { sessionId: ctx.issuedSessionId };
  }

  it("keys an agent's saves by the agent, and tells it plainly when it's made enough for today", async () => {
    const ctx = await connect();
    const first = await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx);
    expect(first.isError).toBeFalsy();
    const agentId = first.structuredContent.agent_id as string;
    expect(await hits("character_create")).toEqual([`agent:${agentId}`]);
    await used("character_create", `agent:${agentId}`, CREATE_LIMITS.perHour - 1);
    const held = await call("create_character", validCharacter({ name: "Bo Quill" }), ctx);
    expect(held.isError).toBe(true);
    expect(JSON.stringify(held.content)).toMatch(/a lot of new characters/);
  });

  it("never counts an agent linked to an admin's account (the show's own cast)", async () => {
    const agentId = userIdOf(newUserCookie());
    const req = () => internalRequest(agentId, { body: {} });
    expect(await createRefusal(t.db, req(), { userId: agentId, authenticated: false }, false)).toBeNull();
    expect(await hits("character_create")).toEqual([`agent:${agentId}`]);
    await t.reset();
    const adminId = userIdOf(newUserCookie());
    await t.db.query(`insert into admins (user_id) values ($1)`, [adminId]);
    await t.db.query(`insert into agent_links (agent_id, user_id) values ($1, $2)`, [agentId, adminId]);
    await used("character_create_all", "all", CREATE_ALL_LIMITS.perHour);
    expect(await createRefusal(t.db, req(), { userId: agentId, authenticated: false }, false)).toBeNull();
    expect(await hits("character_create")).toEqual([]);
  });
});

describe("portraits across the site", () => {
  it("wait once the site's cap is drawn, to be tried again later (nothing kept against the character)", async () => {
    const made = await (await create(validCharacter({ name: "Ada Lumen" }))).json();
    await used("show_portrait", "all", SHOW_PORTRAIT_LIMITS.perHour);
    const r = await drawShowPortrait(t.db, made.id);
    expect(r).toMatchObject({ ok: false, again: true, reason: expect.stringMatching(/tried again later/) });
    expect((await t.db.query(`select 1 from show_portrait_tries where character_id = $1`, [made.id])).rows).toHaveLength(0);
  });
});
