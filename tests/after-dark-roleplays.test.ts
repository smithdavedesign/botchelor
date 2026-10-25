import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { FRAMINGS, profileLines, TURN_ONS, turnOnsFor } from "@/lib/adult/profile";
import { ROLEPLAYS, roleplayLine } from "@/lib/adult/roleplays";
import { SET_SCENE_MAX } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { checkAdultText, excludedTheme } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { loadCharacter } from "@/lib/character";
import { getPublicCharacter } from "@/lib/game";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Roleplays for a chapter (lib/adult/roleplays.ts; David, 2026-10-25): picked with the place in Scene & roleplay, held to
// the lines that never move, and gone when the chapter ends.
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

// Stored lower id first: house-juniper (Juniper Vale) is "a", house-rafe (Rafe Calloway) is "b".
const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const get = async (cookie: string, extra = "") => (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}${extra}`, { headers: { cookie } }))).json();
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
let k = 0;
const SYL = [["ka", "lo", "mi", "nu", "pe", "ra", "si", "tu", "vo", "ze"], ["ban", "dor", "fel", "gim", "hux", "jor", "kel", "lum", "mox", "nib"], ["a", "e", "i", "o", "u", "y", "ae", "oi", "ua", "ie"], ["p", "t", "k", "s", "m", "n", "l", "r", "v", "z"]];
const word = () => {
  const i = k++;
  return SYL.map((syl, d) => syl[Math.floor(i / 10 ** d) % 10]).join("");
};
const six = () => ({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `${word()} ${word()} ${word()} ${word()}.` })) });
function scripted(reply: () => unknown = six) {
  const prompts: ChatMessage[][] = [];
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(messages[0].content)) return "{}";
      prompts.push(messages);
      return JSON.stringify(reply());
    },
  } as never);
  return prompts;
}

describe("roleplays for a chapter", () => {
  it("are reviewed against the lines: two adults, both willing, no family, step-family, babysitter, teacher, school or age-play", () => {
    expect(ROLEPLAYS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ROLEPLAYS.map((r) => r.id)).size).toBe(ROLEPLAYS.length);
    // The scenarios' list, less boss and employee: David asked for the boss setup (2026-10-25), and it's written mutual,
    // said out loud, with nobody's job depending on the answer.
    const NEVER = /\b(sister|brother|sibling|mother|father|mom|mum|dad|daughter|son|step\w*|aunt|uncle|cousin|babysit\w*|nanny|teacher|student|pupil|professor|tutor|lesson|classroom|school|campus|dorm|teen|teenage|young|younger|girl|boy|kid|child|drunk|tipsy|wasted|asleep|unconscious|sedated|forced|force|kidnap\w*|captive|tied|against (her|his|their) will|blackmail|paid|pays|payment|intern)\b/i;
    for (const r of ROLEPLAYS) {
      const text = [r.title, r.premise, ...(r.roles ?? [])].join(" ");
      expect(checkAdultText({ title: r.title, premise: r.premise, roles: (r.roles ?? []).join(", ") }).ok, r.id).toBe(true);
      expect(excludedTheme(text), r.id).toBeNull();
      expect(NEVER.exec(text)?.[0] ?? null, r.id).toBeNull();
      expect(r.premise).toContain("{a}");
      expect(r.premise.length).toBeLessThanOrEqual(300);
    }
    expect(roleplayLine(ROLEPLAYS.find((r) => r.id === "boss")!, { a: "Juniper", b: "Rafe" }, true)).toContain("Rafe runs the team and Juniper is on it.");
  });

  it("go with the place, feed every prompt of the chapter with who plays what, and end with the chapter or Start over", async () => {
    const { cookie } = await admin();
    const prompts = scripted();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const r = await (await post({ a: CAST_A, b: CAST_B, set_scene: "the empty office after hours", roleplay: { id: "boss", swap: true } }, cookie)).json();
    expect(r.scene).toMatchObject({ set_place: "the empty office after hours", roleplay: { id: "boss", swap: true } });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(prompts.at(-1)![0].content).toContain("This chapter's roleplay, chosen by the viewer: Boss and employee, after hours. Late at the office, everyone else gone home. Rafe runs the team and Juniper is on it.");
    // On its own: changed without moving them, or ended.
    expect((await (await post({ a: CAST_A, b: CAST_B, roleplay: { id: "neighbours" } }, cookie)).json()).scene.roleplay).toEqual({ id: "neighbours", swap: false });
    expect((await (await post({ a: CAST_A, b: CAST_B, roleplay: null }, cookie)).json()).scene.roleplay).toBeNull();
    expect((await post({ a: CAST_A, b: CAST_B, roleplay: { id: "stepmom" } }, cookie)).status).toBe(422);
    // A new chapter starts without it.
    await post({ a: CAST_A, b: CAST_B, roleplay: { id: "roommates" } }, cookie);
    expect((await get(cookie)).scene.roleplay).toEqual({ id: "roommates", swap: false });
    await t.db.query(`update adult_scenes set chapter = chapter + 1`);
    expect((await get(cookie)).scene.roleplay).toBeNull();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(prompts.at(-1)![0].content).not.toContain("This chapter's roleplay");
    // Start over clears it too.
    await post({ a: CAST_A, b: CAST_B, roleplay: { id: "exes" } }, cookie);
    expect((await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json()).scene.roleplay).toBeNull();
  });
});
