import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/characters/draft/route";
import { POST as createCharacter } from "@/app/api/characters/route";
import { ENGAGEMENT_FUNNEL } from "@/lib/engagement";
import {
  adultAge,
  draftFromReading,
  expressCreateOn,
  expressDraftedEvent,
  expressFailedEvent,
  expressFailureLine,
  expressStartedEvent,
  EXPRESS_EXAMPLES,
  EXPRESS_PROMPT,
  EXPRESS_TEXT_MAX,
  fieldsFromReply,
  screenExpressText,
  suggestLooks,
} from "@/lib/express-create";
import { profileComplete } from "@/lib/extras";
import type { ImportedDraft } from "@/lib/import-character";
import { EXPRESS_DRAFT_ALL_LIMITS, EXPRESS_DRAFT_IP_LIMITS, EXPRESS_DRAFT_LIMITS } from "@/lib/limits";
import { LooksInput, looksPortraitPrompt, normaliseLooks } from "@/lib/looks";
import { setFrontierModelForTests, setModelForTests } from "@/lib/model";
import { fillProfile } from "@/lib/profile-fill";
import { CHARACTER_REJECTION_MESSAGES } from "@/lib/safety";
import { jsonRequest, newUserCookie, scriptedModel, startTestDb, validCharacter } from "./helpers";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  setModelForTests(null);
  setFrontierModelForTests(null);
  vi.unstubAllEnvs();
});

const SENTENCE = "A lighthouse keeper who repairs old radios and listens to ships talk at night.";
/** What the stub model answers: the reader's labelled fields, as the prompt asks. */
const READING = JSON.stringify({
  name: "Marisol Vane",
  age: 34,
  gender: "woman",
  description: "A lighthouse keeper who repairs old radios and listens to ships talk at night.",
  personality: "wry, patient, guarded",
  wants: "someone who stays up for the late shipping forecast",
  dislikes: "people who whistle indoors",
  occupation: "lighthouse keeper",
  likes: "shortwave radio, storms",
  appearance: "",
});

type Reply = { draft: ImportedDraft; ready: boolean; missing: string[]; invented: { name: boolean; age: boolean }; name_taken?: boolean; free_names?: string[]; reason?: string; message?: string };
const draft = (body: Record<string, unknown>, opts: { cookie?: string; ip?: string } = {}) => {
  const req = jsonRequest("/api/characters/draft", body, { cookie: opts.cookie ?? newUserCookie() });
  if (opts.ip) req.headers.set("x-forwarded-for", opts.ip);
  return POST(req);
};

