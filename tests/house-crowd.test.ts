import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as crowdReport } from "@/app/api/admin/crowd-report/route";
import { capHouseBots, HOUSE_BOT_NO_VOTE_TOOLS, houseBotRefusal } from "@/lib/house-bots";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { popularity } from "@/lib/reviews";
import { deckFor } from "@/lib/swipes";
import { crowdActivity, setWelcomeFromForTests, twoProportion, welcomeArm, welcomeNewCharacter, welcomeReport } from "@/lib/welcome";
import { api, BASE_URL, HOUSE_PARTNER_ID, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// The house crowd's guardrails and the welcome experiment (docs/house-crowd.md, David 2026-10-23).
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setWelcomeFromForTests("2026-01-01T00:00:00Z");
});
afterEach(() => {
  setWelcomeFromForTests(null);
  vi.unstubAllEnvs();
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

const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
let n = 0;
const sheet = (extra: Record<string, unknown> = {}) => validCharacter({ name: `Crowd Person ${++n}`, extras: PROFILE, open_to_dates: true, ...extra });

/** One of the house crowd: a character its agent made over MCP, the agent connected as a botchelor-loop-crowd-… client. */
async function bot(name: string) {
  const ctx = await connect(`botchelor-loop-crowd-${name.toLowerCase().split(" ")[0]}`);
  const r = await call("create_character", { ...validCharacter({ name, extras: PROFILE }), open_to_dates: true }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, agentId: r.structuredContent.agent_id as string, id: r.structuredContent.character.id as string };
}
/** An outside agent's character (an ordinary client name). */
async function agent(name: string) {
  const ctx = await connect("claude-code");
  const r = await call("create_character", { ...validCharacter({ name, extras: PROFILE }), open_to_dates: true }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return { ctx, agentId: r.structuredContent.agent_id as string, id: r.structuredContent.character.id as string };
}
/** A person's character, made on the site (the welcome runs inline in tests). */
async function person(extra: Record<string, unknown> = {}) {
  const cookie = newUserCookie();
  const res = await api.createCharacter(sheet(extra), cookie);
  expect(res.status).toBe(201);
  return { cookie, owner: userIdOf(cookie), id: (await res.json()).id as string };
}
const assigned = async (id: string) =>
  (await t.db.query<{ props: Any }>(`select props from analytics_events where event = 'welcome_assigned' and props->>'character_id' = $1`, [id])).rows.map((r) => r.props);
const likersOf = async (id: string) => (await t.db.query<{ swiper: string }>(`select swiper from swipes where target = $1 and liked order by swiper`, [id])).rows.map((r) => r.swiper);

describe("capHouseBots", () => {
  const cards = (ids: string) => ids.split("").map((id) => ({ id }));
  const bots = new Set(["a", "b", "c", "d", "e", "f"]);
  it("holds the crowd to a third of every prefix while others are left, bots in their own rank order", () => {
    const dealt = capHouseBots(cards("abcXYdeZWf"), bots, 9).map((c) => c.id).join("");
    expect(dealt).toBe("aXYZWbcde");
    const lastOther = Math.max(...[...dealt].map((c, i) => (bots.has(c) ? -1 : i)));
    for (let k = 1; k <= lastOther + 1; k++) expect([...dealt.slice(0, k)].filter((c) => bots.has(c)).length).toBeLessThanOrEqual(Math.max(1, Math.floor(k / 3)));
  });
  it("lets the waiting bots fill a page there aren't enough others for", () => {
    expect(capHouseBots(cards("abcX"), bots, 4).map((c) => c.id)).toEqual(["a", "X", "b", "c"]);
    expect(capHouseBots(cards("abc"), bots, 2).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("house-run bots never vote", () => {
  it("refuses a bot's predict, review, rating, follow and guess, and nobody else's", async () => {
    const b = await bot("Saoirse Kinsella");
    const a = await agent("Ada Lumen");
    expect(HOUSE_BOT_NO_VOTE_TOOLS.has("review_character")).toBe(true);
    const rated = await call("rate_character", { character_id: HOUSE_PARTNER_ID, rating: "likable" }, b.ctx);
    expect(rated.isError).toBe(true);
    expect(rated.content[0].text).toMatch(/House-run bots don't vote/);
    const reviewed = await call("review_character", { character_id: HOUSE_PARTNER_ID, stars: 5 }, b.ctx);
    expect(reviewed.content[0].text).toMatch(/House-run bots don't vote/);
    expect((await t.db.query(`select 1 from character_ratings where rater_id = $1`, [b.agentId])).rows).toHaveLength(0);
    // An outside agent rates as before.
    const theirs = await call("rate_character", { character_id: HOUSE_PARTNER_ID, rating: "likable" }, a.ctx);
    expect(theirs.isError ?? false).toBe(false);
    expect(await houseBotRefusal(t.db, a.agentId, "predict")).toBeNull();
    expect(await houseBotRefusal(t.db, b.agentId, "swipe")).toBeNull();
  });

  it("HOUSE_CROWD_PAUSED stops every bot call but my_status, and only the bots'", async () => {
    const b = await bot("Ezra Blackwood");
    const a = await agent("Bo Quill");
    vi.stubEnv("HOUSE_CROWD_PAUSED", "1");
    const deck = await call("swipe_deck", { character_id: b.id }, b.ctx);
    expect(deck.isError).toBe(true);
    expect(deck.content[0].text).toMatch(/house crowd is paused/);
    expect((await call("my_status", {}, b.ctx)).isError ?? false).toBe(false);
    expect((await call("swipe_deck", { character_id: a.id }, a.ctx)).isError ?? false).toBe(false);
  });

  it("leaves bots' reviews and ratings out of popularity (the monthly top two)", async () => {
    const b = await bot("Lark Ishikawa");
    const fan = newUserCookie();
    await t.db.query(`insert into character_reviews (reviewer_id, character_id, stars, via) values ($1, $2, 1, 'mcp'), ($3, $2, 5, 'web')`, [b.agentId, HOUSE_PARTNER_ID, userIdOf(fan)]);
    await t.db.query(`insert into character_ratings (rater_id, character_id, category) values ($1, $2, 'likable')`, [b.agentId, HOUSE_PARTNER_ID]);
    const [p] = await popularity(t.db, [HOUSE_PARTNER_ID], new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    expect(p).toMatchObject({ reviews: 1, likes: 0 });
    expect(p.score).toBeCloseTo((5 + 3 * 5) / 6, 5);
  });
});

describe("the deck keeps the crowd to a third", () => {
  it("deals people and agents first, bots filling in", async () => {
    const me = await person();
    for (const name of ["Mabel Ferraro", "Soren Valdis", "Kiri Moon", "Delphine Arbuckle", "Mateo Iturbe", "Corbin Ashdown"]) await bot(name);
    for (const name of ["Ada Lumen", "Bo Quill"]) await agent(name);
    await person();
    const deck = await deckFor(t.db, me.owner, me.id, 30);
    if (!deck.ok) throw new Error(deck.message);
    const botIds = new Set((await t.db.query<{ id: string }>(`select id from characters where name in ('Mabel Ferraro','Soren Valdis','Kiri Moon','Delphine Arbuckle','Mateo Iturbe','Corbin Ashdown')`)).rows.map((r) => r.id));
    const flags = deck.cards.map((c) => botIds.has(c.id));
    for (let k = 1; k <= flags.length; k++) {
      const others = flags.length - flags.filter(Boolean).length;
      // Within the stretch there are others left to deal, a prefix holds at most a third bots.
      if (flags.slice(0, k).filter((f) => !f).length < others) expect(flags.slice(0, k).filter(Boolean).length).toBeLessThanOrEqual(Math.max(1, Math.floor(k / 3)));
    }
    expect(flags.filter(Boolean)).toHaveLength(6); // every bot still dealt
  });
});

describe("the welcome experiment", () => {
  it("enrols a person's swipe-ready character once, by its id; the treatment half gets likes from the crowd", async () => {
    const bots = [await bot("Mabel Ferraro"), await bot("Pippa Quarrie"), await bot("Jasper Nkemelu")];
    const seen = new Set<string>();
    for (let i = 0; i < 16 && seen.size < 2; i++) {
      const p = await person();
      const [row, ...more] = await assigned(p.id);
      expect(more).toHaveLength(0);
      expect(row).toMatchObject({ experiment: "welcome-v1", character_id: p.id, arm: welcomeArm(p.id) });
      seen.add(row.arm);
      const likers = await likersOf(p.id);
      if (row.arm === "treatment") {
        expect(row.likes).toBe(2);
        expect(likers).toHaveLength(2);
        expect(likers.every((l) => bots.some((b) => b.id === l))).toBe(true);
      } else {
        expect(row.likes).toBe(0);
        expect(likers).toHaveLength(0);
      }
      // Asking again changes nothing: enrolled once.
      expect(await welcomeNewCharacter(t.db, p.id)).toBeNull();
    }
    expect(seen).toEqual(new Set(["treatment", "control"]));
  });

  it("leaves out agents' characters, ones made before the start, private ones and unfinished profiles, until the profile is done", async () => {
    await bot("Mabel Ferraro");
    const a = await agent("Ada Lumen");
    expect(await assigned(a.id)).toHaveLength(0);
    const unfinished = await person({ extras: { hobbies: ["Hiking"] } });
    expect(await assigned(unfinished.id)).toHaveLength(0);
    // Finished on an edit: swipe-ready now, so enrolled.
    expect((await api.editCharacter(unfinished.id, { extras: PROFILE }, unfinished.cookie)).status).toBe(200);
    expect(await assigned(unfinished.id)).toHaveLength(1);
    setWelcomeFromForTests("2099-01-01T00:00:00Z");
    const early = await person();
    expect(await assigned(early.id)).toHaveLength(0);
  });

  it("does nothing while HOUSE_CROWD_PAUSED is on", async () => {
    await bot("Mabel Ferraro");
    vi.stubEnv("HOUSE_CROWD_PAUSED", "1");
    const p = await person();
    expect(await assigned(p.id)).toHaveLength(0);
    expect(await likersOf(p.id)).toHaveLength(0);
  });

  it("reports each arm, our own traffic left out, with the lift", async () => {
    const b = await bot("Mabel Ferraro");
    await bot("Pippa Quarrie");
    const people: Awaited<ReturnType<typeof person>>[] = [];
    for (let i = 0; i < 10; i++) people.push(await person());
    const treat = people.filter((p) => welcomeArm(p.id) === "treatment");
    // One treatment character matched a bot.
    if (treat[0]) {
      const [lo, hi] = [treat[0].id, b.id].sort();
      await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2)`, [lo, hi]);
    }
    const report = await welcomeReport(t.db);
    const [tr, ct] = report.arms;
    expect(tr.arm).toBe("treatment");
    expect(tr.enrolled + ct.enrolled).toBe(10);
    expect(tr.enrolled).toBe(treat.length);
    expect(tr.matched_7d).toBe(treat.length ? 1 : 0);
    expect(tr.d1_eligible + ct.d1_eligible).toBe(0); // joined today: too soon to tell
    // Two days on, the owners count as eligible; none came back.
    const later = await welcomeReport(t.db, new Date(Date.now() + 3 * 86_400_000));
    expect(later.arms[0].d1_eligible + later.arms[1].d1_eligible).toBe(10);
    expect(later.arms[0].d1_returned + later.arms[1].d1_returned).toBe(0);
  });

  it("twoProportion is a plain two-sided z-test", () => {
    const r = twoProportion({ hits: 10, n: 100 }, { hits: 20, n: 100 });
    expect(r.diff).toBeCloseTo(0.1, 10);
    expect(r.z).toBeCloseTo(1.98, 2);
    expect(r.p).toBeCloseTo(0.0477, 3);
    expect(twoProportion({ hits: 0, n: 0 }, { hits: 1, n: 2 })).toEqual({ diff: null, z: null, p: null });
  });
});

describe("the crowd report", () => {
  it("counts what the crowd did and drew, owner-only", async () => {
    const b = await bot("Mabel Ferraro");
    const p = await person();
    await t.db.query(`insert into swipes (swiper, target, liked) values ($1, $2, true) on conflict do nothing`, [p.id, b.id]);
    const [lo, hi] = [p.id, b.id].sort();
    await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2)`, [lo, hi]);
    const activity = await crowdActivity(t.db, new Date(Date.now() - 86_400_000));
    expect(activity).toMatchObject({ bots: 1, likes_for_bots: 1, matches_with_people: 1, matches_with_agents: 0 });

    const url = `${BASE_URL}/api/admin/crowd-report?days=3`;
    expect((await crowdReport(new Request(url))).status).toBe(403);
    vi.stubEnv("FRONTIER_PASSWORD", ["crowd", "report", "pw"].join("-"));
    const res = await crowdReport(new Request(url, { headers: { "x-frontier-key": ["crowd", "report", "pw"].join("-") } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(3);
    expect(body.welcome.experiment).toBe("welcome-v1");
    expect(body.activity.matches_with_people).toBe(1);
  });
});
