import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as libraryGet, POST as libraryPost } from "@/app/api/library/route";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { checkFor, checkRoleplay } from "@/lib/studio/library";
import { PLACE_IDEAS, PROMPT_IDEAS, ROLEPLAY_IDEAS } from "@/lib/studio/library-ideas";
import { planPgShoot, pgShootPrompt } from "@/lib/studio/pg-catalog";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// The Create library (lib/studio/library.ts; David, 2026-10-25): each person's own prompts, venues and roleplays, safe or
// After Dark, used in both Studios and in a night's Scene & roleplay.

describe("the checks", () => {
  it("hold safe prompts and venues to the Studio's PG words, and After Dark's to its lines", () => {
    expect(checkFor("safe", { text: "golden hour on a rooftop, a denim jacket" }, "prompt")).toBeNull();
    expect(checkFor("safe", { text: "black lace lingerie on the bed" }, "prompt")).toMatch(/safe mode/);
    expect(checkFor("safe", { text: "looks like Taylor Swift" }, "prompt")).toMatch(/real or famous/);
    expect(checkFor("after_dark", { text: "black lace lingerie on the bed, candlelight" }, "prompt")).toBeNull();
    expect(checkFor("after_dark", { text: "she plays his step sister" }, "prompt")).toMatch(/lines that never move/);
    expect(checkFor("after_dark", { text: "a schoolgirl outfit" }, "prompt")).toMatch(/adult/);
    expect(checkFor("safe", { name: "A strip club", description: "neon and mirrors" }, "place")).not.toBeNull();
    expect(checkFor("safe", { name: "The lighthouse lantern room", description: "wind rattling the glass" }, "place")).toBeNull();
  });

  it("hold roleplays to two willing adults: no family, babysitter, teacher, school, nobody paid, drunk or trapped", () => {
    expect(checkRoleplay({ title: "Rival food trucks", premise: "{a} and {b} run food trucks side by side and finally flirt.", roles: ["the taco truck owner", "the ramen truck owner"] })).toBeNull();
    for (const [title, premise] of [
      ["The babysitter", "{a} babysits for {b}"],
      ["Step siblings", "{a} and {b} are step-siblings"],
      ["After class", "{a} is {b}'s teacher"],
      ["Last call", "{b} is drunk and {a} takes them home"],
      ["The escort", "{a} pays {b} for the night"],
      ["Captive", "{a} keeps {b} tied up against their will"],
    ]) {
      expect(checkRoleplay({ title, premise, roles: null }), title).not.toBeNull();
    }
  });

  it("pass every idea the Create tab suggests, each against its own check", () => {
    for (const x of PROMPT_IDEAS.safe) expect(checkFor("safe", { text: x }, "prompt"), x).toBeNull();
    for (const x of PROMPT_IDEAS.after_dark) expect(checkFor("after_dark", { text: x }, "prompt"), x).toBeNull();
    for (const x of PLACE_IDEAS) expect(checkFor("safe", { name: x.name, description: x.description }, "place"), x.name).toBeNull();
    for (const x of ROLEPLAY_IDEAS) expect(checkRoleplay(x), x.title).toBeNull();
  });

  it("put a venue of theirs into a PG Studio picture, in place of the menu's place", () => {
    const r = planPgShoot({ shot: "candid", own_place: { name: "The lighthouse lantern room", description: "the lamp turning slowly" } });
    expect(r.ok && pgShootPrompt(r.plan, { noun: "woman", age: 30, look: "" }, true)).toContain("At The lighthouse lantern room (the lamp turning slowly).");
    expect(planPgShoot({ place: "cafe", own_place: { name: "x" } })).toMatchObject({ ok: false, error: "two_places" });
  });
});

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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
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

