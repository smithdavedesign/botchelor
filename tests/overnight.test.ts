// Overnight dates (lib/overnight-shared.ts, lib/overnight.ts, lib/overnight-house.ts, lib/adult/overnight.ts; David,
// 2026-11-15): the milestone from aired dates only, who books it and whose yes it takes, the ending told both ways with
// the engine untouched, who sees "Continue the night in After Dark", what the night is seeded with, and the one fixed
// fact that comes back. No paid calls: scripted models throughout.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OvernightNightPage from "@/app/after-dark/overnight/[id]/page";
import OvernightMarks from "@/app/characters/[id]/OvernightMarks";
import Overnight from "@/app/couples/[a]/[b]/Overnight";
import { POST as startNight } from "@/app/api/admin/after-dark/overnight/route";
import { POST as companionPost } from "@/app/api/companion/[id]/route";
import { POST as postSecondDate } from "@/app/api/episodes/[id]/second-date/route";
import { GET as getOvernight, POST as postOvernight } from "@/app/api/overnight/route";
import { exportAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { continueShows, NIGHT_LEFT_HOURS, overnightNight, overnightSeed, startOvernightNight, tellShowNightsOver, viewerContinue, type ContinueFacts } from "@/lib/adult/overnight";
import { sceneMemories } from "@/lib/adult/scenes";
import { sendAfterDateText } from "@/lib/after-date-text";
import { airEpisode } from "@/lib/air";
import { signSession } from "@/lib/auth";
import { loadCharacter } from "@/lib/character";
import { openThread, setCompanionModelForTests } from "@/lib/companion";
import { offersFor } from "@/lib/companion-offers";
import { offerLabel } from "@/lib/companion-shared";
import type { SideOutcome } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { isOvernight, loadOvernight, nightTogetherFact, overnightAired, overnightMarks, overnightOffer, recordNightTogether } from "@/lib/overnight";
import { bookHouseOvernight } from "@/lib/overnight-house";
import {
  leftTogether,
  OVERNIGHT_COPY,
  OVERNIGHT_RULES,
  OVERNIGHT_VENUES,
  overnightAfterDarkOn,
  overnightClose,
  overnightDatesOn,
  overnightEndingLabel,
  overnightMilestone,
  overnightOfferLine,
  overnightTextLines,
  nightTogetherMemory,
  pickOvernightVenue,
  type AiredDate,
  type MilestoneInput,
} from "@/lib/overnight-shared";
import { setPlaceForTests } from "@/lib/place";
import { pairKey, refreshRelationship } from "@/lib/relationships";
import { ENDING_LABELS, type Ending } from "@/lib/rules";
import { checkFields } from "@/lib/safety";
import { remembered } from "@/lib/memory";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { assembleDate, buildDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
import { showSince } from "@/lib/show-since";
import { DATE_VENUES, venuePhrase } from "@/lib/venues";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const source = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const yes = { a: "yes", b: "yes" } as const;
const aired = (id: string, ending: Ending, see: { a: "yes" | "maybe" | "no" | null; b: "yes" | "maybe" | "no" | null } = yes): AiredDate => ({ id, ending, see_again: see });
const EARNED: MilestoneInput = {
  aired: [aired("d1", "friends"), aired("d2", "second_date"), aired("d3", "second_date")],
  badBlood: false,
  hadOneThisSeason: false,
  nextDateUnderWay: false,
};

describe("the milestone (pure): from aired dates only", () => {
  it("three aired dates, the last two ending in another date, both saying yes: earned, as the follow-up of the latest", () => {
    expect(overnightMilestone(EARNED)).toEqual({ ok: true, after: "d3" });
    expect(OVERNIGHT_RULES).toMatchObject({ minAiredDates: 3, secondDatesInARow: 2, housePerDay: 1 });
  });

  it("each rule on its own turns it down, and says which", () => {
    const why = (change: Partial<MilestoneInput>) => {
      const m = overnightMilestone({ ...EARNED, ...change });
      return m.ok ? "ok" : m.why;
    };
    // Two aired dates aren't three, however they ended.
    expect(why({ aired: [aired("d1", "second_date"), aired("d2", "second_date")] })).toBe("few_dates");
    // The last two, in a row: a friendly date second to last, or last, breaks it.
    expect(why({ aired: [aired("d1", "second_date"), aired("d2", "friends"), aired("d3", "second_date")] })).toBe("not_in_a_row");
    expect(why({ aired: [aired("d1", "second_date"), aired("d2", "second_date"), aired("d3", "friends")] })).toBe("not_in_a_row");
    expect(why({ aired: [aired("d1", "second_date"), aired("d2", "second_date"), aired("d3", "disaster")] })).toBe("not_in_a_row");
    // Mutual: both sides' LATEST answer is a yes. A maybe, a no or an answer never asked isn't.
    for (const see of [{ a: "yes", b: "maybe" }, { a: "no", b: "yes" }, { a: "yes", b: null }, { a: null, b: null }] as const) {
      expect(why({ aired: [...EARNED.aired.slice(0, 2), aired("d3", "second_date", see)] }), JSON.stringify(see)).toBe("not_mutual");
    }
    // An earlier date's maybe doesn't count against them: only the latest answers do.
    expect(why({ aired: [aired("d1", "friends", { a: "no", b: "maybe" }), aired("d2", "second_date", { a: "maybe", b: "yes" }), aired("d3", "second_date")] })).toBe("ok");
    expect(why({ badBlood: true })).toBe("bad_blood");
    expect(why({ hadOneThisSeason: true })).toBe("had_one");
    expect(why({ nextDateUnderWay: true })).toBe("next_date_under_way");
  });

  it("the switches: on unless set to 0", () => {
    expect(overnightDatesOn({})).toBe(true);
    expect(overnightDatesOn({ OVERNIGHT_DATES: "1" })).toBe(true);
    expect(overnightDatesOn({ OVERNIGHT_DATES: " 0 " })).toBe(false);
    expect(overnightAfterDarkOn({})).toBe(true);
    expect(overnightAfterDarkOn({ OVERNIGHT_AFTER_DARK: "0" })).toBe(false);
  });

  it("the place is one of the library's evening venues, the same for a pair all season", () => {
    const ids = new Set<string>(DATE_VENUES.map((v) => v.id));
    for (const v of OVERNIGHT_VENUES) expect(ids.has(v), v).toBe(true);
    expect(pickOvernightVenue("a", "b", "2026-11-01")).toBe(pickOvernightVenue("a", "b", "2026-11-01"));
    expect(OVERNIGHT_VENUES).toContain(pickOvernightVenue("a", "b", "2026-12-01"));
    // Every one reads as a place in a sentence ("after the date at …").
    for (const v of OVERNIGHT_VENUES) expect(venuePhrase(v)).toMatch(/^(a|an|the) /);
  });
});

describe("the ending, told both ways (templates; the engine's ending is never changed)", () => {
  it("another date is told as leaving together; any other ending as it is, and the night is called", () => {
    expect(leftTogether("second_date")).toBe(true);
    expect(leftTogether("friends")).toBe(false);
    expect(overnightClose("second_date")).toBe("They left together. The cameras stayed behind.");
    expect(overnightClose("friends")).toBe("They called it a night.");
    expect(overnightClose("disaster")).toBe("They called it a night.");
    expect(overnightEndingLabel("second_date", "A fourth date")).toBe("They left together. The cameras stayed behind.");
    expect(overnightEndingLabel("friends", ENDING_LABELS.friends)).toBe(`${ENDING_LABELS.friends}. They called it a night.`);
    expect(overnightEndingLabel("disaster", ENDING_LABELS.disaster)).toBe(`${ENDING_LABELS.disaster}. They called it a night.`);
  });

  it("every line the show says about one passes the show's own content check, and none is suggestive", () => {
    const lines = [
      ...Object.values(OVERNIGHT_COPY),
      ...overnightTextLines("Nell Okafor"),
      overnightOfferLine("Nell Okafor"),
      nightTogetherMemory("the pier at night"),
      nightTogetherMemory(null),
      offerLabel("overnight", { partner: "Nell Okafor", character: "Cass Vega" }),
    ];
    for (const line of lines) {
      expect(checkFields({ line }).ok, line).toBe(true);
      if (line !== OVERNIGHT_COPY.continueButton) expect(line, line).not.toMatch(/after dark/i);
      expect(line, line).not.toMatch(/sex|nsfw|nude|naked|explicit|steam|xxx|porn|erotic|kink|lust|\bbed\b|strip|kiss|undress|seduc/i);
    }
    expect(nightTogetherMemory("the pier at night")).toBe("You spent the night together after the date at the pier at night.");
    expect(OVERNIGHT_COPY.nightTogether).toBe("They spent the night together.");
  });

  it("the page tells it from the templates: the theater's last card, the recap's close, the live stage, and a chip", () => {
    const page = source("app/episodes/[id]/page.tsx");
    expect(page).toContain("const endingTold = overnight ? overnightEndingLabel(episode.ending, endingUsual) : endingUsual;");
    expect(page).toContain("endingLabel={endingTold}");
    expect(page).toContain("{overnightClose(episode.ending)}");
    expect(page).toContain("overnight ? OVERNIGHT_COPY.chip : null,");
    expect(source("app/episodes/[id]/GeneratingPoller.tsx")).toContain("const label = final && stage.overnight ? overnightEndingLabel(final, usual) : usual;");
  });
});

/* ------------------------------------------------------ with a database ------------------------------------------------------ */

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const [H0, H1, H2] = HOUSE_CHARACTERS;
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  setSeasonCastForTests([H0.id, H1.id, H2.id]);
  setPlaceForTests({ country: "CA", region: "ON" });
  setCompanionModelForTests({
    async complete(messages) {
      if (String(messages[0]?.content ?? "").startsWith("You check one message")) return '{"risk": false}';
      throw new Error("the model must not be called for an overnight text");
    },
  });
  // After Dark's own model, for the note a filed night leaves (lib/adult/memory.ts): never a live call.
  setAdultModelForTests({ complete: async () => "{}" });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setPlaceForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const DAY = 24 * 60 * 60 * 1000;
let columns: string[] | null = null;
/** A copy of a stored date with some columns changed: a pair's history without spending a week of free dates on it. */
async function cloneDate(fromId: string, change: Record<string, unknown>): Promise<string> {
  columns ??= (await t.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'episodes' order by ordinal_position`)).rows.map((r) => r.column_name);
  const id = randomUUID();
  const over: Record<string, unknown> = { id, followup_of: null, ...change };
  const keys = Object.keys(over);
  const select = columns.map((c) => (keys.includes(c) ? `$${keys.indexOf(c) + 2}${c.endsWith("_at") || c === "air_after" ? "::timestamptz" : ""}` : c));
  await t.db.query(`insert into episodes (${columns.join(", ")}) select ${select.join(", ")} from episodes where id = $1`, [fromId, ...keys.map((k) => over[k])]);
  return id;
}
const choices = (a: string | null, b: string | null) =>
  JSON.stringify({ v: 1, lines: [], choices: { a: a ? { see_again: a, reason: "It went well." } : null, b: b ? { see_again: b, reason: "It did." } : null } });
/** Sets one date's facts: when it was, whether it aired, how it ended, and what each said after. */
async function setDate(id: string, o: { daysAgo: number; ending?: Ending; aired?: boolean; see?: [string | null, string | null]; visibility?: string }) {
  const at = new Date(Date.now() - o.daysAgo * DAY);
  await t.db.query(
    `update episodes set created_at = $2, revealed_at = $3, ending = coalesce($4, ending), inner_life = $5::jsonb, visibility = coalesce($6, visibility), sides = $7::jsonb where id = $1`,
    [id, at.toISOString(), o.aired === false ? null : new Date(at.getTime() + 600_000).toISOString(), o.ending ?? null, choices(...(o.see ?? ["yes", "yes"])), o.visibility ?? null, JSON.stringify([side(true), side(true)])],
  );
}

type Couple = { creator: string; me: string; mine: string; theirs: string; dates: string[] };

/** A person's character and a partner with a history of aired public dates (oldest first), all mutual unless said. */
async function couple(endings: Ending[], partnerId: string = HOUSE_PARTNER_ID): Promise<Couple> {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), creator)).json();
  scriptOutcome({ ending: endings[0], sides: [side(true), side(true)] });
  scriptedModel([episodeJson()]);
  const first = await (await api.createEpisode({ character_id: character.id, partner_id: partnerId }, creator)).json();
  const dates = [first.id as string];
  for (let i = 1; i < endings.length; i++) dates.push(await cloneDate(first.id, {}));
  for (const [i, id] of dates.entries()) await setDate(id, { daysAgo: (endings.length - i) * 2, ending: endings[i] });
  await refreshRelationship(t.db, character.id, partnerId);
  return { creator, me: userIdOf(creator), mine: character.id, theirs: partnerId, dates };
}
const EARNING: Ending[] = ["friends", "second_date", "second_date"];

const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const book = async (c: { creator: string; mine: string; theirs: string }, ending: Ending = "second_date") => {
  scriptOutcome({ ending, sides: [side(ending === "second_date"), side(ending === "second_date")] });
  const model = scriptedModel([episodeJson()]);
  const res = await post(postOvernight, "/api/overnight", { character_id: c.mine, partner_id: c.theirs }, c.creator);
  return { status: res.status, body: (await res.json()) as Any, calls: model.calls };
};
const episode = async (id: string) =>
  (await t.db.query<Any>(`select id, ending, status, visibility, followup_of, setup, creator_id, character_a, character_b, revealed_at from episodes where id = $1`, [id])).rows[0];
const events = async (kind: string) =>
  (await t.db.query<Any>(`select character_a, character_b, layer, kind, from_stage, to_stage, episode_id, at from relationship_events where kind = $1 order by id`, [kind])).rows;
const milestoneOf = async (c: { mine: string; theirs: string }) => (await loadOvernight(t.db, c.mine, c.theirs))!.milestone;

describe("the milestone, read from the database: aired, public dates only", () => {
  it("earned after three aired dates with the last two ending in another date and both saying yes", async () => {
    const c = await couple(EARNING);
    expect(await milestoneOf(c)).toEqual({ ok: true, after: c.dates[2] });
    const pair = (await loadOvernight(t.db, c.theirs, c.mine))!;
    expect(OVERNIGHT_VENUES).toContain(pair.venue);
    expect([pair.lo.id, pair.hi.id]).toEqual(pairKey(c.mine, c.theirs));
  });

  it("an unaired date never counts toward it, and holds the offer back while it waits to air", async () => {
    const c = await couple(EARNING);
    // The third date hasn't aired: two aired dates, and their next date is under way.
    await setDate(c.dates[2], { daysAgo: 1, ending: "second_date", aired: false });
    expect(await milestoneOf(c)).toMatchObject({ ok: false });
    // Aired, it counts.
    await setDate(c.dates[2], { daysAgo: 1, ending: "second_date" });
    expect(await milestoneOf(c)).toMatchObject({ ok: true });
    // A fourth date that would end it well, unaired: the milestone doesn't read its ending (no spoiler), it only waits.
    const fourth = await cloneDate(c.dates[0], {});
    await setDate(fourth, { daysAgo: 0, ending: "disaster", aired: false });
    expect(await milestoneOf(c)).toEqual({ ok: false, why: "next_date_under_way" });
  });

  it("a private or unlisted date is not on the public record, and a private one after it changes nothing", async () => {
    const c = await couple(EARNING);
    await setDate(c.dates[1], { daysAgo: 4, ending: "second_date", visibility: "unlisted" });
    expect(await milestoneOf(c)).toEqual({ ok: false, why: "few_dates" });
    await setDate(c.dates[1], { daysAgo: 4, ending: "second_date", visibility: "public" });
    const offline = await cloneDate(c.dates[0], {});
    await setDate(offline, { daysAgo: 0, ending: "disaster", aired: false, visibility: "private" });
    expect(await milestoneOf(c)).toEqual({ ok: true, after: c.dates[2] });
  });

  it("mutual: the latest aired date's own answers; a maybe turns it down", async () => {
    const c = await couple(EARNING);
    await setDate(c.dates[2], { daysAgo: 2, ending: "second_date", see: ["yes", "maybe"] });
    expect(await milestoneOf(c)).toEqual({ ok: false, why: "not_mutual" });
    await setDate(c.dates[2], { daysAgo: 2, ending: "second_date", see: [null, null] });
    expect(await milestoneOf(c)).toEqual({ ok: false, why: "not_mutual" });
  });

  it("bad blood: a block between the two owners, whatever the dates say", async () => {
    const host = newUserCookie();
    const partner = newUserCookie();
    const theirs = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [theirs.id]);
    const c = await coupleOf(host, theirs.id);
    expect(await milestoneOf(c)).toMatchObject({ ok: true });
    await t.db.query(`insert into blocks (blocker_id, blocked_id, via_episode_id) values ($1, $2, $3)`, [userIdOf(partner), c.me, c.dates[0]]);
    expect(await milestoneOf(c)).toEqual({ ok: false, why: "bad_blood" });
  });

  it("once a season: an overnight date with each other this season, however it ended, and not last season's", async () => {
    const c = await couple(EARNING);
    const had = await cloneDate(c.dates[0], {});
    await setDate(had, { daysAgo: 6, ending: "friends" });
    await t.db.query(`update episodes set setup = setup || '{"overnight": true}'::jsonb, created_at = date_trunc('month', now()) + interval '1 minute' where id = $1`, [had]);
    await t.db.query(`update episodes set revealed_at = created_at + interval '5 minutes' where id = $1`, [had]);
    // The dates after it still earn the milestone's other rules; only "had one" stands in the way.
    for (const [i, id] of c.dates.entries()) await t.db.query(`update episodes set created_at = now() - make_interval(mins => $2), revealed_at = now() - make_interval(mins => $2) where id = $1`, [id, 30 - i * 5]);
    expect(await milestoneOf(c)).toEqual({ ok: false, why: "had_one" });
    await t.db.query(`update episodes set created_at = date_trunc('month', now()) - interval '3 days', revealed_at = date_trunc('month', now()) - interval '3 days' where id = $1`, [had]);
    expect(await milestoneOf(c)).toMatchObject({ ok: true });
  });
});

/** A host's character with a history against a given partner (another owner's, opened to dates so the first date books). */
async function coupleOf(host: string, partnerId: string): Promise<Couple> {
  const character = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), host)).json();
  scriptOutcome({ ending: "friends", sides: [side(true), side(true)] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: character.id, partner_id: partnerId }, host);
  if (res.status !== 200) throw new Error(`first date failed: ${res.status} ${JSON.stringify(await res.json())}`);
  const first = await res.json();
  const dates = [first.id as string, await cloneDate(first.id, {}), await cloneDate(first.id, {})];
  for (const [i, id] of dates.entries()) await setDate(id, { daysAgo: (3 - i) * 2, ending: EARNING[i] });
  await refreshRelationship(t.db, character.id, partnerId);
  return { creator: host, me: userIdOf(host), mine: character.id, theirs: partnerId, dates };
}

describe("booking and consent: a person's character with a house character", () => {
  it("the offer is the owner's; the house says yes at once; it's the latest date's follow-up at an evening place, and costs a date", async () => {
    const c = await couple(EARNING);
    const offer = (await overnightOffer(t.db, c.me, c.mine, c.theirs))!;
    expect(offer).toMatchObject({ after_episode_id: c.dates[2], mine: { id: c.mine }, them: { id: c.theirs, house: true }, needs_their_yes: false, you_asked: false, they_asked: false });
    expect((await getOvernight(new Request(`${BASE_URL}/api/overnight?character_id=${c.mine}&partner_id=${c.theirs}`, { headers: { cookie: c.creator } }))).status).toBe(200);
    // Nobody else is offered it: a stranger, or nobody at all.
    expect(await overnightOffer(t.db, userIdOf(newUserCookie()), c.mine, c.theirs)).toBeNull();
    expect(await overnightOffer(t.db, null, c.mine, c.theirs)).toBeNull();
    expect((await getOvernight(new Request(`${BASE_URL}/api/overnight?character_id=${c.mine}&partner_id=${c.theirs}`, { headers: { cookie: newUserCookie() } }))).status).toBe(404);

    const before = (await (await api.me(c.creator)).json()) as Any;
    const booked = await book(c);
    expect(booked.status).toBe(200);
    expect(booked.body.overnight).toBe(true);
    const e = await episode(booked.body.id);
    expect(e.followup_of).toBe(c.dates[2]);
    expect(e.setup.overnight).toBe(true);
    expect(e.setup.venue).toBe(offer.venue);
    expect(OVERNIGHT_VENUES).toContain(e.setup.venue);
    expect(e.setup.met_via).toBe("second_date");
    expect(e.visibility).toBe("public");
    expect([e.character_a, e.character_b]).toEqual([c.mine, c.theirs]);
    expect(await isOvernight(t.db, e.id)).toBe(true);
    expect(await isOvernight(t.db, c.dates[2])).toBe(false);
    const after = (await (await api.me(c.creator)).json()) as Any;
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before)); // a date was spent, like any second date
    // One a season, and one follow-up a date: there's nothing more on offer.
    expect(await overnightOffer(t.db, c.me, c.mine, c.theirs)).toBeNull();
    expect((await book(c)).status).toBe(409);
  });

  it("no prompt is told it's an overnight: the date is written from the same prompts as any second date", async () => {
    const c = await couple(EARNING);
    const booked = await book(c);
    expect(booked.status).toBe(200);
    expect(booked.calls.length).toBeGreaterThan(0);
    const said = JSON.stringify(booked.calls);
    expect(said).not.toMatch(/overnight|left together|cameras stayed|spent the night/i);
  });

  it("not earned, somebody else's character, or the switch off: nothing is booked", async () => {
    const c = await couple(["friends", "second_date"]);
    expect((await book(c)).status).toBe(409);
    const d = await couple(EARNING);
    // Someone who owns neither character.
    expect((await post(postOvernight, "/api/overnight", { character_id: d.mine, partner_id: d.theirs }, newUserCookie())).status).toBe(409);
    vi.stubEnv("OVERNIGHT_DATES", "0");
    expect(await overnightOffer(t.db, d.me, d.mine, d.theirs)).toBeNull();
    expect((await post(postOvernight, "/api/overnight", { character_id: d.mine, partner_id: d.theirs }, d.creator)).status).toBe(404);
    expect((await t.db.query(`select 1 from episodes where setup->>'overnight' = 'true'`)).rows).toHaveLength(0);
  });
});

/** Two people, a character each, with a history that has earned an overnight date. */
async function twoOwners() {
  const host = newUserCookie();
  const partner = newUserCookie();
  const theirs = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
  await t.db.query(`update characters set open_to_dates = true where id = $1`, [theirs.id]);
  const c = await coupleOf(host, theirs.id);
  return { ...c, partner, partnerId: userIdOf(partner) };
}

describe("booking and consent: two people's characters", () => {
  const notices = async (userId: string) => (await t.db.query<Any>(`select kind, title, body, link from notifications where user_id = $1 order by created_at`, [userId])).rows;

  it("the other owner has to say yes to an overnight themselves: the first yes waits and tells them, theirs books it", async () => {
    const c = await twoOwners();
    const offer = (await overnightOffer(t.db, c.me, c.mine, c.theirs))!;
    expect(offer).toMatchObject({ needs_their_yes: true, you_asked: false, they_asked: false });

    const first = await book(c);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: "waiting" });
    expect((await t.db.query(`select 1 from episodes where setup->>'overnight' = 'true'`)).rows).toHaveLength(0);
    const told = (await notices(c.partnerId)).filter((n) => /overnight date/.test(n.title));
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: "second_date_yes" });
    expect(told[0].link).toBe(`/couples/${pairKey(c.mine, c.theirs).join("/")}#overnight`);
    // Saying yes again tells them nothing new.
    expect((await book(c)).status).toBe(202);
    expect((await notices(c.partnerId)).filter((n) => /overnight date/.test(n.title))).toHaveLength(1);
    expect(await overnightOffer(t.db, c.me, c.mine, c.theirs)).toMatchObject({ you_asked: true, they_asked: false });

    // The other owner sees the same offer from their side, with the first yes in.
    expect(await overnightOffer(t.db, c.partnerId, c.theirs, c.mine)).toMatchObject({ mine: { id: c.theirs }, them: { id: c.mine }, needs_their_yes: true, you_asked: false, they_asked: true });
    const booked = await book({ creator: c.partner, mine: c.theirs, theirs: c.mine });
    expect(booked.status).toBe(200);
    const e = await episode(booked.body.id);
    expect(e.setup.overnight).toBe(true);
    expect(e.followup_of).toBe(c.dates[2]);
    expect(e.creator_id).toBe(c.partnerId); // whoever completes it books it, on their dates
  });

  it("a plain second-date yes from the other owner is never read as a yes to an overnight", async () => {
    const c = await twoOwners();
    // The other owner said yes to an ordinary second date.
    const plain = await postSecondDate(
      new Request(`${BASE_URL}/api/episodes/${c.dates[2]}/second-date`, { method: "POST", headers: { cookie: c.partner, "content-type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ id: c.dates[2] }) },
    );
    expect(plain.status).toBe(202);
    expect(await overnightOffer(t.db, c.me, c.mine, c.theirs)).toMatchObject({ needs_their_yes: true, they_asked: false });
    // This owner's overnight yes waits for theirs: nothing is booked on the strength of the plain one.
    expect((await book(c)).status).toBe(202);
    expect((await t.db.query(`select 1 from episodes where followup_of = $1`, [c.dates[2]])).rows).toHaveLength(0);
    expect((await exportAccount(t.db, c.me)).second_date_yeses).toEqual([expect.objectContaining({ episode_id: c.dates[2], overnight: true })]);
  });
});

describe("booking: two house characters (the lobby job)", () => {
  /** A house couple's aired history, copied from a person's date so no model writes it. */
  async function houseCouple(endings: Ending[] = EARNING) {
    const seedDate = (await couple(["friends"])).dates[0];
    const dates: string[] = [];
    for (const [i, ending] of endings.entries()) {
      const id = await cloneDate(seedDate, { character_a: H1.id, character_b: H2.id, creator_id: "system" });
      await setDate(id, { daysAgo: (endings.length - i) * 2, ending });
      dates.push(id);
    }
    await refreshRelationship(t.db, H1.id, H2.id);
    return dates;
  }

  it("the house books the couple's overnight as a house room at their evening place, once a day show-wide", async () => {
    const dates = await houseCouple();
    expect(await milestoneOf({ mine: H1.id, theirs: H2.id })).toEqual({ ok: true, after: dates[2] });
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    const run = await bookHouseOvernight(t.db);
    expect(run.room).toBeTruthy();
    const e = await episode(run.episode_id!);
    expect(e.setup.overnight).toBe(true);
    expect(e.setup.venue).toBe((await loadOvernight(t.db, H1.id, H2.id))!.venue);
    expect(e.creator_id).toBe("system");
    expect([e.character_a, e.character_b].sort()).toEqual([H1.id, H2.id].sort());
    expect((await t.db.query(`select 1 from watch_parties where id = $1 and kind = 'template' and starts_at is null`, [run.room])).rows).toHaveLength(1);
    // The day's one is booked: a second pass books nothing, whoever else has earned one.
    expect(await bookHouseOvernight(t.db)).toMatchObject({ room: null, reason: "daily_limit" });
  });

  it("nothing for a couple that hasn't earned it, with the switch off, or while generation is paused", async () => {
    await houseCouple(["second_date", "friends", "second_date"]);
    expect(await bookHouseOvernight(t.db)).toMatchObject({ room: null, reason: "nobody_due" });
    await t.reset();
    await houseCouple();
    expect(await bookHouseOvernight(t.db, new Date(), { ...process.env, OVERNIGHT_DATES: "0" })).toMatchObject({ room: null, reason: "off" });
    expect(await bookHouseOvernight(t.db, new Date(), { ...process.env, GENERATION_PAUSED: "1" })).toMatchObject({ room: null });
    expect((await t.db.query(`select 1 from episodes where setup->>'overnight' = 'true'`)).rows).toHaveLength(0);
  });

  it("the lobby job is where it runs", () => {
    const job = source("app/api/jobs/lobby/route.ts");
    expect(job).toContain("await bookHouseOvernight(db)");
    expect(job.indexOf("bookHouseOvernight(db)")).toBeLessThan(job.indexOf("refreshLobby(db, new Date(), { ensureFresh: true })"));
  });
});

/** Books a couple's overnight date with the engine's ending forced, and airs it. */
async function airedOvernight(ending: Ending = "second_date", opts: { optIn?: boolean } = {}) {
  const c = await couple(EARNING);
  if (opts.optIn) {
    const opened = await openThread(t.db, c.me, c.mine, new Date(), { opener: false });
    if (!opened.ok) throw new Error("no thread");
    await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [opened.thread_id]);
  }
  const booked = await book(c, ending);
  if (booked.status !== 200) throw new Error(`overnight not booked: ${booked.status} ${JSON.stringify(booked.body)}`);
  const id = booked.body.id as string;
  expect(await airEpisode(t.db, id, c.me)).toMatchObject({ ending });
  return { ...c, overnight: id };
}
const texts = async (userId: string, tag: string) =>
  (await t.db.query<{ text: string }>(`select m.text from companion_messages m join companion_threads th on th.id = m.thread_id where th.user_id = $1 and m.action = $2 and m.via <> 'photo' order by m.created_at, m.id`, [userId, tag])).rows.map((r) => r.text);

describe("when it airs: the engine's ending stands, and only leaving together is a milestone", () => {
  it("ended in another date: the ending is the engine's, the pair's timeline gets the milestone once, and it shows where it should", async () => {
    const c = await airedOvernight("second_date");
    const e = await episode(c.overnight);
    expect(e.ending).toBe("second_date");
    const [lo, hi] = pairKey(c.mine, c.theirs);
    const rows = await events("overnight");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ character_a: lo, character_b: hi, layer: "public", episode_id: c.overnight, from_stage: null, to_stage: null });
    // Aired again (a hook that runs twice), still one.
    expect(await overnightAired(t.db, c.overnight)).toMatchObject({ overnight: true, left_together: true });
    expect(await events("overnight")).toHaveLength(1);

    // The couple's page and each character's page, for anyone; "Since you were here" for someone back after it.
    const stranger = userIdOf(newUserCookie());
    for (const where of [{ pair: [c.theirs, c.mine] as [string, string] }, { character: c.mine }, { character: c.theirs }]) {
      const marks = await overnightMarks(t.db, where, stranger);
      expect(marks, JSON.stringify(where)).toHaveLength(1);
      expect(marks[0]).toMatchObject({ episode_id: c.overnight, lo, hi, night_together: false });
      expect(marks[0].place).toBe(venuePhrase(e.setup.venue));
    }
    await t.db.query(`insert into owner_activity (user_id, last_seen) values ($1, now() - interval '3 days') on conflict (user_id) do update set last_seen = excluded.last_seen`, [stranger]);
    const since = await showSince(t.db, stranger);
    expect(since?.overnights).toEqual([expect.objectContaining({ lo, hi, episode_path: `/episodes/${c.overnight}` })]);
    // The stage notices and the stage timeline are untouched by it: no stage row carries a kind.
    expect((await t.db.query(`select 1 from relationship_events where kind is null and to_stage is null and from_stage is null`)).rows).toHaveLength(0);
  });

  it("any other ending is told as it is: no milestone, no text, an ordinary date in every list", async () => {
    for (const ending of ["friends", "disaster"] as const) {
      await t.reset();
      const c = await airedOvernight(ending, { optIn: true });
      expect((await episode(c.overnight)).ending).toBe(ending);
      expect(await events("overnight")).toHaveLength(0);
      expect(await overnightMarks(t.db, { pair: [c.mine, c.theirs] }, c.me)).toHaveLength(0);
      expect(await texts(c.me, `overnight:${c.overnight}`)).toHaveLength(0);
      expect(await overnightAired(t.db, c.overnight)).toEqual({ overnight: true, left_together: false, texted: 0 });
    }
  });

  it("a milestone is read against the date as it stands: taken off the air, it's gone from every public list", async () => {
    const c = await airedOvernight("second_date");
    const stranger = userIdOf(newUserCookie());
    expect(await overnightMarks(t.db, { pair: [c.mine, c.theirs] }, stranger)).toHaveLength(1);
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [c.overnight]);
    expect(await overnightMarks(t.db, { pair: [c.mine, c.theirs] }, stranger)).toHaveLength(0);
    expect(await overnightMarks(t.db, { since: new Date(Date.now() - DAY).toISOString() }, stranger)).toHaveLength(0);
    // Its owner still sees their own.
    expect(await overnightMarks(t.db, { pair: [c.mine, c.theirs] }, c.me)).toHaveLength(1);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [c.overnight]);
    expect(await overnightMarks(t.db, { pair: [c.mine, c.theirs] }, c.me)).toHaveLength(0);
  });

  it("the character tells its own person, once, without detail, and only when they asked to hear from it", async () => {
    const quiet = await airedOvernight("second_date");
    expect(await texts(quiet.me, `overnight:${quiet.overnight}`)).toHaveLength(0);
    await t.reset();
    const c = await airedOvernight("second_date", { optIn: true });
    const said = await texts(c.me, `overnight:${c.overnight}`);
    expect(said).toEqual(overnightTextLines(H0.name));
    expect(said.join(" ")).toMatch(/We left together/);
    await overnightAired(t.db, c.overnight);
    expect(await texts(c.me, `overnight:${c.overnight}`)).toHaveLength(2);
    // The tease on air doesn't double it.
    await new Promise((r) => setTimeout(r, 120));
    expect(await texts(c.me, `tease:${c.overnight}`)).toHaveLength(0);
  });

  it("off (OVERNIGHT_DATES=0): an overnight date that airs is just a date", async () => {
    const c = await couple(EARNING);
    const booked = await book(c);
    vi.stubEnv("OVERNIGHT_DATES", "0");
    await airEpisode(t.db, booked.body.id, c.me);
    expect(await events("overnight")).toHaveLength(0);
  });
});

