import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { FRAMINGS, profileLines, TURN_ONS, turnOnsFor } from "@/lib/adult/profile";
import { SCENARIOS } from "@/lib/adult/scenarios";
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

// Scenario packs and turn-ons (lib/adult/scenarios.ts, lib/adult/profile.ts; David, 2026-10-22): curated starting
// points for a night, each reviewed against the lines that never move, and private turn-ons plus the pair's framing.
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

describe("the themes that never happen", () => {
  it("are refused in any text After Dark checks: family and step-family, teacher and student, school, age-play", () => {
    for (const [text, theme] of [
      ["Let's roleplay: you're my step-sister", "family"],
      ["my stepbrother", "family"],
      ["pretend you're my sister", "family"],
      ["call me daddy", "family"],
      ["incest", "family"],
      ["She calls him my teacher in a husky voice", "teacher_student"],
      ["a naughty student staying after class", "teacher_student"],
      ["play the professor and his student", "teacher_student"],
      ["detention", "teacher_student"],
      ["she wears a school uniform", "school"],
      ["back in the classroom", "school"],
      ["ddlg", "age_play"],
      ["age play", "age_play"],
      ["pretend she's younger", "age_play"],
    ] as const) {
      expect(excludedTheme(text), text).toBe(theme);
      expect(checkAdultText({ direction: text }).ok, text).toBe(false);
    }
    // Already minor terms: refused before any theme is looked for.
    for (const text of ["a schoolgirl outfit", "barely legal", "she's a teen", "jailbait"]) expect(checkAdultText({ direction: text })).toMatchObject({ ok: false, reason: "minor" });
  });

  it("refuse non-consent, animals and sexual violence, roleplayed or not (the processors' lines, 2026-10-24)", () => {
    for (const [text, theme] of [
      ["he rapes her", "non_consent"],
      ["a cnc scene", "non_consent"],
      ["take her against her will", "non_consent"],
      ["she says no but he keeps going", "non_consent"],
      ["he drugged her wine", "non_consent"],
      ["touch her while she's asleep", "non_consent"],
      ["he forced her to kneel", "non_consent"],
      ["roleplay a kidnapping", "non_consent"],
      ["bestiality", "bestiality"],
      ["sex with a dog", "bestiality"],
      ["knife play", "sexual_violence"],
      ["choke her until she passes out", "sexual_violence"],
      ["torture him slowly", "sexual_violence"],
      ["kill her while they're at it", "sexual_violence"],
    ] as const) {
      expect(excludedTheme(text), text).toBe(theme);
      expect(checkAdultText({ direction: text }), text).toMatchObject({ ok: false, theme });
    }
  });

  it("let rough-but-willing and everyday lines through", () => {
    for (const text of [
      "She pins him to the wall and he grins: yes.",
      "Pull my hair, she says. Harder.",
      "A dog-eared paperback on the nightstand.",
      "They walked her dog along the pier first.",
      "The sleepy bar was nearly empty.",
      "She bit her lip until it nearly bled.",
      "He forced a laugh.",
      "She fell asleep on his chest afterwards.",
      "Tie my wrists, she asks, and he does, gently.",
    ]) {
      expect(excludedTheme(text), text).toBeNull();
      expect(checkAdultText({ line: text }).ok, text).toBe(true);
    }
  });

  it("let everyday lines through: a ballroom instructor's class, a sister who set them up, a little game", () => {
    for (const text of [
      "My sister set us up, honestly.",
      "I teach ballroom: beginners on Tuesdays, and you'd be wasted on a beginners' class.",
      "Stay after class and I'll show you the turn.",
      "Old school charm.",
      "My dad taught me to fish.",
      "Let's play a little game.",
      "Little by little, she relaxes.",
      "Pretend we never met.",
      "a dance school recital",
    ]) {
      expect(excludedTheme(text), text).toBeNull();
      expect(checkAdultText({ line: text }).ok, text).toBe(true);
    }
  });

  it("are refused as a steer, a whisper or a place, saying which line it crossed, and never stored", async () => {
    const { cookie } = await admin();
    scripted();
    for (const [body, said] of [
      [{ direction: "she's his step-sister", steer_mode: "direct" }, /no family or step-family roleplay/],
      [{ direction: "she calls him my teacher" }, /no teacher and student roleplay/],
      [{ direction: "she dresses as a schoolgirl" }, /nobody under 18/],
      [{ direction: "barely legal" }, /nobody under 18/],
      [{ direction: "ddlg" }, /no age-play/],
      [{ whisper: { to: "a", text: "pretend she's younger" } }, /no age-play/],
      [{ set_scene: "the high school gym" }, /no school settings/],
    ] as const) {
      const res = await post({ a: CAST_A, b: CAST_B, ...body }, cookie);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await res.json()).message).toMatch(said);
    }
    const scene = (await get(cookie)).scene;
    expect(scene.lines).toEqual([]);
    expect(JSON.stringify((await t.db.query(`select direction, whisper from adult_steps`)).rows)).not.toMatch(/sister|teacher|schoolgirl|barely|ddlg|younger/);
  });

  it("are dropped from what the model writes", async () => {
    const { cookie } = await admin();
    scripted(() => ({ lines: [{ who: "a", text: `${word()} ${word()} ${word()} ${word()}.` }, { who: "b", text: "*grins* Call me daddy." }, { who: "a", text: `${word()} ${word()} ${word()}.` }] }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.held).toBe(1);
    expect(JSON.stringify(r.scene.lines)).not.toMatch(/daddy/i);
  });
});

