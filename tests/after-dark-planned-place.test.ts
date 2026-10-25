import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { awaitingStart, stageLabel } from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import { placeLocked, settlePlace, type MoveLog } from "@/lib/adult/continuity";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { agreedPlan } from "@/lib/plans";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-25: "I sent them on it, but it chose the original destination … if the bots have decided on the date from
// texting then let's lock it … we should still wait [until] play is hit". A place chosen for them (Set the scene, or what
// they agreed by text) stays put, and the night waits for Start.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  // Texts between two house characters outlive a reset (the house cast does).
  await t.db.query(`delete from couple_texts where character_lo = $1 and character_hi = $2`, [[HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort()[0], [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort()[1]]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setSetsFetchForTests(async () => new Response("no", { status: 500 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
});

// Stored lower id first, which is also the texts' "lo" end.
const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: CAST_A, b: CAST_B, ...(body as object) }) }));
const get = async (cookie: string) => (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json()).scene;
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return signedIn(id);
}
/** The model, reporting it's somewhere else than where they were sent (the bug: a bar, after "An awkward double date"). */
function claimsABar() {
  const prompts: ChatMessage[][] = [];
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(messages[0].content)) return "{}";
      prompts.push(messages);
      return JSON.stringify({
        place: "A noisy, dimly lit downtown bar",
        set: "bar",
        lines: [
          { who: "a", text: "*She looks round.* So this is where we ended up." },
          { who: "b", text: "*He grins.* Could be worse. Could be raining." },
          { who: "a", text: "*She laughs.* Give it an hour." },
          { who: "b", text: "*He leans in.* I'll take my chances." },
        ],
      });
    },
  } as never);
  return prompts;
}
async function textPlan() {
  for (const [seq, who, text] of [
    [1, "hi", "Are you carrying a cream pie in that big coat?"],
    [2, "lo", "No, but I work at a pie factory. Want to go get two cream pies together?"],
    [3, "hi", "A pie factory sounds dangerously unguarded. Let's do it."],
  ] as const) {
    await t.db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text) values ($1, $2, current_date, $3, $4, $5)`, [CAST_A, CAST_B, seq, who, text]);
  }
}

describe("a place chosen for them stays chosen", () => {
  const vague = { place: "An awkward double date", set: "An awkward double date" };
  const base = { current: vague, claimed: { place: "A noisy, dimly lit downtown bar", set: "bar" }, lines: [], from: 0, movesThisChapter: 0, homeNow: null, names: { a: "Lexi", b: "Juniper" } } as const;

  it("the model naming somewhere real doesn't replace a vague place the owner picked", () => {
    expect(settlePlace({ ...base }).set).toBe("bar"); // unlocked, as before: the model's place names a vague one
    expect(settlePlace({ ...base, locked: true })).toMatchObject({ set: "An awkward double date", moved: null, rejected: { reason: "no_agreement" } });
  });

  it("is locked by Set the scene or a texted plan, until they agree to go somewhere else", () => {
    const move = (reason: MoveLog["reason"], to: string, taken = true): MoveLog => ({ chapter: 1, at: 0, from: null, to, taken, reason });
    expect(placeLocked({ moves: [move("set_scene", "the pier")], set_place: "the pier" })).toBe(true);
    expect(placeLocked({ moves: [move("plan", "the pie factory")], set_place: "the pie factory" })).toBe(true);
    // A move they turned down after it doesn't unlock it; one they took does.
    expect(placeLocked({ moves: [move("set_scene", "the pier"), move("no_agreement", "a bar", false)], set_place: "the pier" })).toBe(true);
    expect(placeLocked({ moves: [move("set_scene", "the pier"), move("agreed", "her place")], set_place: "her place" })).toBe(false);
    expect(placeLocked({ moves: [], set_place: "bar" })).toBe(false);
  });

  it("a no that answers something else and then proposes is still a plan (Lexi × Juniper's pie factory)", () => {
    const texts = [
      { who: "hi" as const, text: "No pie. Just salt air and a podcast microphone. Do you have opinions on maritime poltergeists?" },
      { who: "lo" as const, text: "No, but I work at a pie factory. Want to go get two cream pies together?" },
      { who: "hi" as const, text: "A pie factory sounds dangerously unguarded. Let's do it." },
    ];
    expect(agreedPlan(texts, { lo: "Lexi", hi: "Juniper" })?.place).toBe("elsewhere@the pie factory");
    // A real refusal still ends it: the proposer taking it back before the yes.
    expect(agreedPlan([texts[1], { who: "lo", text: "No, actually, let's not." }, { who: "hi", text: "Sure." }], { lo: "Lexi", hi: "Juniper" })).toBeNull();
  });
});

describe("the theater before the first line", () => {
  it("waits for Start on a new night, and a new chapter carries straight on", () => {
    expect(awaitingStart({ lines: [], chapter: 1 })).toBe(true);
    expect(awaitingStart({ lines: [] })).toBe(true);
    expect(awaitingStart({ lines: [], chapter: 2 })).toBe(false);
    expect(awaitingStart({ lines: [{}], chapter: 1 })).toBe(false);
  });

  it("the label says the roleplay with how far it's gone", () => {
    const lines = [{ who: "a" as const, text: "Hi.", stage: 0 }];
    expect(stageLabel({ lines, stage: 0, roleplay: { id: "blind-date", swap: false } }, 1)).toBe("🙈 Blind date");
    expect(stageLabel({ lines: [{ ...lines[0], doing: "trading first impressions" }], stage: 0, roleplay: { id: "blind-date", swap: false } }, 1)).toBe("🙈 Blind date · trading first impressions");
    expect(stageLabel({ lines: [], stage: 0, chapter: 2, roleplay: { id: "blind-date", swap: false } }, 0)).toBe("🙈 Blind date · Chapter 2");
  });
});

describe("the night's place", () => {
  it("Set the scene somewhere vague: the first lines don't move them to where the model says", async () => {
    const cookie = await admin();
    claimsABar();
    expect((await post({ set_scene: "An awkward double date", roleplay: { id: "blind-date", swap: false } }, cookie)).status).toBe(200);
    const res = await post({}, cookie);
    expect(res.status).toBe(200);
    const scene = (await res.json()).scene;
    expect(scene.set_place).toBe("An awkward double date");
    expect(scene.place).toBe("An awkward double date");
    expect(scene.moves.at(-1)).toMatchObject({ to: "bar", taken: false, reason: "no_agreement" });
  });

  it("agreed by text: the night starts there, locked, a roleplay still picked, and stored with the first lines", async () => {
    const cookie = await admin();
    await textPlan();
    const before = await get(cookie);
    expect(before.planned).toMatchObject({ place: "the pie factory" });
    expect(before.planned.texts.map((x: { who: string }) => x.who)).toEqual(["a", "b"]);
    expect(before.set_place).toBe("the pie factory");
    // Somewhere else, or a scenario, waits until they're there.
    const moved = await post({ set_scene: "a hotel suite" }, cookie);
    expect(moved.status).toBe(409);
    expect((await moved.json()).message).toMatch(/decided on the pie factory by text/);
    expect((await post({ scenario: "elevator" }, cookie)).status).toBe(409);
    expect((await post({ roleplay: { id: "blind-date", swap: false } }, cookie)).status).toBe(200);
    // The first lines open on arriving there, whatever the model names.
    const prompts = claimsABar();
    const res = await post({}, cookie);
    expect(res.status).toBe(200);
    const scene = (await res.json()).scene;
    expect(prompts[0].map((m) => m.content).join("\n")).toMatch(/just cut to the pie factory/);
    expect(scene).toMatchObject({ set_place: "the pie factory", planned: null });
    expect(scene.moves[0]).toMatchObject({ to: "the pie factory", reason: "plan", taken: true });
    expect(scene.roleplay).toMatchObject({ id: "blind-date" });
    // Started: the place is theirs to change again.
    expect((await post({ set_scene: "a hotel suite" }, cookie)).status).toBe(200);
  });

  it("no plan by text: nothing is planned and Set the scene works as before", async () => {
    const cookie = await admin();
    expect((await get(cookie)).planned).toBeNull();
    expect((await post({ set_scene: "a hotel suite" }, cookie)).status).toBe(200);
  });
});
