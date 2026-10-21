import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteMe } from "@/app/api/me/route";
import { GET as getEmail } from "@/app/api/me/email/route";
import { GET as exportMe } from "@/app/api/me/export/route";
import { mediaBytes } from "@/lib/adult/media";
import { llmsLive } from "@/lib/agents-live";
import { registerAccount } from "@/lib/auth";
import { claimAdmin } from "@/lib/admins";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// The 2026-10-20 security review: an account is only ever used signed in (a bare or planted user id gets nothing
// account-wide, over the web or MCP), private characters show their name only everywhere, and after dark's files are
// their maker's.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const rpc = async (method: string, params: Any = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Any = {}, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
const req = (path: string, cookie: string, init: RequestInit = {}) =>
  new Request(`${BASE_URL}${path}`, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });

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
});
afterEach(() => vi.unstubAllEnvs());

/** A person who signed up: their user id, the bare legacy cookie for it, and their real signed-in session. */
async function person() {
  const bare = newUserCookie();
  const id = userIdOf(bare);
  await api.createCharacter(validCharacter({ name: "Ada Lumen" }), bare);
  await registerAccount(t.db, id, `ada${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
  return { id, bare, signedIn: signedInCookie(id) };
}

describe("an account is only used signed in", () => {
  it("its bare user id can't export, delete or read the account's email; its sign-in can", async () => {
    const { id, bare, signedIn } = await person();
    expect((await exportMe(req("/api/me/export", bare))).status).toBe(401);
    expect((await getEmail(req("/api/me/email", bare))).status).toBe(401);
    expect((await deleteMe(req("/api/me", bare, { method: "DELETE", body: JSON.stringify({ confirm: true }) }))).status).toBe(401);
    expect((await t.db.query(`select 1 from accounts where user_id = $1`, [id])).rows).toHaveLength(1);

    expect((await exportMe(req("/api/me/export", signedIn))).status).toBe(200);
    expect((await getEmail(req("/api/me/email", signedIn))).status).toBe(200);
  });

  it("an anonymous player with no account still exports and deletes with their cookie", async () => {
    const anon = newUserCookie();
    await api.createCharacter(validCharacter(), anon);
    expect((await exportMe(req("/api/me/export", anon))).status).toBe(200);
    expect((await deleteMe(req("/api/me", anon, { method: "DELETE", body: JSON.stringify({ confirm: true }) }))).status).toBe(200);
  });

  it("an account's user id can't be played as an agent_id over MCP", async () => {
    const { id } = await person();
    const out = await call("my_status", { agent_id: id });
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.content)).toMatch(/account/);
    // An agent's own id still works.
    const mine = await call("my_status", {});
    expect(mine.isError).toBeFalsy();
  });
});

describe("private characters show their name only, over MCP and in llms.txt", () => {
  async function privateCharacter() {
    const owner = newUserCookie();
    const res = await api.createCharacter(validCharacter({ name: "Ada Lumen", open_to_dates: true }), owner);
    const id = ((await res.json()) as Any).id as string;
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [id]);
    return id;
  }

  it("the character resource is the name only", async () => {
    const id = await privateCharacter();
    const read = await rpc("resources/read", { uri: `botchelor://character/${id}` });
    const shown = JSON.parse(read.result.contents[0].text);
    expect(shown).toMatchObject({ id, name: "Ada Lumen", private: true });
    expect(shown.bio).toBeUndefined();
    expect(shown.traits).toBeUndefined();
  });

  it("a date preview with it is the name only, with no chemistry from its traits", async () => {
    const id = await privateCharacter();
    const mine = (await call("create_character", validCharacter({ name: "Bo Quill" }))).structuredContent;
    const agent = mine.agent_id ?? mine.identity?.agent_id;
    const preview = (await call("go_on_date", { agent_id: agent, character_id: mine.character.id, partner_id: id, preview: true })).structuredContent;
    expect(preview.with).toMatchObject({ id, name: "Ada Lumen", private: true });
    expect(preview.with.bio).toBeUndefined();
    expect(preview.chemistry_on_record).toBeUndefined();
  });

  it("llms.txt never lists it as open to dates", async () => {
    const id = await privateCharacter();
    const live = await llmsLive(t.db);
    expect(live?.open.map((c) => c.id)).not.toContain(id);
  });
});

describe("after dark's files are their maker's", () => {
  it("another viewer gets nothing by id; the maker, an admin and a signed link do", async () => {
    const maker = crypto.randomUUID();
    const other = crypto.randomUUID();
    const admin = crypto.randomUUID();
    await claimAdmin(t.db, admin);
    await t.db.query(
      `insert into adult_images (id, owner_id, kind, prompt, mime, data, status) values ('pic-x', $1, 'baseline', 'p', 'image/png', $2, 'ready')`,
      [maker, Buffer.from("png")],
    );
    expect(await mediaBytes(t.db, "pic-x", other)).toBeNull();
    expect(await mediaBytes(t.db, "pic-x", maker)).not.toBeNull();
    expect(await mediaBytes(t.db, "pic-x", admin)).not.toBeNull();
    expect(await mediaBytes(t.db, "pic-x", null)).not.toBeNull();
  });
});
