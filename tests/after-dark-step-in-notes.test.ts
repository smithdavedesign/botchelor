// The character writes first, in Step in (lib/adult/step-in-notes.ts, lib/adult/step-in-notes-pass.ts; docs/after-dark.md
// "They write first"). David, 2026-11-23: "Messages sent first, with quiet hours (Kindroid, Nomi)". Off until the
// person turns it on; their quiet hours, in their own zone; their pace; a guard on guilt and pressure; a claim so two
// passes can't both write; bounds on a run and on a day; and After Dark's own pages saying a note is waiting.
// The fixtures are mild lines plus the short phrases the guard must refuse. No live calls here.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
import AfterDarkAccountPage from "@/app/after-dark/account/page";
import AfterDarkCharactersPage from "@/app/after-dark/characters/page";
import AfterDarkHome from "@/app/after-dark/page";
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import StepInSetupPage from "@/app/after-dark/step-in/page";
import { GET as notesGet, POST as notesPost } from "@/app/api/admin/after-dark/step-in/notes/route";
import { GET as jobGet } from "@/app/api/jobs/step-in-notes/route";
import { claimAdmin } from "@/lib/admins";
import { afterDarkDoors } from "@/lib/adult/doors";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { deleteAdultProfile, exportAdultProfile } from "@/lib/adult/profile-data";
import { saveAdultSettings } from "@/lib/adult/settings";
import { endStepIn, getStepInScene, NOTE_PARAGRAPHS, sendStepInLine, setStepInRandomForTests, startStepIn, stepInNotice } from "@/lib/adult/step-in";
import {
  awayWords,
  inQuietHours,
  localHour,
  NOTE_CLAIM_HOURS,
  NOTE_IDLE_HOURS,
  NOTE_PRESSURE,
  noteDecision,
  noteLine,
  notePrefs,
  notePressure,
  NOTES_ABOUT,
  NOTES_OFF,
  NOTES_RIDE_ALONG,
  NOTES_RUN_MAX,
  NOTES_SITE_DAY_MAX,
  NOTES_UNANSWERED,
  notesWaiting,
  notesWaitingCount,
  PACES,
  seenNote,
  setNotePrefs,
  setSceneNotes,
  timeZoneOf,
  type NoteAround,
  type NotePrefs,
  type NoteScene,
} from "@/lib/adult/step-in-notes";
import { NOTE_WHY_WORDS, writeDueNotes, writeNoteNow } from "@/lib/adult/step-in-notes-pass";
import { NOTE_NEVER, noteCue, stepInMessages } from "@/lib/adult/step-in-prompt";
import { NO_LIMITS } from "@/lib/adult/limits";
import { sceneCharacter } from "@/lib/adult/voice";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

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
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
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

const [WHO, OTHER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const NAME = HOUSE_CHARACTERS[0].name.split(/\s+/)[0];
const HOME = "venue:home";
const HOUR = 3_600_000;
/** A moment well after a scene was left: the pass's "now". */
const later = (hours: number, from: Date = new Date()) => new Date(from.getTime() + hours * HOUR);

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
async function subscriber() {
  const id = randomUUID();
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signIn(id) };
}
const open = () => saveAdultSettings(t.db, { rollout: { companion: "everyone" } });
/** Notes on, with no quiet hours unless a test sets some: the pass's hour of the day never matters by accident. */
const on = (id: string, extra: Partial<Parameters<typeof setNotePrefs>[2]> = {}) => setNotePrefs(t.db, id, { pace: "daily", quiet_from: 0, quiet_to: 0, time_zone: "UTC", ...extra });

const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const lastUser = (m: ChatMessage[]) => m[m.length - 1].content;
const asksForNote = (m: ChatMessage[]) => lastUser(m).includes("Write to them first");
const story = (...paragraphs: string[]) => JSON.stringify({ story: paragraphs });
const REPLIES = [
  story('She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her."),
  story('She pushed the menu across with one finger. "Order for both of us. I trust you with everything except the olives."'),
  story('"Tell me the worst part of your week," she said, and reached over for the bread.'),
  story('She laughed, short and surprised. "That is not how that story ends and we both know it."'),
];
const NOTES = [
  story('She found the corkscrew in the cutlery drawer the next morning and laughed out loud in the empty kitchen. "This one is yours, I think. Do you want it back, or is it mine now?"'),
  story('The bakery on the corner had the almond ones again. She bought two out of habit and ate one on the walk home. "They had the almond ones. Which do you like better, those or the plain?"'),
  story('She had started the crossword without anyone to argue with. "Seven letters, a slow walk. Any ideas?"'),
];
/**
 * The scripted models: ordinary replies in order, the scene's notes-keeper, and the notes the character writes first
 * (`notes` in order, the last again). Records what each kind of call was asked.
 */
function scripted(...notes: (string | Error)[]) {
  const seen = { prompts: [] as ChatMessage[][], notes: [] as ChatMessage[][] };
  let i = 0;
  let n = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      if (asksForNote(m)) {
        seen.notes.push(m);
        const pool = notes.length ? notes : NOTES;
        const a = pool[Math.min(n++, pool.length - 1)];
        if (a instanceof Error) throw a;
        return a;
      }
      seen.prompts.push(m);
      return REPLIES[Math.min(i++, REPLIES.length - 1)];
    },
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const replies = async (id: string) => Number((await rows(`select step_in from adult_usage where owner_id = $1`, [id]))[0]?.step_in ?? 0);
const kinds = async (scene: string) => (await rows(`select role, kind from adult_step_in_messages where scene_id = $1 and replaced_by is null order by created_at, id`, [scene])).map((r) => `${r.role}${r.kind ? `:${r.kind}` : ""}`);
const sceneRow = async (id: string) => (await rows(`select note_at, notes_off, notes_claimed_at, last_at from adult_step_in_scenes where id = $1`, [id]))[0];
const viewOf = async (viewer: string, id: string) => {
  const r = await getStepInScene(t.db, viewer, id);
  if (!r.ok) throw new Error("no scene");
  return r.view;
};
/** A running scene with one line of the viewer's and its reply. */
async function scene(viewer: string, who = WHO, line = "I brought the wine you like.") {
  const r = await startStepIn(t.db, viewer, { character_id: who, place: HOME });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  const sent = await sendStepInLine(t.db, viewer, r.id, line);
  if (!sent.ok) throw new Error(`send failed: ${sent.status} ${sent.message}`);
  return r.id;
}
const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie: string) => new Request(`${BASE_URL}${path}`, { headers: { cookie } });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");
const NOTES_PATH = "/api/admin/after-dark/step-in/notes";