describe("the offer in the character's texts (lib/companion-offers.ts)", () => {
  it("the chip leads the menu only when an overnight is on offer", () => {
    expect(offersFor({ ending: "second_date", overnight: true })).toEqual(["overnight", "second_date", "someone_new", "advice"]);
    expect(offersFor({ ending: "second_date" })).toEqual(["second_date", "someone_new", "advice"]);
    expect(offersFor({ ending: "friends", overnight: true })).toEqual(["someone_new", "advice"]);
    expect(offersFor({ ending: "second_date", overnight: true, booked: true })).toEqual(["advice"]);
    expect(offerLabel("overnight", { partner: "Nell Okafor", character: "Cass Vega" })).toBe("Say yes to the overnight date with Nell");
  });

  it("the text about the date that earned it says so and carries the chip; tapping it books the overnight", async () => {
    const c = await couple(EARNING);
    const r = await sendAfterDateText(t.db, { userId: c.me, episodeId: c.dates[2] });
    if (!r.ok || !r.message_id) throw new Error("no text");
    const stored = (await t.db.query<Any>(`select offers from companion_messages where id = $1`, [r.message_id])).rows[0].offers;
    expect(stored.kinds).toEqual(["overnight", "second_date", "someone_new", "advice"]);
    expect(await texts(c.me, `after_date:${c.dates[2]}`)).toContain(overnightOfferLine(H0.name));

    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    const cookie = `bz_sess=${signSession({ uid: c.me, authenticated: false })}; bz_adult=1`;
    const res = await companionPost(
      new Request(`${BASE_URL}/api/companion/${r.thread_id}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ action: "offer", offer: "overnight", message_id: r.message_id }) }),
      { params: Promise.resolve({ id: r.thread_id }) },
    );
    const body = (await res.json()) as Any;
    expect(res.status).toBe(200);
    expect((await episode(body.episode_id)).setup.overnight).toBe(true);
    expect(JSON.stringify(body.view)).toContain("Booked. An overnight date with");
  });

  it("a text about a date that hasn't earned one has the usual chips and no extra line", async () => {
    const c = await couple(["friends", "second_date"]);
    const r = await sendAfterDateText(t.db, { userId: c.me, episodeId: c.dates[1] });
    if (!r.ok || !r.message_id) throw new Error("no text");
    expect((await t.db.query<Any>(`select offers from companion_messages where id = $1`, [r.message_id])).rows[0].offers.kinds).toEqual(["second_date", "someone_new", "advice"]);
    expect((await texts(c.me, `after_date:${c.dates[1]}`)).join(" ")).not.toMatch(/overnight/);
  });
});

describe("on the pages", () => {
  const html = (el: ReactElement | null) => (el ? renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, "&") : "");

  it("the couple's page: the offer for an owner only, then the milestone for anyone once it has aired", async () => {
    const c = await couple(EARNING);
    const [lo, hi] = pairKey(c.mine, c.theirs);
    const stranger = userIdOf(newUserCookie());
    const offered = html(await Overnight({ a: lo, b: hi, viewerId: c.me, owner: true }));
    expect(offered).toContain("data-overnight-offer");
    expect(offered).toContain("have earned an overnight date.");
    expect(offered).toContain("🌙 Book their overnight date");
    expect(offered).toContain('id="overnight"');
    // A visitor is offered nothing, and with nothing to show there is no card at all.
    expect(await Overnight({ a: lo, b: hi, viewerId: stranger, owner: false })).toBeNull();
    expect(await Overnight({ a: lo, b: hi, viewerId: null, owner: false })).toBeNull();

    const booked = await book(c);
    await airEpisode(t.db, booked.body.id, c.me);
    for (const viewer of [stranger, c.me, null]) {
      const card = html(await Overnight({ a: lo, b: hi, viewerId: viewer, owner: viewer === c.me }));
      expect(card).toContain("data-overnight-mark");
      expect(card).toContain("They left together. The cameras stayed behind.");
      expect(card).toContain(`href="/episodes/${booked.body.id}"`);
      expect(card).not.toContain("data-overnight-offer");
      expect(card).not.toContain("data-night-together");
    }
    // The one fixed line a continued night left: the owners', nobody else's.
    await recordNightTogether(t.db, { a: c.mine, b: c.theirs, episodeId: booked.body.id }, new Date());
    expect(html(await Overnight({ a: lo, b: hi, viewerId: c.me, owner: true }))).toContain("They spent the night together.");
    expect(html(await Overnight({ a: lo, b: hi, viewerId: stranger, owner: false }))).not.toContain("spent the night");
    // Each character's page lists it, and the switch takes all of it away.
    for (const id of [c.mine, c.theirs]) {
      const marks = html(await OvernightMarks({ characterId: id, viewerId: stranger }));
      expect(marks).toContain("they left together");
      expect(marks).toContain(`href="/couples/${lo}/${hi}#overnight"`);
    }
    expect(await OvernightMarks({ characterId: userIdOf(newUserCookie()), viewerId: stranger })).toBeNull();
    vi.stubEnv("OVERNIGHT_DATES", "0");
    expect(await Overnight({ a: lo, b: hi, viewerId: c.me, owner: true })).toBeNull();
    expect(await OvernightMarks({ characterId: c.mine, viewerId: c.me })).toBeNull();
  });

  it("an owner waiting on the other creator sees that, and the other creator sees a yes to give", async () => {
    const c = await twoOwners();
    const [lo, hi] = pairKey(c.mine, c.theirs);
    expect(html(await Overnight({ a: lo, b: hi, viewerId: c.me, owner: true }))).toContain("🌙 Say yes to the overnight date");
    expect((await book(c)).status).toBe(202);
    expect(html(await Overnight({ a: lo, b: hi, viewerId: c.me, owner: true }))).toContain("You said yes. Waiting for Otto's creator to say yes too.");
    const theirs = html(await Overnight({ a: lo, b: hi, viewerId: c.partnerId, owner: true }));
    expect(theirs).toContain("Cass's creator already said yes. Say yes too and it's booked.");
    expect(theirs).toContain("🌙 Book their overnight date");
  });

  it("After Dark's page for the date: not found unless After Dark admits them and the date is theirs to continue", async () => {
    const c = await admitted();
    const open = (id: string) => OvernightNightPage({ params: Promise.resolve({ id }) });
    // Signed out, or not admitted: the same not-found as any After Dark page.
    jar.cookies.clear();
    await expect(open(c.overnight)).rejects.toThrow("NOT_FOUND");
    jar.cookies.set("bz_sess", signSession({ uid: c.me, authenticated: true })!);
    const page = html(await open(c.overnight));
    expect(page).toContain("Cass and Rafe: the night after");
    expect(page).toContain("they left together. The cameras stayed behind.");
    expect(page).toContain(">Continue the night<");
    expect(page).toContain("cost what they always cost");
    // An ordinary date of theirs has no such page.
    await expect(open(c.dates[2])).rejects.toThrow("NOT_FOUND");
    // Once started, it's the way back to the night.
    await startOvernightNight(t.db, c.me, c.overnight);
    const again = html(await open(c.overnight));
    expect(again).toContain("Back to their night");
    expect(again).not.toContain(">Continue the night<");
    jar.cookies.clear();
  });
});

/* ------------------------------------------------ the night continues in After Dark ------------------------------------------------ */

const SHOWS: ContinueFacts = {
  on: true, available: true, overnight: true, aired: true, ending: "second_date", latest: true, attested: true, mode: "open", entitled: true, locked: false, owns: true, bothIn: true, bot: false,
};
const BROWSER = new Headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const NO_COOKIES = { get: () => undefined };

describe("who sees 'Continue the night in After Dark' (pure)", () => {
  it("only when every one of After Dark's own conditions holds", () => {
    expect(continueShows(SHOWS)).toBe(true);
    // A text-only place is an allowed place: the night is words.
    expect(continueShows({ ...SHOWS, mode: "text_only" })).toBe(true);
    const off: Partial<ContinueFacts>[] = [
      { on: false }, // OVERNIGHT_AFTER_DARK=0 or OVERNIGHT_DATES=0
      { available: false }, // After Dark is off altogether
      { overnight: false }, // an ordinary date
      { aired: false },
      { ending: "friends" }, // they called it a night
      { ending: "disaster" },
      { ending: null },
      { latest: false }, // they've dated since: tonight isn't the night after it
      { attested: false }, // hasn't said 18 or older on this browser
      { mode: "blocked" }, // not offered where they are
      { entitled: false }, // no pass, invite or subscription today
      { locked: true }, // this device hasn't entered the account's PIN
      { owns: false }, // neither character is theirs
      { bothIn: false }, // one of the two isn't in their After Dark
      { bot: true },
    ];
    for (const change of off) expect(continueShows({ ...SHOWS, ...change }), JSON.stringify(change)).toBe(false);
  });

  it("the copy is the one button", () => {
    expect(OVERNIGHT_COPY.continueButton).toBe("Continue the night in After Dark");
    const page = source("app/episodes/[id]/page.tsx");
    expect(page.match(/OVERNIGHT_COPY\.continueButton/g)).toHaveLength(1);
    // Asked only for a signed-in owner on an aired date, with the 18+ answer.
    expect(page).toContain('ready && episode.revealed && episode.is_creator && auth?.authenticated');
    expect(page).toContain('viewerContinue(db, auth, h, cookieStore, cookieStore.get(ADULT_COOKIE)?.value === "1", id)');
  });
});

/** An aired overnight date that ended in leaving together, whose owner After Dark admits and whose character is switched in. */
async function admitted(opts: { how?: "admin" | "beta" | "none"; switchIn?: boolean } = {}) {
  const c = await airedOvernight("second_date");
  if ((opts.how ?? "admin") === "admin") await claimAdmin(t.db, c.me);
  if (opts.how === "beta") await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at, provider, period_end) values ($1, 'active', now(), 'beta', now() + interval '30 days')`, [c.me]);
  if (opts.switchIn !== false) await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [c.me, c.mine]);
  return { ...c, auth: { userId: c.me, authenticated: true }, cookie: `bz_sess=${signSession({ uid: c.me, authenticated: true })}` };
}
const sees = (c: { auth: { userId: string; authenticated: boolean }; overnight: string }, o: { headers?: Headers; attested?: boolean; env?: Record<string, string | undefined>; episode?: string } = {}) =>
  viewerContinue(t.db, c.auth, o.headers ?? BROWSER, NO_COOKIES, o.attested ?? true, o.episode ?? c.overnight, o.env);

describe("who sees it, for real (lib/adult/overnight.ts viewerContinue)", () => {
  it("an admitted owner whose character is switched in, with a house partner: the link to After Dark's own page", async () => {
    const c = await admitted();
    expect(await sees(c)).toEqual({ href: `/after-dark/overnight/${c.overnight}` });
    // An invited beta pass is admitted the same way.
    await t.reset();
    const beta = await admitted({ how: "beta" });
    expect(await sees(beta)).toEqual({ href: `/after-dark/overnight/${beta.overnight}` });
    // With After Dark on its own host, the link goes there through the sign-in hop.
    expect((await sees(beta, { env: { ...process.env, AFTER_DARK_ORIGIN: "https://ad.example.com" } }))?.href).toBe(
      `https://ad.example.com/api/auth/carry?to=${encodeURIComponent(`/after-dark/overnight/${beta.overnight}`)}`,
    );
  });

  it("entitlement: nobody After Dark doesn't already admit", async () => {
    const c = await admitted({ how: "none" });
    expect(await sees(c)).toBeNull();
    // Signed out, or a guest session.
    expect(await viewerContinue(t.db, null, BROWSER, NO_COOKIES, true, c.overnight)).toBeNull();
    expect(await viewerContinue(t.db, { userId: c.me, authenticated: false }, BROWSER, NO_COOKIES, true, c.overnight)).toBeNull();
    // A lapsed pass.
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at, provider, period_end) values ($1, 'active', now(), 'beta', now() - interval '1 day')`, [c.me]);
    expect(await sees(c)).toBeNull();
    // A subscription with no age check isn't in either.
    await t.db.query(`update adult_entitlements set period_end = now() + interval '9 days', age_verified_at = null where user_id = $1`, [c.me]);
    expect(await sees(c)).toBeNull();
  });

  it("region and the 18+ answer: never where After Dark is blocked, never without the answer, never a crawler", async () => {
    const c = await admitted({ how: "beta" });
    expect(await sees(c)).not.toBeNull();
    for (const where of [{ country: "US", region: "TX" }, { country: "FR", region: null }, { country: null, region: null }]) {
      setPlaceForTests(where);
      expect(await sees(c), JSON.stringify(where)).toBeNull();
    }
    setPlaceForTests({ country: "CA", region: "ON" });
    expect(await sees(c, { attested: false })).toBeNull();
    expect(await sees(c, { headers: new Headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }) })).toBeNull();
  });

  it("ownership and both characters' consent: never another person's character, never one of their own that's switched out", async () => {
    // Their own character isn't switched into After Dark: its owner hasn't said yes for it.
    const out = await admitted({ switchIn: false });
    expect(await sees(out)).toBeNull();
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [out.me, out.mine]);
    expect(await sees(out)).not.toBeNull();
    // An admitted stranger who owns neither character.
    const stranger = userIdOf(newUserCookie());
    await claimAdmin(t.db, stranger);
    expect(await viewerContinue(t.db, { userId: stranger, authenticated: true }, BROWSER, NO_COOKIES, true, out.overnight)).toBeNull();
  });

  it("another person's character never appears in someone's night: there is no consent for it, and this makes none", async () => {
    const c = await twoOwners();
    expect((await book(c)).status).toBe(202);
    const booked = await book({ creator: c.partner, mine: c.theirs, theirs: c.mine });
    expect(booked.status).toBe(200);
    const overnight = booked.body.id as string;
    await airEpisode(t.db, overnight, c.partnerId);
    expect(await events("overnight")).toHaveLength(1);
    // Both owners are admitted, and each has their OWN character switched in for themselves.
    for (const [owner, character] of [[c.me, c.mine], [c.partnerId, c.theirs]] as const) {
      await claimAdmin(t.db, owner);
      await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, character]);
    }
    for (const owner of [c.me, c.partnerId]) {
      expect(await viewerContinue(t.db, { userId: owner, authenticated: true }, BROWSER, NO_COOKIES, true, overnight), owner).toBeNull();
      expect(await overnightNight(t.db, owner, overnight)).toBeNull();
      expect(await startOvernightNight(t.db, owner, overnight)).toBeNull();
    }
    expect((await t.db.query(`select 1 from adult_overnights`)).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_scenes`)).rows).toHaveLength(0);
  });

  it("the date: only an overnight date that aired, ended in leaving together, and is still their latest", async () => {
    const c = await admitted();
    // An ordinary date of theirs.
    expect(await sees(c, { episode: c.dates[2] })).toBeNull();
    // They've been on a date since.
    const later = await cloneDate(c.dates[0], {});
    await t.db.query(`update episodes set created_at = now() + interval '1 minute' where id = $1`, [later]);
    expect(await sees(c)).toBeNull();
    await t.db.query(`delete from episodes where id = $1`, [later]);
    expect(await sees(c)).not.toBeNull();
    // Not aired.
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [c.overnight]);
    expect(await sees(c)).toBeNull();
    await t.reset();
    // It ended some other way.
    const friends = await airedOvernight("friends");
    await claimAdmin(t.db, friends.me);
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [friends.me, friends.mine]);
    expect(await viewerContinue(t.db, { userId: friends.me, authenticated: true }, BROWSER, NO_COOKIES, true, friends.overnight)).toBeNull();
  });

  it("the switches: OVERNIGHT_AFTER_DARK=0 removes the button, and so does After Dark being off, or a locked device", async () => {
    const c = await admitted();
    expect(await sees(c, { env: { ...process.env, OVERNIGHT_AFTER_DARK: "0" } })).toBeNull();
    expect(await sees(c, { env: { ...process.env, OVERNIGHT_DATES: "0" } })).toBeNull();
    expect(await sees(c, { env: { ...process.env, ADULT_MODE: "" } })).toBeNull();
    vi.stubEnv("OVERNIGHT_AFTER_DARK", "0");
    expect(await overnightNight(t.db, c.me, c.overnight)).toBeNull();
    expect((await post(startNight, "/api/admin/after-dark/overnight", { episode_id: c.overnight }, c.cookie)).status).toBe(404);
    vi.stubEnv("OVERNIGHT_AFTER_DARK", "");
    expect(await sees(c)).not.toBeNull();
    // A PIN on the account, not entered on this device: nothing of After Dark is shown.
    await t.db.query(`insert into adult_privacy (user_id, pin_hash, pin_version) values ($1, 'scrypt$x$y', 1) on conflict (user_id) do update set pin_hash = excluded.pin_hash`, [c.me]);
    expect(await sees(c)).toBeNull();
  });

  it("rollout: it reads no rollout switch and writes none (public_door stays where it is)", async () => {
    const before = (await t.db.query<Any>(`select count(*)::int as n from adult_settings`)).rows[0].n;
    const c = await admitted();
    await sees(c);
    await startOvernightNight(t.db, c.me, c.overnight);
    expect((await t.db.query<Any>(`select count(*)::int as n from adult_settings`)).rows[0].n).toBe(before);
    for (const file of ["lib/adult/overnight.ts", "lib/overnight.ts", "lib/overnight-shared.ts", "lib/overnight-house.ts", "app/api/admin/after-dark/overnight/route.ts", "app/after-dark/overnight/[id]/page.tsx"]) {
      expect(source(file), file).not.toMatch(/rollout|adult_settings|saveAdultSettings/);
    }
  });
});

