import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as recastPost } from "@/app/api/admin/recast/route";
import { checkSheets, setAgentCastModelForTests } from "@/lib/adult/agent-cast";
import { franchiseOut, setAdultSwitch } from "@/lib/adult/characters";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import type { ChatMessage, Model } from "@/lib/model";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Originals only (lib/franchises.ts, PRD styles-and-storylines phase 5), where it's wired: a person's character is warned,
// the show's own are refused (the house crowd over MCP, the recast, the After Dark agent cast), and After Dark takes no
// character that names a franchise, whoever's it is. Season-gen's refusal is tests/season-gen.test.ts; the house cast,
// the report and the prompts are tests/franchises.test.ts.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const PW = ["franchise", "pw", "tests"].join("-");
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", PW);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setAgentCastModelForTests(null);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
async function connect(client: string): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const count = async (name: string) => Number((await t.db.query<{ n: string }>(`select count(*) as n from characters where name = $1`, [name])).rows[0].n);

const COPY = { name: "Tifa Lockhart", bio: "Runs a bar in a city of eight reactors and punches above her weight." };

describe("MCP create_character", () => {
  it("warns an outside agent and saves it; refuses one of the house crowd's, saving nothing", async () => {
    const outside = await call("create_character", validCharacter(COPY), await connect("claude-code"));
    expect(outside.isError).toBeFalsy();
    const made = outside.structuredContent;
    expect(made.saved).toBe(true);
    expect(made.franchise_warning).toMatch(/^Its name says "Tifa Lockhart", which reads like Final Fantasy\./);
    expect(made.originality).toMatchObject({ franchise: made.franchise_warning, verdict: "consider changing" });
    expect(made.originality.tips[0]).toBe(made.franchise_warning);

    const crowd = await call("create_character", validCharacter({ ...COPY, name: "Tifa Lockhart Two" }), await connect("botchelor-loop-crowd-tifa"));
    expect(crowd.isError).toBe(true);
    expect(crowd.content[0].text).toMatch(/^Error: Botchelor keeps to original characters: the name says "Tifa Lockhart"/);
    expect(await count("Tifa Lockhart Two")).toBe(0);

    // An original from the crowd goes through as before, with no warning.
    const original = await call("create_character", validCharacter({ name: "Ines Varga" }), await connect("botchelor-loop-crowd-ines"));
    expect(original.isError).toBeFalsy();
    expect(original.structuredContent.franchise_warning).toBeUndefined();
  });

  it("says it on check_only too, before anything is saved", async () => {
    const r = await call("create_character", { ...validCharacter(COPY), check_only: true }, await connect("claude-code"));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ saved: false, franchise_warning: expect.stringMatching(/Final Fantasy/) });
    expect(await count("Tifa Lockhart")).toBe(0);
  });
});

describe("the recast (POST /api/admin/recast)", () => {
  it("refuses an edit or a portrait role that names a franchise, and changes nothing", async () => {
    const cookie = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ name: "Ines Varga" }), cookie)).json()).id as string;
    await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [id]);
    const post = (body: unknown) =>
      recastPost(new Request(`${BASE_URL}/api/admin/recast`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": PW }, body: JSON.stringify(body) }));
    const edit = await post({ action: "update", character_id: id, patch: { bio: "A mercenary in the mould of Cloud Strife, buster sword and all." } });
    expect(edit.status).toBe(422);
    expect(await edit.json()).toMatchObject({ error: "franchise", message: expect.stringMatching(/the bio says "Cloud Strife", which reads like Final Fantasy/) });
    expect((await t.db.query<{ bio: string }>(`select bio from characters where id = $1`, [id])).rows[0].bio).toBe(validCharacter().bio);
    const role = await post({ action: "portrait", character_id: id, role: "Geralt of Rivia", props: "two swords" });
    expect(role.status).toBe(422);
    expect((await role.json()).message).toMatch(/the role says "Geralt of Rivia", which reads like The Witcher/);
  });
});

describe("After Dark", () => {
  it("keeps a character that names a franchise out, whoever's it is, and lets an original in", async () => {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    const copy = (await (await api.createCharacter(validCharacter(COPY), cookie)).json()).id as string;
    const original = (await (await api.createCharacter(validCharacter({ name: "Ines Varga" }), cookie)).json()).id as string;
    expect(await franchiseOut(t.db, copy)).toMatch(/^After Dark keeps to original characters: the name says "Tifa Lockhart"/);
    expect(await franchiseOut(t.db, original)).toBeNull();
    expect(await setAdultSwitch(t.db, owner, copy, true)).toBe(false);
    expect(await setAdultSwitch(t.db, owner, original, true)).toBe(true);
    const switched = (await t.db.query<{ character_id: string }>(`select character_id from adult_switches where owner_id = $1`, [owner])).rows.map((r) => r.character_id);
    expect(switched).toEqual([original]);
    // Switching off is never refused.
    expect(await setAdultSwitch(t.db, owner, copy, false)).toBe(true);
  });

  it("fails our agent cast's sheet that names a franchise without asking the model", async () => {
    const admin = crypto.randomUUID();
    await t.db.query("insert into admins (user_id) values ($1)", [admin]);
    const id = crypto.randomUUID();
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, visibility)
       values ($1, $2, false, 'Captain Varga', 34, 'Sails a pirate ship like Luffy, straw hat and all.', '["bold","warm"]'::jsonb, 'Someone who keeps up', 'Cowardice', 'mcp', 'public')`,
      [id, admin],
    );
    const model = {
      calls: 0,
      async complete(_m: ChatMessage[]) {
        model.calls++;
        return JSON.stringify({ adult: true, humanoid: true, real_person: false, fits: true, reason: "A grown-up captain." });
      },
    };
    setAgentCastModelForTests(model as unknown as Model);
    expect(await checkSheets(t.db)).toEqual({ checked: 1, passed: 0, failed: 1 });
    expect(model.calls).toBe(0);
    const row = (await t.db.query<{ sheet_ok: boolean; sheet_reason: string }>(`select sheet_ok, sheet_reason from adult_cast_checks where character_id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ sheet_ok: false, sheet_reason: expect.stringMatching(/the bio says "Luffy", which reads like One Piece/) });
  });
});
