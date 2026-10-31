import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleCharacter, characterBlindView, characterSelfView, speaks, type Character } from "@/lib/character";
import { buildTurnMessages, parseTurnResult, simulateConversation } from "@/lib/conversation";
import { fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { checkFieldsAnyLanguage, needsTranslation, setTranslatorForTests } from "@/lib/language-check";
import type { ChatMessage, Model } from "@/lib/model";
import { checkAdultText } from "@/lib/safety";
import { pickVenue } from "@/lib/venues";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// David, 2026-10-31: characters can speak another language on the safe side; the English content filter reads every
// line through an English translation; After Dark stays English-only.

/** A model that answers in order and records what it was asked. */
function scripted(outputs: Array<string | Error>): { model: Model; calls: ChatMessage[][] } {
  const queue = [...outputs];
  const calls: ChatMessage[][] = [];
  return {
    calls,
    model: {
      async complete(messages) {
        calls.push(messages);
        const next = queue.shift();
        if (next === undefined) throw new Error("scripted model out of outputs");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

/** A translator that answers every key it's sent: the known Spanish in English, anything else as it came. */
function translator(known: Record<string, string>): Model {
  return {
    async complete(messages) {
      const asked = JSON.parse(messages[1].content) as Record<string, string>;
      return JSON.stringify(Object.fromEntries(Object.entries(asked).map(([k, v]) => [k, known[v] ?? v])));
    },
  };
}

const ES_MINOR = "Una adolescente de dieciséis años que todavía va al instituto.";

describe("needsTranslation", () => {
  it("is false for English and short plain ASCII, true for other languages and short accented text", () => {
    expect(needsTranslation("A cartographer who maps cities that only exist on Tuesdays.")).toBe(false);
    expect(needsTranslation("curious")).toBe(false);
    expect(needsTranslation(ES_MINOR)).toBe(true);
    expect(needsTranslation("niña pequeña")).toBe(true);
    expect(needsTranslation("十六歳の高校生")).toBe(true);
  });
});

describe("checkFieldsAnyLanguage", () => {
  it("reads a Spanish sheet in English: the word filter alone let it through", async () => {
    const { model, calls } = scripted([JSON.stringify({ bio: "A sixteen-year-old teenager who still goes to high school." })]);
    const verdict = await checkFieldsAnyLanguage({ bio: ES_MINOR }, { model });
    expect(verdict).toMatchObject({ ok: false, reason: "minor", field: "bio" });
    expect(JSON.parse(calls[0][1].content)).toEqual({ bio: ES_MINOR });
  });

  it("reads every field of a sheet that isn't English, short plain ones too", async () => {
    const bio = "Bibliotecaria que restaura libros antiguos y odia las prisas.";
    const { model, calls } = scripted([JSON.stringify({ bio: "A librarian who restores old books and hates hurry.", "traits.0": "horny", "traits.1": "witty" })]);
    expect(await checkFieldsAnyLanguage({ bio, traits: ["cachonda", "ingeniosa"] }, { model })).toMatchObject({ ok: false, reason: "sexual", field: "traits" });
    expect(Object.keys(JSON.parse(calls[0][1].content))).toEqual(["bio", "traits.0", "traits.1"]);
  });

  it("names a list's field, not its item, and costs nothing for English", async () => {
    const { model, calls } = scripted([JSON.stringify({ "traits.0": "curious", "traits.1": "daring, and sexy with everyone" })]);
    expect(await checkFieldsAnyLanguage({ traits: ["curious", "atrevida, y con ganas de acostarse con todos"] }, { model })).toMatchObject({ ok: false, reason: "sexual", field: "traits" });
    expect(await checkFieldsAnyLanguage({ bio: "A baker who works nights." }, { model })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses as unread when the model can't translate (never lets an unread text through)", async () => {
    const { model } = scripted([new Error("quota"), "not json"]);
    expect(await checkFieldsAnyLanguage({ bio: "Panadera de noche que colecciona mapas viejos de la ciudad." }, { model })).toMatchObject({ ok: false, reason: "unread", field: "bio", language: "Spanish" });
    expect(await checkFieldsAnyLanguage({ bio: "Boulangère de nuit qui collectionne les vieilles cartes." }, { model })).toMatchObject({ ok: false, reason: "unread" });
  });
});

describe("POST /api/characters in another language", () => {
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
  });
  afterEach(() => {
    setTranslatorForTests(null);
    vi.restoreAllMocks();
  });

  it("refuses a Spanish sheet whose English breaks the rules, and saves a clean one with its language", async () => {
    setTranslatorForTests(translator({ [ES_MINOR]: "A sixteen-year-old teenager who still goes to high school." }));
    const cookie = newUserCookie();
    const bad = await api.createCharacter(validCharacter({ name: "Lucía Ferrer", bio: ES_MINOR }), cookie);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "content_rejected", reason: "minor", field: "bio" });

    const bio = "Panadera de noche que colecciona mapas viejos de la ciudad.";
    setTranslatorForTests(translator({ [bio]: "A night baker who collects old maps of the city." }));
    const good = await api.createCharacter(validCharacter({ name: "Lucía Ferrer", bio, extras: { language: "es" } }), cookie);
    expect(good.status).toBe(201);
    const saved = (await t.db.query<{ extras: { language?: string } }>(`select extras from characters where name = 'Lucía Ferrer'`)).rows[0];
    expect(saved.extras.language).toBe("es");
  });

  it("says try again when the check can't run", async () => {
    setTranslatorForTests(scripted([new Error("quota")]).model);
    const res = await api.createCharacter(validCharacter({ name: "Lucía Ferrer", bio: "Veterinaria que corre medias maratones y habla con todos los perros." }), newUserCookie());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "unread", message: expect.stringContaining("Try again") });
  });
});