describe("one-sentence create: the draft (lib/express-create.ts)", () => {
  it("turns the reader's answer into everything Create needs, with a look already picked", () => {
    const r = draftFromReading(fieldsFromReply(READING)!, SENTENCE);
    if (!r.ok) throw new Error(r.message);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.draft.sheet).toEqual({
      name: "Marisol Vane",
      age: "34",
      bio: "A lighthouse keeper who repairs old radios and listens to ships talk at night.",
      want: "someone who stays up for the late shipping forecast",
      dealbreaker: "people who whistle indoors",
    });
    expect(r.draft.traits).toEqual(["wry", "patient", "guarded"]);
    expect(r.draft.pronouns).toBe("she/her");
    expect(r.draft.extras.occupation).toBe("lighthouse keeper");
    expect(r.draft.extras.hobbies).toEqual(["shortwave radio", "storms"]);
    expect(r.invented).toEqual({ name: true, age: true });
    // The suggestion is a real look: the builder's own schema takes it, and a portrait can be drawn from it.
    const looks = r.draft.extras.looks!;
    expect(looks.gender).toBe("woman");
    expect(LooksInput.parse(looks)).toEqual(looks);
    expect(normaliseLooks(looks)).toEqual(looks);
    expect(looksPortraitPrompt(looks, 34)).toBeTruthy();
    // The dating profile is written from the sheet at Create (lib/profile-fill.ts): the draft is enough for it.
    const filled = fillProfile(r.draft.extras, { traits: r.draft.traits, want: r.draft.sheet.want });
    expect(profileComplete(filled)).toBe(true);
    expect(filled.hobbies).toEqual(["shortwave radio", "storms"]);
  });

  it("keeps the name they typed over the model's, and their words when the model loses the bio", () => {
    const r = draftFromReading({ name: "Someone Else", age: "40", personality: "calm, dry, kind", wants: "quiet", dislikes: "noise" }, SENTENCE, "Juno Vex");
    if (!r.ok) throw new Error(r.message);
    expect(r.draft.sheet.name).toBe("Juno Vex");
    expect(r.invented.name).toBe(false);
    expect(r.draft.sheet.bio).toBe(SENTENCE);
    expect(r.ready).toBe(true);
  });

  it("a draft that comes back short says what the form still has to ask", () => {
    const r = draftFromReading({ name: "Ada Lane", description: "A baker." }, "A baker who hums.");
    if (!r.ok) throw new Error(r.message);
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["three traits", "what they want", "a dealbreaker"]);
    // No woman-or-man in the words: no look is guessed.
    expect(r.draft.extras.looks).toBeUndefined();
  });

  it("the look follows what the words say, stays inside the builder's options, and is never guessed without a gender", () => {
    const him = suggestLooks({ pronouns: "he/him", words: "A red-haired chef with green eyes and a big beard", occupation: "chef" })!;
    expect(him).toMatchObject({ gender: "man", style: "realistic", hair_color: "red", eyes: "green", facial_hair: "full_beard", outfit: "work" });
    expect(LooksInput.parse(him)).toEqual(him);
    const her = suggestLooks({ pronouns: "she/her", words: "A goth violinist with curly black hair" })!;
    expect(her).toMatchObject({ gender: "woman", hair_style: "curly", hair_color: "black", outfit: "gothic" });
    expect(her.facial_hair).toBeUndefined();
    expect(normaliseLooks(her)).toEqual(her);
    // The same words, the same look; other words, their own.
    expect(suggestLooks({ pronouns: "she/her", words: "A goth violinist with curly black hair" })).toEqual(her);
    expect(suggestLooks({ pronouns: "they/them", words: "A poet" })).toBeUndefined();
    expect(suggestLooks({ pronouns: "", words: "A poet" })).toBeUndefined();
    // Never an ethnicity from a sentence: that stays theirs to pick.
    expect(him.ethnicity).toBeUndefined();
  });
});

describe("one-sentence create: always an adult", () => {
  it("takes the age their words state, else the model's adult age, else an adult age of its own", () => {
    expect(adultAge("A 41 year old sailor", "29")).toEqual({ age: 41, invented: false });
    expect(adultAge("A sailor", "29")).toEqual({ age: 29, invented: true });
    // The model never gets to make a minor: 15, 0, nonsense and nothing all become an adult age.
    for (const model of ["15", "17", "0", "young", "", undefined]) {
      const a = adultAge("A sailor who collects knots", model)!;
      expect(a.invented).toBe(true);
      expect(a.age).toBeGreaterThanOrEqual(24);
      expect(a.age).toBeLessThan(40);
    }
    // Stable: the same words, the same age.
    expect(adultAge("A sailor who collects knots", undefined)).toEqual(adultAge("A sailor who collects knots", "12"));
  });

  it("a model's minor never reaches the draft, and a minor in the words refuses it whole", () => {
    const fromModel = draftFromReading({ name: "Ada Lane", age: "16", description: "A sailor who collects knots.", personality: "calm, dry, kind", wants: "quiet", dislikes: "noise" }, "A sailor who collects knots");
    if (!fromModel.ok) throw new Error(fromModel.message);
    expect(Number(fromModel.draft.sheet.age)).toBeGreaterThanOrEqual(18);
    expect(fromModel.invented.age).toBe(true);

    const stated = draftFromReading({ name: "Ada Lane", age: "25", personality: "calm, dry, kind" }, "A 16 year old sailor");
    expect(stated).toMatchObject({ ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor });
    // The model writing a minor into the bio is caught by the reader's own screen.
    const inBio = draftFromReading({ name: "Ada Lane", age: "25", description: "A schoolgirl who sails.", personality: "calm, dry, kind" }, "A sailor");
    expect(inBio).toMatchObject({ ok: false, reason: "minor" });
  });

  it("their words are held to the sheet's own check before any model reads them", () => {
    expect(screenExpressText(SENTENCE, "")).toEqual({ ok: true });
    expect(screenExpressText("a shy 15 year old who loves cats", "")).toMatchObject({ ok: false, reason: "minor" });
    expect(screenExpressText("A 17-year-old poet", "")).toMatchObject({ ok: false, reason: "minor" });
    expect(screenExpressText("A baker who loves exploring in the bedroom", "")).toMatchObject({ ok: false, reason: "unsafe", message: CHARACTER_REJECTION_MESSAGES.innuendo });
    expect(screenExpressText("A singer", "Taylor Swift")).toMatchObject({ ok: false, reason: "real_person" });
  });
});

