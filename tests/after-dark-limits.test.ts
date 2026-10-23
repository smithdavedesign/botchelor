import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { GET as whyGet } from "@/app/api/admin/after-dark/why/route";
import { hardNoHit, hitsOwn, limitsHit, overIntensity, ownWords, type HardNos } from "@/lib/adult/limits";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { sceneMessages } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The viewer's limits for a pair (lib/adult/limits.ts; David, 2026-10-22): an intensity dial and a hard-no list, held by
// every step, steer (Direct too), whisper and suggested next move; and memory they can see and edit.
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
const six = (extra: Record<string, unknown> = {}) => ({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: fresh() })), ...extra });
/** The model, scripted: each step takes the next reply (the last repeats; a function is called each time). Returns the steps' prompts. */
function scripted(...replies: unknown[]) {
  const prompts: ChatMessage[][] = [];
  let i = 0;
  setAdultModelForTests({
    complete: async (messages: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(messages[0].content)) return "{}";
      prompts.push(messages);
      const r = replies[Math.min(i++, replies.length - 1)];
      return JSON.stringify(typeof r === "function" ? r() : r);
    },
  } as never);
  return prompts;
}
const limits = (cookie: string, l: Record<string, unknown>) => post({ a: CAST_A, b: CAST_B, limits: l }, cookie);

describe("the checks", () => {
  const H = (chips: string[], own: string[] = []): HardNos => ({ chips, own });
  it("reads each curated hard no in what a line says or does, and not in an everyday line", () => {
    expect(hardNoHit("*wraps a hand round her throat*", H(["choking"]))).toBe("Choking");
    expect(hardNoHit("She chokes back a laugh at the joke.", H(["choking"]))).toBeNull();
    expect(hardNoHit("*pins her wrists above her head*", H(["restraints"]))).toBe("Restraints");
    expect(hardNoHit("*rolls up his shirt cuffs* Tea?", H(["restraints"]))).toBeNull();
    expect(hardNoHit("You're such a good girl.", H(["dominance"]))).toBe("Dom and sub");
    expect(hardNoHit("What would your wife say?", H(["cheating"]))).toBe("Cheating talk");
    expect(hardNoHit("I'll spank you for that.", H(["pain"]))).toBe("Pain");
    expect(hardNoHit("*tucks her hair behind her ear*", H(["hair_pulling"]))).toBeNull();
    expect(hardNoHit("*his hand slides up to her throat*", H(["choking"]))).toBe("Choking");
    expect(hardNoHit("*traces a finger down her neck*", H(["choking"]))).toBeNull();
    expect(hardNoHit("*pulls her hair* Like that?", H(["hair_pulling"]))).toBe("Hair pulling");
    // Dirty talk is in what they say, not in what the action shows.
    expect(hardNoHit("God, I want to fuck you.", H(["dirty_talk"]))).toBe("Dirty talk");
    expect(hardNoHit("*they fuck slowly* You're warm.", H(["dirty_talk"]))).toBeNull();
    expect(hardNoHit("I'll spank you for that.", H([]))).toBeNull();
  });

  it("reads the viewer's own hard nos by their words", () => {
    expect(ownWords("No tickling!")).toEqual(["tickl"]);
    expect(hitsOwn("*tickles her ribs*", "tickling")).toBe(true);
    expect(hitsOwn("He calls her baby again.", "being called baby")).toBe(true);
    expect(hitsOwn("Baby, the kettle's on.", "being called baby")).toBe(false);
    expect(hitsOwn("*bites her shoulder*", "biting")).toBe(true);
    expect(hitsOwn("We should talk about your ex.", "talk about my ex")).toBe(true);
    expect(hitsOwn("Exactly what I said.", "talk about my ex")).toBe(false);
    expect(hardNoHit("*tickles her ribs*", H([], ["tickling"]))).toBe('"tickling"');
  });

  it("holds a line to the intensity: no further than its stage, and nothing crude below explicit", () => {
    expect(overIntensity("*kisses her slowly*", "slow_burn")).toBeNull();
    expect(overIntensity("*unbuttons her blouse*", "slow_burn")).toMatch(/went past kissing/);
    expect(overIntensity("*unbuttons her blouse*", "flirty")).toBeNull();
    expect(overIntensity("*pushes inside her*", "flirty")).toMatch(/went past undressing/);
    expect(overIntensity("*pushes inside her*", "spicy")).toBeNull();
    expect(overIntensity("I want your cock.", "spicy")).toMatch(/too crude for spicy/);
    expect(overIntensity("I want your cock.", "explicit")).toBeNull();
    expect(limitsHit("*kisses her*", { intensity: "explicit", hard_nos: H(["choking"]) })).toBeNull();
  });
});

