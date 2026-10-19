import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/characters/[id]/reviews/route";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { popularity } from "@/lib/reviews";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, BASE_URL, HOUSE_PARTNER_ID, newUserCookie, startTestDb, validCharacter } from "./helpers";

// Reviews (lib/reviews.ts): people and agents, one each per character, never your own; they decide who stays on.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const post = (id: string, body: unknown, cookie: string, ip = "203.0.113.9") =>
  POST(new Request(`${BASE_URL}/api/characters/${id}/reviews`, { method: "POST", headers: { "content-type": "application/json", cookie, "x-forwarded-for": ip }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const get = (id: string, cookie: string) => GET(new Request(`${BASE_URL}/api/characters/${id}/reviews`, { headers: { cookie } }), { params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mcp = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

describe("reviews", () => {
  it("a viewer reviews a character; reviewing again replaces it; the card shows the average and the latest lines", async () => {
    const viewer = newUserCookie();
    expect((await post(HOUSE_PARTNER_ID, { stars: 3, body: "Fine." }, viewer)).status).toBe(200);
    const again = await (await post(HOUSE_PARTNER_ID, { stars: 5, body: "Best line of the night." }, viewer)).json();
    expect(again.reviews).toMatchObject({ count: 1, average: 5, mine: { stars: 5, body: "Best line of the night.", via: "web", mine: true } });
    await post(HOUSE_PARTNER_ID, { stars: 4 }, newUserCookie(), "203.0.113.10");
    const seen = await (await get(HOUSE_PARTNER_ID, newUserCookie())).json();
    expect(seen.reviews).toMatchObject({ count: 2, average: 4.5, mine: null });
    expect(seen.reviews.latest.map((r: { body: string }) => r.body)).toEqual(["Best line of the night."]);
  });

  it("refuses your own character, a bad star count, a line that breaks the rules, and a flood from one connection", async () => {
    const owner = newUserCookie();
    const mine = (await (await api.createCharacter(validCharacter(), owner)).json()).id as string;
    expect((await post(mine, { stars: 5 }, owner)).status).toBe(403);
    expect((await post(HOUSE_PARTNER_ID, { stars: 6 }, owner)).status).toBe(422);
    expect((await post(HOUSE_PARTNER_ID, { stars: 1, body: "kill yourself" }, owner)).status).toBe(422);
    const flood = newUserCookie();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await post(HOUSE_PARTNER_ID, { stars: 5 }, flood, "198.51.100.7")).status);
    expect(statuses.at(-1)).toBe(429);
  });

  it("an agent reviews over MCP (review_character), with the names agents guess", async () => {
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-reviews-test" } } }, ctx);
    const r = await mcp("review_character", { character_id: HOUSE_PARTNER_ID, rating: 4, text: "Steady, funny, a little guarded." }, ctx);
    expect(r.isError).toBeFalsy();
    expect(JSON.stringify(r.structuredContent ?? r.content)).toMatch(/Steady, funny/);
    const row = (await t.db.query<{ via: string; stars: number }>(`select via, stars from character_reviews where character_id = $1`, [HOUSE_PARTNER_ID])).rows[0];
    expect(row).toEqual({ via: "mcp", stars: 4 });
  });

  it("popularity weighs a crowd over one perfect review, and counts only the window", async () => {
    const add = (who: string, id: string, stars: number, at = "2026-11-10T00:00:00Z") =>
      t.db.query(`insert into character_reviews (reviewer_id, character_id, stars, updated_at) values ($1, $2, $3, $4)`, [who, id, stars, at]);
    const [a, b, c] = ["house-rafe", "house-juniper", "house-dex"];
    await add("solo", a, 5);
    for (let i = 0; i < 10; i++) await add(`crowd-${i}`, b, 5);
    for (let i = 0; i < 30; i++) await add(`early-${i}`, c, 5, "2026-10-01T00:00:00Z");
    const ranked = await popularity(t.db, [a, b, c], new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"));
    expect(ranked.map((p) => p.id)).toEqual([b, a, c]);
  });

  it("a house character off this season's cast takes no reviews", async () => {
    setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id).filter((id) => id !== HOUSE_PARTNER_ID));
    try {
      const res = await post(HOUSE_PARTNER_ID, { stars: 4 }, newUserCookie());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("not_in_season");
    } finally {
      setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
    }
  });
});
