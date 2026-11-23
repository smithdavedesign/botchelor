// How well the viewer and a character know each other in Step in (lib/adult/step-in-bond.ts; docs/after-dark.md "How
// well they know each other"): a level worked out from what they've done together, that never drops and can't be
// bought. David, 2026-11-23: "A visible relationship level (SpicyChat, Candy), without the decay and paid skips people
// complain about." The fixtures are mild lines; no live calls here.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/step-in",
}));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import AfterDarkCharacterPage from "@/app/after-dark/characters/[id]/page";
import AfterDarkCharactersPage from "@/app/after-dark/characters/page";
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import StepInSetupPage from "@/app/after-dark/step-in/page";
import { deleteAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { exportAdultProfile } from "@/lib/adult/profile-data";
import { saveAdultSettings } from "@/lib/adult/settings";
import { deleteStepIn, getStepInScene, sendStepInLine, setStepInRandomForTests, startStepIn } from "@/lib/adult/step-in";
import {
  BOND_DAY_MAX,
  BOND_LEVELS,
  BOND_NEVER_FASTER,
  BOND_WORTH,
  bondLevel,
  bondMark,
  bondName,
  bondPoints,
  bondPromptLine,
  bondReachedLine,
  bondSinceWords,
  bondView,
  NO_BOND_SINCE,
  type BondCounted,
} from "@/lib/adult/step-in-bond";
import { BOND_DAY_TURNS_AT_UTC_HOUR, bondMarks, bondOf, exportBonds } from "@/lib/adult/step-in-bond-data";
import { STEP_IN_PACE, STEP_IN_WILL, stepInMessages } from "@/lib/adult/step-in-prompt";
import { NO_LIMITS } from "@/lib/adult/limits";
import { sceneCharacter } from "@/lib/adult/voice";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setStepInRandomForTests(() => 0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
});

const WHO = HOUSE_CHARACTERS[0].id;
const OTHER = HOUSE_CHARACTERS[1].id;
const NAME = HOUSE_CHARACTERS[0].name.split(/\s+/)[0];
const HOME = "venue:home";
const NOTHING: BondCounted = { days: 0, lines: 0, scenes: 0, stories: 0, callDays: 0, pictureDays: 0, facts: 0 };
const [ACQUAINTED, FAMILIAR, AT_EASE, CLOSE, CONFIDANTS] = BOND_LEVELS.slice(1).map((l) => l.at);

function signIn(id: string): string {
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  return c.split(";")[0];
}
async function admin() {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  return { id, cookie: signIn(id) };
}