/* ------------------------------------------------ the clock ------------------------------------------------ */

describe("their own clock", () => {
  it("takes a time zone the runtime knows, and keeps anything else as UTC", () => {
    expect(timeZoneOf("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(timeZoneOf("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(timeZoneOf("UTC")).toBe("UTC");
    for (const bad of ["Mars/Olympus_Mons", "", "  ", 5, null, undefined, "a".repeat(80), "'; drop table adult_prefs; --", "../etc/passwd"]) expect(timeZoneOf(bad), String(bad)).toBe("UTC");
  });

  it("reads the hour in their zone, across midnight and in a half-hour zone", () => {
    const at = (iso: string) => new Date(iso);
    expect(localHour(at("2026-11-23T20:30:00Z"), "America/Los_Angeles")).toBe(12);
    expect(localHour(at("2026-11-23T06:30:00Z"), "America/Los_Angeles")).toBe(22);
    // India is five and a half hours ahead: 18:29 UTC is 23:59 there, and a minute later it's the next day.
    expect(localHour(at("2026-11-23T18:29:00Z"), "Asia/Kolkata")).toBe(23);
    expect(localHour(at("2026-11-23T18:30:00Z"), "Asia/Kolkata")).toBe(0);
    expect(localHour(at("2026-11-23T20:30:00Z"), "nowhere")).toBe(20);
  });

  it("quiet hours hold in their zone, wrap midnight, and the same hour twice means none", () => {
    const night = { quiet_from: 22, quiet_to: 8 };
    const at = (iso: string) => new Date(iso);
    const quiet = (iso: string, zone: string, hours = night) => inQuietHours(at(iso), { ...hours, time_zone: zone });
    // 22:00 up to 07:59, by the whole hour.
    expect(["2026-11-23T21:59:00Z", "2026-11-23T22:00:00Z", "2026-11-24T03:00:00Z", "2026-11-24T07:59:00Z", "2026-11-24T08:00:00Z"].map((m) => quiet(m, "UTC"))).toEqual([false, true, true, true, false]);
    // The same moment is night in Los Angeles, the middle of the day in India, and early morning in UTC.
    expect(quiet("2026-11-23T06:30:00Z", "America/Los_Angeles")).toBe(true);
    expect(quiet("2026-11-23T06:30:00Z", "Asia/Kolkata")).toBe(false);
    expect(quiet("2026-11-23T06:30:00Z", "UTC")).toBe(true);
    // A half-hour zone: 21:45 there isn't quiet yet, 22:15 is.
    expect(quiet("2026-11-23T16:15:00Z", "Asia/Kolkata")).toBe(false);
    expect(quiet("2026-11-23T16:45:00Z", "Asia/Kolkata")).toBe(true);
    // Quiet hours inside one day, and none at all.
    expect([12, 13, 14, 15].map((h) => quiet(`2026-11-23T${h}:30:00Z`, "UTC", { quiet_from: 13, quiet_to: 15 }))).toEqual([false, true, true, false]);
    expect(quiet("2026-11-23T03:00:00Z", "UTC", { quiet_from: 9, quiet_to: 9 })).toBe(false);
  });

  it("says how long they've been away in a few plain words", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    expect([9, 19, 20, 43, 44, 200].map((h) => awayWords(later(-h, now), now))).toEqual(["a few hours", "a few hours", "since yesterday", "since yesterday", "a few days", "a few days"]);
  });
});

/* ------------------------------------------------ the decision ------------------------------------------------ */

describe("whether a scene gets a note", () => {
  const NOW = new Date("2026-11-23T15:00:00Z");
  const prefs: NotePrefs = { pace: "daily", quiet_from: 22, quiet_to: 8, time_zone: "UTC", turned_on_at: "2026-11-20T00:00:00.000Z" };
  const left = (hours: number) => later(-hours, NOW);
  const scene: NoteScene = { ended: false, paused: false, notes_off: false, last_at: left(9), note_waiting: false, anything_said: true, unanswered: 0 };
  const around: NoteAround = { character_in: true, open: true, capped: false, last_from_character: null, notes_last_day: 0 };
  const decide = (p: Partial<NotePrefs> = {}, s: Partial<NoteScene> = {}, a: Partial<NoteAround> = {}, now = NOW, waive = {}) => {
    const d = noteDecision({ ...prefs, ...p }, { ...scene, ...s }, { ...around, ...a }, now, waive);
    return d.write ? "write" : d.why;
  };

  it("yes, when everything holds; and each thing that doesn't hold says why", () => {
    expect(decide()).toBe("write");
    const cases: [string, ReturnType<typeof decide>][] = [
      ["off", decide({ pace: null })],
      ["ended", decide({}, { ended: true })],
      ["paused", decide({}, { paused: true })],
      ["told_off", decide({}, { notes_off: true })],
      ["character_out", decide({}, {}, { character_in: false })],
      ["closed", decide({}, {}, { open: false })],
      ["nothing_said", decide({}, { anything_said: false })],
      ["note_waiting", decide({}, { note_waiting: true })],
      ["unanswered", decide({}, { unanswered: NOTES_UNANSWERED })],
      ["not_idle", decide({}, { last_at: later(-(NOTE_IDLE_HOURS - 0.02), NOW) })],
      ["quiet_hours", decide({}, {}, {}, new Date("2026-11-23T23:00:00Z"))],
      ["character_pace", decide({}, {}, { last_from_character: left(23) })],
      ["day_pace", decide({}, {}, { notes_last_day: 2 })],
      ["capped", decide({}, {}, { capped: true })],
    ];
    for (const [why, got] of cases) expect(got, why).toBe(why);
    // Every reason has words for the admin who tries one by hand.
    for (const [why] of cases) expect(NOTE_WHY_WORDS[why as keyof typeof NOTE_WHY_WORDS], why).toBeTruthy();
    // Off comes before everything: nothing else is even asked.
    expect(decide({ pace: null }, { ended: true, notes_off: true }, { capped: true })).toBe("off");
  });

  it("a scene has to have been left eight hours, unless an admin is trying it; one unanswered note isn't two", () => {
    expect(decide({}, { last_at: left(NOTE_IDLE_HOURS) })).toBe("write");
    expect(decide({}, { last_at: left(1) })).toBe("not_idle");
    expect(decide({}, { last_at: left(0) }, {}, NOW, { idle: true })).toBe("write");
    // Only the wait is waived: quiet hours, the pace and everything else still hold.
    expect(decide({}, { last_at: left(0) }, {}, new Date("2026-11-23T23:00:00Z"), { idle: true })).toBe("quiet_hours");
    expect(decide({}, { last_at: left(0), unanswered: 2 }, {}, NOW, { idle: true })).toBe("unanswered");
    expect(decide({}, { unanswered: 1 })).toBe("write");
  });

  it("quiet hours are theirs: the same moment is fine in one zone and not in another", () => {
    // 15:00 UTC is midnight in Tokyo and seven in the morning in Los Angeles: both inside 22 to 8.
    expect(decide({ time_zone: "Asia/Tokyo" })).toBe("quiet_hours");
    expect(decide({ time_zone: "America/Los_Angeles" })).toBe("quiet_hours");
    expect(decide({ time_zone: "Europe/London" })).toBe("write");
    expect(decide({ time_zone: "Asia/Tokyo", quiet_from: 1, quiet_to: 6 })).toBe("write");
  });

  it("keeps to their pace: one character's notes, and the day's in all", () => {
    expect(PACES.sometimes).toMatchObject({ characterHours: 72, perDay: 1 });
    expect(PACES.daily).toMatchObject({ characterHours: 24, perDay: 2 });
    // Daily: a day between one character's notes, two a day in all.
    expect(decide({}, {}, { last_from_character: left(24) })).toBe("write");
    expect(decide({}, {}, { notes_last_day: 1 })).toBe("write");
    // Sometimes: three days between one character's notes, one a day in all.
    expect(decide({ pace: "sometimes" }, {}, { last_from_character: left(71) })).toBe("character_pace");
    expect(decide({ pace: "sometimes" }, {}, { last_from_character: left(72) })).toBe("write");
    expect(decide({ pace: "sometimes" }, {}, { notes_last_day: 1 })).toBe("day_pace");
  });
});

/* ------------------------------------------------ the note ------------------------------------------------ */

describe("what a note may say", () => {
  const PRESSING: Record<string, string[]> = {
    where_were_you: ["Where have you been all week?", '"Where did you go?" she asked the empty room.', "I keep wondering where you've been.", "She wondered where you had been."],
    why_did_you_leave: ["Why did you leave like that?", "Why haven't you written?", "She never did work out why you left.", "She could not see why you had gone."],
    been_waiting: ["I've been waiting for you.", "She waited up all night.", "She had been waiting by the window since Tuesday.", "Still waiting, in case you wondered.", "You kept me waiting.", "You kept her waiting."],
    how_long: ["It's been so long.", "It has been days, you know.", "Too long without you around here.", "Finally back, are we?", "It's about time."],
    dont_leave: ["Don't leave me like that again.", "Please come back.", "Come back to me.", "Don't go away again.", "Never leave me."],
    need_you: ["Without you I don't know what to do.", "I can't cope when you're gone.", "She couldn't cope with the quiet.", "I'm lost without you.", "She was lost without you.", "I need you back.", "I can't sleep without you."],
    did_i_do_wrong: ["Did I do something wrong?", "Had she said something wrong?", "Was it something I said?", "Are you mad at me?", "What did I do?"],
    forgot_me: ["Did you forget about me?", "You forgot me.", "I think you've forgotten me.", "You had forgotten her.", "You abandoned me.", "You left me here.", "You left her waiting.", "Are you ignoring me?"],
    hurt: ["It hurts when you go quiet.", "You hurt me.", "I'm hurt, honestly.", "You broke my heart a little.", "I've been so lonely.", "She had been so lonely.", "I cried myself to sleep.", "She cried herself to sleep."],
    you_promised: ["You promised you'd be back.", "You had promised.", "You said you would write.", "Promise me you'll come tomorrow.", "You owe me an evening."],
  };

  it("never guilt or pressure: each way of pressing is caught", () => {
    // Every pattern has its examples here, so a new one can't arrive untested.
    expect(Object.keys(PRESSING).sort()).toEqual(NOTE_PRESSURE.map((p) => p.id).sort());
    for (const [id, lines] of Object.entries(PRESSING)) for (const line of lines) expect(notePressure(line), `${id}: ${line}`).toBe(id);
  });

  it("and an ordinary note, about her own evening or where they left it, is let through", () => {
    const fine = [
      ...NOTES.map((n) => (JSON.parse(n) as { story: string[] }).story.join(" ")),
      "I've been sitting here with the crossword and a cold cup of tea. Seven letters, a slow walk?",
      "The rain finally stopped, so I walked the long way round. Have you ever seen the canal at night?",
      "I couldn't sleep, so I baked. There is far too much bread here now. Do you like rye?",
      "I left the door on the latch out of habit. The cat thinks it's for her. What should I name her?",
      "You left your scarf on the hook. It smells of rain. Shall I keep it warm for you?",
      "I went to the market and they asked where the tall one was. I said you were busy being mysterious. What should I tell them next time?",
      "I was thinking about what you said about the lighthouse. Is it really true you can see it from the pier?",
    ];
    for (const line of fine) expect(notePressure(line), line).toBeNull();
  });

  it("its cue asks for one short note with something easy to answer, says how long it's been, and lists what never to do", () => {
    const cue = noteCue("since yesterday", false);
    expect(cue).toMatch(/^\(They aren't here: it has been since yesterday since they were\. Write to them first/);
    expect(cue).toContain("one short paragraph in your own voice");
    expect(cue).toContain("ending on something easy to answer");
    expect(cue).toContain(NOTE_NEVER);
    expect(cue).not.toContain("Stay inside the story");
    expect(noteCue("a few days", true)).toContain("Stay inside the story the two of you are playing.");
    for (const never of ["don't ask where they've been or why they left", "don't say you've been waiting", "don't ask them to promise anything", "Don't move the scene on or decide anything without them"]) expect(NOTE_NEVER).toContain(never);
    expect(NOTE_NEVER).toMatch(/^Never make them feel bad for being away, and never press them to come back/);
    expect(NOTE_PARAGRAPHS).toBe(2);
  });

  it("a note's first line is what the pages show, cut at a sentence when it's long", () => {
    expect(noteLine("Short and  sweet.")).toBe("Short and sweet.");
    const long = `She found the corkscrew in the cutlery drawer the next morning and laughed out loud. "This one is yours, I think." ${"And more, and more. ".repeat(12)}`;
    expect(noteLine(long).length).toBeLessThanOrEqual(141);
    expect(noteLine(long)).toMatch(/[.?!"…]$/);
  });
});

/* ------------------------------------------------ their choice ------------------------------------------------ */

describe("the person's choice", () => {
  it("is off until they turn it on, keeps a zone it doesn't know as UTC, and refuses an hour that isn't one", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    expect(await notePrefs(t.db, a.id)).toEqual(NOTES_OFF);
    const first = (await (await notesGet(get(NOTES_PATH, a.cookie))).json()) as { notes: NotePrefs; about: string; paces: { id: string; says: string }[]; waiting: unknown[] };
    expect(first.notes).toEqual(NOTES_OFF);
    expect(first.about).toBe(NOTES_ABOUT);
    expect(first.paces.map((p) => p.id)).toEqual(["sometimes", "daily"]);
    expect(first.waiting).toEqual([]);
    // What turning it on means is said in its own words: what it stores, what it costs, that nothing leaves the site.
    for (const said of ["your time zone", "the hours you picked", "one of the month's replies", "Nothing is emailed or sent to your phone", "turning it off stops it at once"]) expect(NOTES_ABOUT).toContain(said);
    const saved = await notesPost(post(NOTES_PATH, { action: "save", pace: "sometimes", quiet_from: 23, quiet_to: 7, time_zone: "America/Los_Angeles" }, a.cookie));
    expect(saved.status).toBe(200);
    expect((await saved.json()).notes).toMatchObject({ pace: "sometimes", quiet_from: 23, quiet_to: 7, time_zone: "America/Los_Angeles", turned_on_at: expect.any(String) });
    expect((await (await notesPost(post(NOTES_PATH, { action: "save", pace: "daily", time_zone: "Mars/Olympus_Mons" }, a.cookie))).json()).notes).toMatchObject({ pace: "daily", quiet_from: 23, quiet_to: 7, time_zone: "UTC" });
    for (const bad of [{ pace: "daily", quiet_from: 24 }, { pace: "daily", quiet_to: -1 }, { pace: "daily", quiet_from: 7.5 }, { pace: "hourly" }, { quiet_from: 3 }]) {
      expect((await notesPost(post(NOTES_PATH, { action: "save", ...bad }, a.cookie))).status, JSON.stringify(bad)).toBe(422);
    }
    // Off stops everything and keeps what they'd set, for turning it on again.
    expect((await (await notesPost(post(NOTES_PATH, { action: "save", pace: null }, a.cookie))).json()).notes).toMatchObject({ pace: null, quiet_from: 23, quiet_to: 7, turned_on_at: null });
    // Closed like the rest of Step in: admins only until its switch is opened.
    const sub = await subscriber();
    expect((await notesGet(get(NOTES_PATH, sub.cookie))).status).toBe(404);
    expect((await notesPost(post(NOTES_PATH, { action: "save", pace: "daily" }, sub.cookie))).status).toBe(404);
  });

  it("is in After Dark's download, and goes when they delete their After Dark profile", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const id = await scene(a.id);
    expect((await exportAdultProfile(t.db, a.id)).notes_first).toEqual({ about: NOTES_ABOUT, on: false, how_often: null, quiet_hours: { from: 22, to: 8 }, time_zone: null, turned_on_at: null, scenes_told_not_to: [] });
    await on(a.id, { pace: "sometimes", quiet_from: 21, quiet_to: 6, time_zone: "Europe/Lisbon" });
    await setSceneNotes(t.db, a.id, id, true);
    expect((await exportAdultProfile(t.db, a.id)).notes_first).toMatchObject({ on: true, how_often: "sometimes", quiet_hours: { from: 21, to: 6 }, time_zone: "Europe/Lisbon", turned_on_at: expect.any(String), scenes_told_not_to: [id] });
    await deleteAdultProfile(t.db, a.id);
    expect(await notePrefs(t.db, a.id)).toEqual(NOTES_OFF);
    expect((await rows(`select step_in_tz, step_in_quiet_from, step_in_notes from adult_prefs where user_id = $1`, [a.id]))[0]).toEqual({ step_in_tz: null, step_in_quiet_from: null, step_in_notes: null });
    expect((await sceneRow(id)).notes_off).toBe(false);
  });
});

/* ------------------------------------------------ the pass ------------------------------------------------ */

describe("the pass", () => {
  it("writes one note in a scene that's been left: a reply like any other, kept as theirs, counted once, with no AI notice of its own", async () => {
    const seen = scripted();
    await open();
    const sub = await subscriber();
    await on(sub.id);
    const id = await scene(sub.id);
    const before = { replies: await replies(sub.id), lines: await kinds(id) };
    // Not left long enough yet: it isn't even looked at.
    expect(await writeDueNotes(t.db, later(NOTE_IDLE_HOURS - 1))).toMatchObject({ ok: true, looked: 0, written: 0, stopped: "done" });
    const run = await writeDueNotes(t.db, later(9));
    expect(run).toEqual({ ok: true, looked: 1, written: 1, failed: 0, skipped: {}, stopped: "done" });
    // One call, asked with the note's own cue after the scene so far.
    expect(seen.notes).toHaveLength(1);
    expect(lastUser(seen.notes[0])).toContain(noteCue("a few hours", false));
    // Kept as the character's line, marked as a note; nothing else was added (the AI notice waits for their next line).
    expect(await kinds(id)).toEqual([...before.lines, "character:note"]);
    expect(await replies(sub.id)).toBe(before.replies + 1);
    const view = await viewOf(sub.id, id);
    expect(view.messages.at(-1)).toMatchObject({ role: "character", kind: "note" });
    expect(view.messages.at(-1)!.text).toContain("corkscrew");
    expect(view.notes).toEqual({ on: true, scene_off: false, waiting: true, try_now: false });
    // The step log says what kind of move it was, and never a word of it.
    const logged = (await rows(`select flags from adult_steps where owner_id = $1 order by created_at desc limit 1`, [sub.id]))[0].flags as { action?: string };
    expect(logged.action).toBe("note");
    // The scene says a note is waiting; the pass's claim was let go.
    expect(await sceneRow(id)).toMatchObject({ note_at: expect.anything(), notes_claimed_at: null });
    expect(await notesWaiting(t.db, sub.id)).toEqual([{ scene: id, character: WHO, name: NAME, at: expect.any(String), line: expect.stringContaining("corkscrew") }]);
    expect(await notesWaitingCount(t.db, sub.id)).toBe(1);
    // While it waits unseen, nothing more is written there.
    expect(await writeDueNotes(t.db, later(40))).toMatchObject({ looked: 0, written: 0 });
    // Their next line takes the mark away, and gets the AI notice it was due.
    const sent = await sendStepInLine(t.db, sub.id, id, "Keep it. I have three.", later(41));
    expect(sent.ok).toBe(true);
    expect((await sceneRow(id)).note_at).toBeNull();
    expect(await kinds(id)).toEqual([...before.lines, "character:note", "system:notice", "viewer", "character"]);
    expect((await rows(`select text from adult_step_in_messages where scene_id = $1 and kind = 'notice' order by created_at desc limit 1`, [id]))[0].text).toBe(stepInNotice(NAME));
  });

  it("stops when it isn't being answered: after two notes in a row, no more until they write", async () => {
    scripted();
    await open();
    const sub = await subscriber();
    await on(sub.id);
    const id = await scene(sub.id);
    const t0 = new Date();
    expect(await writeDueNotes(t.db, later(9, t0))).toMatchObject({ written: 1 });
    // They open the scene and say nothing: the note has been seen, not answered.
    expect(await seenNote(t.db, sub.id, id)).toBe(true);
    expect(await seenNote(t.db, sub.id, id)).toBe(false);
    // Nine hours on: left long enough, but one note a day from any one of them.
    expect(await writeDueNotes(t.db, later(18, t0))).toMatchObject({ written: 0, skipped: { character_pace: 1 } });
    expect(await writeDueNotes(t.db, later(34, t0))).toMatchObject({ written: 1 });
    await seenNote(t.db, sub.id, id);
    // Two in a row with nothing from them between: that scene gets no more.
    expect(await writeDueNotes(t.db, later(60, t0))).toMatchObject({ written: 0, skipped: { unanswered: 1 } });
    expect(await writeDueNotes(t.db, later(200, t0))).toMatchObject({ written: 0, skipped: { unanswered: 1 } });
    expect((await kinds(id)).filter((k) => k === "character:note")).toHaveLength(2);
    // Once they've written, it can again.
    await sendStepInLine(t.db, sub.id, id, "Sorry, long week. Rye, always.", later(201, t0));
    expect(await writeDueNotes(t.db, later(212, t0))).toMatchObject({ written: 1 });
  });

  it("keeps to quiet hours in their zone, to their pace across characters, and to a scene that was told not to", async () => {
    scripted();
    await open();
    const sub = await subscriber();
    const first = await scene(sub.id, WHO);
    const second = await scene(sub.id, OTHER);
    const now = later(9);
    // Quiet all day but one hour, in their zone: whatever the hour is there now, it's inside.
    const hour = localHour(now, "Asia/Kolkata");
    await on(sub.id, { pace: "sometimes", quiet_from: (hour + 23) % 24, quiet_to: (hour + 1) % 24, time_zone: "Asia/Kolkata" });
    expect(await writeDueNotes(t.db, now)).toMatchObject({ looked: 2, written: 0, skipped: { quiet_hours: 2 } });
    // The same hours in UTC would have let it through: the zone is what's read.
    expect(inQuietHours(now, { quiet_from: (hour + 23) % 24, quiet_to: (hour + 1) % 24, time_zone: "Asia/Kolkata" })).toBe(true);
    // No quiet hours, "sometimes": one a day in all, so the second scene waits.
    await on(sub.id, { pace: "sometimes" });
    expect(await writeDueNotes(t.db, now)).toMatchObject({ looked: 2, written: 1, skipped: { day_pace: 1 } });
    // "Daily" allows two a day in all, one from each of them.
    await on(sub.id, { pace: "daily" });
    expect(await writeDueNotes(t.db, now)).toMatchObject({ looked: 1, written: 1 });
    expect((await notesWaiting(t.db, sub.id)).map((n) => n.scene).sort()).toEqual([first, second].sort());
    // A scene told not to is never looked at, whatever else holds.
    for (const id of [first, second]) await seenNote(t.db, sub.id, id);
    expect(await setSceneNotes(t.db, sub.id, first, true)).toBe(true);
    expect(await setSceneNotes(t.db, randomUUID(), second, true)).toBe(false);
    expect(await writeDueNotes(t.db, later(60))).toMatchObject({ looked: 1 });
    expect((await viewOf(sub.id, first)).notes).toMatchObject({ on: true, scene_off: true });
  });

  it("writes nothing where it's off, ended, capped or closed to them, and nothing in a scene nobody has spoken in", async () => {
    scripted();
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" }, caps: { step_in: 3 } });
    const sub = await subscriber();
    const id = await scene(sub.id);
    // Off (how it starts): not a candidate.
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ looked: 0, written: 0 });
    await on(sub.id);
    // The month's replies are used (an opening, a reply, and one more).
    await sendStepInLine(t.db, sub.id, id, "And the olives?");
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ looked: 1, written: 0, skipped: { capped: 1 } });
    await saveAdultSettings(t.db, { caps: { step_in: 50 } });
    // Step in closed to them again (the switch back on admins only): nothing is written for a scene they can't open.
    await saveAdultSettings(t.db, { rollout: { companion: "admins" } });
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ looked: 1, written: 0, skipped: { closed: 1 } });
    await open();
    // Their pass has run out: After Dark doesn't open for them, so neither does this.
    await t.db.query(`update adult_entitlements set subscription_status = 'cancelled', period_end = now() - interval '1 day' where user_id = $1`, [sub.id]);
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ written: 0, skipped: { closed: 1 } });
    await t.db.query(`update adult_entitlements set subscription_status = 'active', period_end = null where user_id = $1`, [sub.id]);
    // Ended: not a candidate.
    await endStepIn(t.db, sub.id, id);
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ looked: 0 });
    // A scene made and never opened has nothing to carry on from.
    const empty = randomUUID();
    await t.db.query(`insert into adult_step_in_scenes (id, owner_id, character_id, place, last_at) values ($1, $2, $3, 'home', now())`, [empty, sub.id, OTHER]);
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ looked: 1, written: 0, skipped: { nothing_said: 1 } });
    expect(await replies(sub.id)).toBe(3);
  });

  it("a note that presses is drawn once more; if that one presses too, nothing is written, nothing counted, and the scene isn't tried again for a while", async () => {
    const seen = scripted(story("I've been waiting for you all night."), NOTES[1]);
    await open();
    const sub = await subscriber();
    await on(sub.id);
    const id = await scene(sub.id);
    const before = await replies(sub.id);
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ written: 1, failed: 0 });
    expect(seen.notes).toHaveLength(2);
    expect(lastUser(seen.notes[1])).toContain("it made them feel bad for being away, or pressed them to come back");
    expect((await viewOf(sub.id, id)).messages.at(-1)!.text).toContain("almond");
    expect(JSON.stringify(await rows(`select * from adult_step_in_messages where scene_id = $1`, [id]))).not.toContain("been waiting");
    const flags = (await rows(`select flags from adult_steps where owner_id = $1 order by created_at desc limit 1`, [sub.id]))[0].flags as { redrawn?: string[] };
    expect(flags.redrawn).toEqual(["note:been_waiting"]);
    expect(await replies(sub.id)).toBe(before + 1);

    // Both drafts press: no stand-in, no line, no count.
    const other = await subscriber();
    await on(other.id);
    const theirs = await scene(other.id);
    scripted(story("Where have you been?"), story("Did I do something wrong?"));
    const lines = await kinds(theirs);
    const counted = await replies(other.id);
    const t0 = new Date();
    expect(await writeDueNotes(t.db, later(9, t0))).toMatchObject({ written: 0, failed: 1 });
    expect(await kinds(theirs)).toEqual(lines);
    expect(await replies(other.id)).toBe(counted);
    expect(await sceneRow(theirs)).toMatchObject({ note_at: null, notes_claimed_at: expect.anything() });
    // The claim it kept holds the scene back, so one that can't be written isn't tried every hour.
    scripted();
    expect(await writeDueNotes(t.db, later(9 + NOTE_CLAIM_HOURS - 1, t0))).toMatchObject({ looked: 0 });
    expect(await writeDueNotes(t.db, later(9 + NOTE_CLAIM_HOURS + 1, t0))).toMatchObject({ looked: 1, written: 1 });
  });

  it("no model, no note; and a long draft is kept to its first two paragraphs", async () => {
    scripted(new Error("down"));
    await open();
    const sub = await subscriber();
    await on(sub.id);
    const id = await scene(sub.id);
    const lines = await kinds(id);
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ written: 0, failed: 1 });
    expect(await kinds(id)).toEqual(lines);
    await t.db.query(`update adult_step_in_scenes set notes_claimed_at = null where id = $1`, [id]);
    scripted(story("One, about the bread.", 'Two. "Do you like rye?"', "Three, which is too many.", "Four."));
    expect(await writeDueNotes(t.db, later(9))).toMatchObject({ written: 1 });
    const text = (await viewOf(sub.id, id)).messages.at(-1)!.text;
    expect(text).toBe('One, about the bread.\n\nTwo. "Do you like rye?"');
  });

  it("two passes at once write one note, and a run and a day are bounded", async () => {
    scripted();
    await open();
    const people = [await subscriber(), await subscriber(), await subscriber()];
    const scenes: string[] = [];
    for (const p of people) {
      await on(p.id);
      scenes.push(await scene(p.id));
    }
    // The claim: only one of two passes started together writes any one scene.
    const now = later(9);
    const [x, y] = await Promise.all([writeDueNotes(t.db, now, { max: 1 }), writeDueNotes(t.db, now, { max: 1 })]);
    const written = (await rows(`select scene_id from adult_step_in_messages where kind = 'note'`)).map((r) => r.scene_id);
    expect(new Set(written).size).toBe(written.length);
    expect(x.written + y.written).toBe(written.length);
    expect(written.length).toBeGreaterThanOrEqual(1);
    expect(written.length).toBeLessThanOrEqual(2);
    // A run stops at its bound, and says so.
    expect(NOTES_RUN_MAX).toBe(25);
    expect(NOTES_SITE_DAY_MAX).toBe(300);
    expect(NOTES_RIDE_ALONG).toEqual({ max: 10, budgetMs: 60_000 });
    /** As if no note had been written yet: none kept, nothing waiting, no claim, and each scene last touched just now. */
    const fresh = async () => {
      await t.db.query(`delete from adult_step_in_messages where kind = 'note'`);
      await t.db.query(`update adult_step_in_scenes set note_at = null, notes_claimed_at = null, last_at = now()`);
    };
    await fresh();
    expect(await writeDueNotes(t.db, now, { max: 2 })).toMatchObject({ written: 2, stopped: "run_max" });
    // The site's day: once it's reached, nothing more is even looked at.
    expect(await writeDueNotes(t.db, now, { siteDayMax: 2 })).toMatchObject({ looked: 0, written: 0, stopped: "site_day_max" });
    expect(await writeDueNotes(t.db, now, { siteDayMax: 3 })).toMatchObject({ written: 1, stopped: "done" });
    // And the clock: a pass that has run out of time starts no more.
    await fresh();
    let ticks = 0;
    expect(await writeDueNotes(t.db, now, { budgetMs: 1000, clock: () => (ticks++ === 0 ? 0 : 5000) })).toMatchObject({ looked: 0, written: 0, stopped: "time" });
  });
});

