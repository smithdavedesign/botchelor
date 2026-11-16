// Open casting (lib/casting.ts; David 2026-11-15): the season is the first date. A person's new character's first date
// goes to the Botchelor's lead, Sunday's roses go to the walk-ons whose date ended in a second date, the owner hears
// either way, and a rose books the next date on the show. Nothing here touches points, odds, pairings or endings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as castingGet } from "@/app/api/casting/walk-on/route";
import { POST as adminSeasonPost } from "@/app/api/admin/season/route";
import { CastingProvider, type CastingForClient } from "@/app/CastingContext";
import BotchelorCard from "@/app/watch/BotchelorCard";
import { episodeAllowance } from "@/lib/allowance";
import {
  CASTING_MET_VIA,
  castingBadgesOf,
  castingHeroLine,
  castingLead,
  castingNote,
  castingPartnerFor,
  leadBilling,
  nextRosesAt,
  noRoseLines,
  openCasting,
  roseLines,
  roseWeek,
  runWalkOnRoses,
  walkOnsLine,
} from "@/lib/casting";
import { ceremonyBoard, ceremonySummary } from "@/lib/ceremony";
import { weeklyLifeDates } from "@/lib/character-life";
import { openThread, setCompanionModelForTests } from "@/lib/companion";
import { pickSomeoneNew } from "@/lib/companion-offers";
import { ensureSchema } from "@/lib/db";
import { coarseMetVia } from "@/lib/graph";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { PEOPLE_KEPT, updateCharacterMemory } from "@/lib/memory";
import { setLeadOverride, setSeasonCastForTests } from "@/lib/season-cast";
import { setSeasonFormat, setSeasonFormatForTests } from "@/lib/season-format-store";
import { nextSeasonStart, seasonIdOf } from "@/lib/season-window";
import { api, BASE_URL, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

// The lead sits OFF the season's house cast in these tests, so a blind date that fell back to the house can never be
// mistaken for a casting date.
const LEAD = HOUSE_CHARACTERS[5].id;
const LEAD_NAME = HOUSE_CHARACTERS[5].name;
const LEAD_FIRST = LEAD_NAME.split(/\s+/)[0];
const CAST = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);

beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  setSeasonCastForTests(CAST);
  setCompanionModelForTests({
    async complete() {
      throw new Error("the model must not be called for a rose");
    },
  });
});
afterEach(() => {
  setSeasonCastForTests(null);
  setSeasonFormatForTests(null);
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const DAY = 24 * 60 * 60 * 1000;
// December 2026: Dec 1 is a Tuesday; its Sundays are 6, 13, 20, 27. November 2026's are 1, 8, 15, 22, 29.
const DEC = "2026-12-01";
const dec = (day: number, hour = 12) => new Date(Date.UTC(2026, 11, day, hour));
const nov = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));

/** December runs as The Botchelor with LEAD as its stored lead (the cast as the 1st picks it). */
async function decemberSeason() {
  await setSeasonFormat(t.db, DEC, "botchelor");
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [DEC, LEAD]);
}

// From the clock, for everything that goes through the booking route (its rows carry the database's now()). The season
// AFTER the real one is picked as The Botchelor with LEAD picked as its lead: the preseason, open whatever today is.
const NOW = new Date();
const NEXT = seasonIdOf(nextSeasonStart(NOW));
/** The coming Sunday's pass (today's, late, when today is one). It may fall in the next month: then it is in season. */
const SUNDAY = (() => {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  d.setUTCHours(23, 20, 0, 0);
  return d;
})();
async function preseason() {
  await setSeasonFormat(t.db, NEXT, "botchelor");
  await setLeadOverride(t.db, NEXT, LEAD);
  // The same lead once that season starts, so a pass that falls in it reads the same house.
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [NEXT, LEAD]);
}

/** Names off lib/our-traffic.ts OUR_TEST_NAMES (the fixture's "Mira Quell" makes its owner ours). */
let named = 0;
const SURNAMES = ["Holt", "Okafor", "Lindqvist", "Marsh", "Abara", "Fenwick", "Sato", "Reyes", "Varga", "Nkemelu"];
const FIRSTS = ["Ines", "Tavi", "Bram", "Odile", "Cass", "Wren", "Juno", "Pax"];
const nextName = () => `${FIRSTS[named % FIRSTS.length]} ${SURNAMES[named++ % SURNAMES.length]}${named > SURNAMES.length ? ` ${Math.ceil(named / SURNAMES.length)}` : ""}`;

/** A person with one new character that has never dated. */
async function newcomer() {
  const cookie = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: nextName() }), cookie)).json()) as { id: string; name: string };
  return { cookie, owner: userIdOf(cookie), character };
}

type Ending = "second_date" | "friends" | "disaster";
/** The wizard's instant card with casting on: a blind date in the first-date format. */
async function walkOn(who: { cookie: string; character: { id: string } }, ending: Ending = "second_date") {
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: who.character.id, blind: true, format: "speed_date" }, who.cookie);
  return { status: res.status, body: (await res.json()) as { id: string; characters?: { id: string }[] } };
}

const episodeRow = async (id: string) =>
  (await t.db.query<{ character_a: string; character_b: string; met_via: string | null; format: string | null; followup_of: string | null; status: string; creator_id: string }>(
    `select character_a, character_b, setup->>'met_via' as met_via, setup->>'format' as format, followup_of, status, creator_id from episodes where id = $1`,
    [id],
  )).rows[0];

