import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDirectorMessages } from "@/lib/beats";
import { loadCharacter } from "@/lib/character";
import { buildTurnMessages, critiqueTurn, type Turn } from "@/lib/conversation";
import { fixedEngine, type SideOutcome } from "@/lib/engine";
import { dealtEvent, LIFE_EVENTS, thisWeek } from "@/lib/life";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { connections, findMilestones, loadCharacterMemory, metBefore, pairStatus, recentDates, stageFor, updateCharacterMemory } from "@/lib/memory";
import { buildReflectionMessages } from "@/lib/reflection";
import type { DramaAnswer, DramaQuestion, Ending } from "@/lib/rules";
import { checkFields } from "@/lib/safety";
import { weekIdOf } from "@/lib/season-window";
import { buildDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

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

const so = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const line = (side: "a" | "b", dialogue: string, interest = 0.5): Turn => ({ side, act: 1, dialogue, action: "", emotion: "", interest });

// Mondays, a week apart (seasons start Monday 00:00 UTC).
const WEEK1 = Date.UTC(2026, 9, 5, 12) / 1000; // Mon 5 Oct 2026, noon
const WEEK2 = Date.UTC(2026, 9, 12, 12) / 1000; // Mon 12 Oct 2026, noon
let n = 0;

/** An AIRED, public episode with a controlled ending, sides, drama, venue and transcript. */
async function aired(o: {
  a: string; b: string; ending: Ending; sides?: [SideOutcome, SideOutcome]; at: number; venue?: string;
  drama?: [DramaQuestion, DramaAnswer]; transcript?: Turn[];
}): Promise<string> {
  const id = `ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides,
                           transcript, setup, drama_question, drama_answer, created_at, revealed_at)
     values ($1, 'sys', $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', $4, 'ready', $5::jsonb, $6::jsonb, $7::jsonb, $8, $9,
             to_timestamp($10), to_timestamp($10))`,
    [
      id, o.a, o.b, o.ending, JSON.stringify(o.sides ?? [so(true), so(true)]), JSON.stringify(o.transcript ?? []),
      JSON.stringify({ venue: o.venue ?? "rooftop_bar" }), o.drama?.[0] ?? "leaves_first", o.drama?.[1] ?? "neither", o.at + n,
    ],
  );
  return id;
}

async function oc(name: string, owner = newUserCookie(), extra: Record<string, unknown> = {}): Promise<string> {
  return (await (await api.createCharacter(validCharacter({ name, ...extra }), owner)).json()).id;
}

describe("how a pair stands", () => {
  it("the latest ending, coloured by what came before", () => {
    expect(pairStatus(["second_date"])).toBe("seeing");
    expect(pairStatus(["disaster", "second_date"])).toBe("seeing");
    expect(pairStatus(["second_date", "friends"])).toBe("exes");
    expect(pairStatus(["second_date", "disaster"])).toBe("exes");
    expect(pairStatus(["friends"])).toBe("just_met");
    expect(pairStatus(["friends", "friends"])).toBe("friends");
    expect(pairStatus(["friends", "disaster"])).toBe("bad_blood");
  });

  it("stages follow the aired record", () => {
    expect([0, 1, 3, 6, 12].map(stageFor)).toEqual(["Fresh face", "Newcomer", "Regular", "Veteran", "Legend"]);
  });

  it("milestones are reached once each, in order", () => {
    const d = (ending: Ending, other: string, turned_down: "you" | "them" | null = null, i = 0) => ({ id: `e${other}${ending}${i}`, ending, season: "2026-10-05", other: { id: other }, turned_down });
    const ms = findMilestones([d("disaster", "x"), d("second_date", "y"), d("second_date", "x", null, 1), d("second_date", "z", "them"), d("friends", "w")]);
    expect(ms.map((m) => m.id)).toEqual(["first_date", "survived_a_disaster", "first_spark", "comeback", "rematch", "heartbreaker", "on_a_roll", "made_a_friend", "five_dates"]);
  });
});

