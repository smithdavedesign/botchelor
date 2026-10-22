import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { GET as whyGet } from "@/app/api/admin/after-dark/why/route";
import { GET as setGet } from "@/app/api/sets/[slug]/route";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import SceneWriter from "@/app/after-dark/[a]/[b]/SceneWriter";
import { nextShown, type Shown } from "@/app/after-dark/[a]/[b]/useSteadySet";
import { HIVE_MODERATION, setCheckFetchForTests } from "@/lib/adult/check";
import { agreedMove, canonicalSet, closestSet, MAX_SCENE_MOVES, repeatOf, samePlace, settlePlace } from "@/lib/adult/continuity";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { observeNight, reportMarkdown, type ObserverInput } from "@/lib/adult/observer";
import { dropRepeats, type AdultScene } from "@/lib/adult/scenes";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { ensureSet, resolveSet, retryDueSets, SET_MODEL, setSetsFetchForTests } from "@/lib/sets";
import { setPath } from "@/lib/venues";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark's continuity (David, 2026-10-21): stable sets, provoked moves, no repeated lines, a private why per line.
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
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
  setCheckFetchForTests(null);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
/** A scripted model: each call takes the next reply (the last one repeats). */
function scripted(...replies: unknown[]) {
  let i = 0;
  setAdultModelForTests({ complete: async () => JSON.stringify(replies[Math.min(i++, replies.length - 1)]) });
}
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const write = async (cookie: string) => (await (await post({ a: CAST_A, b: CAST_B }, cookie)).json()) as { scene: AdultScene; added: number; repeats: number };
const stored = async () => (await t.db.query<{ lines: { who: string; text: string; why?: string; memory?: string | null; moved_to?: string }[]; set_place: string | null; place: string | null; moves: { taken: boolean; reason: string; to: string }[]; place_history: { set: string }[] }>(`select lines, set_place, place, moves, place_history from adult_scenes`)).rows[0];
/** Puts the scene somewhere already, as if earlier lines had got them there. */
const placeAt = (set: string, place = set) => t.db.query(`update adult_scenes set set_place = $1, place = $2, place_history = $3::jsonb`, [set, place, JSON.stringify([{ place, set, home: null, chapter: 1 }])]);

describe("stable sets: a set is a place, not a mood", () => {
  it("canonicalizes a set's name down to its place noun", () => {
    for (const [label, canonical] of [
      ["bedroom glow", "bedroom"],
      ["bedroom ambiance", "bedroom"],
      ["bedroom buzzing", "bedroom"],
      ["bedroom's edge", "bedroom"],
      ["the bedroom, dimly lit", "bedroom"],
      ["same bedroom", "bedroom"],
      ["his bedroom", "bedroom"],
      ["messy bedroom", "bedroom"],
      ["middle of bed", "bedroom"],
      ["still on the bed", "bedroom"],
      ["Chud's living room", "living room"],
      ["cozy living space", "living room"],
      ["a rooftop pool at midnight", "rooftop pool"],
      ["hotel corridor", "hotel hallway"],
      ["Chud's place", "home"],
    ] as const) {
      expect(canonicalSet(label).canonical, label).toBe(canonical);
    }
    expect(canonicalSet("Chud's living room").owner).toBe("chud");
    // Nothing that names a place: no set at all.
    expect(canonicalSet("intimate, private space")).toMatchObject({ canonical: "", head: null, known: false });
    expect(canonicalSet("on the swing").known).toBe(false);
    expect(samePlace("bedroom glow", "the cozy bedroom")).toBe(true);
    expect(samePlace("Chud's living room", "Star's living room")).toBe(false);
    expect(samePlace("his apartment", "his living room")).toBe(true);
    expect(samePlace("his bedroom", "the balcony")).toBe(false);
  });

  it("reuses the closest ready set for the same place, and draws a new one under its canonical name", async () => {
    expect(closestSet("bedroom glow", ["cozy bedroom", "bed", "by the bed", "chud's living room"])).toBe("cozy bedroom");
    expect(closestSet("on the bed", ["cozy bedroom", "bed"])).toBe("bed");
    expect(closestSet("cozy bedroom glow", ["bed", "cozy bedroom"])).toBe("cozy bedroom");
    expect(closestSet("balcony", ["cozy bedroom"])).toBeNull();
    await t.db.query(`insert into place_sets (normalized, label, status, mime, data) values ('cozy bedroom', 'cozy bedroom', 'ready', 'image/jpeg', '\\x00'), ('his apartment', 'his apartment', 'ready', 'image/jpeg', '\\x00')`);
    expect(await resolveSet(t.db, "bedroom ambiance")).toBe("cozy bedroom");
    // v2.2: whose it is stays, so Chud's place is his own set, not anyone's "his apartment".
    expect(await resolveSet(t.db, "Chud's place")).toBe("Chud's living room");
    // No ready set for it: its canonical name, drawn once (no keys here, so it's only claimed and fails).
    expect(await resolveSet(t.db, "the moonlit balcony glow")).toBe("balcony");
  });
});