/** A finished date with the lead, written straight into the table at a time of its own (the lead as side B, as booked). */
async function datedLead(id: string, characterId: string, ownerId: string, ending: Ending, at: Date, opts: { casting?: boolean; leadWants?: boolean } = {}) {
  const side = (wants: boolean) => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript, sides, setup, created_at)
     values ($1, $2, $3, $4, 'a table', '[]'::jsonb, '[]'::jsonb, 'a twist', 'a finale', $5, 1, 'ready', 'public', $6, '[]'::jsonb, $7::jsonb, $8::jsonb, $6)`,
    [id, ownerId, characterId, LEAD, ending, at.toISOString(), JSON.stringify([side(ending === "second_date"), side(opts.leadWants ?? ending === "second_date")]), JSON.stringify(opts.casting === false ? { venue: "jazz_bar" } : { venue: "jazz_bar", met_via: CASTING_MET_VIA })],
  );
}

const roses = async () =>
  (await t.db.query<{ season_id: string; held_on: string; character_id: string; episode_id: string; rose: boolean; next_episode_id: string | null }>(
    `select season_id, held_on, character_id, episode_id, rose, next_episode_id from walk_on_roses order by held_on, character_id`,
  )).rows;
const notices = async (userId: string) => (await t.db.query<{ kind: string; title: string; body: string | null; link: string | null }>(`select kind, title, body, link from notifications where user_id = $1 and kind = 'ceremony_held' order by created_at`, [userId])).rows;
const roseTexts = async (characterId: string) =>
  (await t.db.query<{ text: string; action: string; offers: { kinds: string[]; partner_id: string } | null }>(
    `select m.text, m.action, m.offers from companion_messages m join companion_threads th on th.id = m.thread_id where th.character_id = $1 and m.action like '%rose:%' order by m.created_at, m.id`,
    [characterId],
  )).rows;
/** The person tapped "Hear from" once: their thread with their own character is opted in to its texts. */
async function optIn(owner: string, characterId: string) {
  const opened = await openThread(t.db, owner, characterId, new Date(), { opener: false });
  if (!opened.ok) throw new Error("could not open the thread");
  await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [opened.thread_id]);
}

describe("who a new character's first date goes to (castingLead)", () => {
  it("is nobody until a lead format is picked: nothing changes today", async () => {
    expect(openCasting({})).toBe(true);
    expect(await castingLead(t.db, nov(16), {})).toBeNull();
    expect(await castingLead(t.db, dec(2), {})).toBeNull();
  });

  it("in season: this month's lead, until the season's last roses are handed out", async () => {
    await decemberSeason();
    const c = await castingLead(t.db, dec(2), {});
    expect(c).toMatchObject({ phase: "season", season_id: DEC, month: "December", lead: { id: LEAD, name: LEAD_NAME }, roses_at: "2026-12-06T23:20:00.000Z" });
    expect(leadBilling(c!)).toBe("this season's Botchelor");
    expect(castingHeroLine(c!)).toBe(`Their first date is with ${LEAD_FIRST}, this season's Botchelor: nobody steers it, roses are handed out on Sunday, and they text you whether they got one.`);
    // The finale Sunday, before the pass: still open. After it no Sunday is left in the season, so casting has closed.
    expect((await castingLead(t.db, dec(27, 12), {}))?.roses_at).toBe("2026-12-27T23:20:00.000Z");
    expect(await castingLead(t.db, new Date(Date.UTC(2026, 11, 27, 23, 30)), {})).toBeNull();
    expect(await castingLead(t.db, dec(30), {})).toBeNull();
    // A Botchelor month with no lead on its cast yet holds nothing.
    await t.db.query(`delete from season_casts where season_id = $1`, [DEC]);
    expect(await castingLead(t.db, dec(2), {})).toBeNull();
  });

  it("in the preseason: next month's lead, once next month's format AND its lead are both picked", async () => {
    // The format alone: the default lead is only known on the 1st.
    await setSeasonFormat(t.db, DEC, "botchelor");
    expect(await castingLead(t.db, nov(16), {})).toBeNull();
    await setLeadOverride(t.db, DEC, LEAD);
    const c = await castingLead(t.db, nov(16), {});
    expect(c).toMatchObject({ phase: "preseason", season_id: DEC, month: "December", lead: { id: LEAD }, roses_at: "2026-11-22T23:20:00.000Z" });
    expect(leadBilling(c!)).toBe("December's Botchelor");
    // The lead alone, with the format back to classic: closed again.
    await setSeasonFormat(t.db, DEC, "classic");
    expect(await castingLead(t.db, nov(16), {})).toBeNull();
    // The viewers' ballot leaning that way is not a pick: it can still move until the 1st.
    for (const v of ["v1", "v2", "v3"]) await t.db.query(`insert into season_format_votes (season_id, user_id, pick) values ($1, $2, 'botchelor')`, [DEC, v]);
    expect(await castingLead(t.db, nov(16), {})).toBeNull();
  });

  it("OPEN_CASTING=0 turns it off, in season and before it", async () => {
    await decemberSeason();
    await setLeadOverride(t.db, DEC, LEAD);
    expect(openCasting({ OPEN_CASTING: "0" })).toBe(false);
    expect(await castingLead(t.db, dec(2), { OPEN_CASTING: "0" })).toBeNull();
    expect(await castingLead(t.db, nov(16), { OPEN_CASTING: "0" })).toBeNull();
    expect(await castingLead(t.db, nov(16), { OPEN_CASTING: "1" })).not.toBeNull();
  });

  it("the roses are handed out on Sunday's pass at the ceremony hour: the Sunday premiere's (23), or as before with it off", () => {
    expect(nextRosesAt(dec(2), {}).toISOString()).toBe("2026-12-06T23:20:00.000Z");
    expect(nextRosesAt(dec(6, 23), {}).toISOString()).toBe("2026-12-06T23:20:00.000Z");
    expect(nextRosesAt(new Date(Date.UTC(2026, 11, 6, 23, 30)), {}).toISOString()).toBe("2026-12-13T23:20:00.000Z");
    expect(nextRosesAt(dec(2), { CEREMONY_HOUR_UTC: "18" }).toISOString()).toBe("2026-12-06T23:20:00.000Z");
    expect(nextRosesAt(dec(2), { CEREMONY_HOUR_UTC: "18", SUNDAY_PREMIERE: "0" }).toISOString()).toBe("2026-12-06T18:20:00.000Z");
    expect(nextRosesAt(dec(2), { SUNDAY_PREMIERE: "0" }).toISOString()).toBe("2026-12-06T20:20:00.000Z");
  });

  it("/admin/season: picking next season's format and lead opens casting at once, and the panel says so", async () => {
    const PW = ["pw", "for", "casting", "tests"].join("-");
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const post = async (body: Record<string, unknown>) => {
      const res = await adminSeasonPost(new Request(`${BASE_URL}/api/admin/season`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": PW }, body: JSON.stringify(body) }));
      return { status: res.status, body: (await res.json()) as { botchelor?: { casting?: { switched_on: boolean; now: { phase: string; lead: { id: string } } | null } } } };
    };
    const format = await post({ action: "format", season_id: NEXT, slug: "botchelor" });
    expect(format.status).toBe(200);
    expect(format.body.botchelor?.casting).toEqual({ switched_on: true, now: null });
    const lead = await post({ action: "lead", season_id: NEXT, character_id: LEAD });
    expect(lead.body.botchelor?.casting?.now).toMatchObject({ phase: "preseason", lead: { id: LEAD } });
  });
});