describe("starting the night: After Dark's own start path, seeded with show facts only", () => {
  const scene = async (me: string) => (await t.db.query<Any>(`select lines, chapter, place, set_place, scenario from adult_scenes where owner_id = $1`, [me])).rows;

  it("the route is After Dark's: not found unless After Dark admits them; it writes no line and takes no token", async () => {
    const c = await admitted();
    const stranger = newUserCookie();
    expect((await post(startNight, "/api/admin/after-dark/overnight", { episode_id: c.overnight }, stranger)).status).toBe(404);
    const res = await post(startNight, "/api/admin/after-dark/overnight", { episode_id: c.overnight }, c.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: `/after-dark/${pairKey(c.mine, c.theirs).join("/")}` });
    // The pair's own scene, fresh: nothing written, nowhere set, no scenario. The night's page asks for the first chapter.
    const rows = await scene(c.me);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lines: [], chapter: 1, place: null, set_place: null, scenario: null });
    expect((await t.db.query(`select 1 from adult_token_usage where user_id = $1`, [c.me])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_overnights where episode_id = $1 and owner_id = $2 and told_at is null`, [c.overnight, c.me])).rows).toHaveLength(1);
    // Pressed again: the same night, nothing new.
    expect((await post(startNight, "/api/admin/after-dark/overnight", { episode_id: c.overnight }, c.cookie)).status).toBe(200);
    expect((await t.db.query(`select 1 from adult_overnights`)).rows).toHaveLength(1);
    expect((await overnightNight(t.db, c.me, c.overnight))!.started).toBe(true);
  });

  it("a night already under way is filed first, as Start over files it, and isn't mistaken for this one ending", async () => {
    const c = await admitted();
    const [a, b] = pairKey(c.mine, c.theirs);
    await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines) values ($1, $2, $3, $4, $5::jsonb)`, [
      randomUUID(), c.me, a, b, JSON.stringify([{ who: "a", text: "An older night, from before the overnight date.", stage: 0 }]),
    ]);
    expect(await startOvernightNight(t.db, c.me, c.overnight)).toMatchObject({ path: `/after-dark/${a}/${b}` });
    expect((await scene(c.me))[0]).toMatchObject({ lines: [], chapter: 1 });
    expect((await t.db.query(`select 1 from adult_nights where owner_id = $1`, [c.me])).rows).toHaveLength(1);
    // The filed night is from before the continuation: the show is told nothing yet.
    expect(await tellShowNightsOver(t.db)).toBe(0);
    expect(await events("night_together")).toHaveLength(0);
  });

  it("the seed is one sentence of show facts, only for a night this viewer continued", async () => {
    const c = await admitted();
    const [a, b] = pairKey(c.mine, c.theirs);
    const [ca, cb] = await Promise.all([loadCharacter(t.db, a), loadCharacter(t.db, b)]);
    const e = await episode(c.overnight);
    const date = { id: c.overnight, setting: "A quiet table.", ending: "second_date", venue: e.setup.venue as string, character_a: c.mine, transcript: [] };
    expect(await overnightSeed(t.db, c.me, date)).toBeNull();
    expect((await sceneMemories(t.db, c.me, ca, cb, date)).join("\n")).not.toMatch(/overnight/);

    await startOvernightNight(t.db, c.me, c.overnight);
    const seed = (await overnightSeed(t.db, c.me, date))!;
    expect(seed).toBe(`Their latest date, at ${venuePhrase(e.setup.venue)}, was an overnight date on the show: they left together, and tonight is the rest of that night.`);
    expect(await sceneMemories(t.db, c.me, ca, cb, date)).toContain(seed);
    // Show facts only, in the show's own words: it would pass the show's content check, and adds nothing explicit.
    expect(checkFields({ line: seed }).ok).toBe(true);
    expect(seed).not.toMatch(/sex|nude|naked|explicit|kiss|undress|bed|strip|seduc/i);
    // Nobody else's night for the pair is seeded, nor a later date's, nor with the switch off.
    expect(await overnightSeed(t.db, userIdOf(newUserCookie()), date)).toBeNull();
    expect(await overnightSeed(t.db, c.me, { ...date, id: c.dates[2] })).toBeNull();
    expect(await overnightSeed(t.db, c.me, { ...date, ending: "friends" })).toBeNull();
    vi.stubEnv("OVERNIGHT_AFTER_DARK", "0");
    expect(await overnightSeed(t.db, c.me, date)).toBeNull();
  });

  it("it adds no generation path of its own: no model, no writer, no prompt text beyond the seed", () => {
    const src = source("lib/adult/overnight.ts");
    expect(src).not.toMatch(/adultModel|\.complete\(|continueScene|writeSceneStep|sceneMessages|spendAdTokens|startScenario|setSceneTo/);
    // What it calls of the scene is opening it and Start over, the page's own two.
    expect(src).toContain('const { openScene, resetScene } = await import("./scenes");');
    const route = source("app/api/admin/after-dark/overnight/route.ts");
    expect(route).toContain("await adultViewer(db, req)");
    expect(route).not.toMatch(/spendAdTokens|continueScene/);
  });
});