/* ------------------------------------------------ the routes and the pages ------------------------------------------------ */

describe("the routes", () => {
  it("the job answers only the scheduler, and says what the pass did", async () => {
    scripted();
    await open();
    const sub = await subscriber();
    await on(sub.id);
    await scene(sub.id);
    await t.db.query(`update adult_step_in_scenes set last_at = now() - interval '9 hours'`);
    const path = `${BASE_URL}/api/jobs/step-in-notes`;
    expect((await jobGet(new Request(path))).status).toBe(404);
    expect((await jobGet(new Request(path, { headers: { authorization: "Bearer wrong" } }))).status).toBe(404);
    const res = await jobGet(new Request(path, { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toMatchObject({ ok: true, looked: 1, written: 1, stopped: "done" });
    // It rides along on the two routes the scheduler already calls on After Dark's host, with a smaller share of their time.
    for (const route of ["app/api/jobs/showcase-check/route.ts", "app/api/jobs/after-dark-daily/route.ts"]) expect(readFileSync(route, "utf8"), route).toContain("writeDueNotes(db, new Date(), NOTES_RIDE_ALONG)");
    // The scheduler's own spec is untouched: it reaches the live app only by hand.
    expect(readFileSync(".do/app.yaml", "utf8")).not.toContain("step-in-notes");
  });

  it("a scene is told not to, a note is marked seen, and an admin can have one written now; nobody does any of it to someone else's scene", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const id = await scene(a.id);
    const other = await admin();
    // Someone else's scene: not found, and nothing changes.
    for (const body of [{ action: "scene", scene_id: id, off: true }, { action: "now", scene_id: id }]) expect((await notesPost(post(NOTES_PATH, body, other.cookie))).status, body.action).toBe(404);
    expect(await (await notesPost(post(NOTES_PATH, { action: "seen", scene_id: id }, other.cookie))).json()).toEqual({ seen: false });
    // Off for them: an admin's try says why not, in words.
    const off = await notesPost(post(NOTES_PATH, { action: "now", scene_id: id }, a.cookie));
    expect(off.status).toBe(409);
    expect(await off.json()).toMatchObject({ error: "off", message: NOTE_WHY_WORDS.off, scene: { id } });
    await on(a.id);
    // On: written now, though the scene was only just left (only that wait is waived).
    const now = await notesPost(post(NOTES_PATH, { action: "now", scene_id: id }, a.cookie));
    expect(now.status).toBe(200);
    const body = (await now.json()) as { note: string; scene: { messages: { id: string; kind: string | null }[]; notes: { waiting: boolean; try_now: boolean } } };
    expect(body.scene.messages.at(-1)).toMatchObject({ id: body.note, kind: "note" });
    expect(body.scene.notes).toMatchObject({ waiting: true, try_now: true });
    // One is waiting, so another isn't written on top of it.
    expect(await (await notesPost(post(NOTES_PATH, { action: "now", scene_id: id }, a.cookie))).json()).toMatchObject({ error: "note_waiting" });
    expect(await (await notesPost(post(NOTES_PATH, { action: "seen", scene_id: id }, a.cookie))).json()).toEqual({ seen: true });
    expect((await viewOf(a.id, id)).notes.waiting).toBe(false);
    // Told not to: the scene says so, and a try is refused.
    const told = await notesPost(post(NOTES_PATH, { action: "scene", scene_id: id, off: true }, a.cookie));
    expect((await told.json()).scene.notes).toMatchObject({ on: true, scene_off: true });
    expect(await writeNoteNow(t.db, a.id, id)).toMatchObject({ ok: false, status: 409, why: "told_off" });
    // "Write now" is an admin's: a subscriber gets not found even on their own scene.
    await open();
    const sub = await subscriber();
    await on(sub.id);
    const theirs = await scene(sub.id);
    expect(await writeNoteNow(t.db, sub.id, theirs)).toMatchObject({ ok: false, status: 404 });
    expect((await viewOf(sub.id, theirs)).notes.try_now).toBe(false);
  });
});

describe("where they see it", () => {
  it("in the scene: the note is marked as written first, and the menu says the state, with plain buttons", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const id = await scene(a.id);
    signIn(a.id);
    const page = async () => html(await StepInScenePage({ params: Promise.resolve({ id }) }));
    // Off for them: the menu points at where to turn it on.
    const off = await page();
    expect(off).toMatch(/<a class="button-ghost small"[^>]*href="\/after-dark\/account#notes"[^>]*>✉ [^<]* can write to you first: off<\/a>/);
    expect(off).not.toContain("data-step-in-note-now");
    expect(off).not.toContain('data-kind="note"');
    await on(a.id);
    expect(await writeNoteNow(t.db, a.id, id)).toMatchObject({ ok: true });
    const noted = await page();
    expect(noted).toMatch(/<li class="ad-si-them" data-kind="note">/);
    expect(noted).toMatch(/<span class="ad-si-noted muted small" data-step-in-note="true"><span aria-hidden="true">✉ <\/span>wrote first · <time/);
    // The scene's own switch and an admin's "write now", both plain buttons (the menu sits inside the composer's form).
    expect(noted).toMatch(/<button type="button" class="button-ghost small" aria-pressed="false" data-step-in-notes="on">/);
    expect(noted).toMatch(/<button type="button" class="button-ghost small" data-step-in-note-now="true">/);
    await setSceneNotes(t.db, a.id, id, true);
    const told = await page();
    expect(told).toContain(`✉ ${NAME} doesn&#x27;t write first in this scene`);
    expect(told).not.toContain("data-step-in-note-now");
    // No form anywhere in the menu, as its other panels are held to.
    expect(told.slice(told.indexOf('<div class="ad-si-menu-items">'), told.indexOf("</details>", told.indexOf('<div class="ad-si-menu-items">')))).not.toContain("<form");
  });

  it("on Step in's front page, a character's card, the hub's tile and the header's door, and never in the tab's title", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    await on(a.id);
    const plain = await scene(a.id, OTHER);
    const id = await scene(a.id, WHO);
    signIn(a.id);
    const pages = async () => ({
      front: await html(await StepInSetupPage({ searchParams: Promise.resolve({}) })),
      cast: await html(await AfterDarkCharactersPage({ searchParams: Promise.resolve({}) })),
      hub: await html(await AfterDarkHome({ searchParams: Promise.resolve({}) })),
    });
    const before = await pages();
    for (const [name, page] of Object.entries(before)) expect(page, name).not.toMatch(/wrote to you/);
    expect((await afterDarkDoors(t.db, a.id)).notes).toBe(0);
    // The older scene gets the note, so it isn't first by being newest.
    await t.db.query(`update adult_step_in_scenes set last_at = now() - interval '1 hour' where id = $1`, [id]);
    expect(await writeNoteNow(t.db, a.id, id, later(-0.5))).toMatchObject({ ok: true });
    await t.db.query(`update adult_step_in_scenes set last_at = now() where id = $1`, [plain]);
    const after = await pages();
    // The front page: that scene comes first, and says who wrote and how the note starts.
    const order = [...after.front.matchAll(/<li class="card ad-si-scene-row" data-step-in-scene="([^"]+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 2)).toEqual([id, plain]);
    expect(after.front).toMatch(new RegExp(`data-step-in-note-waiting="true"><span aria-hidden="true">✉ </span><strong>${NAME} wrote to you\\.</strong> She found the corkscrew`));
    expect(after.front.match(/data-step-in-note-waiting/g)).toHaveLength(1);
    // Their card: the mark, and the button still goes back into the scene.
    expect(after.cast).toMatch(new RegExp(`data-character-note="true"><span aria-hidden="true">✉ </span>${NAME} wrote to you</span>`));
    expect(after.cast.match(/data-character-note/g)).toHaveLength(1);
    expect(after.cast).toContain(`href="/after-dark/step-in/${id}"`);
    // The hub's tile: a link to the note.
    expect(after.hub).toMatch(new RegExp(`data-step-in-tile-notes="true"><a href="/after-dark/step-in/${id}"><span aria-hidden="true">✉ </span>${NAME} wrote to you</a>`));
    // The header's door carries the count, on After Dark's own host only, and the tab's title never does.
    expect((await afterDarkDoors(t.db, a.id)).notes).toBe(1);
    const nav = readFileSync("app/Nav.tsx", "utf8");
    expect(nav).toContain('adHost && l.href === "/after-dark" && (adDoors.notes ?? 0) > 0');
    for (const file of ["app/after-dark/step-in/[id]/page.tsx", "app/after-dark/step-in/page.tsx", "app/after-dark/layout.tsx"]) expect(readFileSync(file, "utf8"), file).not.toMatch(/title:[^\n]*notes?\b.*waiting/i);
    // Seen: every mark goes.
    await seenNote(t.db, a.id, id);
    const seen = await pages();
    for (const [name, page] of Object.entries(seen)) expect(page, name).not.toMatch(/wrote to you/);
    expect((await afterDarkDoors(t.db, a.id)).notes).toBe(0);
  });

  it("on the account page: off with what it means, then how often and the quiet hours in their zone", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    signIn(a.id);
    const off = await html(await AfterDarkAccountPage());
    expect(off).toContain('id="notes" data-step-in-notes-card="off"');
    expect(off).toContain(NOTES_ABOUT.replace(/'/g, "&#x27;"));
    expect(off).not.toContain("data-step-in-notes-quiet");
    await on(a.id, { pace: "sometimes", quiet_from: 23, quiet_to: 7, time_zone: "America/Los_Angeles" });
    const set = await html(await AfterDarkAccountPage());
    expect(set).toContain('data-step-in-notes-card="sometimes"');
    expect(set).toContain(PACES.sometimes.says);
    expect(set).toMatch(/<option value="23" selected="">23:00<\/option>/);
    expect(set).toMatch(/<option value="7" selected="">07:00<\/option>/);
    expect(set).toContain('<span data-step-in-notes-zone="true">America/Los_Angeles</span>');
    // Where Step in isn't open to someone, the card isn't there.
    const sub = await subscriber();
    signIn(sub.id);
    expect(await html(await AfterDarkAccountPage())).not.toContain("data-step-in-notes-card");
  });
});

describe("in the prompt", () => {
  it("a note is asked for after the scene so far, once, and nothing about it is in an ordinary reply's prompt", async () => {
    await saveAdultSettings(t.db, {});
    const character = (await sceneCharacter(t.db, WHO))!;
    const base = { character, place: { label: "your place", situation: null, public: false }, roleplay: null, persona: null, limits: NO_LIMITS, turns: [{ role: "viewer" as const, text: "I brought the wine." }, { role: "character" as const, text: "She smiled." }] };
    const note = stepInMessages({ ...base, cue: "note", away: "a few days" });
    expect(lastUser(note)).toBe(noteCue("a few days", false));
    expect(note.at(-1)!.role).toBe("user");
    const plain = stepInMessages({ ...base, cue: "continue" });
    expect(JSON.stringify(plain)).not.toContain("Write to them first");
    expect(JSON.stringify(plain)).not.toContain(NOTE_NEVER);
  });
});