const lib = (body: unknown, cookie?: string) =>
  libraryPost(new Request(`${BASE_URL}/api/library`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const libGet = async (cookie?: string) => libraryGet(new Request(`${BASE_URL}/api/library`, { headers: cookie ? { cookie } : {} }));
const person = () => {
  const id = crypto.randomUUID();
  return { id, cookie: signedInCookie(id) };
};

describe("the library's API", () => {
  it("is signed-in accounts only; anyone keeps safe prompts and venues, After Dark items and roleplays need After Dark", async () => {
    expect((await libGet()).status).toBe(401);
    expect((await lib({ action: "save_prompt", text: "a café", mode: "safe" })).status).toBe(401);
    const me = person();
    expect((await lib({ action: "save_prompt", text: "Reading in a café window seat", title: "Café", mode: "safe" }, me.cookie)).status).toBe(200);
    expect((await lib({ action: "save_place", name: "The lighthouse lantern room", description: "wind on the glass", mode: "safe" }, me.cookie)).status).toBe(200);
    expect((await lib({ action: "save_place", name: "the lighthouse lantern room", mode: "safe" }, me.cookie)).status).toBe(409);
    expect((await lib({ action: "save_prompt", text: "silk robe, candlelight", mode: "after_dark" }, me.cookie)).status).toBe(403);
    expect((await lib({ action: "save_roleplay", title: "Rivals", premise: "{a} and {b} compete" }, me.cookie)).status).toBe(403);
    expect((await lib({ action: "save_prompt", text: "in lingerie", mode: "safe" }, me.cookie)).status).toBe(422);
    const got = await (await libGet(me.cookie)).json();
    expect(got).toMatchObject({ after_dark: false, library: { prompts: [{ title: "Café", mode: "safe" }], places: [{ name: "The lighthouse lantern room" }], roleplays: [] } });
    // Theirs only: someone else can't delete it.
    expect((await lib({ action: "delete", kind: "prompt", id: got.library.prompts[0].id }, person().cookie)).status).toBe(404);
    expect((await lib({ action: "delete", kind: "prompt", id: got.library.prompts[0].id }, me.cookie)).status).toBe(200);
  });
});

// Stored lower id first: house-juniper (Juniper Vale) is "a", house-rafe (Rafe Calloway) is "b".
const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const get = async (cookie: string) => (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json();
let k = 0;
const six = () => ({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `line ${k++} of the night, said plainly.` })) });
function scripted() {
  const prompts: ChatMessage[][] = [];
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(messages[0].content)) return "{}";
      prompts.push(messages);
      return JSON.stringify(six());
    },
  } as never);
  return prompts;
}

describe("in After Dark", () => {
  it("their roleplay and their venue reach the writer; someone else's roleplay never does", async () => {
    const me = person();
    await claimAdmin(t.db, me.id);
    const prompts = scripted();
    const rp = await (await lib({ action: "save_roleplay", title: "Rival food trucks", premise: "{a} and {b} run food trucks side by side.", roles: ["the taco truck owner", "the ramen truck owner"], category: "romance" }, me.cookie)).json();
    await lib({ action: "save_place", name: "The night market alley", description: "steam and lanterns, a dozen stalls closing up", mode: "safe" }, me.cookie);
    const uid = `u:${rp.item.id}`;
    await post({ a: CAST_A, b: CAST_B }, me.cookie);
    const r = await (await post({ a: CAST_A, b: CAST_B, set_scene: "The night market alley", roleplay: { id: uid, swap: true } }, me.cookie)).json();
    expect(r.scene.roleplay).toEqual({ id: uid, swap: true });
    await post({ a: CAST_A, b: CAST_B, start: true }, me.cookie).catch(() => null);
    await post({ a: CAST_A, b: CAST_B }, me.cookie);
    const system = prompts.at(-1)![0].content;
    expect(system).toContain("This chapter's roleplay, chosen by the viewer: Rival food trucks. Rafe and Juniper run food trucks side by side.");
    expect(system).toContain("Tonight's situation: The night market alley: steam and lanterns, a dozen stalls closing up.");
    // Another person's roleplay id is never taken.
    const other = person();
    await claimAdmin(t.db, other.id);
    const theirs = await (await post({ a: CAST_A, b: CAST_B, roleplay: { id: uid } }, other.cookie)).json();
    expect(theirs.scene.roleplay).toBeNull();
    expect((await get(me.cookie)).scene.roleplay).toEqual({ id: uid, swap: true });
  });
});