describe("scenario packs", () => {
  it("are about sixteen, each reviewed against the lines: two adults, both willing, no family, teacher, school or age-play", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    const NEVER = /\b(sister|brother|sibling|mother|father|mom|mum|dad|daughter|son|step|aunt|uncle|cousin|teacher|student|pupil|professor|tutor|lesson|classroom|school|campus|dorm|teen|teenage|young|younger|girl|boy|kid|child|drunk|tipsy|wasted|asleep|unconscious|sedated|forced|force|kidnap\w*|captive|tied|against (her|his|their) will|blackmail|paid|pays|payment|boss|employee|intern)\b/i;
    for (const s of SCENARIOS) {
      const text = [s.title, s.premise, s.place, s.opening].join(" ");
      expect(checkAdultText({ title: s.title, premise: s.premise, place: s.place, opening: s.opening }).ok, s.id).toBe(true);
      expect(excludedTheme(text), s.id).toBeNull();
      expect(NEVER.exec(text)?.[0] ?? null, s.id).toBeNull();
      expect([0, 1, 2]).toContain(s.stage);
      expect(s.place.length).toBeLessThanOrEqual(Math.min(40, SET_SCENE_MAX));
      expect(s.premise.length).toBeLessThanOrEqual(240);
      expect(s.opening.length).toBeLessThanOrEqual(300);
    }
    // The examples David named are there.
    for (const title of ["Stuck in an elevator", "Hotel after the wedding", "Rivals at a conference", "Rainy cabin", "Exes at a party", "Massage appointment (licensed adults)"]) {
      expect(SCENARIOS.map((s) => s.title)).toContain(title);
    }
  });

  it("start a night: the one that ran is filed, they're put in its place, its stage, and its opening is the first steer (a nudge)", async () => {
    const { cookie } = await admin();
    const prompts = scripted();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const sc = SCENARIOS.find((s) => s.id === "rainy-cabin")!;
    const r = await (await post({ a: CAST_A, b: CAST_B, scenario: sc.id }, cookie)).json();
    expect(r.nights).toHaveLength(1);
    expect(r.scene).toMatchObject({ scenario: sc.id, set_place: sc.place, chapter: 1 });
    expect(r.scene.lines).toHaveLength(6);
    expect(r.scene.place_history[0]).toMatchObject({ set: sc.place });
    expect(r.scene.stage).toBe(sc.stage);
    const first = prompts.at(-1)!;
    expect(first[0].content).toMatch(new RegExp(`The scene has just cut to ${sc.place}`));
    expect(first[0].content).toContain(`Tonight's scenario: ${sc.title}. ${sc.premise}`);
    expect(first[1].content).toContain(`Lean the scene gently this way, at its own pace`);
    expect(first[1].content).toContain(sc.opening);
    // The premise stays for the night; Start over clears it.
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(prompts.at(-1)![0].content).toContain(`Tonight's scenario: ${sc.title}.`);
    const reset = await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json();
    expect(reset.scene.scenario).toBeNull();
  });

  it("never start one that runs into the viewer's hard nos, or when the month's steps are used up: nothing is filed", async () => {
    const { cookie } = await admin();
    scripted();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    await post({ a: CAST_A, b: CAST_B, limits: { hard_nos: { chips: [], own: ["masks"] } } }, cookie);
    const res = await post({ a: CAST_A, b: CAST_B, scenario: "masquerade" }, cookie);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/That scenario asks for one of your hard limits/);
    expect((await t.db.query(`select 1 from adult_nights`)).rows).toHaveLength(0);
    expect((await get(cookie)).scene.lines).toHaveLength(6);
    expect((await post({ a: CAST_A, b: CAST_B, scenario: "nope" }, cookie)).status).toBe(422);
  });
});