describe("what a character remembers", () => {
  it("remembers each person, how they stand, its own feeling, and a line from each side; builds chapters a week at a time", async () => {
    const owner = newUserCookie();
    const ira = await oc("Ira Fenn", owner);
    const nell = await oc("Nell Abiodun");
    const teo = await oc("Teo Brandt");
    // Week 1: a second date with Nell (Ira is B), then a disaster with Teo where Teo turns Ira down.
    await aired({ a: nell, b: ira, ending: "second_date", at: WEEK1, venue: "botanic_park", transcript: [line("a", "Do you always read the last page first?", 0.9), line("b", "Only when I'm scared of the middle.", 0.8)] });
    await aired({ a: ira, b: teo, ending: "disaster", sides: [so(false), so(false)], at: WEEK1 + 60, drama: ["rejected", "a"] });
    // Week 2: a rematch with Nell, now just friends; Ira still wants more.
    await aired({ a: ira, b: nell, ending: "friends", sides: [so(true), so(false)], at: WEEK2, venue: "retro_arcade", transcript: [line("a", "I kept your bookmark.", 0.95), line("b", "You should keep the book too.", 0.7)] });

    const m = await updateCharacterMemory(t.db, ira);
    expect(m.people!.map((p) => [p.name, p.status, p.dates])).toEqual([["Nell Abiodun", "exes", 2], ["Teo Brandt", "bad_blood", 1]]);
    const nellMem = m.people![0];
    expect(nellMem).toMatchObject({ last_ending: "friends", last_venue: "retro_arcade", wanted_more: true, they_said: "You should keep the book too.", you_said: "I kept your bookmark." });
    expect(m.people![1].turned_down).toBe("you");
    expect(m.chapters!.map((c) => [c.label, c.line])).toEqual([
      ["Week of Oct 12", "1 date: just friends with Nell."],
      ["Week of Oct 5", "2 dates: a second date with Nell, a disaster with Teo."],
    ]);
    expect(m.milestones!.map((x) => x.id)).toEqual(["first_date", "first_spark", "survived_a_disaster", "made_a_friend", "rematch"]);

    // Teo turned Ira down: from Teo's side, a heartbreaker.
    const teoMem = await updateCharacterMemory(t.db, teo);
    expect(teoMem.people![0].turned_down).toBe("them");
    expect(teoMem.milestones!.map((x) => x.id)).toContain("heartbreaker");

    // Stored and read back.
    expect((await loadCharacterMemory(t.db, ira))!.people![0].they_said).toBe("You should keep the book too.");
  });

  it("only aired, public dates count (same rule as the record)", async () => {
    const ira = await oc("Ira Fenn");
    const nell = await oc("Nell Abiodun");
    const id = await aired({ a: ira, b: nell, ending: "second_date", at: WEEK1 });
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [id]);
    expect((await updateCharacterMemory(t.db, ira)).people).toEqual([]);
  });

  it("the public face drops the private feeling", async () => {
    const ira = await oc("Ira Fenn");
    const nell = await oc("Nell Abiodun");
    await aired({ a: ira, b: nell, ending: "disaster", sides: [so(true), so(false)], at: WEEK1 });
    const m = await updateCharacterMemory(t.db, ira);
    const pub = connections(m);
    expect(pub[0]).toEqual({ id: nell, name: "Nell Abiodun", house: false, dates: 1, status: "bad_blood", label: "🔥 Bad blood", turned_down: null });
    expect(JSON.stringify(pub)).not.toContain("wanted_more");
  });
});