describe("provoked moves", () => {
  it("a rewording of where they are keeps the set", async () => {
    const { cookie } = await admin();
    scripted({ lines: [{ who: "a", text: "Hi." }] });
    await write(cookie);
    await placeAt("his bedroom");
    scripted({ lines: [{ who: "a", text: "Stay right there." }, { who: "b", text: "Not going anywhere." }], place: "on the bed, in the glow", set: "bedroom glow" });
    const r = await write(cookie);
    expect(r.scene.set_place).toBe("his bedroom");
    expect(r.scene.place).toBe("on the bed, in the glow");
    expect((await stored()).moves).toEqual([]);
  });

  it("ignores a move nobody agreed to, logs it, and takes one that was proposed and agreed", async () => {
    const { cookie } = await admin();
    scripted({ lines: [{ who: "a", text: "Hi." }] });
    await write(cookie);
    await placeAt("Chud's living room");
    // Star × Chud, chapter 2 line 73: onto the balcony, nobody suggested it.
    scripted({ lines: [{ who: "a", action: "grins, stepping onto the balcony", text: "The stars are witnesses." }, { who: "b", text: "With you, I'm always ready." }], place: "the balcony", set: "private balcony" });
    let r = await write(cookie);
    expect(r.scene.set_place).toBe("Chud's living room");
    expect(r.scene.place).toBe("Chud's living room");
    expect((await stored()).moves).toMatchObject([{ taken: false, reason: "no_agreement", to: "private balcony" }]);
    // Proposed and agreed: they go.
    scripted({ lines: [{ who: "a", text: "Shall we take this to the bedroom?" }, { who: "b", action: "nods, taking her hand", text: "Lead the way." }], place: "his bedroom", set: "his bedroom" });
    r = await write(cookie);
    expect(r.scene.set_place).toBe("bedroom");
    const s = await stored();
    expect(s.moves.at(-1)).toMatchObject({ taken: true, reason: "agreed", to: "bedroom" });
    expect(s.lines.at(-1)?.moved_to).toBe("bedroom");
    expect(s.place_history.map((p) => p.set)).toEqual(["Chud's living room", "bedroom"]);
    // The page never sees the move stamp or the private notes.
    expect(JSON.stringify(r.scene.lines)).not.toContain("moved_to");
  });

  it("caps moves at two a chapter, and never 'my place?' once they're there", () => {
    const names = { a: "Star Dust", b: "Chud Mallow" };
    const agreed = [
      { who: "a" as const, text: "Shall we head to the kitchen?" },
      { who: "b" as const, text: "Lead the way." },
    ];
    const base = { current: { place: "his bedroom", set: "his bedroom" }, claimed: { place: "the kitchen", set: "kitchen" }, lines: agreed, from: 0, homeNow: null, names };
    expect(settlePlace({ ...base, movesThisChapter: 0 }).moved?.to).toBe("kitchen");
    expect(settlePlace({ ...base, movesThisChapter: MAX_SCENE_MOVES })).toMatchObject({ moved: null, set: "his bedroom", rejected: { reason: "cap" } });
    // Chud asks "My place, perhaps?" at his own place, Star says yes: they're already there.
    const myPlace = [
      { who: "b" as const, text: "*lifts her effortlessly* My place, perhaps?" },
      { who: "a" as const, text: "Yes, please." },
    ];
    expect(agreedMove(myPlace, 0)).toMatchObject({ by: "b", home: "b" });
    expect(settlePlace({ ...base, lines: myPlace, claimed: { place: "Chud's car", set: "the car" }, movesThisChapter: 0, homeNow: "b" })).toMatchObject({ moved: null, rejected: { reason: "already_there" } });
  });

  it("the third agreed move of a chapter is refused through the engine too", async () => {
    const { cookie } = await admin();
    scripted({ lines: [{ who: "a", text: "Hi." }] });
    await write(cookie);
    await placeAt("the bar");
    const ask = ["Shall we go to the kitchen?", "How about the balcony, for some air?", "Let's take this to the bathroom, shall we?"];
    const yes = ["Yes, lead the way.", "Gladly, after you, darling.", "Mm, take me there right now."];
    for (const [i, to] of ["kitchen", "balcony", "bathroom"].entries()) {
      scripted({ lines: [{ who: "a", text: ask[i] }, { who: "b", text: yes[i] }], place: `the ${to}`, set: to });
      await write(cookie);
    }
    const s = await stored();
    expect(s.moves.map((m) => [m.to, m.taken, m.reason])).toEqual([
      ["kitchen", true, "agreed"],
      ["balcony", true, "agreed"],
      ["bathroom", false, "cap"],
    ]);
    expect(s.set_place).toBe("balcony");
  });
});

