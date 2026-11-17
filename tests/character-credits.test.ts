// A character's credits (lib/profile/credits.ts; the connected-model plan, stage 3): every season it has been in, as
// what, and what came of it, in one statement for any number of characters. The public record only: a private
// character's credits and an audition's standing reach nobody but the owner, and nothing counts that hasn't aired.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Credits from "@/app/characters/[id]/Credits";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage } from "@/lib/mcp";
import { awardKey, characterCredits, creditLine, saveSeasonAwards, syncSeasonAwards, type CharacterCredit } from "@/lib/profile/credits";
import { backfillEpisodeSeasons, ensureShowSeasons } from "@/lib/show-seasons";
import { setSeasonFormat } from "@/lib/season-format-store";
import { api, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const NOW = new Date("2026-11-16T12:00:00Z");
const OCT = "2026-10-19";
const NOV = "2026-11-01";
const DEC = "2026-12-01";
const [NELL, DEX] = HOUSE_CHARACTERS.map((c) => c.id);

/** A date of `characterId`'s that aired at `when`, public, stamped with its season. */
async function airedDate(when: string, ending: "second_date" | "friends" | "disaster" = "friends") {
  const made = await setupEpisode(ending);
  await t.db.query(`update episodes set revealed_at = $2, status = 'ready', visibility = 'public', season_id = null where id = $1`, [made.episode.id, when]);
  return made;
}
const cast = (season: string, id: string, source: string, slot = 1) => t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, $4)`, [season, id, slot, source]);
const credits = async (id: string, viewerId?: string) => (await characterCredits(t.db, [id], { viewerId, now: NOW })).get(id) ?? [];

describe("what a character has been in", () => {
  it("lists each season with its show, the part, the aired dates and what was won, newest first", async () => {
    const a = await airedDate("2026-11-03T20:00:00Z", "second_date");
    const partner = (await t.db.query<{ character_b: string }>(`select character_b from episodes where id = $1`, [a.episode.id])).rows[0].character_b;
    // A date in October too, so the registry reaches back to the first monthly season.
    await airedDate("2026-10-25T20:00:00Z");
    await ensureShowSeasons(t.db, NOW);
    await backfillEpisodeSeasons(t.db);
    await cast(NOV, partner, "dealt");
    await cast(OCT, partner, "survivor", 2);
    await saveSeasonAwards(t.db, NOV, [{ title: "🏆 The golden couple", chars: [{ id: partner }, { id: a.character.id }] }]);

    const house = await credits(partner);
    expect(house.map((c) => c.season_id)).toEqual([NOV, OCT]);
    expect(house[0]).toMatchObject({ number: 2, label: "November 2026", path: "/seasons/november-2026", format: "classic", format_title: "Classic Botchelor", role: "cast", dates: 1, second_dates: 1, when: "now", show_id: "botchelor" });
    expect(house[0].honours).toEqual([{ key: "the-golden-couple", label: "🏆 The golden couple" }]);
    expect(house[1]).toMatchObject({ number: 1, role: "cast", when: "past" });

    // The person's character was never on a cast: it dated on the show, and shares the award.
    const guest = await credits(a.character.id);
    expect(guest).toHaveLength(1);
    expect(guest[0]).toMatchObject({ season_id: NOV, role: "guest", dates: 1, second_dates: 1 });
    expect(guest[0].honours.map((h) => h.key)).toEqual(["the-golden-couple"]);
  });

  it("takes the most prominent part, and puts roses before awards", async () => {
    await ensureShowSeasons(t.db, NOW);
    await setSeasonFormat(t.db, DEC, "botchelor");
    await cast(DEC, NELL, "lead");
    await cast(DEC, DEX, "suitor", 2);
    await t.db.query(`insert into suitor_badges (season_id, character_id, badge, week) values ($1, $2, 'final_rose', 4)`, [DEC, DEX]);
    await saveSeasonAwards(t.db, DEC, [{ title: "💗 Fan favourite", chars: [{ id: DEX }] }]);
    const lead = await credits(NELL);
    expect(lead[0]).toMatchObject({ season_id: DEC, role: "lead", when: "next", format: "botchelor", format_title: "The Botchelor" });
    const suitor = await credits(DEX);
    expect(suitor[0]).toMatchObject({ role: "suitor" });
    expect(suitor[0].honours.map((h) => h.label)).toEqual(["🌹 The final rose", "💗 Fan favourite"]);
    expect(creditLine(lead)).toBe("Lead of The Botchelor, December 2026");
    expect(creditLine(suitor)).toBe("Suitor on The Botchelor, December 2026");
  });

  it("a walk-on's roses, a withdrawn cast member, and nothing at all for someone with no part", async () => {
    await ensureShowSeasons(t.db, NOW);
    const me = newUserCookie();
    const mine = await (await api.createCharacter(validCharacter({ name: "Odalys Brandt" }), me)).json();
    for (const day of ["2026-11-01", "2026-11-08"]) {
      await t.db.query(`insert into walk_on_roses (season_id, held_on, character_id, episode_id, rose) values ($1, $2, $3, 'ep', true)`, [NOV, day, mine.id]);
    }
    const walkOn = await credits(mine.id);
    expect(walkOn[0]).toMatchObject({ role: "walk_on" });
    expect(walkOn[0].honours).toEqual([{ key: "roses", label: "🌹 2 roses" }]);
    expect(creditLine(walkOn)).toBe("Walk-on on Classic Botchelor, November 2026");

    await cast(NOV, DEX, "fan", 3);
    await t.db.query(`update season_casts set withdrawn_at = now() where character_id = $1`, [DEX]);
    expect((await credits(DEX))[0]).toMatchObject({ role: "fan", withdrawn: true });
    expect(await credits(NELL)).toEqual([]);
    expect(creditLine([])).toBeNull();
  });

  it("the leaderboard weeks before the first monthly season are not seasons of the show", async () => {
    const a = await airedDate("2026-10-07T20:00:00Z");
    await ensureShowSeasons(t.db, NOW);
    await backfillEpisodeSeasons(t.db);
    expect((await t.db.query<{ season_id: string }>(`select season_id from episodes where id = $1`, [a.episode.id])).rows[0].season_id).toBe("2026-10-05");
    expect(await credits(a.character.id)).toEqual([]);
  });
});

describe("the public record only", () => {
  it("a date that hasn't aired, or isn't public, is not a credit", async () => {
    const a = await airedDate("2026-11-03T20:00:00Z");
    await ensureShowSeasons(t.db, NOW);
    await backfillEpisodeSeasons(t.db);
    expect((await credits(a.character.id))[0]).toMatchObject({ dates: 1 });
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [a.episode.id]);
    expect(await credits(a.character.id)).toEqual([]);
  });

  it("a private character's credits, and an audition's standing, reach only the owner", async () => {
    await ensureShowSeasons(t.db, NOW);
    const me = newUserCookie();
    const mine = await (await api.createCharacter(validCharacter({ name: "Odalys Brandt" }), me)).json();
    await cast(NOV, mine.id, "fan");
    await t.db.query(`insert into cast_auditions (season_id, character_id, owner_id, status) values ($1, $2, $3, 'open')`, [DEC, mine.id, userIdOf(me)]);

    const stranger = await credits(mine.id, "someone-else");
    expect(stranger.map((c) => c.season_id)).toEqual([NOV]);
    expect(stranger[0].audition).toBeUndefined();

    const owner = await credits(mine.id, userIdOf(me));
    expect(owner.map((c) => c.season_id)).toEqual([DEC, NOV]);
    expect(owner[0]).toMatchObject({ role: "guest", audition: "open", when: "next" });

    await t.db.query(`update characters set visibility = 'private' where id = $1`, [mine.id]);
    expect(await credits(mine.id, "someone-else")).toEqual([]);
    expect(await credits(mine.id)).toEqual([]);
    expect((await credits(mine.id, userIdOf(me))).length).toBe(2);
  });
});

describe("one statement, however many characters", () => {
  it("reads a page of characters in a single query once every season's format is frozen", async () => {
    await ensureShowSeasons(t.db, NOW);
    await cast(NOV, NELL, "dealt");
    await cast(NOV, DEX, "dealt", 2);
    const spy = vi.spyOn(t.db, "query");
    const all = await characterCredits(t.db, [NELL, DEX, "nobody", NELL], { now: NOW });
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...all.keys()].sort()).toEqual([NELL, DEX].sort());
    expect(await characterCredits(t.db, [], { now: NOW })).toEqual(new Map());
  });
});

describe("a season's awards as rows", () => {
  it("has a stable key, replaces what was there, and fills recaps frozen before", async () => {
    expect(awardKey("🏆 The golden couple")).toBe("the-golden-couple");
    expect(awardKey("💥 Biggest disaster")).toBe("biggest-disaster");
    expect(await saveSeasonAwards(t.db, NOV, [{ title: "💗 Fan favourite", chars: [{ id: NELL }] }])).toBe(1);
    expect(await saveSeasonAwards(t.db, NOV, [{ title: "💗 Fan favourite", chars: [{ id: DEX }] }])).toBe(1);
    expect((await t.db.query<{ character_id: string }>(`select character_id from season_awards where season_id = $1`, [NOV])).rows).toEqual([{ character_id: DEX }]);

    await t.db.query(`insert into season_recaps (season_id, data, frozen_at) values ($1, $2::jsonb, now())`, [OCT, JSON.stringify({ awards: [{ title: "🤯 Full of surprises", chars: [{ id: NELL }] }, { title: "🏆 The golden couple", chars: [{ id: NELL }, { id: DEX }] }] })]);
    expect(await syncSeasonAwards(t.db)).toBe(3);
    expect(await syncSeasonAwards(t.db)).toBe(0);
  });
});

describe("where it shows", () => {
  const credit = (over: Partial<CharacterCredit>): CharacterCredit => ({
    season_id: NOV, show_id: "botchelor", number: 2, label: "November 2026", path: "/seasons/november-2026", format: "classic", format_title: "Classic Botchelor",
    role: "cast", withdrawn: false, dates: 14, second_dates: 6, honours: [{ key: "the-golden-couple", label: "🏆 The golden couple" }], when: "now", ...over,
  });

  it("the character page lists each season, linked, with the part and what came of it", () => {
    const html = renderToStaticMarkup(createElement(Credits, { first: "Nell", credits: [credit({}), credit({ season_id: OCT, number: 1, label: "October 2026", path: "/seasons/october-2026", when: "past", dates: 1, second_dates: 0, honours: [], role: "guest" })] }));
    expect(html).toContain('<h2 id="credits-title">On the show</h2>');
    expect(html).toContain('href="/seasons/november-2026"');
    expect(html).toContain("Season 2 · November 2026");
    expect(html).toContain("<strong>On the cast</strong>");
    expect(html).toContain("14 dates, 6 ended in a second date · 🏆 The golden couple");
    expect(html).toContain('<span class="chip">On now</span>');
    expect(html).toContain("<strong>Dated on the show</strong>");
    expect(html).toContain("1 date");
    expect(renderToStaticMarkup(createElement(Credits, { first: "Nell", credits: [] }))).toBe("");
  });

  it("an audition with no part yet is its own line, for the owner", () => {
    const html = renderToStaticMarkup(createElement(Credits, { first: "Odalys", credits: [credit({ season_id: DEC, number: 3, label: "December 2026", role: "guest", dates: 0, second_dates: 0, honours: [], when: "next", audition: "approved" })] }));
    expect(html).toContain("<strong>Auditioned: shortlisted</strong>");
    expect(html).toContain('<span class="chip">Coming up</span>');
    expect(html).not.toContain("Dated on the show");
  });

  it("an agent reads the same record from get_character", async () => {
    await ensureShowSeasons(t.db);
    const current = (await t.db.query<{ id: string }>(`select id from show_seasons where starts_at <= now() and ends_at > now()`)).rows[0].id;
    await cast(current, NELL, "lead");
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_character", arguments: { character_id: NELL } } }, {})) as { result: { structuredContent: { on_the_show?: { role: string; when?: string; season: string }[] } } };
    expect(res.result.structuredContent.on_the_show?.[0]).toMatchObject({ role: "lead", when: "now" });
    vi.stubEnv("CHARACTER_CREDITS", "0");
    const off = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_character", arguments: { character_id: NELL } } }, {})) as { result: { structuredContent: { on_the_show?: unknown } } };
    expect(off.result.structuredContent.on_the_show).toBeUndefined();
  });
});