describe("a rematch remembers last time", () => {
  it("each side gets its own memory of the other, never the other's feeling; a first date gets the recent dating life instead", async () => {
    const ira = await oc("Ira Fenn");
    const nell = await oc("Nell Abiodun", undefined, { bio: "Brings homemade soup in a thermos to every single date." });
    const teo = await oc("Teo Brandt");
    await aired({ a: ira, b: teo, ending: "disaster", sides: [so(false), so(false)], at: WEEK1 });
    await aired({ a: ira, b: nell, ending: "second_date", sides: [so(true), so(false)], at: WEEK2, venue: "night_beach", transcript: [line("a", "Your thermos is a crime.", 0.9), line("b", "It's soup. It's always soup.", 0.9)] });
    await updateCharacterMemory(t.db, ira);
    await updateCharacterMemory(t.db, nell);

    const forDate = async (id: string) => {
      const c = (await loadCharacter(t.db, id))!;
      return { id, sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, house: false } };
    };
    const built = await buildDate(t.db, "ep-rematch", await forDate(ira), await forDate(nell), DEFAULT_DATE_REQUEST);
    const outcome = fixedEngine({ ending: "friends" }).decide(built.input, 1);
    const data = (i: number): Any =>
      JSON.parse(buildTurnMessages(built.input, outcome, built.characters, "a_hard_question", "rooftop_bar", [], i, "classic", {}, { totalTurns: 6 }).messages[1].content.replace(/^[^\n]*\n/, ""));

    // What each remembers about the OTHER lands under one merged block (David 2026-10-18: cut the memory snowball).
    const iraSees = data(0).what_you_remember_about_them;
    expect(iraSees).toMatchObject({ times: 1, where_you_stand: "You've been seeing each other.", how_you_left_it: "You wanted to see them again.", one_line_they_said: "It's soup. It's always soup." });
    expect(iraSees.how_it_ended_last_time).toMatch(/cold beach at night/);
    const nellSees = data(1).what_you_remember_about_them;
    expect(nellSees.how_you_left_it).toBe("You didn't want to see them again.");
    // your_recent_dates was dropped (duplicated the sheet's own life + extras); the character still carries its own context.
    expect(data(0).your_recent_dates).toBeUndefined();

    // The director plans it as a rematch; the reflection knows it too.
    const director = buildDirectorMessages(built.input, outcome, built.characters, "a_hard_question", "rooftop_bar", "classic", {})[1].content;
    expect(director).toContain("have met before (one date");
    const reflection = buildReflectionMessages(built.input, outcome, built.characters, "rooftop_bar", "classic", "a")[1].content;
    expect(reflection).toContain("you_had_met_them_before");

    // A callback to what was said last time isn't "profile reading".
    expect(critiqueTurn([line("b", "Hi again.")], line("a", "Still hiding soup in that thermos?"), built.input, built.characters, "rooftop_bar")).toBeNull();
  });

  it("strangers get neither", () => {
    expect(metBefore(null, "x")).toBeNull();
    expect(recentDates(null, "x")).toEqual([]);
  });
});