describe("no repeated lines", () => {
  it("drops a line said before tonight, word for word or nearly, and asks again when every line was one", async () => {
    const { cookie } = await admin();
    const first = [
      { who: "a", action: "Traces his chest with a playful finger", text: "Your heart's rhythm is a song, and I'm the conductor. Shall we let the melody lead us elsewhere?" },
      { who: "b", action: "Wraps arms around her waist", text: "Your words are the lyrics to our symphony, and this room is our stage tonight." },
    ];
    scripted({ lines: first });
    expect((await write(cookie)).added).toBe(2);
    // Lines 102–106 were 84–88 again (lower-cased actions): dropped. One new line stays.
    scripted({ lines: [{ who: "a", action: "traces his chest with a playful finger", text: "Your heart's rhythm is a song, and I'm the conductor. Shall we let the melody lead us elsewhere?" }, { who: "b", text: "Something we haven't said yet, finally, about the rain outside." }] });
    const r = await write(cookie);
    expect(r).toMatchObject({ added: 1, repeats: 1 });
    // Every line a repeat: one more call with a note; its new lines are kept.
    scripted({ lines: first }, { lines: [{ who: "a", text: "Tell me something true about tonight that I don't know yet." }] });
    const again = await write(cookie);
    expect(again.added).toBe(1);
    expect((await stored()).lines.map((l) => l.text).filter((x) => x.includes("lyrics"))).toHaveLength(1);
    expect(repeatOf("Yes.", ["Yes."])).toBeNull();
  });

  it("lets a catchphrase through once a chapter", async () => {
    const a = (await loadCharacter(t.db, CAST_A))!;
    const b = (await loadCharacter(t.db, CAST_B))!;
    const star = { ...a, extras: { ...a.extras, catchphrase: "“That's a problem for future me.”" } };
    const said = [{ who: "a" as const, text: "*smirks* Your place? That's a problem for future me." }];
    const { kept, dropped } = dropRepeats(
      [
        { who: "a", text: "*laces fingers through his hair* A place of our own? That's a problem for future me. But let's not keep the night waiting." },
        { who: "a", text: "That's a problem for future me." },
      ],
      said,
      said,
      star,
      b,
    );
    expect(kept).toEqual([{ who: "a", text: "*laces fingers through his hair* A place of our own? But let's not keep the night waiting." }]);
    expect(dropped[0].reason).toMatch(/catchphrase/);
  });
});