/* ------------------------------------------------------- one fact back ------------------------------------------------------- */

describe("one fact back: ids and a timestamp", () => {
  /** A continued night with a chapter filed after it started (After Dark's own table, as its scene would write it). */
  async function continued() {
    const c = await admitted();
    await startOvernightNight(t.db, c.me, c.overnight);
    return c;
  }
  const fileNight = (c: { me: string; mine: string; theirs: string }) => {
    const [a, b] = pairKey(c.mine, c.theirs);
    return t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, stage, chapter, recap) values ($1, $2, $3, $4, $5::jsonb, 3, 1, $6)`, [
      randomUUID(), c.me, a, b, JSON.stringify([{ who: "a", text: "SECRET-LINE-OF-THE-NIGHT", stage: 3 }]), "SECRET-RECAP-OF-THE-NIGHT",
    ]);
  };

  it("when the night ends, the show records one fixed event between the two, private to the owners, once", async () => {
    const c = await continued();
    expect(await tellShowNightsOver(t.db)).toBe(0); // nothing written yet: no night happened
    await fileNight(c);
    // Off, nothing is told; back on, it is.
    expect(await tellShowNightsOver(t.db, null, new Date(), { OVERNIGHT_AFTER_DARK: "0" })).toBe(0);
    const [lo, hi] = pairKey(c.mine, c.theirs);
    expect(await tellShowNightsOver(t.db, { ownerId: c.me, pair: [c.theirs, c.mine] })).toBe(1);
    const rows = await events("night_together");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ character_a: lo, character_b: hi, layer: "all", kind: "night_together", episode_id: c.overnight, from_stage: null, to_stage: null });
    // Told once: a second chapter, or the daily sweep, adds nothing.
    await fileNight(c);
    expect(await tellShowNightsOver(t.db)).toBe(0);
    expect(await events("night_together")).toHaveLength(1);

    // Private to the two owners: on the couple's page for its owner, never for anyone else, and never in a public list.
    expect((await overnightMarks(t.db, { pair: [lo, hi] }, c.me))[0].night_together).toBe(true);
    expect((await overnightMarks(t.db, { pair: [lo, hi] }, userIdOf(newUserCookie())))[0].night_together).toBe(false);
    expect((await overnightMarks(t.db, { pair: [lo, hi] }, null))[0].night_together).toBe(false);
    // The public stage timeline and "Since you were here" read stage changes and public rows only.
    expect((await t.db.query(`select 1 from relationship_events where kind = 'night_together' and layer = 'public'`)).rows).toHaveLength(0);
  });

  it("a night that was simply left is told by the daily sweep, after a while, and only if it had begun", async () => {
    const c = await continued();
    const lines = JSON.stringify([{ who: "a", text: "SECRET-LINE-OF-THE-NIGHT", stage: 1 }]);
    // Lines written an hour ago: still under way.
    await t.db.query(`update adult_scenes set lines = $2::jsonb, updated_at = now() - interval '1 hour' where owner_id = $1`, [c.me, lines]);
    expect(await tellShowNightsOver(t.db)).toBe(0);
    // Nobody has added to it for longer than NIGHT_LEFT_HOURS: it was left.
    await t.db.query(`update adult_scenes set updated_at = now() - make_interval(hours => $2) where owner_id = $1`, [c.me, NIGHT_LEFT_HOURS + 1]);
    expect(await tellShowNightsOver(t.db)).toBe(1);
    expect(await events("night_together")).toHaveLength(1);
    expect(source("app/api/jobs/after-dark-daily/route.ts")).toContain("await tellShowNightsOver(db)");
    // The scene tells it itself when a chapter closes or the night is filed.
    expect(source("lib/adult/scenes.ts").match(/await tellShowNightsOver\(db, \{ ownerId/g)).toHaveLength(2);
  });

  it("each of the two may carry one neutral sentence into their next date, and only that one date", async () => {
    const c = await continued();
    expect(await nightTogetherFact(t.db, c.mine, c.theirs)).toBeNull();
    await fileNight(c);
    await tellShowNightsOver(t.db);
    const place = venuePhrase((await episode(c.overnight)).setup.venue);
    const fact = `You spent the night together after the date at ${place}.`;
    expect(await nightTogetherFact(t.db, c.mine, c.theirs)).toBe(fact);
    expect(await nightTogetherFact(t.db, c.theirs, c.mine)).toBe(fact);
    expect(await nightTogetherFact(t.db, c.mine, c.theirs, { OVERNIGHT_DATES: "0" })).toBeNull();

    // Their next date on the show: both sides' own prompts carry the sentence, in the slot the pair's memory already has.
    const sheet = (name: string) => ({ name, age: 33, bio: "A bio.", traits: ["warm", "bold", "dry"], want: "someone kind", dealbreaker: "liars", house: false });
    const built = await buildDate(t.db, randomUUID(), { id: c.mine, sheet: sheet("Cass Vega") }, { id: c.theirs, sheet: sheet(H0.name) }, DEFAULT_DATE_REQUEST, undefined, undefined, { creatorId: c.me });
    for (const [who, other] of [[built.characters[0], c.theirs], [built.characters[1], c.mine]] as const) {
      expect(remembered(who as never, other)).toMatchObject({ what_happened_after_your_last_date: fact });
    }
    // A side that has After Dark's own PG note keeps that; the other still gets the fixed sentence.
    const both = assembleDate({
      episodeId: "e", a: { id: "ca", sheet: sheet("Ada Lumen") }, b: { id: "cb", sheet: sheet("Bo Quill") }, req: DEFAULT_DATE_REQUEST, seed: 3,
      soulA: null, soulB: null, memoryA: null, memoryB: null, history: undefined, afterDark: { a: "You and Bo are closer now.", b: null }, nightTogether: fact,
    } as never);
    const [ca, cb] = both.characters as unknown as [{ pair?: Record<string, unknown> }, { pair?: Record<string, unknown> }];
    expect(ca.pair?.what_happened_after_your_last_date).toBe("You and Bo are closer now.");
    expect(cb.pair?.what_happened_after_your_last_date).toBe(fact);
    expect(source("lib/simulation.ts")).toContain("const nightTogether = await nightTogetherFact(db, a.id, b.id);");

    scriptOutcome({ ending: "friends", sides: [side(false), side(false)] });
    scriptedModel([episodeJson()]);
    const next = await api.createEpisode({ character_id: c.mine, partner_id: c.theirs }, c.creator);
    expect(next.status).toBe(200);
    // Behaviour only: the engine's forced ending stood, and the date isn't marked as carrying an After Dark memory.
    const made = await episode((await next.json()).id);
    expect(made.ending).toBe("friends");
    expect(made.setup.after_dark).toBeUndefined();
    // Once that date exists, the fact has been used: the date after it isn't told again.
    expect(await nightTogetherFact(t.db, c.mine, c.theirs)).toBeNull();
  });

  it("the show's writer takes ids and a timestamp, and records nothing for a date that isn't theirs to record", async () => {
    const c = await continued();
    const at = new Date("2026-11-20T03:00:00Z");
    // Not an overnight date, the wrong pair, or one of the two with itself: nothing.
    expect(await recordNightTogether(t.db, { a: c.mine, b: c.theirs, episodeId: c.dates[2] }, at)).toBe(false);
    expect(await recordNightTogether(t.db, { a: c.mine, b: H1.id, episodeId: c.overnight }, at)).toBe(false);
    expect(await recordNightTogether(t.db, { a: c.mine, b: c.mine, episodeId: c.overnight }, at)).toBe(false);
    // Anything else handed to it is not stored: the row is two ids, a layer, a kind, the date's id and the time.
    const smuggled = { a: c.mine, b: c.theirs, episodeId: c.overnight, text: "SECRET-LINE-OF-THE-NIGHT", recap: "SECRET-RECAP-OF-THE-NIGHT", tags: ["x"], picture: "p" };
    expect(await recordNightTogether(t.db, smuggled, at)).toBe(true);
    expect(await recordNightTogether(t.db, smuggled, at)).toBe(false);
    const row = (await t.db.query<Any>(`select * from relationship_events where kind = 'night_together'`)).rows[0];
    expect(Object.keys(row).sort()).toEqual(["at", "character_a", "character_b", "episode_id", "from_stage", "id", "kind", "layer", "to_stage"]);
    expect(new Date(row.at).toISOString()).toBe(at.toISOString());
    expect(JSON.stringify(row)).not.toMatch(/SECRET/);
  });

  it("PIN: no After Dark text, summary, tag or picture is read by the show's overnight code", async () => {
    // The show's files read no After Dark table and import nothing of After Dark's.
    for (const file of ["lib/overnight.ts", "lib/overnight-shared.ts", "lib/overnight-house.ts", "app/api/overnight/route.ts", "app/couples/[a]/[b]/Overnight.tsx", "app/couples/[a]/[b]/OvernightOffer.tsx", "app/characters/[id]/OvernightMarks.tsx"]) {
      const src = source(file);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\badult_[a-z_]+/);
      expect(code, file).not.toMatch(/from "(\.\/|@\/lib\/)adult\//);
      expect(code, file).not.toMatch(/import\("(\.\/|@\/lib\/)adult\//);
    }
    // The writer's signature is ids and a timestamp; its insert names fixed columns and no free text.
    const lib = source("lib/overnight.ts");
    expect(lib).toContain("export async function recordNightTogether(db: Db, ids: { a: string; b: string; episodeId: string }, at: Date): Promise<boolean>");
    expect(recordNightTogether.length).toBe(3);
    const writer = lib.slice(lib.indexOf("export async function recordNightTogether"), lib.indexOf("export async function nightTogetherFact"));
    expect(writer).toContain("insert into relationship_events (character_a, character_b, layer, kind, episode_id, at)");
    expect(writer).toContain("[lo, hi, ids.episodeId, at.toISOString()]");
    // After Dark's side hands over exactly that, and reads no line to do it: only whether the night has any, and when.
    const ad = source("lib/adult/overnight.ts");
    expect(ad).toContain("await recordNightTogether(db, { a: r.character_a, b: r.character_b, episodeId: r.episode_id }, now);");
    expect(ad.match(/recordNightTogether\(/g)).toHaveLength(1);
    const teller = ad.slice(ad.indexOf("export async function tellShowNightsOver"));
    expect(teller).toContain("`select o.episode_id, o.owner_id, o.character_a, o.character_b\n");
    expect(teller).not.toMatch(/\b(recap|note|prompt|tags?|summary|picture|media|image)\b/i);
    // The night's lines are counted, never selected.
    expect(teller.match(/lines/g)).toHaveLength(1);
    expect(teller).toContain("jsonb_array_length(s.lines) > 0");

    // End to end: a night full of marked text ends, and nothing of it is anywhere the show reads.
    const c = await continued();
    await fileNight(c);
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note) values ($1, $2, $3, 'A plain note.') on conflict do nothing`, [c.mine, c.theirs, c.me]);
    await tellShowNightsOver(t.db);
    const shown = JSON.stringify([
      await events("night_together"),
      await overnightMarks(t.db, { pair: [c.mine, c.theirs] }, c.me),
      await nightTogetherFact(t.db, c.mine, c.theirs),
      (await exportAccount(t.db, c.me)).relationship_events,
    ]);
    expect(shown).not.toMatch(/SECRET/);
    expect(shown).toContain("night_together");
  });
});