describe("turn-ons and framing", () => {
  it("feed the prompt: each one's turn-ons (none a hard no rules out) and how the viewer frames them", async () => {
    const { cookie } = await admin();
    expect((await (await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_A, ids: ["slow_teasing", "praise", "dirty_talk"] } }, cookie)).json()).profile.a).toEqual({
      editable: true,
      turn_ons: ["slow_teasing", "praise", "dirty_talk"],
    });
    await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_B, ids: ["massage"] } }, cookie);
    await post({ a: CAST_A, b: CAST_B, framing: "exes" }, cookie);
    await post({ a: CAST_A, b: CAST_B, limits: { hard_nos: { chips: ["dirty_talk"], own: [] } } }, cookie);
    const prompts = scripted();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const system = prompts[0][0].content;
    expect(system).toContain("How the viewer frames them tonight: They're exes:");
    expect(system).toMatch(/What Juniper is into \(private, from Juniper's own profile[^)]*\): slow teasing, praise\./);
    expect(system).toMatch(/What Rafe is into [^\n]*: massage\./);
    expect(system).not.toMatch(/dirty talk\./);
    expect((await get(cookie)).scene.framing).toBe("exes");
    await post({ a: CAST_A, b: CAST_B, framing: null }, cookie);
    expect((await get(cookie)).scene.framing).toBeNull();
    expect((await post({ a: CAST_A, b: CAST_B, framing: "siblings" }, cookie)).status).toBe(422);
  });

  it("are the owner's only: a house character's are an admin's to set; a subscriber can't see or set them", async () => {
    const { cookie } = await admin();
    await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_A, ids: ["candlelight"] } }, cookie);
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const subCookie = signedIn(sub);
    expect((await get(subCookie, "&profile=1")).profile).toEqual({ a: { editable: false, turn_ons: [] }, b: { editable: false, turn_ons: [] } });
    const res = await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_A, ids: [] } }, subCookie);
    expect(res.status).toBe(404);
    expect((await t.db.query<{ turn_ons: string[] }>(`select turn_ons from adult_profiles where character_id = $1`, [CAST_A])).rows[0].turn_ons).toEqual(["candlelight"]);
    // Only one of the pair, in the viewer's After Dark.
    expect((await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: HOUSE_CHARACTERS[2].id, ids: [] } }, cookie)).status).toBe(404);
  });

  it("never reach the show: not on a character's public page or API, and nothing outside After Dark reads them", async () => {
    const { cookie } = await admin();
    await post({ a: CAST_A, b: CAST_B, turn_ons: { character_id: CAST_A, ids: ["lingerie", "candlelight"] } }, cookie);
    // The public card, and the character as a date's models get it (its own sheet, extras and memory).
    const card = JSON.stringify(await getPublicCharacter(t.db, CAST_A));
    const self = JSON.stringify(await loadCharacter(t.db, CAST_A));
    expect(card).toContain("Juniper");
    for (const text of [card, self]) expect(text).not.toMatch(/lingerie|candlelight|turn_ons/i);
    const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("adult_profiles")) hits.push(p.slice(root.length + 1));
      }
    };
    walk(join(root, "lib"));
    walk(join(root, "app"));
    expect(hits.filter((p) => !p.startsWith("lib/adult/") && p !== "lib/db.ts")).toEqual([]);
  });

  it("are curated: about twenty turn-ons and seven framings, none of them family, teacher and student, school or age-play", () => {
    expect(TURN_ONS.length).toBeGreaterThanOrEqual(18);
    expect(FRAMINGS.map((f) => f.id)).toEqual(["strangers", "first_date", "exes", "friends_to_lovers", "rivals", "coworkers", "long_term"]);
    for (const text of [...TURN_ONS.map((x) => x.label), ...FRAMINGS.flatMap((f) => [f.label, f.prompt])]) {
      expect(checkAdultText({ text }).ok, text).toBe(true);
      expect(excludedTheme(text), text).toBeNull();
    }
    expect(turnOnsFor(["dirty_talk", "praise", "being_told"], { chips: ["dominance"], own: ["praise"] })).toEqual(["dirty talk"]);
    expect(profileLines({ a: "Ada Lumen", b: "Bo Quill" }, { a: [], b: [] }, null)).toEqual([]);
  });
});