describe("the first date (POST /api/episodes)", () => {
  it("a person's new character's blind speed date is with the lead, marked casting, while other walk-ons are filming with the lead too", async () => {
    await preseason();
    const a = await newcomer();
    const first = await walkOn(a);
    expect(first.status).toBe(200);
    expect(await episodeRow(first.body.id)).toMatchObject({ character_a: a.character.id, character_b: LEAD, met_via: "casting", format: "speed_date" });
    // The first walk-on's date is still being filmed: the next one meets the lead all the same ("one date at a time" is per couple).
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [first.body.id]);
    const b = await newcomer();
    const second = await walkOn(b, "friends");
    expect(second.status).toBe(200);
    expect(await episodeRow(second.body.id)).toMatchObject({ character_a: b.character.id, character_b: LEAD, met_via: "casting" });
    // A casting date reads as "the show set it up" in the graph.
    expect(coarseMetVia(CASTING_MET_VIA)).toBe("set_up");
  });

  it("falls back to the usual blind date, silently, whenever it isn't a walk-on's first date with a lead to meet", async () => {
    // No lead format picked: the usual blind date.
    const early = await newcomer();
    const before = await walkOn(early);
    expect((await episodeRow(before.body.id)).met_via).not.toBe("casting");
    expect(await castingPartnerFor(t.db, { id: early.character.id, owner_id: early.owner }, "speed_date")).toBeNull();

    await preseason();
    // Not its first date any more.
    const again = await walkOn(early);
    expect(again.status).toBe(200);
    expect((await episodeRow(again.body.id)).character_b).not.toBe(LEAD);
    // Not the first-date format (a classic blind date).
    const classic = await newcomer();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const long = (await (await api.createEpisode({ character_id: classic.character.id, blind: true }, classic.cookie)).json()) as { id: string };
    expect((await episodeRow(long.id)).met_via).not.toBe("casting");
    // It unmatched the lead: a rule refuses, so the blind date goes elsewhere.
    const cold = await newcomer();
    const [lo, hi] = [cold.character.id, LEAD].sort();
    await t.db.query(`insert into unmatches (character_lo, character_hi, by_character) values ($1, $2, $3)`, [lo, hi, cold.character.id]);
    expect(await castingPartnerFor(t.db, { id: cold.character.id, owner_id: cold.owner }, "speed_date")).toBeNull();
    const elsewhere = await walkOn(cold);
    expect(elsewhere.status).toBe(200);
    expect((await episodeRow(elsewhere.body.id)).character_b).not.toBe(LEAD);
    // An agent's own run (made over MCP, no account) is not a walk-on.
    const bot = await newcomer();
    await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [bot.character.id]);
    expect(await castingPartnerFor(t.db, { id: bot.character.id, owner_id: bot.owner }, "speed_date")).toBeNull();
    // A date by name is the person's pick: never swapped.
    const picky = await newcomer();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const named = (await (await api.createEpisode({ character_id: picky.character.id, partner_id: CAST[1], format: "speed_date" }, picky.cookie)).json()) as { id: string };
    expect(await episodeRow(named.id)).toMatchObject({ character_b: CAST[1], met_via: "chosen" });
    // The switch.
    vi.stubEnv("OPEN_CASTING", "0");
    const off = await newcomer();
    const usual = await walkOn(off);
    expect(usual.status).toBe(200);
    expect((await episodeRow(usual.body.id)).met_via).not.toBe("casting");
  });

  it("the lead's memory of many walk-ons stays inside the cap every character's has", async () => {
    await preseason();
    for (let i = 0; i < PEOPLE_KEPT + 4; i++) {
      const w = await newcomer();
      await datedLead(`walk-${i}`, w.character.id, w.owner, i % 2 ? "friends" : "second_date", new Date(NOW.getTime() - (i + 1) * 60_000));
    }
    const memory = await updateCharacterMemory(t.db, LEAD);
    expect(memory.dates).toBe(PEOPLE_KEPT + 4);
    expect(memory.people?.length).toBeLessThanOrEqual(PEOPLE_KEPT);
  });
});