describe("the intensity dial", () => {
  it("is explicit by default, with the prompt as it was; lower, the prompt says its register and how far it goes", () => {
    const plain = sceneMessages(null, null, null, [], null)[0].content;
    expect(plain).toMatch(/Explicit sexual content is allowed and expected/);
    expect(plain).not.toMatch(/Tonight it goes no further/);
    const slow = sceneMessages(null, null, null, [], null, undefined, { place: "the pier", stage: 2, linesAtStage: 20, limits: { intensity: "slow_burn", hard_nos: { chips: [], own: [] } } })[0].content;
    expect(slow).not.toMatch(/Explicit sexual content is allowed/);
    expect(slow).toMatch(/Keep it a slow burn: tender and suggestive/);
    expect(slow).toMatch(/Tonight it goes no further than kissing\./);
    expect(slow).toMatch(/It's gone as far as tonight goes \(kissing\): these lines stay there/);
    expect(slow).not.toMatch(/Move it on/);
    // Turned down past where they are: ease back.
    const down = sceneMessages(null, null, null, [], null, undefined, { place: "her flat", stage: 4, limits: { intensity: "flirty", hard_nos: { chips: [], own: [] } } })[0].content;
    expect(down).toMatch(/turned it down to flirty: from here it goes no further than undressing/);
  });

  it("is stored per owner and pair, outlives Start over, and is shown with the scene", async () => {
    const one = await admin();
    const two = await admin();
    expect((await get(one.cookie)).scene).toMatchObject({ intensity: "explicit", hard_nos: { chips: [], own: [] } });
    const saved = await (await limits(one.cookie, { intensity: "slow_burn", hard_nos: { chips: ["choking"], own: ["tickling"] } })).json();
    expect(saved.scene).toMatchObject({ intensity: "slow_burn", hard_nos: { chips: ["choking"], own: ["tickling"] } });
    expect((await get(two.cookie)).scene).toMatchObject({ intensity: "explicit", hard_nos: { chips: [], own: [] } });
    scripted(() => six());
    await post({ a: CAST_A, b: CAST_B }, one.cookie);
    await post({ a: CAST_A, b: CAST_B, reset: true }, one.cookie);
    expect((await get(one.cookie)).scene).toMatchObject({ intensity: "slow_burn", hard_nos: { chips: ["choking"], own: ["tickling"] } });
  });

  it("drops lines past its stage and never lets the stage climb past it, a Direct steer included", async () => {
    const { cookie } = await admin();
    await limits(cookie, { intensity: "slow_burn" });
    const scene = (await get(cookie)).scene;
    await t.db.query(`update adult_scenes set place = 'her flat', set_place = 'her flat', stage = 2, stage_from = 0 where id = $1`, [scene.id]);
    scripted({
      lines: [
        { who: "a", text: "*kisses him against the bookshelf* Finally." },
        { who: "b", text: "*unbuttons her blouse* Is this all right?" },
        { who: "a", text: "*laughs into the kiss* Slow, chef. Slow." },
      ],
      stage: 4,
    });
    const r = await (await post({ a: CAST_A, b: CAST_B, direction: "they kiss for a long time", steer_mode: "direct" }, cookie)).json();
    expect(r.scene.stage).toBe(2);
    expect(r.scene.lines.map((l: { text: string }) => l.text).join(" ")).not.toMatch(/unbuttons/);
    const dropped = (await why(cookie)).current.steps[0].dropped as { reason: string }[];
    expect(dropped.map((d) => d.reason)).toContain("went past kissing (the intensity is slow burn)");
  });

  it("refuses a steer or whisper that asks past it, and turned down, brings the stage back to it", async () => {
    const { cookie } = await admin();
    await limits(cookie, { intensity: "flirty" });
    scripted(() => six());
    const res = await post({ a: CAST_A, b: CAST_B, direction: "they go to bed and have sex", steer_mode: "direct" }, cookie);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/goes past undressing, as far as flirty goes/);
    expect((await post({ a: CAST_A, b: CAST_B, whisper: { to: "a", text: "he wants you inside him tonight" } }, cookie)).status).toBe(422);
    // At sex already, and the dial goes down to flirty: the next step stands at undressing at most.
    const scene = (await get(cookie)).scene;
    await t.db.query(`update adult_scenes set place = 'her flat', set_place = 'her flat', stage = 4, stage_from = 0 where id = $1`, [scene.id]);
    const prompts = scripted(() => six({ stage: 5 }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(prompts[0][0].content).toMatch(/turned it down to flirty/);
    expect(r.scene.stage).toBe(3);
  });

  it("holds the suggested next moves to it", async () => {
    const { cookie } = await admin();
    await limits(cookie, { intensity: "slow_burn" });
    const scene = (await get(cookie)).scene;
    await t.db.query(`update adult_scenes set place = 'her flat', set_place = 'her flat', stage = 2, stage_from = 0 where id = $1`, [scene.id]);
    const prompts = scripted(six({ stage: 3, suggestions: { mild: "They trade stories about the harbour", flirty: "She steals his scarf", spicy: "He undresses her slowly" } }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(prompts[0][1].content).toMatch(/at most one stage further than these lines end on, and never past kissing/);
    const spicy = r.scene.suggestions.find((s: { heat: string }) => s.heat === "spicy");
    expect(spicy.text).toBe("They draw it out, slower than before");
    // And a change of limits holds the ones already there to the new ones at once.
    await limits(cookie, { hard_nos: { chips: [], own: ["scarf"] } });
    const flirty = (await get(cookie)).scene.suggestions.find((s: { heat: string }) => s.heat === "flirty");
    expect(flirty.text).not.toMatch(/scarf/);
  });
});

describe("the hard nos", () => {
  it("are in the prompt as never-cross rules that hold over every steer, the viewer's own too", async () => {
    const { cookie } = await admin();
    await limits(cookie, { hard_nos: { chips: ["choking", "cheating"], own: ["tickling"] } });
    const prompts = scripted(() => six());
    await post({ a: CAST_A, b: CAST_B, direction: "they get closer", steer_mode: "direct" }, cookie);
    const system = prompts[0][0].content;
    expect(system).toMatch(/Hard limits the viewer has set for these two\. They hold over every steer \(a nudge, a direct steer, a whisper\)/);
    expect(system).toMatch(/- No choking or breath play/);
    expect(system).toMatch(/- No cheating talk/);
    expect(system).toMatch(/- Never: tickling\./);
    expect(prompts[0][1].content).toMatch(/None of them goes near the hard limits/);
  });

  it("hold over a Direct steer: a line that crosses one is dropped and the step asked once more, the retry's lines kept", async () => {
    const { cookie } = await admin();
    await limits(cookie, { hard_nos: { chips: ["choking"], own: [] } });
    const prompts = scripted(
      { lines: [{ who: "a", text: "*kisses him hard*" }, { who: "b", text: "*wraps a hand round her throat* Like this?" }, { who: "a", text: fresh() }] },
      () => six(),
    );
    const r = await (await post({ a: CAST_A, b: CAST_B, direction: "they kiss like they mean it", steer_mode: "direct" }, cookie)).json();
    expect(prompts).toHaveLength(2);
    expect(prompts[1][1].content).toMatch(/crossed the viewer's hard limits \(Choking\)/);
    expect(r.added).toBe(6);
    expect(JSON.stringify(r.scene.lines)).not.toMatch(/throat/);
    const step = (await why(cookie)).current.steps[0];
    expect(step.flags).toMatchObject({ hard_nos: 1, retried: true, calls: 2 });
    expect(step.dropped.map((d: { reason: string }) => d.reason)).toContain("crossed a hard limit (Choking)");
  });

  it("keep the first reply's other lines when the second has nothing to keep", async () => {
    const { cookie } = await admin();
    await limits(cookie, { hard_nos: { chips: [], own: ["tickling"] } });
    const keep = fresh();
    scripted({ lines: [{ who: "a", text: keep }, { who: "b", text: "*tickles her ribs*" }] }, { lines: [{ who: "a", text: "*tickles him back*" }] });
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.scene.lines.map((l: { text: string }) => l.text)).toEqual([keep]);
  });

  it("refuse a steer or whisper that asks for one, nudge or direct", async () => {
    const { cookie } = await admin();
    await limits(cookie, { hard_nos: { chips: ["restraints"], own: ["tickling"] } });
    scripted(() => six());
    for (const body of [
      { direction: "he ties her up", steer_mode: "direct" },
      { direction: "a tickling fight", steer_mode: "nudge" },
      { whisper: { to: "b", text: "she wants you to blindfold her" } },
    ]) {
      const res = await post({ a: CAST_A, b: CAST_B, ...body }, cookie);
      expect(res.status).toBe(422);
      expect((await res.json()).message).toMatch(/one of your hard limits/);
    }
    expect((await get(cookie)).scene.lines).toEqual([]);
  });

  it("hold the suggested next moves", async () => {
    const { cookie } = await admin();
    await limits(cookie, { hard_nos: { chips: ["choking"], own: [] } });
    scripted(six({ suggestions: { mild: "They share the last of the tea", flirty: "His hand slides to her throat", spicy: "Her hand finds his" } }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.scene.suggestions.map((s: { text: string }) => s.text).join(" ")).not.toMatch(/throat/);
  });

  it("take at most 8 of the viewer's own, 40 characters each, and never one that crosses the two lines", async () => {
    const { cookie } = await admin();
    expect((await limits(cookie, { hard_nos: { own: Array.from({ length: 9 }, (_, i) => `limit ${i}`) } })).status).toBe(400);
    expect((await limits(cookie, { hard_nos: { own: ["x".repeat(41)] } })).status).toBe(400);
    const res = await limits(cookie, { hard_nos: { own: ["anything with teens"] } });
    expect(res.status).toBe(422);
    expect((await get(cookie)).scene.hard_nos).toEqual({ chips: [], own: [] });
  });
});

describe("memory you can see and edit", () => {
  async function seeded() {
    const me = await admin();
    const other = await admin();
    await get(me.cookie);
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note) values ('house-juniper', 'house-rafe', $1, 'You and Rafe watched the storm from the pier; you owe him a rematch.')`, [me.id]);
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note) values ('house-rafe', 'house-juniper', $1, 'Someone else wrote this one.')`, [other.id]);
    await t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact, quote) values ('f-mine', $1, 'house-juniper', 'house-rafe', 'promise', 'Rafe promised Juniper a storm cake', 'A storm cake, promise.')`, [me.id]);
    await t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact) values ('f-theirs', $1, 'house-rafe', 'house-juniper', 'like', 'Juniper names every gull')`, [other.id]);
    await t.db.query(`update adult_scenes set recap = 'They watched the storm and argued about cake.' where owner_id = $1`, [me.id]);
    return { me, other };
  }

  it("shows what each remembers about the other, only what the viewer's own nights wrote", async () => {
    const { me, other } = await seeded();
    const { memory } = await get(me.cookie, "&memory=1");
    expect(memory).toEqual({
      notes: { a: "You and Rafe watched the storm from the pier; you owe him a rematch.", b: null },
      facts: [{ id: "f-mine", of: "a", kind: "promise", fact: "Rafe promised Juniper a storm cake", quote: "A storm cake, promise.", uses: 0 }],
      recap: "They watched the storm and argued about cake.",
    });
    expect((await get(other.cookie, "&memory=1")).memory).toMatchObject({ notes: { a: null, b: "Someone else wrote this one." }, facts: [{ id: "f-theirs" }], recap: null });
  });

  it("edits the PG note held to the show's own check too, since it reaches their public dates and texts", async () => {
    const { me } = await seeded();
    const ok = await (await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "note", of: "a", text: "You and Rafe stayed up talking on the pier; he still owes you cake." } }, me.cookie)).json();
    expect(ok.memory.notes.a).toBe("You and Rafe stayed up talking on the pier; he still owes you cake.");
    const sexual = await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "note", of: "a", text: "You and Rafe had sex all night." } }, me.cookie);
    expect(sexual.status).toBe(422);
    expect((await sexual.json()).message).toMatch(/has to stay PG/);
    expect((await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "note", of: "a", text: "She was sixteen then." } }, me.cookie)).status).toBe(422);
    // Someone else's note can't be changed or deleted.
    expect((await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "note", of: "b", text: null } }, me.cookie)).status).toBe(404);
    const del = await (await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "note", of: "a", text: null } }, me.cookie)).json();
    expect(del.memory.notes.a).toBeNull();
    expect((await t.db.query(`select note from adult_memories`)).rows).toEqual([{ note: "Someone else wrote this one." }]);
  });

  it("edits or deletes a fact (the edit drops its quote), only the viewer's own, held to the two lines", async () => {
    const { me } = await seeded();
    const ok = await (await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "fact", id: "f-mine", text: "Rafe owes Juniper a storm cake and a rematch" } }, me.cookie)).json();
    expect(ok.memory.facts[0]).toMatchObject({ fact: "Rafe owes Juniper a storm cake and a rematch", quote: null });
    expect((await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "fact", id: "f-mine", text: "Juniper is only 15" } }, me.cookie)).status).toBe(422);
    expect((await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "fact", id: "f-theirs", text: null } }, me.cookie)).status).toBe(404);
    await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "fact", id: "f-mine", text: null } }, me.cookie);
    expect((await t.db.query<{ id: string }>(`select id from adult_facts`)).rows.map((r) => r.id)).toEqual(["f-theirs"]);
  });

  it("edits or deletes the night's recap, and a rewind of a step that didn't close a chapter keeps the edit", async () => {
    const { me } = await seeded();
    scripted(() => six());
    await post({ a: CAST_A, b: CAST_B }, me.cookie);
    const r = await (await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "recap", text: "They argued about cake, then made up." } }, me.cookie)).json();
    expect(r.scene.recap).toBe("They argued about cake, then made up.");
    const back = await (await post({ a: CAST_A, b: CAST_B, rewind: true }, me.cookie)).json();
    expect(back.scene.recap).toBe("They argued about cake, then made up.");
    const prompts = scripted(() => six());
    await post({ a: CAST_A, b: CAST_B }, me.cookie);
    expect(prompts[0][0].content).toMatch(/Earlier tonight[^\n]*\nThey argued about cake, then made up\./);
    const gone = await (await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "recap", text: null } }, me.cookie)).json();
    expect(gone.memory.recap).toBeNull();
  });

  it("is not found for anyone After Dark doesn't open for", async () => {
    await seeded();
    const stranger = signedIn(userIdOf(newUserCookie()));
    const res = await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}&memory=1`, { headers: { cookie: stranger } }));
    expect(res.status).toBe(404);
    expect((await post({ a: CAST_A, b: CAST_B, memory_edit: { kind: "fact", id: "f-mine", text: null } }, stranger)).status).toBe(404);
  });
});