describe("a private why on every line", () => {
  it("stores why and memory with the line, never sends or renders them, and an admin can read them as JSON", async () => {
    const { cookie } = await admin();
    scripted({
      lines: [
        { who: "a", action: "leans in", text: "You still owe me that dance from the bowling alley.", why: "She remembers the dance he promised on their date.", memory: "he promised her a dance at the bowling alley" },
        { who: "b", text: "Then let's settle it now.", why: "His competitive streak.", memory: null },
      ],
    });
    const r = await write(cookie);
    const lines = (await stored()).lines;
    expect(lines[0]).toMatchObject({ why: "She remembers the dance he promised on their date.", memory: "he promised her a dance at the bowling alley" });
    expect(lines[1]).toMatchObject({ why: "His competitive streak.", memory: null });
    expect(JSON.stringify(r)).not.toContain("competitive streak");
    // Rendered with notes on its lines anyway (a stale client), neither the theater nor the page shows them.
    const chars = [
      { id: CAST_A, name: "Rafe", house: true, hue: 1, portrait: null },
      { id: CAST_B, name: "June", house: true, hue: 2, portrait: null },
    ] as const;
    const withNotes = lines as AdultScene["lines"];
    const theater = renderToStaticMarkup(createElement(AfterDarkTheater, { scene: { lines: withNotes, place: null, stage: 0, dateVenue: null }, characters: [...chars], onExit: () => {} }));
    const page = renderToStaticMarkup(createElement(SceneWriter, { initial: { ...r.scene, lines: withNotes }, gallery: [], characters: [...chars] }));
    expect(page).toContain("You still owe me that dance");
    for (const html of [theater, page]) {
      expect(html).not.toContain("competitive streak");
      expect(html).not.toContain("promised her a dance");
    }
    // The admin's export has them; nobody else gets it.
    const why = await whyGet(new Request(`${BASE_URL}/api/admin/after-dark/why?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }));
    expect(why.status).toBe(200);
    const notes = await why.json();
    expect(notes.current.lines[0]).toMatchObject({ i: 0, why: "She remembers the dance he promised on their date.", memory: "he promised her a dance at the bowling alley" });
    const stranger = signedIn(userIdOf(newUserCookie()));
    expect((await whyGet(new Request(`${BASE_URL}/api/admin/after-dark/why?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie: stranger } }))).status).toBe(404);
  });
});

describe("sets that couldn't be checked are tried again", () => {
  const JPEG = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
  const CLEAN = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.01 }] }] };
  const serve = (label: string) => setGet(new Request(`${BASE_URL}${setPath(label)}`), { params: Promise.resolve({ slug: setPath(label).split("/").pop()! }) });

  it("keeps the picture after a Hive 429, never shows it, answers a pixel while it waits, then checks it again", async () => {
    await saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive" });
    let draws = 0;
    setSetsFetchForTests(async (input: RequestInfo | URL) => {
      if (String(input) === `https://fal.run/${SET_MODEL}`) {
        draws++;
        return Response.json({ images: [{ url: "https://cdn.fal.test/set.jpg" }] });
      }
      return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    });
    let hive: Response = new Response("slow down", { status: 429 });
    let hiveCalls = 0;
    setCheckFetchForTests(async (input: RequestInfo | URL) => {
      hiveCalls++;
      return String(input) === HIVE_MODERATION ? hive.clone() : new Response("?", { status: 500 });
    });
    expect(await ensureSet(t.db, "bedroom")).toBe("failed");
    const row = (await t.db.query<{ status: string; reason: string; attempts: number; has: boolean; due: boolean }>(`select status, reason, attempts, data is not null as has, retry_at > now() as due from place_sets`)).rows[0];
    expect(row).toMatchObject({ status: "failed", attempts: 1, has: true, due: true });
    expect(row.reason).toMatch(/^unchecked: the check couldn't run \(Hive answered 429\)/);
    // Waiting: a transparent pixel, never cached, never a 404 in the console.
    const waiting = await serve("bedroom");
    expect(waiting.status).toBe(200);
    expect(waiting.headers.get("x-set-status")).toBe("retrying");
    expect(waiting.headers.get("content-type")).toBe("image/gif");
    expect(waiting.headers.get("cache-control")).toBe("no-store");
    // Not due yet, and Hive is cooling down: nothing is sent.
    const before = hiveCalls;
    expect(await retryDueSets(t.db, 3, 0)).toEqual([]);
    expect(hiveCalls).toBe(before);
    // Due, cool-down over: only the check runs again (no new drawing), and it's ready.
    await t.db.query(`update place_sets set retry_at = now() - interval '1 minute', updated_at = now() - interval '10 minutes'`);
    hive = Response.json(CLEAN);
    expect(await retryDueSets(t.db, 3, 0)).toEqual([{ label: "bedroom", status: "ready" }]);
    expect(draws).toBe(1);
    const shown = await serve("bedroom");
    expect(shown.status).toBe(200);
    expect(shown.headers.get("x-set-status")).toBe("ready");
    expect(shown.headers.get("content-type")).toBe("image/jpeg");
  });

  it("a set stuck drawing can be claimed again; a set nobody has 404s", async () => {
    await t.db.query(`insert into place_sets (normalized, label, status, updated_at) values ('kitchen', 'kitchen', 'drawing', now() - interval '1 hour')`);
    expect(await ensureSet(t.db, "kitchen")).toBe("failed"); // claimed again (no keys here, so it fails for now)
    expect((await serve("nowhere at all")).status).toBe(404);
  });
});