const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const REPLIES = [
  ['She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the counter made a small warm circle of it."],
  ['She pushed the menu across with one finger. "Order for both of us. I trust you with everything except the olives."', "The waiter hovered, decided against it, and went back to polishing a glass that was already clean."],
  ['"Tell me the worst part of your week," she said, and reached over to take her hand back from the cold glass.', "Somewhere behind the bar a radio found a song from ten summers ago and kept it low."],
  ['She laughed, short and surprised. "That is not how that story ends and we both know it."', "The candle between the plates had burned down to a stub, and nobody had come to change it."],
  ['"Walk with me," she said, already reaching for her coat. "The rain has stopped pretending."', "The street outside was all reflections, and the bus shelter across the road hummed under its one light."],
  ['She held the door with her shoulder. "After you. I want to see which way you turn."', "The night air smelled of wet pavement and somebody else's dinner."],
];
/** The scripted writer: mild replies, each different; what it was asked is kept. */
function scripted() {
  const seen = { prompts: [] as ChatMessage[][] };
  let i = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      seen.prompts.push(m);
      return JSON.stringify({ story: REPLIES[i++ % REPLIES.length] });
    },
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const day = (n: number, hour = 20) => new Date(Date.UTC(2026, 10, n, hour, 0, 0));
async function start(viewer: string, who = WHO, at = day(2)) {
  const r = await startStepIn(t.db, viewer, { character_id: who, place: HOME }, at);
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  return r;
}
const say = async (viewer: string, id: string, line: string, at: Date) => {
  const r = await sendStepInLine(t.db, viewer, id, line, at);
  if (!r.ok) throw new Error(`send failed: ${r.status} ${r.message}`);
  return r.view;
};
/** Lines of the viewer's put straight into a scene (a hundred of them without a hundred replies). */
async function lines(viewer: string, scene: string, n: number, at: Date) {
  for (let i = 0; i < n; i++) {
    await t.db.query(`insert into adult_step_in_messages (id, scene_id, owner_id, role, text, created_at) values ($1, $2, $3, 'viewer', $4, $5)`, [randomUUID(), scene, viewer, `line ${i}`, new Date(at.getTime() + i * 1000).toISOString()]);
  }
}
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");

describe("the levels", () => {
  it("are six, lowest first, with plain names; a level is where its points have got to", () => {
    expect(BOND_LEVELS.map((l) => l.name)).toEqual(["Strangers", "Acquainted", "Familiar", "At ease", "Close", "Confidants"]);
    expect(BOND_LEVELS.map((l) => l.at)).toEqual([0, 12, 60, 150, 320, 600]);
    expect([0, 11, 12, 59, 60, 149, 150, 319, 320, 599, 600, 100000].map(bondLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect([0, 1, 3, 6, 9].map(bondName)).toEqual(["Strangers", "Strangers", "Familiar", "Confidants", "Confidants"]);
    // Strangers have no mark in a list; everyone past that has their level's name.
    expect(bondMark(0)).toBeNull();
    expect(bondMark(ACQUAINTED - 1)).toBeNull();
    expect(bondMark(ACQUAINTED)).toEqual({ level: 2, name: "Acquainted" });
    expect(bondMark(CONFIDANTS + 5)).toEqual({ level: 6, name: "Confidants" });
  });

  it("a first evening reaches level 2, and no single evening, however long or full, jumps two levels", () => {
    // One line, in one scene, on one day: acquainted.
    expect(bondPoints({ ...NOTHING, days: 1, lines: 1, scenes: 1 })).toBe(ACQUAINTED);
    expect(bondLevel(bondPoints({ ...NOTHING, days: 1, lines: 1, scenes: 1 }))).toBe(2);
    // A hundred lines in one evening: only the first of them count (the caps are the statement's; these are its totals).
    const longEvening = bondPoints({ ...NOTHING, days: 1, lines: BOND_WORTH.linesADay, scenes: 1 });
    expect(longEvening).toBe(18);
    expect(bondLevel(longEvening)).toBe(2);
    // Everything a day can hold, and the memory's whole share on top: still under the third level.
    const fullDay = bondPoints({ days: 1, lines: BOND_WORTH.linesADay, scenes: BOND_WORTH.scenesADay, stories: BOND_WORTH.storiesADay, callDays: 1, pictureDays: 1, facts: 99 });
    expect(fullDay).toBe(BOND_DAY_MAX);
    expect(BOND_DAY_MAX).toBeLessThan(FAMILIAR);
    expect(bondLevel(BOND_DAY_MAX)).toBe(2);
  });

  it("time together and stories played to the end matter most; lines the least; nothing counts for more by being bought", () => {
    const w = BOND_WORTH;
    // A day is worth more than every line that counts in it, and a story more than a day.
    expect(w.day).toBeGreaterThan(Math.floor(w.linesADay / w.linesToAPoint));
    expect(w.story).toBeGreaterThan(w.day);
    // Ten quiet evenings (one line each, one scene) against one evening of a thousand lines.
    expect(bondPoints({ ...NOTHING, days: 10, lines: 10, scenes: 1 })).toBeGreaterThan(5 * bondPoints({ ...NOTHING, days: 1, lines: w.linesADay, scenes: 1 }));
    // A picture costs tokens past the month's own, so a day's pictures count once, for less than a call and far less than the day.
    expect(w.pictureDay).toBeLessThan(w.callDay);
    expect(w.pictureDay * 5).toBeLessThanOrEqual(w.day);
    // What the character remembers stops counting at ten things.
    expect(bondPoints({ ...NOTHING, facts: 500 })).toBe(w.factsMax);
    // Weeks of evenings to the top: an ordinary evening (a day, its lines, a scene) is 18; a story every third evening.
    const evenings = (n: number) => bondPoints({ ...NOTHING, days: n, lines: n * w.linesADay, scenes: n, stories: Math.floor(n / 3) });
    expect(bondLevel(evenings(2))).toBe(2);
    expect(bondLevel(evenings(3))).toBe(3);
    expect(bondLevel(evenings(14))).toBe(4);
    expect(bondLevel(evenings(27))).toBe(5);
    expect(bondLevel(evenings(28))).toBe(6);
  });
});

describe("what's shown", () => {
  it("is the greater of what's there now and the most it has ever been: it never drops", () => {
    const since = { ...NO_BOND_SINCE, days: 2, lines: 9, scenes: 1 };
    expect(bondView(22, 0, since)).toMatchObject({ level: 2, name: "Acquainted", points: 22, kept: false, reached: false, next: { name: "Familiar", at: FAMILIAR } });
    // Scenes deleted since: what's derived has fallen, what's shown hasn't.
    expect(bondView(0, 170, NO_BOND_SINCE)).toMatchObject({ level: 4, name: "At ease", points: 170, kept: true, next: { name: "Close", at: CLOSE } });
    expect(bondView(22, 22, since).kept).toBe(false);
    // How far toward the next, and nothing past the top.
    expect(bondView(ACQUAINTED, 0, since).progress).toBe(0);
    expect(bondView((ACQUAINTED + FAMILIAR) / 2, 0, since).progress).toBeCloseTo(0.5);
    expect(bondView(AT_EASE - 1, 0, since).progress).toBeLessThan(1);
    expect(bondView(CONFIDANTS + 400, 0, since)).toMatchObject({ level: 6, next: null, progress: 1 });
  });

  it("says what it's made of in a few words, the time together first, and only what there is", () => {
    expect(bondSinceWords({ days: 4, lines: 61, scenes: 3, stories: 2, calls: 0, pictures: 0, facts: 0 })).toEqual(["4 evenings", "2 stories played", "3 scenes", "61 lines"]);
    expect(bondSinceWords({ days: 1, lines: 1, scenes: 1, stories: 1, calls: 1, pictures: 1, facts: 1 })).toEqual(["1 evening", "1 story played", "1 scene", "1 line", "1 call", "1 picture", "1 thing remembered"]);
    expect(bondSinceWords({ ...NO_BOND_SINCE, lines: 1234 })).toEqual(["1,234 lines"]);
    expect(bondSinceWords(NO_BOND_SINCE)).toEqual([]);
    expect(bondReachedLine("Juniper", 3)).toBe("You and Juniper are now familiar.");
    expect(bondReachedLine("Juniper", 4)).toBe("You and Juniper are now at ease.");
  });
});

describe("what the character is told", () => {
  const known = (level: number, since: Partial<typeof NO_BOND_SINCE>, kept = false) => ({ level, since: { ...NO_BOND_SINCE, ...since }, kept });

  it("is nothing for strangers, and nothing through a first scene on a first evening", () => {
    expect(bondPromptLine(known(1, {}))).toBeNull();
    // The first line of all already makes them acquainted on the page; nothing came before it, so nothing is said.
    expect(bondPromptLine(known(2, { days: 1, scenes: 1, lines: 30 }))).toBeNull();
  });

  it("says how long they've known each other from the second scene or evening on, and never as leave to go faster", () => {
    expect(bondPromptLine(known(2, { days: 1, scenes: 2 }))).toBe(`You two have spent time together before: you've met before and you remember them; you don't start from nothing. ${BOND_NEVER_FASTER}`);
    expect(bondPromptLine(known(4, { days: 9, scenes: 12, stories: 3 }))).toBe(
      `You two have spent nine evenings together and played three stories to the end: you're at ease with them: you have history, and you don't act as if you've just met. ${BOND_NEVER_FASTER}`,
    );
    expect(bondPromptLine(known(3, { days: 2, scenes: 1, stories: 1 }))).toContain("You two have spent two evenings together and played one story to the end: you're familiar with each other");
    expect(bondPromptLine(known(6, { days: 41, scenes: 50 }))).toContain("You two have spent 41 evenings together: you know each other very well by now");
    // Scenes deleted since: the level stands, and so does the history, in plain words.
    expect(bondPromptLine(known(5, {}, true))).toContain("You two have spent time together before: you're close");
    // In a roleplay the role comes first.
    expect(bondPromptLine(known(3, { days: 3, scenes: 3 }), { roleplay: true })).toMatch(/In a roleplay the role comes first; this is who the two of you are underneath it\.$/);
    // Every line carries the same sentence: time together is never leave.
    expect(BOND_NEVER_FASTER).toContain("never a reason to go faster or further than they take things");
    expect(BOND_NEVER_FASTER).toContain("the pace, their limits and your own will stand exactly as written");
    for (let level = 2; level <= BOND_LEVELS.length; level++) {
      const line = bondPromptLine(known(level, { days: 5, scenes: 5 }))!;
      expect(line, String(level)).toContain(BOND_NEVER_FASTER);
      // Nothing in it reads as a licence: no "now you can", no "further", "more", "faster" outside that sentence.
      expect(line.replace(BOND_NEVER_FASTER, ""), String(level)).not.toMatch(/\b(faster|further|more|now you|allowed|ready for)\b/i);
    }
  });

  it("goes into the character's own prompt once, beside the rules it never loosens, and is absent without one", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const character = (await sceneCharacter(t.db, WHO))!;
    const args = { character, place: { label: "your place", situation: null, public: false }, roleplay: null, persona: null, limits: NO_LIMITS, turns: [{ role: "viewer" as const, text: "I sit down." }] };
    const line = bondPromptLine(known(4, { days: 9, scenes: 12 }))!;
    const withIt = stepInMessages({ ...args, bond: line })[0].content;
    expect(withIt.split(line)).toHaveLength(2);
    expect(withIt).toContain(STEP_IN_PACE);
    expect(withIt).toContain(STEP_IN_WILL);
    const without = stepInMessages(args)[0].content;
    expect(without).not.toContain("You two have spent");
    expect(withIt.replace(`\n\n${line}`, "")).toBe(without);
  });
});

describe("worked out from what they've done together", () => {
  it("counts the days, the lines, the scenes, calls, pictures and what's remembered, each held to its day", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    // Nothing done: strangers, and nothing kept.
    expect((await bondOf(t.db, a.id, WHO)).bond).toMatchObject({ level: 1, name: "Strangers", points: 0, since: NO_BOND_SINCE, kept: false });
    expect(await rows(`select 1 from adult_step_in_bonds`)).toHaveLength(0);
    const s = await start(a.id);
    // A scene with only its opening is still nothing done: it's what they write that counts.
    expect((await bondOf(t.db, a.id, WHO)).bond).toMatchObject({ level: 1, points: 0 });
    await say(a.id, s.id, "I sit down across from you.", day(2, 21));
    expect((await bondOf(t.db, a.id, WHO)).bond).toMatchObject({ level: 2, points: 12, since: { ...NO_BOND_SINCE, days: 1, lines: 1, scenes: 1 } });
    // A second evening, in the same scene: another day, no new scene.
    await say(a.id, s.id, "I came back.", day(3));
    expect((await bondOf(t.db, a.id, WHO)).bond).toMatchObject({ points: 22, since: { ...NO_BOND_SINCE, days: 2, lines: 2, scenes: 1 } });
    // A hundred lines on a third evening: the day, and the first 24 of them (six points), no more.
    await lines(a.id, s.id, 100, day(4));
    expect((await bondOf(t.db, a.id, WHO)).bond).toMatchObject({ points: 22 + 10 + 6, level: 2, since: { ...NO_BOND_SINCE, days: 3, lines: 102, scenes: 1 } });
    // A call that evening (two spoken replies: one day with a call), two pictures made in the scene (one day with a
    // picture), a story played to the end, and three things remembered.
    for (const id of ["c1", "c2"]) await t.db.query(`insert into adult_step_in_messages (id, scene_id, owner_id, role, kind, text, created_at) values ($1, $2, $3, 'character', 'call', '"Hello."', $4)`, [id, s.id, a.id, day(4, 22).toISOString()]);
    for (const id of ["p1", "p2"]) {
      await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, step_in_scene, created_at) values ($1, $2, $3, 'scene', 'p', 'image/png', $4, 'ready', $5, $6)`, [id, a.id, WHO, new Uint8Array([1]), s.id, day(4, 22).toISOString()]);
    }
    await t.db.query(`update adult_step_in_scenes set story_done_at = $2 where id = $1`, [s.id, day(4, 23).toISOString()]);
    for (const text of ["They go by Sam.", "They work nights.", "They like it slow."]) await t.db.query(`insert into adult_step_in_facts (id, owner_id, character_id, text) values ($1, $2, $3, $4)`, [randomUUID(), a.id, WHO, text]);
    const full = (await bondOf(t.db, a.id, WHO)).bond;
    expect(full.since).toEqual({ days: 3, lines: 102, scenes: 1, stories: 1, calls: 2, pictures: 2, facts: 3 });
    expect(full.points).toBe(38 + 3 + 2 + 12 + 3);
    expect(full).toMatchObject({ level: 2, name: "Acquainted", next: { name: "Familiar", at: FAMILIAR } });
    // Someone else's scenes and someone else's character are nothing to do with it.
    expect((await bondOf(t.db, a.id, OTHER)).bond.points).toBe(0);
    expect((await bondOf(t.db, randomUUID(), WHO)).bond.points).toBe(0);
  });

  it("an evening is one day wherever it's spent: it turns over at 10:00 UTC, not at midnight", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    // Half past six in New York, then half past eight: one evening, though midnight UTC fell between them.
    await say(a.id, s.id, "I sit down across from you.", new Date("2026-11-20T23:30:00Z"));
    await say(a.id, s.id, "I'm still here.", new Date("2026-11-21T01:30:00Z"));
    expect((await bondOf(t.db, a.id, WHO)).bond.since).toMatchObject({ days: 1, lines: 2 });
    // Nine in the morning UTC is still that night in the Americas; eleven is the next day.
    await say(a.id, s.id, "It's late.", new Date(`2026-11-21T0${BOND_DAY_TURNS_AT_UTC_HOUR - 1}:30:00Z`));
    expect((await bondOf(t.db, a.id, WHO)).bond.since).toMatchObject({ days: 1, lines: 3 });
    await say(a.id, s.id, "Good morning.", new Date(`2026-11-21T${BOND_DAY_TURNS_AT_UTC_HOUR + 1}:30:00Z`));
    expect((await bondOf(t.db, a.id, WHO)).bond.since).toMatchObject({ days: 2, lines: 4 });
  });

  it("a day's scenes and stories count twice at most, however many there were", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    for (let i = 0; i < 5; i++) {
      const s = await start(a.id, WHO, day(6, 10 + i));
      await lines(a.id, s.id, 1, day(6, 10 + i));
      await t.db.query(`update adult_step_in_scenes set story_done_at = $2 where id = $1`, [s.id, day(6, 11 + i).toISOString()]);
    }
    const b = (await bondOf(t.db, a.id, WHO)).bond;
    expect(b.since).toMatchObject({ days: 1, lines: 5, scenes: 5, stories: 5 });
    expect(b.points).toBe(BOND_WORTH.day + 1 + BOND_WORTH.scene * BOND_WORTH.scenesADay + BOND_WORTH.story * BOND_WORTH.storiesADay);
    expect(b.level).toBe(2);
  });

  it("never drops: a scene deleted takes its lines, not the level", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    for (let d = 2; d <= 8; d++) await lines(a.id, s.id, 3, day(d));
    const before = (await bondOf(t.db, a.id, WHO)).bond;
    // Seven evenings of three lines in one scene: 70 for the days, 5 for the lines, 2 for the scene.
    expect(before).toMatchObject({ level: 3, name: "Familiar", points: 77, kept: false });
    expect(await rows(`select points, level from adult_step_in_bonds where owner_id = $1 and character_id = $2`, [a.id, WHO])).toEqual([{ points: 77, level: 3 }]);
    expect(await deleteStepIn(t.db, a.id, s.id)).toEqual({ ok: true });
    const after = (await bondOf(t.db, a.id, WHO)).bond;
    expect(after).toMatchObject({ level: 3, name: "Familiar", points: 77, kept: true, since: NO_BOND_SINCE });
    // What's kept is only ever raised: a new evening adds to what's there now, and the level holds until that passes it.
    const again = await start(a.id, WHO, day(12));
    await lines(a.id, again.id, 1, day(12));
    expect((await bondOf(t.db, a.id, WHO)).bond).toMatchObject({ level: 3, points: 77, kept: true, since: { ...NO_BOND_SINCE, days: 1, lines: 1, scenes: 1 } });
    expect(await rows(`select points, level from adult_step_in_bonds where owner_id = $1`, [a.id])).toEqual([{ points: 77, level: 3 }]);
    // Reading it without lifting writes nothing.
    const fresh = await admin();
    const theirs = await start(fresh.id);
    await lines(fresh.id, theirs.id, 1, day(2));
    expect((await bondOf(t.db, fresh.id, WHO, { lift: false })).bond.points).toBe(12);
    expect(await rows(`select 1 from adult_step_in_bonds where owner_id = $1`, [fresh.id])).toHaveLength(0);
  });

  it("every pair's mark comes from one statement, and matches the pair's own", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const one = await start(a.id, WHO);
    for (let d = 2; d <= 8; d++) await lines(a.id, one.id, 2, day(d));
    const two = await start(a.id, OTHER);
    await lines(a.id, two.id, 1, day(3));
    const queries = vi.spyOn(t.db, "query");
    const marks = await bondMarks(t.db, a.id);
    expect(queries).toHaveBeenCalledTimes(1);
    queries.mockRestore();
    expect([...marks.keys()].sort()).toEqual([WHO, OTHER].sort());
    for (const id of [WHO, OTHER]) {
      const { bond } = await bondOf(t.db, a.id, id, { lift: false });
      expect(marks.get(id), id).toEqual({ level: bond.level, name: bond.name });
    }
    expect(marks.get(WHO)).toEqual({ level: 3, name: "Familiar" });
    expect(marks.get(OTHER)).toEqual({ level: 2, name: "Acquainted" });
    // A level kept from scenes since deleted still shows in the list.
    await bondOf(t.db, a.id, WHO);
    await deleteStepIn(t.db, a.id, one.id);
    expect((await bondMarks(t.db, a.id)).get(WHO)).toEqual({ level: 3, name: "Familiar" });
    // Someone who has never stepped in has none.
    expect((await bondMarks(t.db, randomUUID())).size).toBe(0);
  });
});

describe("in the scene", () => {
  it("the view carries it; the reply that crosses into a level says so, once", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    expect(s.view.bond).toMatchObject({ level: 1, name: "Strangers", points: 0, reached: false, kept: false, next: { name: "Acquainted", at: ACQUAINTED } });
    // Their first line: acquainted, said under that reply.
    const first = await say(a.id, s.id, "I sit down across from you.", day(2, 21));
    expect(first.bond).toMatchObject({ level: 2, name: "Acquainted", reached: true });
    // Read again (a reload), and on the next reply: not said twice.
    const read = await getStepInScene(t.db, a.id, s.id);
    expect(read.ok && read.view.bond).toMatchObject({ level: 2, reached: false });
    expect((await say(a.id, s.id, "Tell me about your day.", day(2, 22))).bond).toMatchObject({ level: 2, reached: false });
    // A level reached while nobody was told (lines on later days, read by a reload): the reload says nothing and
    // uses nothing up; the next reply says it, once.
    for (let d = 3; d <= 7; d++) await lines(a.id, s.id, 2, day(d));
    const reload = await getStepInScene(t.db, a.id, s.id);
    expect(reload.ok && reload.view.bond).toMatchObject({ level: 3, name: "Familiar", reached: false });
    expect((await say(a.id, s.id, "I came back.", day(7, 22))).bond).toMatchObject({ level: 3, reached: true });
    expect((await say(a.id, s.id, "And again.", day(7, 23))).bond).toMatchObject({ level: 3, reached: false });
    expect(await rows(`select level, shown_level from adult_step_in_bonds where owner_id = $1`, [a.id])).toEqual([{ level: 3, shown_level: 3 }]);
  });

  it("the writer is told nothing in a first scene, and how long they've known each other from the second evening on", async () => {
    const seen = scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    await say(a.id, s.id, "I sit down across from you.", day(2, 21));
    await say(a.id, s.id, "Tell me about your day.", day(2, 22));
    for (const m of seen.prompts) expect(m[0].content).not.toContain("You two have spent");
    await say(a.id, s.id, "I came back.", day(3));
    const told = seen.prompts.at(-1)![0].content;
    expect(told).toContain("You two have spent two evenings together: you've met before and you remember them");
    expect(told).toContain(BOND_NEVER_FASTER);
    expect(told).toContain(STEP_IN_PACE);
    // A roleplay says the role comes first.
    const rp = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: "neighbours", you: 0 } }, day(3, 21));
    if (!rp.ok) throw new Error("start failed");
    expect(seen.prompts.at(-1)![0].content).toContain("In a roleplay the role comes first; this is who the two of you are underneath it.");
  });

  it("the header has a quiet chip that opens on what it's made of, and the line under the reply only when a level was just reached", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    signIn(a.id);
    const page = async () => html(await StepInScenePage({ params: Promise.resolve({ id: s.id }) }));
    const strangers = await page();
    expect(strangers).toContain('data-step-in-bond="1"');
    expect(strangers).toContain(`You and ${NAME} have only just met.`);
    await say(a.id, s.id, "I sit down across from you.", day(2, 21));
    for (let d = 3; d <= 5; d++) await lines(a.id, s.id, 2, day(d));
    const known = await page();
    expect(known).toMatch(/<details class="ad-si-bond" data-step-in-bond="2">/);
    expect(known).toContain('<span class="ad-si-bond-name">Acquainted</span>');
    expect(known).toContain("4 evenings · 1 scene · 7 lines.");
    expect(known).toContain("Next: Familiar.");
    expect(known).toContain("it only ever goes up");
    // A page that's read says nothing was just reached: that's for the reply that crossed into it.
    expect(known).not.toContain("data-step-in-bond-reached");
    // Nothing to buy and nothing to keep up: the words a level system usually comes with are not on the page.
    expect(known.slice(known.indexOf("ad-si-bond"), known.indexOf("ad-si-bond") + 1500)).not.toMatch(/streak|unlock|tokens|buy|daily/i);
  });
});

describe("in the lists", () => {
  it("a character's card, their own page and the shelf say the level for someone they've stepped in with, and nothing for anyone else", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    signIn(a.id);
    const cards = async () => html(await AfterDarkCharactersPage({ searchParams: Promise.resolve({}) }));
    const theirPage = async (id: string) => html(await AfterDarkCharacterPage({ params: Promise.resolve({ id }) }));
    // Nobody yet: no mark anywhere.
    expect(await cards()).not.toContain("data-bond-level");
    expect(await theirPage(WHO)).not.toContain("data-character-bond");
    const s = await start(a.id);
    for (let d = 2; d <= 8; d++) await lines(a.id, s.id, 2, day(d));
    const list = await cards();
    expect(list.match(/data-bond-level=/g)).toHaveLength(1);
    expect(list).toMatch(new RegExp(`data-character="${WHO}"[\\s\\S]*?<span class="ad-bond-mark ad-char-bond" data-bond-level="3"[^>]*>Familiar</span>`));
    expect(await theirPage(WHO)).toMatch(/data-character-bond="true">\s*<span class="ad-bond-mark" data-bond-level="3"[^>]*>Familiar<\/span>/);
    expect(await theirPage(OTHER)).not.toContain("data-character-bond");
    // The shelf, opened for them: every card is cast with them, each with the mark beside the face.
    const shelf = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO }) }));
    const cardsShown = shelf.match(/data-step-in-card="/g)!.length;
    expect(cardsShown).toBeGreaterThan(0);
    expect(shelf.match(/<span class="ad-bond-mark ad-si-shelf-bond" data-bond-level="3"[^>]*>Familiar<\/span>/g)).toHaveLength(cardsShown);
    // Opened for someone they don't know: no mark on any card.
    const other = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: OTHER }) }));
    expect(other).not.toContain("data-bond-level");
  });
});

describe("with the account", () => {
  it("is in After Dark's download, and goes with the account; nothing else takes it away", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    expect(await exportBonds(t.db, a.id)).toEqual([]);
    expect((await exportAdultProfile(t.db, a.id)).bonds).toEqual([]);
    const s = await start(a.id);
    for (let d = 2; d <= 8; d++) await lines(a.id, s.id, 2, day(d));
    await bondOf(t.db, a.id, WHO);
    const out = await exportAdultProfile(t.db, a.id);
    expect(out.bonds).toEqual([{ character_id: WHO, level: 3, name: "Familiar", points: 75, since: { ...NO_BOND_SINCE, days: 7, lines: 14, scenes: 1 } }]);
    // The scenes go: the download still says the level (it's kept), with nothing left that it's made of.
    await deleteStepIn(t.db, a.id, s.id);
    expect((await exportAdultProfile(t.db, a.id)).bonds).toEqual([{ character_id: WHO, level: 3, name: "Familiar", points: 75, since: NO_BOND_SINCE }]);
    // The account goes: so does it.
    await deleteAccount(t.db, a.id);
    expect(await rows(`select 1 from adult_step_in_bonds where owner_id = $1`, [a.id])).toHaveLength(0);
    expect(await exportBonds(t.db, a.id)).toEqual([]);
  });
});
