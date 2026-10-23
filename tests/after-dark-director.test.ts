import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { GET as whyGet } from "@/app/api/admin/after-dark/why/route";
import { cleanSuggestion, fallbackSuggestion, holdSuggestion, suggestionsFor, suggestionsIn, SUGGESTION_MAX, type SuggestionRules } from "@/lib/adult/director";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { CHAPTER_LINES, UNDO_DEPTH } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark's director (lib/adult/director.ts, lib/adult/scenes.ts; David, 2026-10-22): suggested next moves, rewind
// and redo, and a whisper to one of the two. Every rule a line is held to holds for each of them.
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
const get = async (cookie: string) => (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json()).scene;
const why = async (cookie: string) => (await whyGet(new Request(`${BASE_URL}/api/admin/after-dark/why?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json();
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

// Made-up words, never the same twice, so no guard reads two lines as a repeat, a worn phrase or a theme.
let k = 0;
const SYL = [["ka", "lo", "mi", "nu", "pe", "ra", "si", "tu", "vo", "ze"], ["ban", "dor", "fel", "gim", "hux", "jor", "kel", "lum", "mox", "nib"], ["a", "e", "i", "o", "u", "y", "ae", "oi", "ua", "ie"], ["p", "t", "k", "s", "m", "n", "l", "r", "v", "z"]];
const word = () => {
  const i = k++;
  return SYL.map((syl, d) => syl[Math.floor(i / 10 ** d) % 10]).join("");
};
const fresh = () => `${word()} ${word()} ${word()} ${word()}.`;
/** Six new lines (never a repeat), with what else the reply should carry. */
const six = (extra: Record<string, unknown> = {}) => ({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: fresh() })), ...extra });
/**
 * The model, scripted: each step takes the next reply (the last repeats; a function is called each time); the recap,
 * facts and PG notes get their own. Returns the steps' prompts.
 */
function scripted(...replies: unknown[]) {
  const prompts: ChatMessage[][] = [];
  let i = 0;
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap/.test(messages[0].content)) return JSON.stringify({ recap: "They talked by the lighthouse until late." });
      if (/factual memory/.test(messages[0].content)) return JSON.stringify({ a: [{ kind: "promise", fact: "Rafe promised Juniper a storm cake next time it rains", quote: null }], b: [{ kind: "like", fact: "Juniper names every gull on the pier", quote: null }] });
      if (/what a private night left behind/.test(messages[0].content)) return JSON.stringify({ a: "You and Rafe stayed up talking at the lighthouse; you're closer now.", b: "You and Juniper stayed up talking at the lighthouse; you're closer now." });
      prompts.push(messages);
      const r = replies[Math.min(i++, replies.length - 1)];
      return JSON.stringify(typeof r === "function" ? r() : r);
    },
  } as never);
  return prompts;
}
/** Fresh lines every step. */
const freshSteps = (extra: Record<string, unknown> = {}) => scripted(() => six(extra));

const RULES: SuggestionRules = { stage: 0, maxStage: 1, publicPlace: false, names: { a: "Juniper Vale", b: "Rafe Calloway" }, cast: new Set(["sable", "dex"]) };

describe("suggested next moves", () => {
  it("reads the shapes a reply gives them in, and tidies each one", () => {
    expect(suggestionsIn({ suggestions: { mild: "a", flirty: "b", spicy: "c" } })).toEqual({ mild: "a", flirty: "b", spicy: "c" });
    expect(suggestionsIn({ suggestions: [{ heat: "spicy", text: "c" }, { heat: "mild", text: "a" }] })).toEqual({ spicy: "c", mild: "a" });
    expect(suggestionsIn({ suggestions: ["a", "b", "c"] })).toEqual({ mild: "a", flirty: "b", spicy: "c" });
    expect(suggestionsIn({ lines: [] })).toEqual({});
    expect(cleanSuggestion('  "Mild: She pulls him in to dance."  ')).toBe("She pulls him in to dance");
  });

  it("holds each one to the rules a line is: the two lines, the length, other people, the pace", () => {
    expect(holdSuggestion("She pulls him in to dance", RULES)).toEqual({ ok: true, text: "She pulls him in to dance" });
    expect(holdSuggestion("x".repeat(SUGGESTION_MAX + 1), RULES)).toMatchObject({ ok: false });
    expect(holdSuggestion("She tells him she's sixteen", RULES)).toMatchObject({ ok: false, reason: "crosses one of the two lines" });
    expect(holdSuggestion("They call Sable over to join them", RULES)).toMatchObject({ ok: false, reason: expect.stringMatching(/names someone/) });
    // Talking now: a stage on (a touch) is fine, a kiss or more is past the pace.
    expect(holdSuggestion("Her hand finds his on the table", RULES).ok).toBe(true);
    expect(holdSuggestion("They kiss", RULES)).toMatchObject({ ok: false, reason: expect.stringMatching(/past tension/) });
    expect(holdSuggestion("He undresses her slowly", RULES)).toMatchObject({ ok: false });
    expect(holdSuggestion("They take it further", { ...RULES, stage: 2, maxStage: 3 }).ok).toBe(true);
    expect(holdSuggestion("They take it all the way", { ...RULES, stage: 2, maxStage: 3 }).ok).toBe(true);
    expect(holdSuggestion("They take it all the way", { ...RULES, stage: 2, maxStage: 2 }).ok).toBe(false);
    // A limit the rules bring (the pair's hard-nos) holds too.
    expect(holdSuggestion("He pins her wrists", { ...RULES, limit: (s) => (/wrists/.test(s) ? "a hard no" : null) })).toMatchObject({ ok: false, reason: "a hard no" });
  });

  it("somewhere public, nothing past kissing: going further means leaving for somewhere private first", () => {
    const pub: SuggestionRules = { ...RULES, stage: 2, maxStage: 3, publicPlace: true };
    expect(holdSuggestion("He starts undressing her in the booth", pub)).toMatchObject({ ok: false, reason: "past kissing somewhere public" });
    expect(holdSuggestion("They take it further, right here", pub)).toMatchObject({ ok: false, reason: "past kissing somewhere public" });
    expect(holdSuggestion("She kisses him again, slower", pub).ok).toBe(true);
    expect(holdSuggestion("They leave for her place and start undressing", pub).ok).toBe(true);
    expect(fallbackSuggestion("spicy", pub)).toMatch(/somewhere private/);
    expect(holdSuggestion(fallbackSuggestion("spicy", pub), pub).ok).toBe(true);
  });

  it("puts a plain one of the same heat in place of one that fails, held to the same rules", () => {
    const { suggestions, replaced } = suggestionsFor({ mild: "They share the last biscuit", flirty: "She tells him she's sixteen", spicy: "They kiss hard" }, RULES);
    expect(suggestions.map((s) => s.heat)).toEqual(["mild", "flirty", "spicy"]);
    expect(suggestions[0].text).toBe("They share the last biscuit");
    expect(suggestions[1].text).toBe(fallbackSuggestion("flirty", RULES));
    expect(suggestions[2].text).toBe(fallbackSuggestion("spicy", RULES));
    expect(replaced).toBe(2);
    // Every fallback passes its own rules, at every stage, public or not.
    for (const stage of [0, 1, 2, 3, 4]) {
      for (const publicPlace of [false, true]) {
        const r = { ...RULES, stage, maxStage: Math.min(4, stage + 1), publicPlace };
        for (const heat of ["mild", "flirty", "spicy"] as const) expect(holdSuggestion(fallbackSuggestion(heat, r), r).ok).toBe(true);
      }
    }
  });

  it("come with each step, are stored on the scene (a reload shows them), and a tap sends one as a nudge", async () => {
    const { cookie } = await admin();
    const prompts = scripted(six({ place: "the lighthouse", stage: 1, suggestions: { mild: "He makes her tea", flirty: "She teases him about the gulls", spicy: "He undresses her by the lamp" } }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    // Asked for in the reply's JSON, with the pace and the length.
    expect(prompts[0][1].content).toMatch(/"suggestions": \{"mild": "\.\.\.", "flirty": "\.\.\.", "spicy": "\.\.\."\}/);
    expect(prompts[0][1].content).toMatch(new RegExp(`under ${SUGGESTION_MAX} characters`));
    expect(r.scene.suggestions).toEqual([
      { heat: "mild", text: "He makes her tea" },
      { heat: "flirty", text: "She teases him about the gulls" },
      // Undressing is three stages past talking (the first step holds at talking): a plain one in its place.
      { heat: "spicy", text: "A touch that lingers, and neither of them pulls away" },
    ]);
    expect((await get(cookie)).suggestions).toEqual(r.scene.suggestions);
    // The page sends a tapped chip as a nudge; it's an ordinary steer.
    freshSteps();
    await post({ a: CAST_A, b: CAST_B, direction: "He makes her tea", steer_mode: "nudge" }, cookie);
    expect((await why(cookie)).current.steps.at(-1)).toMatchObject({ direction: "He makes her tea", steer_mode: "nudge" });
  });

  it("in a public place, the spicy one has them leave for somewhere private instead of going further", async () => {
    const { cookie } = await admin();
    const scene = await get(cookie);
    await t.db.query(`update adult_scenes set place = 'the bar', set_place = 'the bar', stage = 2, stage_from = 0 where id = $1`, [scene.id]);
    freshSteps({ place: "the bar", stage: 3, suggestions: { mild: "She buys him a drink", flirty: "He whispers a dare in her ear", spicy: "She undresses him at the bar" } });
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.scene.stage).toBe(2);
    expect(r.scene.suggestions.find((s: { heat: string }) => s.heat === "spicy").text).toBe("One of them suggests they leave for somewhere private");
    freshSteps({ place: "the bar", stage: 2, suggestions: { mild: "She buys him a drink", flirty: "He whispers a dare in her ear", spicy: "They leave for his place, kissing in the cab" } });
    const r2 = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r2.scene.suggestions.find((s: { heat: string }) => s.heat === "spicy").text).toBe("They leave for his place, kissing in the cab");
  });

  it("go when the night starts over or the scene is set somewhere new", async () => {
    const { cookie } = await admin();
    freshSteps({ suggestions: { mild: "He makes her tea", flirty: "She teases him", spicy: "Her hand finds his" } });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect((await get(cookie)).suggestions).toHaveLength(3);
    await post({ a: CAST_A, b: CAST_B, set_scene: "the rooftop" }, cookie);
    expect((await get(cookie)).suggestions).toEqual([]);
    await post({ a: CAST_A, b: CAST_B }, cookie);
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    expect((await get(cookie)).suggestions).toEqual([]);
  });
});

describe("rewind and redo", () => {
  it("takes the last step back: its lines, the stage, the place and the set, and its move", async () => {
    const { cookie } = await admin();
    freshSteps({ place: "the cafe", stage: 1 });
    const one = (await (await post({ a: CAST_A, b: CAST_B }, cookie)).json()).scene;
    expect(one.place_history).toHaveLength(1);
    // The second step agrees to go to his place, and goes.
    scripted({
      lines: [
        { who: "a", text: "Let's go back to your place, Rafe?" },
        { who: "b", text: "Yes. Lead the way." },
        { who: "a", text: "*leads him out into the night* It's not far." },
        { who: "b", text: "*unlocks his front door* Come on in." },
      ],
      place: "Rafe's place",
      set: "his living room",
      stage: 1,
    });
    const two = (await (await post({ a: CAST_A, b: CAST_B }, cookie)).json()).scene;
    expect(two.lines.length).toBeGreaterThan(one.lines.length);
    expect(two.place_history).toHaveLength(2);
    expect(two.set_place).not.toBe(one.set_place);
    expect(two.rewind.depth).toBe(2);
    const back = await (await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).json();
    expect(back.rewound).toBe(two.lines.length - one.lines.length);
    for (const k of ["lines", "place", "stage", "stage_from", "set_place", "place_history", "moves", "chapter", "suggestions"]) expect(back.scene[k]).toEqual(one[k]);
    expect(back.scene.rewind.depth).toBe(1);
    expect(await get(cookie)).toMatchObject({ lines: one.lines, place: one.place, set_place: one.set_place, place_history: one.place_history });
  });

  it("keeps the log honest: the step stays, marked rewound with the lines it wrote, and the rewind is a step of its own", async () => {
    const { cookie } = await admin();
    freshSteps();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const gone = (await (await post({ a: CAST_A, b: CAST_B, direction: "they dance", steer_mode: "direct" }, cookie)).json()).scene.lines.slice(6);
    await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie);
    const steps = (await why(cookie)).current.steps as { kind: string; direction: string | null; rewound?: { lines: { who: string; text: string }[] } | null; message: string | null }[];
    expect(steps.map((s) => s.kind)).toEqual(["write", "write", "rewind"]);
    expect(steps[0].rewound ?? null).toBeNull();
    expect(steps[1].rewound?.lines).toEqual(gone.map((l: { who: string; text: string }) => ({ who: l.who, text: l.text })));
    expect(gone).toHaveLength(6);
    expect(steps[2]).toMatchObject({ direction: "they dance", message: "took back 6 lines" });
    // The lines still there map to the step that wrote them, never the rewound one.
    expect((await why(cookie)).current.lines.map((l: { step: number | null }) => l.step)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("gives the facts its lines cited their uses back, and drops votes on the lines that went", async () => {
    const { id, cookie } = await admin();
    await t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact, uses, last_used_at) values ('f-cake', $1, 'house-juniper', 'house-rafe', 'promise', 'Rafe promised Juniper a storm cake next time it rains', 2, '2026-10-01T00:00:00Z')`, [id]);
    freshSteps();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    scripted({ lines: [{ who: "a", text: "It's raining. Where's my storm cake, Rafe?", why: "his promise", memory: "F1" }, { who: "b", text: "In the oven already, cake thief." }] });
    const two = (await (await post({ a: CAST_A, b: CAST_B }, cookie)).json()).scene;
    expect((await t.db.query<{ uses: number }>(`select uses from adult_facts where id = 'f-cake'`)).rows[0].uses).toBe(3);
    for (const line_index of [0, 6, 7]) {
      await t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote) values ($1, $2, 'after_dark', $3, $4, 1)`, [crypto.randomUUID(), id, two.id, line_index]);
    }
    await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie);
    const fact = (await t.db.query<{ uses: number; last: string }>(`select uses, last_used_at::text as last from adult_facts where id = 'f-cake'`)).rows[0];
    expect(fact.uses).toBe(2);
    expect(new Date(fact.last).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect((await t.db.query<{ line_index: number }>(`select line_index from line_feedback order by line_index`)).rows.map((r) => r.line_index)).toEqual([0]);
  });

  it("takes back a chapter's close too: the night, the recap, the PG notes and the facts it changed", async () => {
    const { id, cookie } = await admin();
    const scene = await get(cookie);
    const full = Array.from({ length: CHAPTER_LINES - 6 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `Filler line ${i}.` }));
    await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = 2, stage_from = 100 where id = $1`, [scene.id, JSON.stringify(full)]);
    // What was there before the chapter closed: an old PG note one way, and a fact the extraction's cap will have to drop.
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note) values ('house-juniper', 'house-rafe', $1, 'You and Rafe watched the storm come in; you still owe him a rematch.')`, [id]);
    for (let i = 0; i < 40; i++) {
      await t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact, uses, created_at) values ($1, $2, 'house-juniper', 'house-rafe', 'event', $3, $4, '2026-10-01T00:00:00Z')`, [`old-${i}`, id, `Juniper remembers old evening number ${i} at the pier`, i === 0 ? 0 : 5]);
    }
    await t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote) values ($1, $2, 'after_dark', $3, 3, -1)`, [crypto.randomUUID(), id, scene.id]);
    const before = await get(cookie);
    freshSteps();
    const closed = (await (await post({ a: CAST_A, b: CAST_B }, cookie)).json()).scene;
    expect(closed).toMatchObject({ chapter: 2, lines: [], recap: expect.stringContaining("lighthouse") });
    expect((await t.db.query(`select 1 from adult_nights`)).rows).toHaveLength(1);
    expect((await t.db.query(`select 1 from adult_facts where id = 'old-0'`)).rows).toHaveLength(0);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from adult_facts`)).rows[0].n).toBe(41);
    expect((await t.db.query<{ note: string }>(`select note from adult_memories where character_id = 'house-juniper'`)).rows[0].note).toMatch(/lighthouse/);
    const back = await (await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).json();
    expect(back.nights).toEqual([]);
    for (const k of ["lines", "chapter", "recap", "prev_tail", "stage", "stage_from", "moves"]) expect(back.scene[k]).toEqual(before[k]);
    expect((await t.db.query(`select 1 from adult_nights`)).rows).toHaveLength(0);
    // The PG notes as they were: the old one back, and none the other way (there wasn't one).
    const notes = (await t.db.query<{ character_id: string; note: string }>(`select character_id, note from adult_memories`)).rows;
    expect(notes).toEqual([{ character_id: "house-juniper", note: "You and Rafe watched the storm come in; you still owe him a rematch." }]);
    // The facts as they were: the extracted ones gone, the one dropped to make room back.
    const facts = (await t.db.query<{ id: string }>(`select id from adult_facts order by id`)).rows.map((r) => r.id);
    expect(facts).toHaveLength(40);
    expect(facts.every((f) => f.startsWith("old-"))).toBe(true);
    // The votes and steps came back to the scene from the night that's gone.
    expect((await t.db.query<{ ref_id: string }>(`select ref_id from line_feedback`)).rows).toEqual([{ ref_id: scene.id }]);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from adult_steps where night_id is not null`)).rows[0].n).toBe(0);
  });

  it("can go back UNDO_DEPTH steps, and never past Start over or Set the scene", async () => {
    const { cookie } = await admin();
    expect((await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).status).toBe(409);
    freshSteps();
    for (let i = 0; i < UNDO_DEPTH + 1; i++) await post({ a: CAST_A, b: CAST_B }, cookie);
    expect((await get(cookie)).rewind.depth).toBe(UNDO_DEPTH);
    for (let i = 0; i < UNDO_DEPTH; i++) expect((await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).status).toBe(200);
    expect((await get(cookie)).lines).toHaveLength(6);
    expect((await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).status).toBe(409);
    await post({ a: CAST_A, b: CAST_B }, cookie);
    await post({ a: CAST_A, b: CAST_B, set_scene: "the rooftop" }, cookie);
    expect((await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).status).toBe(409);
    await post({ a: CAST_A, b: CAST_B }, cookie);
    // After the cut, the step that opened on arriving there can be rewound: it opens on arriving again.
    const back = await (await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).json();
    expect(back.scene.cut_to).toBe("the rooftop");
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    expect((await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).status).toBe(409);
  });

  it("redo writes the step again with the same steer, strength and whisper, and counts for the month", async () => {
    const { cookie } = await admin();
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const subCookie = signedIn(sub);
    void cookie;
    // The month's caps live in the settings row (300 steps by default).
    await t.db.query(`insert into adult_settings (id) values (1) on conflict (id) do nothing`);
    const prompts = freshSteps();
    await post({ a: CAST_A, b: CAST_B }, subCookie);
    await post({ a: CAST_A, b: CAST_B, direction: "they dance in the kitchen", steer_mode: "direct", whisper: { to: "b", text: "she's been waiting all night for you to ask" } }, subCookie);
    const first = prompts.length;
    const redone = await (await post({ a: CAST_A, b: CAST_B, redo: true }, subCookie)).json();
    expect(redone).toMatchObject({ added: 6 });
    const again = prompts[first][1].content;
    expect(again).toMatch(/Steer the scene this way, now: they dance in the kitchen/);
    expect(again).toMatch(/A secret only Rafe knows: "she's been waiting all night for you to ask"/);
    expect(redone.scene.lines).toHaveLength(12);
    const usage = (await t.db.query<{ writes: number }>(`select writes from adult_usage where owner_id = $1`, [sub])).rows[0];
    expect(usage.writes).toBe(3);
    // Capped: a redo is refused before anything is taken back.
    await t.db.query(`insert into adult_settings (id, cap_writes) values (1, 3) on conflict (id) do update set cap_writes = 3`);
    const capped = await post({ a: CAST_A, b: CAST_B, redo: true }, subCookie);
    expect(capped.status).toBe(429);
    expect((await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie: subCookie } }))).json()).scene.lines).toHaveLength(12);
  });
});

describe("whisper to one", () => {
  it("is that one's secret intention in the prompt, for this step and the next, and kept on the step's log", async () => {
    const { cookie } = await admin();
    const prompts = freshSteps();
    const r = await (await post({ a: CAST_A, b: CAST_B, whisper: { to: "a", text: "he wants you to take the lead" } }, cookie)).json();
    expect(prompts[0][1].content).toMatch(/A secret only Juniper knows: "he wants you to take the lead"\. It was whispered to Juniper alone; Rafe doesn't know it/);
    expect(prompts[0][1].content).toMatch(/never said aloud, word for word or nearly/);
    expect(r.scene.whispers).toEqual({ a: { text: "he wants you to take the lead", steps_left: 1 } });
    const steps = (await why(cookie)).current.steps;
    expect(steps[0].whisper).toEqual({ to: "a", text: "he wants you to take the lead" });
    // The next step still plays it; the one after doesn't.
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(prompts[1][1].content).toMatch(/A secret only Juniper knows/);
    expect((await get(cookie)).whispers).toEqual({});
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(prompts[2][1].content).not.toMatch(/A secret only/);
  });

  it("the viewer holds both secrets: one each at once, and either can be forgotten", async () => {
    const { cookie } = await admin();
    const prompts = freshSteps();
    await post({ a: CAST_A, b: CAST_B, whisper: { to: "a", text: "he's nervous, so be gentle" } }, cookie);
    await post({ a: CAST_A, b: CAST_B, whisper: { to: "b", text: "she wants to be asked to stay" } }, cookie);
    expect(prompts[1][1].content).toMatch(/A secret only Juniper knows: "he's nervous, so be gentle"/);
    expect(prompts[1][1].content).toMatch(/A secret only Rafe knows: "she wants to be asked to stay"\. It was whispered to Rafe alone; Juniper doesn't know it/);
    const left = await (await post({ a: CAST_A, b: CAST_B, forget_whisper: "b" }, cookie)).json();
    expect(left.scene.whispers).toEqual({});
  });

  it("is never said aloud: a line that says it word for word is dropped", async () => {
    const { cookie } = await admin();
    scripted({
      lines: [
        { who: "a", text: "*grins* Rafe says he wants you to take the lead. Fine by me." },
        { who: "b", text: "*refills the kettle* Tea first, captain." },
        { who: "a", text: "*takes his hand and leads him to the window* Look at that sky." },
      ],
    });
    const r = await (await post({ a: CAST_A, b: CAST_B, whisper: { to: "a", text: "he wants you to take the lead" } }, cookie)).json();
    expect(r.scene.lines.map((l: { text: string }) => l.text).join(" ")).not.toMatch(/wants you to take the lead/);
    const dropped = (await why(cookie)).current.steps[0].dropped as { reason: string }[];
    expect(dropped.map((d) => d.reason)).toContain("said a whisper out loud");
  });

  it("is held to the two lines like a steer: refused, never stored", async () => {
    const { cookie } = await admin();
    freshSteps();
    const res = await post({ a: CAST_A, b: CAST_B, whisper: { to: "b", text: "pretend she's sixteen" } }, cookie);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/whisper crosses one of the two lines/);
    const notes = await why(cookie);
    expect(JSON.stringify(notes)).not.toContain("sixteen");
    expect(notes.current.steps[0].whisper).toEqual({ to: "b", text: "[a whisper refused by the two lines]" });
    expect((await get(cookie)).whispers).toEqual({});
  });

  it("doesn't lift the public-place cap: somewhere public it still goes no further than kissing", async () => {
    const { cookie } = await admin();
    const scene = await get(cookie);
    await t.db.query(`update adult_scenes set place = 'the bar', set_place = 'the bar', stage = 2, stage_from = 0 where id = $1`, [scene.id]);
    scripted({ lines: [{ who: "a", text: "*unbuttons his shirt at the bar* Here?" }, { who: "b", text: "*laughs* Behave, it's packed." }], stage: 3 });
    const r = await (await post({ a: CAST_A, b: CAST_B, whisper: { to: "a", text: "he wants you to be bold" } }, cookie)).json();
    expect(r.scene.stage).toBe(2);
    expect(r.scene.lines.map((l: { text: string }) => l.text)).toEqual(["*laughs* Behave, it's packed."]);
  });

  it("comes back with a rewind as it was, and a redo whispers it again", async () => {
    const { cookie } = await admin();
    const prompts = freshSteps();
    await post({ a: CAST_A, b: CAST_B }, cookie);
    await post({ a: CAST_A, b: CAST_B, whisper: { to: "a", text: "he hasn't stopped looking at you" } }, cookie);
    expect((await get(cookie)).whispers.a.text).toBe("he hasn't stopped looking at you");
    const back = await (await post({ a: CAST_A, b: CAST_B, rewind: true }, cookie)).json();
    expect(back.scene.whispers).toEqual({});
    // What a redo would ask now: the first step's (no steer, no whisper).
    expect(back.scene.rewind).toEqual({ depth: 1, last: { direction: null, steer_mode: "nudge", whisper: null } });
    await post({ a: CAST_A, b: CAST_B, whisper: { to: "a", text: "he hasn't stopped looking at you" } }, cookie);
    const at = prompts.length;
    const redone = await (await post({ a: CAST_A, b: CAST_B, redo: true }, cookie)).json();
    expect(prompts[at][1].content).toMatch(/A secret only Juniper knows: "he hasn't stopped looking at you"/);
    expect(redone.scene.whispers).toEqual({ a: { text: "he hasn't stopped looking at you", steps_left: 1 } });
  });
});