const sheet = (name: string, bio: string, want: string, dealbreaker: string): CharacterSheet => ({ name, age: 30, bio, traits: ["warm", "dry"], want, dealbreaker, house: false });
const EN = sheet("Mira", "A cartographer who maps cities that only exist on Tuesdays.", "Someone who can read a map upside down", "People who hate surprises");
const ES = sheet("Lucía", "Panadera de noche que colecciona mapas viejos de la ciudad.", "Alguien que no tenga prisa", "La gente que es grosera con los camareros");

describe("speaks", () => {
  it("is the creator's pick, else the sheet's language, else English", () => {
    expect(speaks(assembleCharacter({ id: "a", sheet: EN, soul: null, memory: null }))).toBe("en");
    expect(speaks(assembleCharacter({ id: "b", sheet: ES, soul: null, memory: null }))).toBe("es");
    expect(speaks(assembleCharacter({ id: "c", sheet: EN, soul: null, memory: null, extras: { language: "fr" } }))).toBe("fr");
  });

  it("tells a character its own language and the other's, and says nothing for English", () => {
    const lucia = assembleCharacter({ id: "b", sheet: ES, soul: null, memory: null });
    const mira = assembleCharacter({ id: "a", sheet: EN, soul: null, memory: null });
    expect(characterSelfView(lucia).you_speak).toContain("Spanish");
    expect(characterSelfView(mira).you_speak).toBeUndefined();
    expect(characterBlindView(lucia).they_speak).toContain("Spanish");
    expect(characterBlindView(mira).they_speak).toBeUndefined();
  });
});

const sideOf = (s: CharacterSheet): SideSetup => ({ sheet: s, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_adventurous", note: null, gameBudget: 25 });
const sideOutcome = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });

describe("a date in another language", () => {
  const VENUE = pickVenue(1);
  const pair = (a: CharacterSheet, b: CharacterSheet): { input: DateInput; outcome: Outcome; chars: [Character, Character] } => {
    const input: DateInput = { a: sideOf(a), b: sideOf(b) };
    return {
      input,
      outcome: fixedEngine({ ending: "friends", sides: [sideOutcome(false), sideOutcome(false)] }).decide(input, 1),
      chars: [assembleCharacter({ id: "a", sheet: a, soul: null, memory: null }), assembleCharacter({ id: "b", sheet: b, soul: null, memory: null })],
    };
  };

  it("asks each side for its own language and an English translation; an English date's prompt is unchanged", () => {
    const es = pair(EN, ES);
    const system = (side: 0 | 1) => buildTurnMessages(es.input, es.outcome, es.chars, "a_hard_question", VENUE, [], side).messages[0].content;
    expect(system(0)).toContain('You speak English: write "dialogue" in English');
    expect(system(0)).toContain("Lucía speaks Spanish; you understand each other");
    expect(system(1)).toContain("You speak Spanish");
    expect(system(1)).toContain('Also give "english"');
    const en = pair(EN, EN);
    expect(buildTurnMessages(en.input, en.outcome, en.chars, "a_hard_question", VENUE, [], 0).messages[0].content).not.toContain("LANGUAGE");
  });

  it("checks a line through its English, and sends back a line in another language that has none", () => {
    const line = (dialogue: string, english?: string) => JSON.stringify({ dialogue, action: "", emotion: "curious", interest_signal: 0.5, ...(english ? { english } : {}) });
    const ok = parseTurnResult(line("¿Y tú a qué te dedicas cuando no estás aquí?", "And what do you do when you're not here?"), "b", 0, { english: true });
    expect(ok).toMatchObject({ english: "And what do you do when you're not here?", turn: { dialogue: "¿Y tú a qué te dedicas cuando no estás aquí?" } });
    expect(parseTurnResult(line("¿Y tú a qué te dedicas cuando no estás aquí?"), "b", 0, { english: true })).toEqual({ rejected: "no_english" });
    expect(parseTurnResult(line("Me encantaría verte desnuda esta noche, de verdad.", "I'd love to see you naked tonight, really."), "b", 0, { english: true })).toMatchObject({
      rejected: "filtered",
      reason: "sexual",
    });
    // Without the option (an English date), nothing changes.
    expect("turn" in parseTurnResult(line("¿Y tú a qué te dedicas cuando no estás aquí?"), "b", 0)).toBe(true);
  });

  it("keeps the line as written in the transcript and never stores the translation", async () => {
    const es = pair(ES, ES);
    const said = ["Hola, ¿siempre vienes a este sitio los jueves?", "Solo cuando la panadería cierra temprano, la verdad.", "Pues hoy hemos tenido suerte los dos, me parece."];
    const { model } = scripted(said.map((d, i) => JSON.stringify({ dialogue: d, action: "", emotion: "warm", interest_signal: 0.5, english: `English ${i}: ${d.length}` })));
    const transcript = await simulateConversation(model, es.input, es.outcome, es.chars, "a_hard_question", VENUE, "classic", 3);
    expect(transcript.map((t) => t.dialogue)).toEqual(said);
    expect(JSON.stringify(transcript)).not.toContain("English 0");
  });
});

describe("After Dark stays English-only", () => {
  it("refuses text in another language", () => {
    expect(checkAdultText({ text: "Me quito la camisa despacio mientras me miras desde la cama." })).toMatchObject({ ok: false, reason: "language", field: "text" });
    expect(checkAdultText({ text: "I take my shirt off slowly while you watch from the bed." })).toEqual({ ok: true });
  });
});
