/**
 * Scaling for the catalog cast (David, 2026-11-19: up to 90 new characters a day): the swipe deck's pool and filters,
 * search indexing only once a character has aired, the house crowd's own logs, and the home page's sky counts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getSwipes } from "@/app/api/swipes/route";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { deckFilterQuery, deckFiltersSaid, hasDeckFilters, NO_DECK_FILTERS, parseDeckFilters } from "@/lib/deck-filters";
import { constellation, skyCounts } from "@/lib/graph";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { recentPublicUrls } from "@/lib/indexnow";
import { HOUSE_BOT_LOG_DAYS, pruneHouseBotLogs } from "@/lib/retention";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { characterIndexable, contentSitemap } from "@/lib/seo";
import { DECK_POOL, deckFor, deckPoolIds, deckSeed } from "@/lib/swipes";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
async function connect(client: string): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.restoreAllMocks();
});

/** A person's character (made on the site), in the deck. */
async function person(name: string) {
  const cookie = newUserCookie();
  const character = await (await api.createCharacter(validCharacter({ name, extras: PROFILE, open_to_dates: true }), cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: character.id as string };
}

/** An agent's character (made over MCP, as `client`), in the deck. */
async function agentMade(name: string, client = "claude-code") {
  const ctx = await connect(client);
  const r = (await rpc("tools/call", { name: "create_character", arguments: { ...validCharacter({ name, extras: PROFILE }), open_to_dates: true } }, ctx))!.result;
  if (r.isError) throw new Error(r.content[0].text);
  return { userId: r.structuredContent.agent_id as string, id: r.structuredContent.character.id as string };
}

/** `n` agent-made characters straight into the table, the newest made `newestSecondsAgo` ago, one second apart. */
async function bulkAgents(n: number, newestSecondsAgo = 1) {
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, created_via, open_to_dates, visibility, extras, created_at)
     select 'bulk-' || g, 'bulk-owner-' || g, 'Bulk Agent ' || g, 30, 'Fixes clocks for a living and talks to them too.',
            '["warm","odd","bold"]'::jsonb, 'Someone patient.', 'Rudeness to waiters.', 'mcp', true, 'public', $1::jsonb,
            now() - ((g + $2) || ' seconds')::interval
       from generate_series(1, $3::int) g`,
    [JSON.stringify(PROFILE), newestSecondsAgo - 1, n],
  );
}

describe("deck filters in the address (lib/deck-filters.ts)", () => {
  it("reads known values, drops unknown ones, and writes them back in a fixed order", () => {
    const q = new URLSearchParams("made_by=human&style=anime&kind=vampire&type=sweet&extra=1");
    const f = parseDeckFilters((k) => q.get(k));
    expect(f).toEqual({ made_by: "human", style: "anime", kind: "vampire", type: "sweet" });
    expect(deckFilterQuery(f)).toBe("&made_by=human&style=anime&kind=vampire&type=sweet");
    expect(deckFiltersSaid(f, () => "Sweet")).toBe("made by people, anime, vampire, sweet");
    const junk = parseDeckFilters((k) => ({ made_by: "robots", style: "crayon", kind: "", type: "nope" })[k]);
    expect(junk).toEqual(NO_DECK_FILTERS);
    expect(hasDeckFilters(junk)).toBe(false);
    expect(deckFilterQuery(junk)).toBe("");
  });
});

describe("the deck's pool and filters (lib/swipes.ts deckPool)", () => {
  it("keeps the season's cast and people's older characters in the pool when hundreds of newer agent-made ones arrive", async () => {
    const me = await person("Wren Kestrel");
    const old = await person("Pim Alder");
    await t.db.query(`update characters set created_at = now() - interval '30 days' where id = $1`, [old.id]);
    await bulkAgents(DECK_POOL + 20);
    const pool = await deckPoolIds(t.db, me.userId, me.id);
    expect(pool.length).toBeLessThanOrEqual(DECK_POOL);
    // The newest 300 alone would have been all bulk: the person's character and the cast are in anyway.
    expect(pool).toContain(old.id);
    expect(pool).toContain(HOUSE_PARTNER_ID);
    expect(pool).toContain("bulk-1");
    // The same slice all day for one character.
    expect(await deckPoolIds(t.db, me.userId, me.id)).toEqual(pool);
    expect(deckSeed("abc", new Date("2026-11-19T23:00:00Z"))).toBe("abc:2026-11-19");
  });

  it("a filtered deck shows only what passes: who made them, the style, the kind and the type", async () => {
    const me = await person("Wren Kestrel");
    const pim = await person("Pim Alder");
    const ada = await agentMade("Ada Quill");
    const deal = async (filters: Partial<typeof NO_DECK_FILTERS>) => {
      const d = await deckFor(t.db, me.userId, me.id, 30, { filters: { ...NO_DECK_FILTERS, ...filters } });
      if (!d.ok) throw new Error(d.message);
      return d.cards.map((c) => c.id);
    };
    // Unfiltered: everyone, the cast included.
    expect(await deal({})).toEqual(expect.arrayContaining([pim.id, ada.id, HOUSE_PARTNER_ID]));
    // Who made them: the cast is neither, so it isn't slotted in.
    expect(await deal({ made_by: "human" })).toEqual([pim.id]);
    expect(await deal({ made_by: "agent" })).toEqual([ada.id]);
    // What they are: a character with no kind counts as human.
    await t.db.query(`update characters set extras = jsonb_set(extras, '{kind}', '"vampire"') where id = $1`, [ada.id]);
    expect(await deal({ kind: "vampire" })).toEqual([ada.id]);
    expect(await deal({ kind: "human" })).toEqual(expect.arrayContaining([pim.id]));
    expect(await deal({ kind: "human" })).not.toContain(ada.id);
    // How they're drawn.
    await t.db.query(`update characters set extras = jsonb_set(extras, '{looks}', '{"style":"anime"}') where id = $1`, [pim.id]);
    expect(await deal({ style: "anime" })).toEqual([pim.id]);
    // A type tag.
    await t.db.query(`delete from character_tags where character_id = $1`, [ada.id]);
    await t.db.query(`insert into character_tags (character_id, tag, source) values ($1, 'grump', 'owner')`, [ada.id]);
    expect(await deal({ type: "grump" })).toEqual([ada.id]);
    // The API carries the filters too.
    const res = await getSwipes(new Request(`${BASE_URL}/api/swipes?character_id=${encodeURIComponent(me.id)}&made_by=agent`, { headers: { cookie: me.cookie } }));
    expect((await res.json()).cards.map((c: { id: string }) => c.id)).toEqual([ada.id]);
  });
});

describe("search engines see a character once it has aired (lib/seo.ts indexableCharacterSql)", () => {
  async function airedWith(owner: string, character: string) {
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
    expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
    await t.db.query(`update episodes set visibility = 'public', revealed_at = now() - interval '2 hours' where id = $1`, [ep.id]);
    return ep.id as string;
  }

  it("a new profile is noindex and out of the sitemap and IndexNow; its first public date puts it in; private never", async () => {
    const fresh = await person("Pell Ardent");
    const base = "https://botchelor.com";
    const url = `${base}/characters/${fresh.id}`;
    const since = new Date(Date.now() - 86_400_000);
    expect(await characterIndexable(t.db, fresh.id)).toBe(false);
    expect(await characterIndexable(t.db, HOUSE_PARTNER_ID)).toBe(true);
    expect((await contentSitemap(t.db, base)).map((e) => e.url)).not.toContain(url);
    expect(await recentPublicUrls(t.db, since, base)).not.toContain(url);

    await airedWith(fresh.cookie, fresh.id);
    expect(await characterIndexable(t.db, fresh.id)).toBe(true);
    expect((await contentSitemap(t.db, base)).map((e) => e.url)).toContain(url);
    expect(await recentPublicUrls(t.db, since, base)).toContain(url);

    await t.db.query(`update characters set visibility = 'private' where id = $1`, [fresh.id]);
    expect(await characterIndexable(t.db, fresh.id)).toBe(false);
    expect(await recentPublicUrls(t.db, since, base)).not.toContain(url);
  });
});

describe("the house crowd's own logs (lib/retention.ts pruneHouseBotLogs)", () => {
  it(`keeps a house bot's impressions and calls ${HOUSE_BOT_LOG_DAYS} days, everyone else's untouched`, async () => {
    const bot = await agentMade("Cosmo Vane", "botchelor-loop-crowd-cosmo");
    const someone = await person("Wren Kestrel");
    const imp = (viewer: string, daysAgo: number, serve: string) =>
      t.db.query(`insert into swipe_impressions (viewer, card, serve_id, rank, served_via, at) values ($1, $2, $3, 1, 'mcp', now() - ($4 || ' days')::interval)`, [
        viewer,
        HOUSE_PARTNER_ID,
        serve,
        String(daysAgo),
      ]);
    await imp(bot.id, 20, "bot-old");
    await imp(bot.id, 1, "bot-new");
    await imp(someone.id, 20, "person-old");
    const call = (client: string, daysAgo: number, method: string) =>
      t.db.query(`insert into mcp_calls (method, ok, client_name, created_at) values ($1, true, $2, now() - ($3 || ' days')::interval)`, [method, client, String(daysAgo)]);
    await call("botchelor-loop-crowd-cosmo", 20, "bot-old");
    await call("botchelor-loop-crowd-cosmo", 1, "bot-new");
    await call("claude-code", 20, "agent-old");

    const pruned = await pruneHouseBotLogs(t.db);
    expect(pruned).toEqual({ swipe_impressions: 1, mcp_calls: 1 });
    const serves = (await t.db.query<{ serve_id: string }>(`select serve_id from swipe_impressions order by serve_id`)).rows.map((r) => r.serve_id);
    expect(serves).toEqual(["bot-new", "person-old"]);
    const methods = (await t.db.query<{ method: string }>(`select method from mcp_calls where method in ('bot-old', 'bot-new', 'agent-old') order by method`)).rows.map((r) => r.method);
    expect(methods).toEqual(["agent-old", "bot-new"]);
  });
});

describe("the home page's sky counts (lib/graph.ts skyCounts)", () => {
  it("are the Constellation's own character and couple counts, without building it", async () => {
    await person("Wren Kestrel");
    await agentMade("Ada Quill");
    const sky = await constellation(t.db);
    expect(await skyCounts(t.db)).toEqual({ characters: sky.stats.characters, couples: sky.stats.couples });
  });
});
