/**
 * Our own demand per tag (lib/tag-demand.ts, lib/adult/tag-demand.ts, docs/tags.md "Demand"): picks against what's on
 * offer, shrunk toward the census, our own accounts left out, After Dark's kept on its side.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adultRoleplayDemand, adultRoleplayPicks } from "@/lib/adult/tag-demand";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { DATE_ROLEPLAYS } from "@/lib/roleplays";
import {
  ART_STYLE_VALUES,
  artStyleDemand,
  characterTypeDemand,
  demandMap,
  demandOf,
  facetDemand,
  forgetPickerDemandForTests,
  LINEUP_VALUES,
  lineupDemand,
  pickerDemand,
  RAW_CAP,
  SHRINK,
  showRoleplayDemand,
  showRoleplayPicks,
} from "@/lib/tag-demand";
import { byDemand, tagById, tagsIn } from "@/lib/tags";
import { GET as adultDemandGet } from "@/app/api/admin/after-dark/tag-demand/route";
import { GET as demandGet } from "@/app/api/tags/demand/route";
import { BASE_URL, newUserCookie, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  forgetPickerDemandForTests();
});

const tag = (id: string, sfw: number | null, nsfw: number | null = null) => ({ id, label: id, icon: "", facet: "setup", census: { sfw, nsfw } });

describe("the arithmetic", () => {
  const offer = [
    { id: "a", tags: ["x"] },
    { id: "b", tags: ["y"] },
    { id: "c", tags: ["y"] },
    { id: "d", tags: [] },
  ];

  it("is the census with no picks at all", () => {
    const d = demandOf(new Map(), offer, [tag("x", 1.4), tag("y", 0.8)], "sfw");
    expect(d.total).toBe(0);
    expect(d.rows.map((r) => [r.tag, r.raw, r.blended])).toEqual([
      ["x", null, 1.4],
      ["y", null, 0.8],
    ]);
  });

  it("is share of picks over share of supply, shrunk toward the census", () => {
    // x is a quarter of what's on offer and gets half the picks: twice its share.
    const d = demandOf(new Map([["a", 10], ["b", 5], ["c", 5]]), offer, [tag("x", 1), tag("y", 1)], "sfw");
    const x = d.rows.find((r) => r.tag === "x")!;
    expect(x).toMatchObject({ picks: 10, supply: 1, raw: 2, census: 1 });
    expect(x.blended).toBeCloseTo((10 * 2 + SHRINK * 1) / (10 + SHRINK), 3);
    const y = d.rows.find((r) => r.tag === "y")!;
    expect(y.raw).toBeCloseTo(1, 5); // half the picks, half the offer
    expect(y.blended).toBeCloseTo(1, 3);
  });

  it("caps a rare tag's raw number before it blends, and a hundred picks mostly speak for themselves", () => {
    const rare = demandOf(new Map([["a", 2]]), offer, [tag("x", 1)], "sfw").rows[0]!;
    expect(rare.raw).toBe(4); // all the picks on a quarter of the offer
    expect(rare.blended).toBeCloseTo((2 * RAW_CAP + SHRINK) / (2 + SHRINK), 3);
    expect(rare.blended).toBeLessThan(1.2);
    const many = demandOf(new Map([["a", 100], ["b", 100]]), offer, [tag("x", 0.5)], "sfw").rows[0]!;
    expect(many.raw).toBe(2);
    expect(many.blended).toBeGreaterThan(1.6);
  });

  it("falls back to the other side's census, then 1", () => {
    const d = demandOf(new Map(), offer, [tag("x", null, 1.3), tag("y", null, null)], "sfw");
    expect(demandMap(d)).toEqual({ x: 1.3, y: 1 });
  });

  it("orders a picker: most wanted first", () => {
    const types = tagsIn("type");
    const loud = types[types.length - 1]!.id;
    expect(byDemand(types, "sfw", { [loud]: 9 })[0]!.id).toBe(loud);
    // No numbers of ours: the census's order, unchanged.
    expect(byDemand(types, "sfw", {}).map((x) => x.id)).toEqual(byDemand(types, "sfw").map((x) => x.id));
  });
});

const [A, B] = [HOUSE_CHARACTERS[0]!.id, HOUSE_CHARACTERS[1]!.id];

async function date(id: string, creator: string, roleplay: string | null, daysAgo = 1) {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, setup, created_at)
     values ($1, $2, $3, $4, 'cafe', '{}', '[]', '', '', 'friends', $5, now() - make_interval(days => $6::int))`,
    [id, creator, A, B, JSON.stringify(roleplay ? { roleplay: { id: roleplay, title: "T" } } : {}), daysAgo],
  );
}

describe("whose picks count", () => {
  const rivals = DATE_ROLEPLAYS.find((r) => r.tags.includes("rivals"))!;

  it("counts dates and companion scenes by real people, recent ones only, and never ours", async () => {
    await date("d1", "u-real", rivals.id);
    await date("d2", "u-real", rivals.id);
    await date("d3", "u-real", "custom");
    await date("d4", "u-real", null);
    await date("d-old", "u-old", rivals.id, 100);
    await t.db.query(`insert into admins (user_id) values ('u-admin') on conflict do nothing`);
    await date("d-ours", "u-admin", rivals.id);
    await t.db.query(
      `insert into companion_threads (id, user_id, character_id, roleplay) values ('th1', 'u-real', $1, $2), ('th2', 'u-admin', $1, $2)`,
      [A, JSON.stringify({ id: rivals.id, title: "T" })],
    );
    // Everyone's, recent: an admin's count when nobody's left out, a pick older than DEMAND_DAYS never does.
    expect((await showRoleplayPicks(t.db, [])).get(rivals.id)).toBe(5);
    const picks = await showRoleplayPicks(t.db);
    expect(picks.get(rivals.id)).toBe(3);
    expect(picks.get("custom")).toBe(1); // read, but on no shelf: nothing on offer has that id
    const d = await showRoleplayDemand(t.db);
    expect(d.total).toBe(3);
    const row = d.rows.find((r) => r.tag === "rivals")!;
    expect(row.picks).toBe(3);
    expect(row.raw).toBeGreaterThan(1);
    expect(row.blended).toBeGreaterThan(tagById("rivals")!.census.sfw ?? 1);
    // Only the shelves' facets: types are the characters' measure.
    expect(new Set(d.rows.map((r) => r.facet))).toEqual(new Set(["setup", "theme"]));
  });

  it("counts companion talk by the type of who it's with", async () => {
    await t.db.query(`insert into character_tags (character_id, tag, source) values ($1, 'cold', 'house'), ($2, 'sweet', 'house')`, [A, B]);
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('t1', 'u1', $1), ('t2', 'u2', $1), ('t3', 'u3', $2)`, [A, B]);
    const d = await characterTypeDemand(t.db);
    expect(d.rows.find((r) => r.tag === "cold")!.picks).toBe(2);
    expect(d.rows.find((r) => r.tag === "sweet")!.picks).toBe(1);
    expect(new Set(d.rows.map((r) => r.facet))).toEqual(new Set(["type"]));
  });

  it("is what the pickers fetch, cached", async () => {
    const first = await pickerDemand(t.db, 1000);
    expect(Object.keys(first.roleplays)).toContain("rivals");
    expect(Object.keys(first.types)).toContain("cold");
    await date("d1", "u-real", rivals.id);
    expect(await pickerDemand(t.db, 2000)).toBe(first); // within the hour: the same answer
    forgetPickerDemandForTests();
    expect((await pickerDemand(t.db, 3000)).roleplays.rivals).toBeGreaterThan(first.roleplays.rivals!);
  });
});

describe("facets that aren't tags (art style, lineup; PRD styles-and-storylines phase 7)", () => {
  it("is the tags' index and blend, with the census's rank by style as the prior", () => {
    const supply = new Map([["realistic", 8], ["anime", 2]]);
    expect(demandMap(facetDemand("art_style", new Map(), supply, ART_STYLE_VALUES))).toEqual({ realistic: 0.92, anime: 1.08, semi_real: 1.05 });
    // Anime is a fifth of what's on offer and gets half the picks: two and a half times its share.
    const d = facetDemand("art_style", new Map([["realistic", 5], ["anime", 5]]), supply, ART_STYLE_VALUES);
    expect(d.total).toBe(10);
    const anime = d.rows.find((r) => r.tag === "anime")!;
    expect(anime).toMatchObject({ facet: "art_style", picks: 5, supply: 2, census: 1.08 });
    expect(anime.raw).toBeCloseTo(2.5, 5);
    expect(anime.blended).toBeCloseTo((5 * 2.5 + SHRINK * 1.08) / (5 + SHRINK), 3);
    expect(d.rows.find((r) => r.tag === "realistic")!.blended).toBeLessThan(0.92);
    // Nothing drawn in 2.5D on offer yet: no number of ours, the census's stands.
    expect(d.rows.find((r) => r.tag === "semi_real")).toMatchObject({ picks: 0, supply: 0, raw: null, blended: 1.05 });
  });

  it("has an even prior for the lineup, one value per pronoun the characters table allows", () => {
    expect(LINEUP_VALUES.map((v) => v.id)).toEqual(["she/her", "he/him", "they/them"]);
    expect(demandMap(facetDemand("lineup", new Map(), new Map(), LINEUP_VALUES))).toEqual({ "she/her": 1, "he/him": 1, "they/them": 1 });
  });

  async function character(id: string, owner: string, style: string | null, pronouns: string | null, daysAgo = 1, visibility = "public") {
    await t.db.query(
      `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, extras, pronouns, visibility, created_at)
       values ($1, $2, $1, 30, 'A florist.', '["bold","gentle","precise"]'::jsonb, 'Quiet.', 'Fireworks.', $3::jsonb, $4, $5, now() - make_interval(days => $6::int))`,
      [id, owner, JSON.stringify(style ? { looks: { style } } : {}), pronouns, visibility, daysAgo],
    );
  }
  const event = (name: string, props: Record<string, string>, user: string | null = null) =>
    t.db.query(`insert into web_events (visitor, session, user_id, event, path, props) values ('v1', 's1', $1, $2, '/companion', $3::jsonb)`, [
      user,
      name,
      JSON.stringify(props),
    ]);

  it("counts styles made, the style filter and conversations by style, never ours", async () => {
    const before = await artStyleDemand(t.db);
    await t.db.query(`insert into admins (user_id) values ('u-admin') on conflict do nothing`);
    await character("c-anime", "u-real", "anime", "she/her");
    await character("c-anime-2", "u-real", "anime", "he/him", 1, "private");
    await character("c-semi", "u-real", "semi_real", "they/them");
    await character("c-old", "u-old", "anime", null, 100);
    await character("c-ours", "u-admin", "anime", null);
    await character("c-photo", "u-real", null, "she/her");
    await event("style_filter", { style: "anime", page: "companion" });
    await event("style_filter", { style: "semi_real", page: "characters" }, "u-real");
    await event("style_filter", { style: "anime", page: "characters" }, "u-admin");
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('t1', 'u-real', 'c-anime'), ('t2', 'u-admin', 'c-anime'), ('t3', 'u-two', 'c-photo')`);

    const d = await artStyleDemand(t.db);
    // Made: two anime (a private one is still a pick), one 2.5D, one photographed; the old one and ours don't count.
    expect(d.sources.anime).toEqual({ made: 2, filtered: 1, chats: 1 });
    expect(d.sources.semi_real).toEqual({ made: 1, filtered: 1, chats: 0 });
    expect(d.sources.realistic!.made).toBe(before.sources.realistic!.made + 1);
    expect(d.sources.realistic!.chats).toBe(before.sources.realistic!.chats + 1);
    const anime = d.rows.find((r) => r.tag === "anime")!;
    expect(anime.picks).toBe(4);
    // On offer: everyone anyone may find, ours and old ones too, but not the private one.
    expect(anime.supply).toBe(before.rows.find((r) => r.tag === "anime")!.supply + 3);
    expect(d.rows.find((r) => r.tag === "semi_real")!.supply).toBe(before.rows.find((r) => r.tag === "semi_real")!.supply + 1);
    expect(anime.raw).toBeGreaterThan(1);
    expect(anime.blended).toBeGreaterThan(1.08);
  });

  it("counts the pronouns filter and conversations by who they're with", async () => {
    await character("c-she", "u-real", null, "she/her");
    await character("c-they", "u-real", null, "they/them");
    await event("pronouns_filter", { pronouns: "they/them", page: "companion" });
    await event("pronouns_filter", { pronouns: "they/them", page: "companion" }, "u-real");
    await t.db.query(`insert into admins (user_id) values ('u-admin') on conflict do nothing`);
    await event("pronouns_filter", { pronouns: "she/her", page: "companion" }, "u-admin");
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('t1', 'u-real', 'c-she'), ('t2', 'u-real', 'c-they')`);
    const d = await lineupDemand(t.db);
    expect(d.sources["they/them"]).toEqual({ filtered: 2, chats: 1 });
    expect(d.sources["she/her"]).toEqual({ filtered: 0, chats: 1 });
    expect(d.rows.find((r) => r.tag === "they/them")!.picks).toBe(3);
    expect(d.total).toBe(4);
    expect(new Set(d.rows.map((r) => r.facet))).toEqual(new Set(["lineup"]));
  });
});

describe("After Dark's own", () => {
  it("counts Set the scene and Step in by members, not ours, by its own tags", async () => {
    const rp = ROLEPLAYS.find((r) => r.tags.includes("dom_sub"))!;
    const v = JSON.stringify({ id: rp.id, title: rp.title });
    await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, roleplay) values ('s1', 'm1', $1, $2, $3)`, [A, B, v]);
    await t.db.query(`insert into adult_step_in_scenes (id, owner_id, character_id, place, roleplay) values ('p1', 'm2', $1, 'bar', $2)`, [A, v]);
    await t.db.query(`insert into admins (user_id) values ('u-admin') on conflict do nothing`);
    await t.db.query(`insert into adult_step_in_scenes (id, owner_id, character_id, place, roleplay) values ('p2', 'u-admin', $1, 'bar', $2)`, [A, v]);
    expect((await adultRoleplayPicks(t.db)).get(rp.id)).toBe(2);
    const d = await adultRoleplayDemand(t.db);
    expect(d.side).toBe("nsfw");
    expect(d.rows.find((r) => r.tag === "dom_sub")!.picks).toBe(2);
    expect(d.rows.some((r) => r.facet === "heat")).toBe(true);
  });
});

describe("the routes", () => {
  it("gives the show's numbers to anyone, and After Dark's to no one After Dark is closed to", async () => {
    const res = await demandGet(new Request(`${BASE_URL}/api/tags/demand`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roleplays: Record<string, number>; types: Record<string, number> };
    expect(Object.keys(body).sort()).toEqual(["roleplays", "types"]);
    expect(typeof body.roleplays.rivals).toBe("number");
    // The show's numbers never carry After Dark's tags.
    expect(body.roleplays.dom_sub).toBeUndefined();
    const url = `${BASE_URL}/api/admin/after-dark/tag-demand`;
    expect((await adultDemandGet(new Request(url))).status).toBe(404);
    const someone = await newUserCookie();
    expect((await adultDemandGet(new Request(url, { headers: { cookie: someone } }))).status).toBe(404);
  });
});
