import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { GET as whyGet } from "@/app/api/admin/after-dark/why/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { fileSteps, logStep, stepIndexOf, stepsOf } from "@/lib/adult/steps";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The admin's step log for After Dark (lib/adult/steps.ts; David, 2026-10-22: /why "doesn't include nudges and
// suggestions, also no errors").
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
  setSetsFetchForTests(async () => new Response("no", { status: 500 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
function scripted(...replies: unknown[]) {
  let i = 0;
  setAdultModelForTests({ complete: async () => JSON.stringify(replies[Math.min(i++, replies.length - 1)]) });
}
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const why = async (cookie: string) => (await whyGet(new Request(`${BASE_URL}/api/admin/after-dark/why?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json();
const two = (a: string, b: string) => ({ lines: [{ who: "a", action: "smiles", text: a, why: "the moment" }, { who: "b", action: "", text: b, why: "the moment" }], place: "the bar", stage: 1 });

describe("the step log in /why", () => {
  it("shows each steer and how strongly, the error a step ended in, a set-the-scene, and which step wrote each line", async () => {
    const { cookie } = await admin();
    scripted(two("Fancy seeing you here tonight.", "I could say the same about you."));
    expect((await post({ a: CAST_A, b: CAST_B, direction: "she asks him to dance", steer_mode: "direct" }, cookie)).status).toBe(200);
    scripted({ lines: [] });
    expect((await post({ a: CAST_A, b: CAST_B, direction: "they slow down" }, cookie)).status).toBe(422);
    expect((await post({ a: CAST_A, b: CAST_B, set_scene: "the rooftop" }, cookie)).status).toBe(200);
    const notes = await why(cookie);
    const steps = notes.current.steps as { kind: string; direction: string | null; steer_mode: string | null; status: string; http: number | null; message: string | null; added: number }[];
    expect(steps.map((s) => [s.kind, s.status])).toEqual([["write", "ok"], ["write", "error"], ["set_scene", "ok"]]);
    expect(steps[0]).toMatchObject({ direction: "she asks him to dance", steer_mode: "direct", added: 2 });
    expect(steps[1]).toMatchObject({ direction: "they slow down", steer_mode: "nudge", http: 422, message: "The model's reply had no lines in it. Try again." });
    expect(steps[2]).toMatchObject({ direction: "the rooftop" });
    expect(notes.current.lines.map((l: { step: number | null }) => l.step)).toEqual([0, 0]);
  });

  it("never stores a steer the two lines refused, only that one was refused", async () => {
    const { cookie } = await admin();
    expect((await post({ a: CAST_A, b: CAST_B, direction: "she is only 15 years old" }, cookie)).status).toBe(422);
    const notes = await why(cookie);
    expect(notes.current.steps).toHaveLength(1);
    expect(JSON.stringify(notes)).not.toContain("15 years");
    expect(notes.current.steps[0]).toMatchObject({ status: "error", http: 422, direction: "[a steer refused by the two lines]" });
  });

  it("moves a filed chapter's steps to its night, and maps lines to the step that wrote them", async () => {
    const owner = "owner-1";
    const step = (chapter: number, from: number, to: number) => ({ kind: "write" as const, direction: "x", steer_mode: "nudge" as const, status: "ok" as const, http: null, message: null, chapter, line_from: from, line_to: to, added: to - from + 1, dropped: [], flags: null });
    await logStep(t.db, owner, { a: CAST_A, b: CAST_B }, "scene-1", step(1, 0, 5));
    await logStep(t.db, owner, { a: CAST_A, b: CAST_B }, "scene-1", step(2, 0, 5));
    await fileSteps(t.db, "scene-1", 1, "night-1");
    const { running, byNight } = await stepsOf(t.db, owner, CAST_A, CAST_B);
    expect(running.map((s) => s.chapter)).toEqual([2]);
    expect(byNight.get("night-1")?.map((s) => s.chapter)).toEqual([1]);
    expect(stepIndexOf(running, 8)).toEqual([0, 0, 0, 0, 0, 0, null, null]);
  });
});