describe("Sunday's roses for the walk-ons (runWalkOnRoses)", () => {
  it("a rose if and only if the date ended in a second date; the owner hears either way; texts only when opted in; once", async () => {
    await preseason();
    const [won, lost, quiet] = [await newcomer(), await newcomer(), await newcomer()];
    const wonDate = await walkOn(won, "second_date");
    const lostDate = await walkOn(lost, "friends");
    const quietDate = await walkOn(quiet, "disaster");
    await optIn(won.owner, won.character.id);
    await optIn(lost.owner, lost.character.id);
    const allowance = await episodeAllowance(t.db, won.owner);

    // Not on a weekday, and not before the hour.
    expect(await runWalkOnRoses(t.db, new Date(SUNDAY.getTime() + DAY))).toBeNull();
    expect(await runWalkOnRoses(t.db, new Date(Date.UTC(SUNDAY.getUTCFullYear(), SUNDAY.getUTCMonth(), SUNDAY.getUTCDate(), 22, 20)))).toBeNull();

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const run = await runWalkOnRoses(t.db, SUNDAY);
    const heldOn = SUNDAY.toISOString().slice(0, 10);
    expect(run).toMatchObject({ season_id: NEXT, held_on: heldOn, judged: 3, roses: 1, booked: 1, texted: 2, peoples_rose: null });
    const rows = await roses();
    expect(rows).toHaveLength(3);
    const rowOf = (id: string) => rows.find((r) => r.character_id === id)!;
    expect(rowOf(won.character.id)).toMatchObject({ season_id: NEXT, held_on: heldOn, episode_id: wonDate.body.id, rose: true });
    expect(rowOf(lost.character.id)).toMatchObject({ episode_id: lostDate.body.id, rose: false, next_episode_id: null });
    expect(rowOf(quiet.character.id)).toMatchObject({ episode_id: quietDate.body.id, rose: false, next_episode_id: null });

    // The rose booked a second date with the lead, paid by the show: the owner's dates are what they were.
    const next = rowOf(won.character.id).next_episode_id!;
    expect(await episodeRow(next)).toMatchObject({ character_a: won.character.id, character_b: LEAD, followup_of: wonDate.body.id, met_via: "second_date", format: "speed_date", creator_id: won.owner });
    expect(await episodeAllowance(t.db, won.owner)).toEqual(allowance);

    // The owners hear either way.
    const [wonNotice] = await notices(won.owner);
    expect(wonNotice.title).toBe(`🌹 ${won.character.name.split(" ")[0]} got a rose from ${LEAD_FIRST}`);
    expect(wonNotice.body).toContain("paid by the show");
    expect(wonNotice.link).toBe(`/episodes/${next}?play=1`);
    const [lostNotice] = await notices(lost.owner);
    expect(lostNotice.title).toBe(`🥀 No rose for ${lost.character.name.split(" ")[0]} this week`);
    expect(lostNotice.body).toContain("ended as friends");
    expect(await notices(quiet.owner)).toHaveLength(1);

    // The character's own text, only where its person opted in: the rose, or no rose with "Try someone new" under it.
    const wonTexts = await roseTexts(won.character.id);
    expect(wonTexts.map((m) => m.text)).toEqual(roseLines(LEAD_FIRST, true));
    expect(wonTexts[0].text).toBe("I got a rose.");
    expect(wonTexts[1].text).toBe(`${LEAD_FIRST} wants to see me again this week.`);
    expect(wonTexts[0].action).toBe(`rose:${NEXT}-${heldOn}`);
    expect(wonTexts[0].offers).toBeNull();
    const lostTexts = await roseTexts(lost.character.id);
    expect(lostTexts.map((m) => m.text)).toEqual(noRoseLines(LEAD_FIRST));
    expect(lostTexts.map((m) => m.text)).toEqual([`No rose. ${LEAD_FIRST} was kind about it.`, "I'm fine. Mostly."]);
    expect(lostTexts[0].offers).toMatchObject({ kinds: ["someone_new"], partner_id: LEAD, episode_id: lostDate.body.id });
    expect(await roseTexts(quiet.character.id)).toEqual([]);

    // Once: the next hourly pass that Sunday judges nobody, books nothing and tells nobody again.
    const again = await runWalkOnRoses(t.db, new Date(SUNDAY.getTime() + 20 * 60_000));
    expect(again).toMatchObject({ judged: 0, roses: 0, booked: 0, texted: 0 });
    expect(await roses()).toHaveLength(3);
    expect(await notices(won.owner)).toHaveLength(1);
    expect(await roseTexts(won.character.id)).toHaveLength(wonTexts.length);

    // The rose's date counts for the next Sunday: it ended as friends, so no second rose, and nothing new is booked.
    const nextSunday = new Date(SUNDAY.getTime() + 7 * DAY);
    const week2 = await runWalkOnRoses(t.db, nextSunday);
    expect(week2).toMatchObject({ judged: 1, roses: 0, booked: 0 });
    const second = (await roses()).find((r) => r.character_id === won.character.id && r.held_on === nextSunday.toISOString().slice(0, 10));
    expect(second).toMatchObject({ episode_id: next, rose: false, next_episode_id: null });

    // A rose never touched an ending: every date here ended as the engine said.
    const endings = (await t.db.query<{ id: string; ending: string }>(`select id, ending from episodes where id = any($1)`, [[wonDate.body.id, lostDate.body.id, quietDate.body.id, next]])).rows;
    expect(Object.fromEntries(endings.map((e) => [e.id, e.ending]))).toEqual({ [wonDate.body.id]: "second_date", [lostDate.body.id]: "friends", [quietDate.body.id]: "disaster", [next]: "friends" });
  });

  it("a rose skips that week's life date, and a rose whose booking failed is booked by the next pass", async () => {
    await preseason();
    const [won, lost] = [await newcomer(), await newcomer()];
    await walkOn(won, "second_date");
    await walkOn(lost, "friends");
    for (const w of [won, lost]) {
      await t.db.query(`insert into character_assets (id, character_id, kind, source_type, url, review_status, content_rating) values ($1, $2, 'portrait', 'drawn', '/api/assets/' || $1, 'approved', 'pg')`, [`portrait-${w.character.id}`, w.character.id]);
    }
    // The show is paused when the roses are handed out: the rose stands, its date waits.
    vi.stubEnv("BOTCHELOR_PAUSE", "1");
    const paused = await runWalkOnRoses(t.db, SUNDAY);
    expect(paused).toMatchObject({ judged: 2, roses: 1, booked: 0 });
    expect((await roses()).find((r) => r.character_id === won.character.id)).toMatchObject({ rose: true, next_episode_id: null });
    const [told] = await notices(won.owner);
    expect(told.body).toContain("coming this week");
    expect(told.link).toBe(`/characters/${won.character.id}`);
    // Still paused an hour later: nothing. Then on Monday, with the show back, the waiting date is booked (any pass does it).
    expect((await runWalkOnRoses(t.db, new Date(SUNDAY.getTime() + 20 * 60_000)))?.booked).toBe(0);
    vi.stubEnv("BOTCHELOR_PAUSE", "");
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const monday = new Date(SUNDAY.getTime() + 5 * 3600_000);
    expect(monday.getUTCDay()).toBe(1);
    expect(await runWalkOnRoses(t.db, monday)).toMatchObject({ held_on: null, judged: 0, booked: 1 });
    expect((await roses()).find((r) => r.character_id === won.character.id)?.next_episode_id).toBeTruthy();
    expect(await notices(won.owner)).toHaveLength(1);
    // Nothing waits any more: a weekday pass has nothing to do.
    expect(await runWalkOnRoses(t.db, new Date(monday.getTime() + 3600_000))).toBeNull();

    // Monday's life dates: the walk-on with no rose is due (it has had a date), the one with a rose is not (the rose's
    // second date is that week's outing).
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const life = await weeklyLifeDates(t.db, new Date(SUNDAY.getTime() + 6 * 3600_000));
    expect(life.candidates).toBe(1);
    const lifeDates = (await t.db.query<{ character_a: string }>(`select character_a from episodes where setup->>'met_via' = 'life'`)).rows;
    expect(lifeDates.map((d) => d.character_a)).toEqual([lost.character.id]);
  });

  it("books the rose's date by name when only the walk-on's side wanted more, and takes a second date the owner already booked", async () => {
    await preseason();
    const [oneSided, eager] = [await newcomer(), await newcomer()];
    // The ending is the engine's (a second date); the lead's own "see again" answer was no, so it can't be a planned second date.
    await datedLead("one-sided", oneSided.character.id, oneSided.owner, "second_date", new Date(NOW.getTime() - 3600_000), { leadWants: false });
    // This owner tapped "see them again" before Sunday: the second date exists already.
    await datedLead("eager-1", eager.character.id, eager.owner, "second_date", new Date(NOW.getTime() - 7200_000));
    await datedLead("eager-2", eager.character.id, eager.owner, "friends", new Date(NOW.getTime() - 3600_000), { casting: false });
    await t.db.query(`update episodes set followup_of = 'eager-1' where id = 'eager-2'`);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const run = await runWalkOnRoses(t.db, SUNDAY);
    expect(run).toMatchObject({ judged: 2, roses: 2, booked: 2 });
    const rows = await roses();
    const byName = rows.find((r) => r.character_id === oneSided.character.id)!.next_episode_id!;
    expect(await episodeRow(byName)).toMatchObject({ character_a: oneSided.character.id, character_b: LEAD, followup_of: null, format: "speed_date" });
    expect(rows.find((r) => r.character_id === eager.character.id)).toMatchObject({ episode_id: "eager-1", next_episode_id: "eager-2" });
    // And that already-finished second date is what next Sunday judges.
    const week2 = await runWalkOnRoses(t.db, new Date(SUNDAY.getTime() + 7 * DAY));
    expect((await roses()).find((r) => r.episode_id === "eager-2")).toMatchObject({ rose: false });
    expect(week2?.judged).toBeGreaterThanOrEqual(1);
  });

  it("holds nothing with casting off, without a lead format, or for the house's own suitors and dates", async () => {
    const w = await newcomer();
    await datedLead("d-1", w.character.id, w.owner, "second_date", new Date(NOW.getTime() - 3600_000));
    // No lead format anywhere: no pass.
    expect(await runWalkOnRoses(t.db, SUNDAY)).toBeNull();
    await preseason();
    expect(await runWalkOnRoses(t.db, SUNDAY, { OPEN_CASTING: "0" })).toBeNull();
    // A suitor on that season's cast is the ceremony's to judge, and a date that wasn't a casting date is nobody's rose.
    const suitor = await newcomer();
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 1, 'suitor')`, [NEXT, suitor.character.id]);
    await datedLead("d-suitor", suitor.character.id, suitor.owner, "second_date", new Date(NOW.getTime() - 3600_000));
    const other = await newcomer();
    await datedLead("d-life", other.character.id, other.owner, "second_date", new Date(NOW.getTime() - 3600_000), { casting: false });
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const run = await runWalkOnRoses(t.db, SUNDAY);
    expect(run).toMatchObject({ judged: 1, roses: 1 });
    expect((await roses()).map((r) => r.character_id)).toEqual([w.character.id]);
  });
});

describe("the finale: the people's rose", () => {
  /** A December walk-on with rows from earlier Sundays: [held_on day, ending] each, the first on `firstDay`. */
  async function veteran(weeks: [number, Ending][], firstDay: number) {
    const w = await newcomer();
    for (const [i, [day, ending]] of weeks.entries()) {
      const id = `${w.character.id}-w${day}`;
      await datedLead(id, w.character.id, w.owner, ending, dec(i === 0 ? firstDay : day - 2), { casting: i === 0 });
      await t.db.query(`insert into walk_on_roses (season_id, held_on, character_id, episode_id, rose, created_at) values ($1, $2, $3, $4, $5, $6)`, [DEC, `2026-12-${String(day).padStart(2, "0")}`, w.character.id, id, ending === "second_date", dec(day, 20).toISOString()]);
    }
    return w;
  }

  it("goes to the walk-on with the most roses (ties: the better record, then who walked on first), once, and the summary and the card name it", async () => {
    await decemberSeason();
    // Two roses each for three of them; one rose for the fourth.
    const early = await veteran([[6, "second_date"], [13, "second_date"], [20, "friends"]], 2);
    const sour = await veteran([[6, "second_date"], [13, "second_date"], [20, "disaster"]], 1);
    const late = await veteran([[6, "second_date"], [13, "second_date"], [20, "friends"]], 4);
    const once = await veteran([[13, "second_date"]], 9);
    await optIn(early.owner, early.character.id);

    // Not the finale: week 3's pass hands out no people's rose.
    expect((await runWalkOnRoses(t.db, dec(20, 23), {}))?.peoples_rose).toBeNull();
    const run = await runWalkOnRoses(t.db, dec(27, 23), {});
    // early and late tie on roses (2) and record (3 + 3 + 1); early walked on first. sour's record is worse.
    expect(run).toMatchObject({ season_id: DEC, held_on: "2026-12-27", phase: "season", peoples_rose: early.character.id });
    expect((await t.db.query(`select character_id, badge, week from suitor_badges where season_id = $1`, [DEC])).rows).toEqual([{ character_id: early.character.id, badge: "peoples_rose", week: 4 }]);
    const [notice] = await notices(early.owner);
    expect(notice.title).toBe(`🌹 ${early.character.name.split(" ")[0]} got the people's rose`);
    expect((await roseTexts(early.character.id)).map((m) => m.text)).toEqual(["The people's rose. That's me.", "Thank you for sending me in."]);
    for (const other of [sour, late, once]) expect(await notices(other.owner)).toHaveLength(0);
    // Once.
    expect((await runWalkOnRoses(t.db, new Date(Date.UTC(2026, 11, 27, 23, 50)), {}))?.peoples_rose).toBeNull();
    expect(await notices(early.owner)).toHaveLength(1);

    // The ceremony's summary and the card name it; the character page keeps the badge.
    const summary = await ceremonySummary(t.db, DEC);
    expect(summary.peoples_rose).toEqual({ id: early.character.id, name: early.character.name, roses: 2 });
    const board = await ceremonyBoard(t.db, null, dec(28));
    expect(board?.walk_ons).toEqual({ line: null, peoples_rose: { id: early.character.id, name: early.character.name, roses: 2 } });
    const card = renderToStaticMarkup(createElement(BotchelorCard, { board: board!, now: dec(28).getTime() }));
    expect(card).toContain("The people&#x27;s rose:");
    expect(card).toContain(early.character.name);
    expect(card).not.toContain("Walk-ons this week.");
    const badges = await castingBadgesOf(t.db, early.character.id);
    expect(badges.map((b) => b.label)).toEqual(["Season 3 people's rose", "Rose, week 2"]);
  });

  it("never goes to one of our own characters, a private one, or anyone without a rose", async () => {
    await decemberSeason();
    const ours = await veteran([[6, "second_date"], [13, "second_date"]], 2);
    await t.db.query(`update characters set name = 'Mira Quell' where id = $1`, [ours.character.id]);
    const hidden = await veteran([[6, "second_date"], [13, "second_date"]], 2);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [hidden.character.id]);
    const roseless = await veteran([[6, "friends"], [13, "friends"]], 2);
    expect((await runWalkOnRoses(t.db, dec(27, 23), {}))?.peoples_rose).toBeNull();
    expect((await ceremonySummary(t.db, DEC)).peoples_rose).toBeNull();
    expect(await notices(roseless.owner)).toHaveLength(0);
  });
});