describe("POST /api/characters/draft", () => {
  it("drafts a whole sheet from one sentence on the show's free model, and the save takes it", async () => {
    const { calls } = scriptedModel([`\`\`\`json\n${READING}\n\`\`\``]);
    const cookie = newUserCookie();
    const res = await draft({ text: SENTENCE }, { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Reply;
    expect(body.ready).toBe(true);
    expect(body.draft.sheet.name).toBe("Marisol Vane");
    expect(Number(body.draft.sheet.age)).toBeGreaterThanOrEqual(18);
    expect(body.draft.extras.looks?.gender).toBe("woman");
    expect(calls).toHaveLength(1);
    expect(calls[0][0].content).toBe(EXPRESS_PROMPT);
    expect(calls[0][0].content).toMatch(/never under 18/);
    expect(calls[0][1].content).toBe(SENTENCE);

    // The sheet's own rules stay the judge: the draft, with the box ticked, is a character the save accepts.
    const d = body.draft;
    const extras = fillProfile(d.extras, { traits: d.traits, want: d.sheet.want });
    const saved = await createCharacter(
      jsonRequest("/api/characters", { name: d.sheet.name, age: Number(d.sheet.age), bio: d.sheet.bio, traits: d.traits, want: d.sheet.want, dealbreaker: d.sheet.dealbreaker, pronouns: d.pronouns, extras, attest: true }, { cookie }),
    );
    expect(saved.status).toBe(201);
  });

  it("invents a name nobody on the show has", async () => {
    const owner = newUserCookie();
    expect((await createCharacter(jsonRequest("/api/characters", validCharacter({ name: "Marisol Vane" }), { cookie: owner }))).status).toBe(201);
    scriptedModel([READING, JSON.stringify({ ...JSON.parse(READING), name: "" })]);
    const taken = (await (await draft({ text: SENTENCE })).json()) as Reply;
    expect(taken.ready).toBe(true);
    expect(taken.invented.name).toBe(true);
    expect(taken.draft.sheet.name).not.toBe("Marisol Vane");
    expect(taken.draft.sheet.name).toMatch(/ Vane$/);
    expect(await t.count("characters", `lower(name) = lower('${taken.draft.sheet.name}')`)).toBe(0);
    // The model gave no name at all: one of the show's spare first names, free.
    const none = (await (await draft({ text: SENTENCE })).json()) as Reply;
    expect(none.ready).toBe(true);
    expect(none.draft.sheet.name.length).toBeGreaterThan(1);
    expect(none.invented.name).toBe(true);
  });

  it("keeps a typed name that's taken, says so, and leaves the choice to the form", async () => {
    expect((await createCharacter(jsonRequest("/api/characters", validCharacter({ name: "Juno Vex" }), { cookie: newUserCookie() }))).status).toBe(201);
    scriptedModel([READING]);
    const body = (await (await draft({ text: SENTENCE, name: "Juno Vex" })).json()) as Reply;
    expect(body.draft.sheet.name).toBe("Juno Vex");
    expect(body.name_taken).toBe(true);
    expect(body.free_names!.length).toBeGreaterThan(0);
    expect(body.ready).toBe(false);
    expect(body.invented.name).toBe(false);
  });

  it("the fallback: a model that fails, or answers something unreadable, says why in one sentence and saves nothing", async () => {
    scriptedModel([new Error("quota"), "I'd be happy to help! Here is a character."]);
    for (const reason of ["model", "model"]) {
      const res = await draft({ text: SENTENCE });
      expect(res.status).toBe(503);
      const body = (await res.json()) as Reply;
      expect(body.reason).toBe(reason);
      expect(body.message).toBe("The show's writer couldn't draft them just now, so here's the form with your words in the bio.");
    }
    expect(await t.count("characters", "not is_house")).toBe(0);
  });

  it("the fallback: a model that takes too long", async () => {
    vi.useFakeTimers();
    try {
      setModelForTests({ complete: () => new Promise<string>(() => {}) });
      const pending = draft({ text: SENTENCE });
      await vi.advanceTimersByTimeAsync(13_000);
      const res = await pending;
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ reason: "timeout", message: "The draft took too long, so here's the form with your words in the bio." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses words the show's rules refuse before any model reads them, with the save's own sentence", async () => {
    const { calls } = scriptedModel([]);
    const minor = await draft({ text: "a shy 15 year old who loves cats" });
    expect(minor.status).toBe(422);
    expect(await minor.json()).toMatchObject({ reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor });
    const person = await draft({ text: "A singer who loves cats", name: "Taylor Swift" });
    expect(person.status).toBe(422);
    expect(await person.json()).toMatchObject({ reason: "real_person", message: CHARACTER_REJECTION_MESSAGES.real_person });
    expect(calls).toHaveLength(0);
  });

  it("refuses a draft whose model wrote a minor", async () => {
    scriptedModel([JSON.stringify({ ...JSON.parse(READING), description: "A schoolgirl who keeps a lighthouse." })]);
    const res = await draft({ text: SENTENCE });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "minor" });
  });

  it("is capped per visitor, guests included", async () => {
    scriptedModel(Array.from({ length: EXPRESS_DRAFT_LIMITS.perHour }, () => READING));
    const cookie = newUserCookie();
    for (let i = 0; i < EXPRESS_DRAFT_LIMITS.perHour; i++) expect((await draft({ text: `${SENTENCE} ${i}` }, { cookie, ip: `10.0.0.${i}` })).status).toBe(200);
    const over = await draft({ text: SENTENCE }, { cookie, ip: "10.0.0.99" });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ reason: "limited", message: "That's a lot of drafts from here for one day, so here's the form with your words in the bio." });
  });

  it("is capped per address across cookies, and across everyone", async () => {
    scriptedModel(Array.from({ length: EXPRESS_DRAFT_IP_LIMITS.perHour }, () => READING));
    for (let i = 0; i < EXPRESS_DRAFT_IP_LIMITS.perHour; i++) expect((await draft({ text: SENTENCE }, { ip: "203.0.113.7" })).status).toBe(200);
    expect((await draft({ text: SENTENCE }, { ip: "203.0.113.7" })).status).toBe(429);
    // Another address still drafts…
    scriptedModel([READING]);
    expect((await draft({ text: SENTENCE }, { ip: "203.0.113.8" })).status).toBe(200);
    // …until the whole show's cap is spent, however many cookies and addresses there are.
    const now = new Date().toISOString();
    for (let i = 0; i < EXPRESS_DRAFT_ALL_LIMITS.perHour; i++) await t.db.query("insert into rate_hits (bucket, key, at) values ('express_draft_all', 'all', $1)", [now]);
    const { calls } = scriptedModel([READING]);
    expect((await draft({ text: SENTENCE }, { ip: "203.0.113.9" })).status).toBe(429);
    expect(calls).toHaveLength(0);
    // The numbers the PR states.
    expect(EXPRESS_DRAFT_LIMITS).toEqual({ perHour: 5, perDay: 10 });
    expect(EXPRESS_DRAFT_IP_LIMITS).toEqual({ perHour: 10, perDay: 30 });
    expect(EXPRESS_DRAFT_ALL_LIMITS).toEqual({ perHour: 60, perDay: 300 });
  });

  it("never uses the paid model, even when it's the show's default", async () => {
    vi.stubEnv("FRONTIER_DEFAULT", "1");
    vi.stubEnv("FRONTIER_LLM_BASE_URL", "https://example.invalid/v1");
    vi.stubEnv("FRONTIER_LLM_API_KEY", "test-frontier");
    vi.stubEnv("FRONTIER_LLM_MODEL", "paid-model");
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const paid = vi.fn(async () => READING);
    setFrontierModelForTests({ complete: paid });
    expect((await draft({ text: SENTENCE })).status).toBe(503);
    expect(paid).not.toHaveBeenCalled();
  });

  it("takes a sentence or two, not a card", async () => {
    scriptedModel([]);
    expect((await draft({ text: "hi" })).status).toBe(422);
    expect((await draft({ text: "x".repeat(EXPRESS_TEXT_MAX + 1) })).status).toBe(422);
  });

  it("EXPRESS_CREATE=0 turns it off", async () => {
    expect(expressCreateOn({})).toBe(true);
    expect(expressCreateOn({ EXPRESS_CREATE: "1" })).toBe(true);
    expect(expressCreateOn({ EXPRESS_CREATE: "0" })).toBe(false);
    vi.stubEnv("EXPRESS_CREATE", "0");
    const { calls } = scriptedModel([READING]);
    const res = await draft({ text: SENTENCE });
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("the builder's first screen", () => {
  const render = async (props: Record<string, unknown>) => {
    const { default: CreateWizard } = await import("@/app/create/CreateWizard");
    return renderToStaticMarkup(createElement(CreateWizard, props));
  };

  it("is one box for a first character: a sentence, three examples, an optional name, Meet them", async () => {
    const html = await render({ express: true });
    expect(html).toContain("Describe them in a sentence or two");
    expect(html).toContain(`maxLength="${EXPRESS_TEXT_MAX}"`);
    expect(EXPRESS_EXAMPLES).toHaveLength(3);
    for (const ex of EXPRESS_EXAMPLES) {
      expect(html).toContain(ex.label);
      expect(ex.text.length).toBeLessThanOrEqual(EXPRESS_TEXT_MAX);
      expect(screenExpressText(ex.text, "")).toEqual({ ok: true });
    }
    expect(html).toContain('name="express_name"');
    expect(html).toMatch(/<button type="submit"[^>]*>Meet them<\/button>/);
    // The ways out are one tap away, and the same three steps are on the rail.
    expect(html).toContain("Fill it in myself");
    expect(html).toContain("Use a sample character");
    expect(html).toContain("Step 1 of 3 · Identity");
    // Not the eight fields.
    expect(html).not.toContain('name="dealbreaker"');
    expect(html).not.toContain('name="trait1"');
  });

  it("stays today's form with the switch off, for a second character, and for anyone who arrives with something in hand", async () => {
    for (const props of [
      {},
      { express: false },
      { express: true, myCharacters: [{ id: "c-1", name: "Mira Quell" }] },
      { express: true, startImported: true },
      { express: true, startName: "Juniper" },
      { express: true, startSample: true },
    ]) {
      const html = await render(props);
      expect(html).not.toContain("Describe them in a sentence or two");
      expect(html).toContain('name="dealbreaker"');
    }
  });

  it("an edit never shows it", async () => {
    const html = await render({
      express: true,
      edit: { id: "c-1", initial: { name: "Mira Quell", age: 27, bio: "A cartographer.", traits: ["a", "b", "c"], want: "w", dealbreaker: "d", pronouns: null, voice: null, appearance: null, hue: null, soul: null, openToDates: true, extras: {}, imageTrained: false, portrait: null } },
    });
    expect(html).not.toContain("Describe them in a sentence or two");
    expect(html).toContain("Edit Mira Quell");
  });
});

describe("the events and the funnel", () => {
  it("are built as data, never with the words", () => {
    expect(expressStartedEvent({ length: 81, named: false, example: true })).toEqual({ name: "express_started", props: { length: 81, named: false, example: true } });
    expect(expressDraftedEvent({ ready: true, invented_name: true, look: true })).toEqual({ name: "express_drafted", props: { ready: true, invented_name: true, look: true } });
    expect(expressFailedEvent("limited")).toEqual({ name: "express_failed", props: { reason: "limited" } });
  });

  it("the funnel lists the two steps between opening the builder and making a character", () => {
    const keys = ENGAGEMENT_FUNNEL.map((s) => s.key);
    expect(keys.slice(keys.indexOf("create_opened"), keys.indexOf("character_created") + 1)).toEqual(["create_opened", "express_started", "express_drafted", "character_created"]);
    expect([...ENGAGEMENT_FUNNEL.find((s) => s.key === "express_drafted")!.events]).toEqual(["express_drafted"]);
  });

  it("every failure has one plain sentence", () => {
    for (const reason of ["minor", "real_person", "unsafe", "limited", "model", "timeout", "network", "unreadable", "off"] as const) {
      const line = expressFailureLine(reason);
      expect(line.length).toBeGreaterThan(20);
      expect(line.split(/[.!?]\s/).length).toBe(1);
    }
    expect(expressFailureLine("unsafe", CHARACTER_REJECTION_MESSAGES.sexual)).toBe(CHARACTER_REJECTION_MESSAGES.sexual);
  });
});
