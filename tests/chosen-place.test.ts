import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { agreedPlan } from "@/lib/plans";
import { namedPlace } from "@/lib/places";
import { buildDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// David, 2026-10-23: everyone chooses where their date happens (a place named at booking, or one agreed by text),
// except a date between two house characters, which the show still deals.
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
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const venueOf = async (id: string) => (await t.db.query<Any>(`select setup->>'venue' as v from episodes where id = $1`, [id])).rows[0].v;

describe("a texted plan names compound places too", () => {
  it("'under the old footbridge' is a place, and a yes makes it the plan", () => {
    expect(namedPlace("Meet me under the old footbridge at dusk?")).toBe("the old footbridge");
    expect(namedPlace("Come see the boathouse")).toBe("the boathouse");
    const plan = agreedPlan(
      [
        { who: "lo", text: "Meet me under the old footbridge at dusk?" },
        { who: "hi", text: "Yes. I'll bring the lantern." },
      ],
      { lo: "Moss Underbridge", hi: "Henrietta Quill" },
    );
    expect(plan?.place).toBe("elsewhere@the old footbridge");
  });
});

describe("place at booking", () => {
  it("go_on_date takes a place: a venue we have, one of their homes, or their own words; not a car", async () => {
    const cookie = newUserCookie();
    const mine = (await (await api.createCharacter(validCharacter({ name: "Ira Fenn" }), cookie)).json()).id;
    const book = async (place: string) => {
      scriptOutcome({ ending: "friends" });
      scriptedModel([episodeJson()]);
      return api.createEpisode({ character_id: mine, partner_id: HOUSE_PARTNER_ID, place, ...{} }, cookie);
    };
    const own = await book("under the old footbridge");
    expect(own.status).toBe(200);
    expect(await venueOf((await own.json()).id)).toBe("elsewhere@under the old footbridge");
    const home = await book("my place");
    expect(await venueOf((await home.json()).id)).toBe("home@Ira's place");
    const bad = await book("the back seat of my car");
    expect(bad.status).toBe(422);
    expect((await bad.json()).field).toBe("place");
  });

  it("start_own_date takes a place over MCP", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx);
    const s: McpContext = { sessionId: ctx.issuedSessionId };
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> => (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, s))!.result;
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }))).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }))).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b, place: "the old footbridge" })).structuredContent.step;
    expect(await venueOf(step.episode_id)).toBe("elsewhere@the old footbridge");
  });

  it("two house characters never get a chosen place: the show deals theirs", async () => {
    const [x, y] = HOUSE_CHARACTERS;
    const sheet = (c: (typeof HOUSE_CHARACTERS)[number]) => ({ name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: true });
    const built = await buildDate(t.db, "ep-house-show", { id: x.id, sheet: sheet(x) }, { id: y.id, sheet: sheet(y) }, DEFAULT_DATE_REQUEST, undefined, undefined, { chosenPlace: "elsewhere@the moon" });
    expect(built.setup.venue).not.toBe("elsewhere@the moon");
  });
});