describe("the surfaces", () => {
  it("the card's Walk-ons this week line shows the count under the empty-room rule", async () => {
    await decemberSeason();
    const mine = await newcomer();
    await datedLead("w-1", mine.character.id, mine.owner, "friends", dec(8));
    // A stranger sees no count of one; an owner does; our own characters never count.
    const stranger = await walkOnsLine(t.db, null, dec(9), {});
    expect(stranger).toEqual({ line: `Any new character's first date is with ${LEAD_FIRST}. Roses on Sunday.`, peoples_rose: null });
    const insider = await walkOnsLine(t.db, mine.owner, dec(9), {});
    expect(insider?.line).toBe(`1 character has walked on for a first date with ${LEAD_FIRST} since the last roses. Roses on Sunday.`);
    for (let i = 0; i < 4; i++) {
      const w = await newcomer();
      await datedLead(`w-more-${i}`, w.character.id, w.owner, "friends", dec(8));
    }
    const ours = await newcomer();
    await t.db.query(`update characters set name = 'Mira Quell' where id = $1`, [ours.character.id]);
    await datedLead("w-ours", ours.character.id, ours.owner, "friends", dec(8));
    expect((await walkOnsLine(t.db, null, dec(9), {}))?.line).toBe(`5 characters have walked on for a first date with ${LEAD_FIRST} since the last roses. Roses on Sunday.`);
    // Last week's walk-ons are last week's.
    expect((await walkOnsLine(t.db, null, dec(14), {}))?.line).toBe(`Any new character's first date is with ${LEAD_FIRST}. Roses on Sunday.`);
    expect(await walkOnsLine(t.db, null, dec(9), { OPEN_CASTING: "0" })).toBeNull();

    // On the card, with the way in.
    const board = await ceremonyBoard(t.db, mine.owner, dec(9));
    const card = renderToStaticMarkup(createElement(BotchelorCard, { board: board!, now: dec(9).getTime() }));
    expect(card).toContain("<strong>Walk-ons this week.</strong>");
    expect(card).toContain('href="/create"');
  });

  it("a walk-on's rose is a badge on its page: the week in season, a casting rose before it", async () => {
    expect(roseWeek(DEC, "2026-12-06")).toBe(1);
    expect(roseWeek(DEC, "2026-12-27")).toBe(4);
    expect(roseWeek(DEC, "2026-11-22")).toBeNull();
    const w = await newcomer();
    expect(await castingBadgesOf(t.db, w.character.id)).toEqual([]);
    await datedLead("r-1", w.character.id, w.owner, "second_date", nov(20));
    await t.db.query(`insert into walk_on_roses (season_id, held_on, character_id, episode_id, rose) values ($1, '2026-11-22', $2, 'r-1', true)`, [DEC, w.character.id]);
    expect(await castingBadgesOf(t.db, w.character.id)).toEqual([{ key: "rose", label: "Casting rose", title: `1 rose from ${LEAD_FIRST} as a walk-on on Season 3's Botchelor, before the season started` }]);
    await datedLead("r-2", w.character.id, w.owner, "second_date", dec(10), { casting: false });
    await t.db.query(`insert into walk_on_roses (season_id, held_on, character_id, episode_id, rose) values ($1, '2026-12-13', $2, 'r-2', true)`, [DEC, w.character.id]);
    expect((await castingBadgesOf(t.db, w.character.id))[0]).toMatchObject({ label: "Rose, week 2", title: `2 roses from ${LEAD_FIRST} as a walk-on on Season 3's Botchelor` });
    // No rose is no badge.
    const none = await newcomer();
    await datedLead("r-3", none.character.id, none.owner, "friends", dec(10));
    await t.db.query(`insert into walk_on_roses (season_id, held_on, character_id, episode_id, rose) values ($1, '2026-12-13', $2, 'r-3', false)`, [DEC, none.character.id]);
    expect(await castingBadgesOf(t.db, none.character.id)).toEqual([]);
  });

  it("the verdict card's line is the owner's, on a casting date nobody has judged yet", async () => {
    await preseason();
    const w = await newcomer();
    const date = await walkOn(w, "friends");
    const first = w.character.name.split(" ")[0];
    expect(await castingNote(t.db, date.body.id, w.owner)).toEqual({ first, lead: LEAD_FIRST, hour: 23, minute: 20 });
    expect(await castingNote(t.db, date.body.id, "someone-else")).toBeNull();
    expect(await castingNote(t.db, date.body.id, null)).toBeNull();
    expect(await castingNote(t.db, date.body.id, w.owner, { OPEN_CASTING: "0" })).toBeNull();
    const get = async (cookie?: string) => (await (await castingGet(new Request(`${BASE_URL}/api/casting/walk-on?episode=${date.body.id}`, { headers: cookie ? { cookie } : {} }))).json()) as { note: unknown };
    expect((await get(w.cookie)).note).toEqual({ first, lead: LEAD_FIRST, hour: 23, minute: 20 });
    expect((await get()).note).toBeNull();
    // Who the first date goes to, for anyone.
    const open = (await (await castingGet(new Request(`${BASE_URL}/api/casting/walk-on`))).json()) as { casting: { phase: string; lead: { id: string } } | null };
    expect(open.casting).toMatchObject({ phase: "preseason", lead: { id: LEAD } });
    // Judged: the line has done its job.
    await runWalkOnRoses(t.db, SUNDAY);
    expect(await castingNote(t.db, date.body.id, w.owner)).toBeNull();
    // Any other date has no line.
    const plain = await newcomer();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const usual = (await (await api.createEpisode({ character_id: plain.character.id, partner_id: CAST[0] }, plain.cookie)).json()) as { id: string };
    expect(await castingNote(t.db, usual.id, plain.owner)).toBeNull();
  });

  it("the builder's instant card names the lead and sends a blind date when casting is on, and reads as before when it isn't", async () => {
    const { SendPhase } = await import("@/app/create/CreateWizard");
    const partners = [
      { id: "house-juniper", name: "Juniper Vale", age: 29, bio: "b", traits: ["warm"], archetype: "The Romantic" },
      { id: "house-nell", name: "Nell Abiodun", age: 33, bio: "b", traits: ["dry"], archetype: "The Skeptic" },
    ];
    const props = {
      character: { id: "c-new", name: "Leopold Sol" },
      partners,
      openCharacters: [],
      swipeGate: true,
      tokens: { free_left: 3, free_per_season: 3, pack_left: 0, left: 3 },
      offer: null,
      autonomy: "balanced" as never,
      busy: null,
      setBusy() {},
      error: null,
      setError() {},
      outOfTokens: false,
      setOutOfTokens() {},
      onSend() {},
      returnTo: null,
      buildNext: null,
      signedIn: false,
      firstCharacter: true,
    };
    const casting: CastingForClient = { phase: "preseason", billing: "December's Botchelor", lead: { id: LEAD, name: LEAD_NAME, hue: 200, portrait: null }, hour: 23, minute: 20 };
    const card = (value: CastingForClient | null, extra: Record<string, unknown> = {}) => {
      const html = renderToStaticMarkup(createElement(CastingProvider, { value, children: createElement(SendPhase, { ...props, ...extra }) }));
      return html.slice(html.indexOf("data-first-date"), html.indexOf("send-more-ways"));
    };
    const on = card(casting);
    expect(on).toContain(`First date: ${LEAD_FIRST}, December&#x27;s Botchelor. Roses on Sunday.`);
    expect(on).toContain(`Leopold walks on for a date with ${LEAD_FIRST}, for a speed date: 6 lines`);
    expect(on).toContain(`On Sunday at 23:20 UTC ${LEAD_FIRST} hands out roses, and you hear whether Leopold got one.`);
    expect(on).toContain("▶ Start the date now");
    expect(on).not.toContain("meets Nell");
    expect(card({ ...casting, phase: "season", billing: "this season's Botchelor" })).toContain(`First date: ${LEAD_FIRST}, this season&#x27;s Botchelor. Roses on Sunday.`);
    // Casting closed: the card as it was.
    const off = card(null);
    expect(off).toContain("Leopold&#x27;s first date can start right now");
    expect(off).toContain("meets Nell");
    expect(off).not.toContain("Roses on Sunday");
    // A post's link named a cast member (?meet=): that date stays theirs.
    const meet = card(casting, { meet: "house-juniper" });
    expect(meet).toContain("meets Juniper");
    expect(meet).not.toContain("Roses on Sunday");
  });

  it("the home hero tells a stranger who the first date is with while casting is open, and an owner what it always did", async () => {
    await preseason();
    const Home = (await import("@/app/page")).default;
    const month = new Date(`${NEXT}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    const stranger = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(stranger).toContain(`Their first date is with ${LEAD_FIRST}, ${month}&#x27;s Botchelor: nobody steers it, roses are handed out on Sunday, and they text you whether they got one. Make one in a minute`);
    expect(stranger).not.toContain("They go on blind dates nobody steers");
    // Someone with a character of their own: the hero as it was.
    const me = await newcomer();
    jar.cookies.set(me.cookie.split("=")[0], me.cookie.split("=")[1]);
    const owner = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(owner).toContain("They go on blind dates nobody steers, text you how it went, and take your advice into the next one.");
    expect(owner).not.toContain("Their first date is with");
    // Switched off: a stranger's hero is the old one too.
    jar.cookies.clear();
    vi.stubEnv("OPEN_CASTING", "0");
    expect(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))).toContain("They go on blind dates nobody steers");
  });

  it("\"Try someone new\" after no rose offers a suitor once the lead is the only house character met", async () => {
    const w = await newcomer();
    await datedLead("only", w.character.id, w.owner, "friends", new Date(NOW.getTime() - 3600_000));
    const suitor = await newcomer();
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [suitor.character.id]);
    // A Botchelor season as loaded: the house side is the lead alone, the suitors are the fan side.
    setSeasonCastForTests([LEAD], [suitor.character.id], LEAD);
    expect(await pickSomeoneNew(t.db, w.character.id)).toMatchObject({ id: suitor.character.id });
    // Never the person's own character, and nobody once every suitor is met too.
    expect(await pickSomeoneNew(t.db, suitor.character.id)).toMatchObject({ id: LEAD });
    await t.db.query(`update characters set owner_id = $2 where id = $1`, [suitor.character.id, w.owner]);
    expect(await pickSomeoneNew(t.db, w.character.id)).toBeNull();
  });
});

describe("the schema", () => {
  it("applies again over a Botchelor season's cast and badges (a narrower check would stop the boot)", async () => {
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [DEC, LEAD]);
    const w = await newcomer();
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 1, 'suitor')`, [DEC, w.character.id]);
    await t.db.query(`insert into suitor_badges (season_id, character_id, badge, week) values ($1, $2, 'peoples_rose', 4)`, [DEC, w.character.id]);
    await expect(ensureSchema(t.db)).resolves.toBeUndefined();
    expect((await t.db.query(`select 1 from season_casts where season_id = $1`, [DEC])).rows).toHaveLength(2);
  });
});