describe("a life that moves", () => {
  const MON = new Date(Date.UTC(2026, 9, 12, 9));
  const NEXT = new Date(Date.UTC(2026, 9, 19, 9));

  it("the show deals one a week: stable all week, fresh next week", () => {
    expect(thisWeek("c1", null, MON)).toBe(dealtEvent("c1", "2026-10-12"));
    expect(thisWeek("c1", null, new Date(Date.UTC(2026, 9, 18, 23)))).toBe(thisWeek("c1", null, MON));
    const weeks = new Set(Array.from({ length: 6 }, (_, i) => thisWeek("c1", null, new Date(MON.getTime() + i * 7 * 86_400_000))));
    expect(weeks.size).toBeGreaterThan(1);
  });

  it("a creator's own update wins for its season, then the show takes over again; an empty one means nothing this week", () => {
    expect(thisWeek("c1", { text: "Adopted a very old cat", season: "2026-10-12" }, MON)).toBe("Adopted a very old cat");
    expect(thisWeek("c1", { text: "Adopted a very old cat", season: "2026-10-12" }, NEXT)).toBe(dealtEvent("c1", "2026-10-19"));
    expect(thisWeek("c1", { text: "", season: "2026-10-12" }, MON)).toBeNull();
  });

  it("every dealt event passes the content rules", () => {
    for (const e of LIFE_EVENTS) expect(checkFields({ e }).ok, e).toBe(true);
  });

  it("set and cleared through the API, content-filtered, and in the character's own prompt", async () => {
    const owner = newUserCookie();
    const res = await api.createCharacter(validCharacter({ this_week: "Adopted a very old cat" }), owner);
    expect(res.status).toBe(201);
    const id = (await res.json()).id;
    const stored = (await t.db.query<Any>(`select this_week from characters where id = $1`, [id])).rows[0].this_week;
    // this_week is stamped with the week's id (lib/life.ts), not the season's: since seasons went monthly (2026-10-19)
    // the two only matched in the first week.
    expect(stored).toEqual({ text: "Adopted a very old cat", season: weekIdOf(new Date()) });
    expect((await loadCharacter(t.db, id))!.thisWeek).toBe("Adopted a very old cat");

    expect((await api.editCharacter(id, { this_week: "Watched porn all week" }, owner)).status).toBe(422);
    expect((await api.editCharacter(id, { this_week: null }, owner)).status).toBe(200);
    expect((await t.db.query<Any>(`select this_week from characters where id = $1`, [id])).rows[0].this_week).toBeNull();
    expect((await loadCharacter(t.db, id))!.thisWeek).toBe(dealtEvent(id, weekIdOf(new Date())));

    const c = (await loadCharacter(t.db, id))!;
    const built = await buildDate(t.db, "ep-week", { id, sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, house: false } }, { id, sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, house: false } }, DEFAULT_DATE_REQUEST);
    expect(built.characters[0].thisWeek).toBe(dealtEvent(id, weekIdOf(new Date())));
  });
});

describe("for agents", () => {
  it("get_character tells the story: stage, this week, connections, milestones and chapters", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ira = await oc("Ira Fenn");
    const nell = await oc("Nell Abiodun");
    await aired({ a: ira, b: nell, ending: "second_date", at: WEEK1 });
    await updateCharacterMemory(t.db, ira);
    const ctx: McpContext = {};
    const r = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_character", arguments: { character_id: ira } } }, ctx))!.result as Any;
    const d = r.structuredContent;
    expect(d.stage).toBe("Newcomer");
    expect(typeof d.this_week).toBe("string");
    expect(d.connections).toEqual([{ id: nell, name: "Nell Abiodun", dates: 1, status: "💞 Seeing each other", turned_down: null }]);
    expect(d.milestones).toEqual(["🎬 First date", "💘 First second date"]);
    expect(d.story).toEqual(["Week of Oct 5: 1 date: a second date with Nell."]);
    expect(JSON.stringify(d)).not.toContain("wanted_more");
  });
});

describe("memories from before the story existed", () => {
  it("heal on first read: rebuilt once from the aired record", async () => {
    const ira = await oc("Ira Fenn");
    const nell = await oc("Nell Abiodun");
    await aired({ a: ira, b: nell, ending: "second_date", at: WEEK1 });
    // A row as it was stored before people/chapters/milestones: counts only.
    await t.db.query(`insert into character_memory (character_id, dates, second_dates, arc) values ($1, 1, 1, 'One date in; still chasing a spark that sticks.')`, [ira]);
    const m = (await loadCharacterMemory(t.db, ira))!;
    expect(m.people!.map((p) => p.name)).toEqual(["Nell Abiodun"]);
    expect(m.milestones!.map((x) => x.id)).toEqual(["first_date", "first_spark"]);
    // Stored, so the next read is a plain read.
    expect((await t.db.query<Any>(`select jsonb_array_length(milestones) as n from character_memory where character_id = $1`, [ira])).rows[0].n).toBe(2);
  });
});