describe("the theater keeps the last ready set up", () => {
  const ready: Shown = { venue: "elsewhere@his bedroom", setUrl: "blob:bedroom", steady: true };
  it("swaps only once the new set has loaded; the placeholder is only for a first set while it draws", () => {
    expect(nextShown(ready, "elsewhere@balcony", "drawing")).toBe(ready);
    expect(nextShown(ready, "elsewhere@balcony", "retrying")).toBe(ready);
    expect(nextShown(ready, "elsewhere@balcony", "ready", "blob:balcony")).toEqual({ venue: "elsewhere@balcony", setUrl: "blob:balcony", steady: true });
    const first: Shown = { venue: null, setUrl: undefined, steady: false };
    expect(nextShown(first, "elsewhere@balcony", "drawing")).toEqual({ venue: "elsewhere@balcony", setUrl: null, steady: false });
    // A set that isn't coming: the place's name on the generic set, without asking for the picture again.
    expect(nextShown(ready, "elsewhere@balcony", "refused")).toEqual({ venue: "elsewhere@balcony", setUrl: null, steady: false });
  });
});

describe("the observer", () => {
  // A night built from Star × Chud's patterns (2026-10-21), kept PG.
  const line = (who: "a" | "b", text: string, extra: Record<string, unknown> = {}) => ({ who, text, ...extra });
  const fixture = (): ObserverInput => ({
    a: { name: "Star Dust", catchphrase: "“That's a problem for future me.”", traits: ["playful", "mischievous"], tells: ["bites her lip when she's plotting"], voice: "teasing, cosmic metaphors", want: "an adventure" },
    b: { name: "Chud Mallow", catchphrase: null, traits: ["confident", "competitive"], tells: [], voice: "swaggering", want: "to win her over" },
    start: "the bowling alley",
    memories: ["You and Chud spent the night together at his place after the bowling date; you're closer now.", "Their latest date at the bowling alley ended: second date"],
    chapters: [
      {
        chapter: 1,
        source: "night",
        id: "n1",
        set_place: "the cozy bedroom",
        place: "on the bed",
        lines: [
          line("a", "*leans in* I see us somewhere with fewer people. What do you say?"),
          line("b", "*cocks an eyebrow* Let's take this conversation back to my place."),
          line("a", "*smirks* Lead the way. That's a problem for future me."),
          line("b", "*gestures for her to step inside* Come on in, Star."),
          line("a", "*takes in the room* So this is where the famous Chud lives."),
          line("b", "*grins* The very same. Bowling trophies and all."),
        ],
      },
      {
        chapter: 2,
        source: "night",
        id: "n2",
        set_place: "Chud's living room",
        place: "on the swing",
        sets_requested: ["bedroom glow", "bedroom ambiance", "bedroom's edge", "same bedroom", "private balcony", "car park", "celestial swing"],
        lines: [
          line("a", "*traces his jaw* The stars are out tonight, and so are you."),
          line("b", "*laughs* Smooth. Was that rehearsed?"),
          line("a", "*grins, stepping onto the balcony* The stars are witnesses, Chud. Are you ready to dive into the unknown?"),
          line("b", "*follows her out* With you, I'm always ready for the unexpected."),
          line("a", "*nods in agreement* You're right. Let's find a place where the stars won't be the only witnesses to our dance."),
          line("b", "*grins, lifting her effortlessly* I promise, this melody will be one for the ages. My place, perhaps?"),
          line("a", "*laces fingers through his hair* Your place, Chud? That's a problem for future me. But for now, let's not keep the stars waiting."),
          line("b", "*carries her toward the door, laughing* Then let's not disappoint our audience. Our encore begins at my place."),
          line("a", "*nods in agreement* You're right. Let's find a place where the stars won't be the only witnesses to our dance."),
          line("b", "*grins, lifting her effortlessly* I promise, this melody will be one for the ages. My place, perhaps?"),
        ],
      },
      {
        chapter: 3,
        source: "scene",
        id: "s1",
        set_place: "Chud's living room",
        place: "on the swing",
        moves: [{ chapter: 3, at: 2, from: "Chud's living room", to: "intimate private space", taken: false, reason: "no_agreement" }],
        lines: [
          line("a", "You still owe me a rematch at the lanes.", { why: "She remembers the bowling date.", memory: "their date at the bowling alley" }),
          line("b", "Name the time and I'll beat you again.", { why: "His competitive streak.", memory: null }),
          line("a", "Remember when you sang to me on the ferris wheel?", { why: "A memory.", memory: "he sang to her on the ferris wheel" }),
          line("b", "*laughs* You're impossible.", { why: "the moment", memory: null }),
        ],
      },
    ],
  });

  it("calls out unprovoked moves, 'my place' at his place, repeats, catchphrases, set churn and unfounded memories", () => {
    const r = observeNight(fixture());
    const checks = r.findings.map((f) => `${f.chapter}:${f.check}:${f.from}-${f.to}`);
    expect(checks).toContain("2:unprovoked_move:1-2"); // the balcony
    expect(checks).toContain("2:my_place_when_there:5-5");
    expect(checks).toContain("2:verbatim_repeat:8-9"); // lines 8–9 repeat 4–5
    expect(checks).toContain("2:unprovoked_move:6-7"); // toward the door, at his own place, with no yes
    expect(checks).toContain("3:refused_move:2-2");
    expect(checks).toContain("3:unfounded_memory:2-2"); // the ferris wheel never happened
    expect(checks).not.toContain("3:unfounded_memory:0-0");
    expect(r.findings.find((f) => f.check === "verbatim_repeat")?.note).toMatch(/lines 8–9 repeat lines 4–5 word for word/);
    // "My place, perhaps?" (5) and its repeat (9), both at his place.
    expect(r.summary).toMatchObject({ unprovoked_moves: 2, my_place_when_there: 2, verbatim_repeats: 2, refused_moves: 1, lines_with_why: 4, unfounded_memories: 1 });
    expect(r.summary.catchphrases["Star Dust"]).toEqual({ 1: 1, 2: 1, 3: 0 });
    // Seven sets asked for, four places once canonicalized (bedroom, balcony, parking lot, swing).
    expect(r.summary.set_churn[2]).toEqual({ final: "Chud's living room", distinct_sets: 1, requested: 7, requested_places: 4 });
    expect(checks).toContain("2:set_churn:0-9");
    expect(r.summary.share_memory).toBe(0.5);
    expect(r.summary.share_trait).toBe(0.25);
    expect(r.summary.share_moment).toBe(0.25);
    const md = reportMarkdown(r);
    expect(md).toContain("## After Dark observer: Star Dust × Chud Mallow");
    expect(md).toContain("### Chapter 2");
  });

  it("still runs on legacy lines with no why", () => {
    const f = fixture();
    f.chapters = f.chapters.slice(0, 2);
    const r = observeNight(f);
    expect(r.summary.lines_with_why).toBe(0);
    expect(r.summary.share_memory).toBe(0);
    expect(r.lines).toBe(16);
  });
});
