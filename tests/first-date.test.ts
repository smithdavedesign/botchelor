import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { episodeAllowance } from "@/lib/allowance";
import { setConversationEnabledForTests } from "@/lib/conversation";
import { DEFAULT_FIRST_DATE_FORMAT, FIRST_DATE_STEPS, firstDateFormat, offerFirstDate, pickFirstPartner } from "@/lib/first-date";
import { format } from "@/lib/formats";
import { fillProfile, interestFor, promptsFromSheet } from "@/lib/profile-fill";
import { CONVERSATION_TURNS, FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, planJson, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// 2026-11-11 bounce review (David: "yes do 1-4"): of the month's visitors, 7 opened the builder, 3 made a character,
// 2 started a date and nobody watched one end. A first character now gets one button: a house date that plays at once.
const CAST = [
  { id: "house-juniper", name: "Juniper Vale", age: 29, bio: "b", traits: ["warm"], archetype: "The Romantic" },
  { id: "house-nell", name: "Nell Abiodun", age: 33, bio: "b", traits: ["dry"], archetype: "The Skeptic" },
  { id: "house-gold", name: "Goldie Premium", age: 30, bio: "b", traits: ["rich"], premium: true },
];
const TOKENS = { free_left: 3, free_per_season: 3, pack_left: 0, left: 3 };

describe("a newcomer's first date, straight away", () => {
  it("picks one of the season's cast, never a premium one, the same one on a reload", () => {
    const picks = new Set<string>();
    for (const id of Array.from({ length: 24 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)) {
      const p = pickFirstPartner(CAST, id);
      expect(p?.premium).toBeFalsy();
      expect(pickFirstPartner(CAST, id)?.id).toBe(p?.id);
      picks.add(p!.id);
    }
    expect(picks.size).toBe(2); // different newcomers meet different cast members
    expect(pickFirstPartner([CAST[2]], "x")).toBeNull();
    // A post's link names a house character (/create?meet=<id>): that one, but never a premium one or someone off the cast.
    expect(pickFirstPartner(CAST, "anyone", "house-juniper")?.id).toBe("house-juniper");
    expect(pickFirstPartner(CAST, "anyone", "house-nell")?.id).toBe("house-nell");
    expect(pickFirstPartner(CAST, "anyone", "house-gold")?.premium).toBeFalsy();
    expect(pickFirstPartner(CAST, "anyone", "not-on-cast")).toEqual(pickFirstPartner(CAST, "anyone"));
  });

  it("is offered only for a first character that's free to date and has a date left", () => {
    const base = { firstCharacter: true, taken: false, datesLeft: 3, partner: CAST[0] };
    expect(offerFirstDate(base)).toBe(true);
    expect(offerFirstDate({ ...base, firstCharacter: false })).toBe(false);
    expect(offerFirstDate({ ...base, taken: true })).toBe(false);
    expect(offerFirstDate({ ...base, datesLeft: 0 })).toBe(false);
    expect(offerFirstDate({ ...base, partner: null })).toBe(false);
  });

  it("the date step leads with one Start button for a first character, and keeps every other choice below", async () => {
    const { SendPhase } = await import("@/app/create/CreateWizard");
    const props = {
      character: { id: "c-new", name: "Leopold Sol" },
      partners: CAST,
      openCharacters: [],
      swipeGate: true,
      tokens: TOKENS,
      offer: null,
      autonomy: "balanced" as never,
      busy: null,
      setBusy() {},
      error: null,
      setError() {},
      outOfTokens: false,
      setOutOfTokens() {},
      onSend() {},
      returnTo: null,
      buildNext: null,
      signedIn: false,
    };
    const first = renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: true }));
    expect(first).toContain("data-first-date");
    expect(first).toContain("Leopold&#x27;s first date can start right now");
    expect(first).toContain("▶ Start the date now");
    expect(first.indexOf("data-first-date")).toBeLessThan(first.indexOf("send-blind"));
    expect(first).toContain("Send Leopold Sol on a blind date"); // still there, below
    const card = first.slice(first.indexOf("data-first-date"), first.indexOf("send-blind"));
    expect(card).toContain("meets Nell");
    expect(card).not.toContain("Goldie");
    // PR1 (2026-11-14): the first date is a speed date (6 lines, about a minute) and the card says so; every other way to
    // date (the blind date, swipes, the house cast by name) folds under "More ways to date", closed.
    expect(card).toContain('data-first-format="speed_date"');
    expect(card).toContain("for a speed date: 6 lines, about a minute");
    const fold = first.indexOf("<details class=\"ux-fold send-more-ways\"");
    expect(fold).toBeGreaterThan(first.indexOf("data-first-date"));
    expect(fold).toBeLessThan(first.indexOf("send-blind"));
    expect(first.slice(fold)).toContain("<summary>More ways to date</summary>");
    expect(first).not.toMatch(/<details class="ux-fold send-more-ways"[^>]*open/);
    expect(first.slice(fold)).toContain("Swipe to meet someone new");
    expect(first.slice(fold)).toMatch(/aria-label="Send on a date with Nell"/);
    // FIRST_DATE_FORMAT set to another free format: the card names it and its length.
    const classic = renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: true, firstFormat: "classic" as const }));
    expect(classic).toContain('data-first-format="classic"');
    expect(classic).toContain(`for a classic blind date: ${CONVERSATION_TURNS} lines`);
    // A creator's second character gets the full menu as before, nothing folded.
    const later = renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: false }));
    expect(later).not.toContain("data-first-date");
    expect(later).not.toContain("send-more-ways");
    expect(later).toContain("Swipe to meet someone new");
    // Out of dates: no instant date (it would only fail).
    const broke = renderToStaticMarkup(createElement(SendPhase, { ...props, firstCharacter: true, tokens: { ...TOKENS, free_left: 0, left: 0 } }));
    expect(broke).not.toContain("data-first-date");
  });
});

// 2026-11-14 first-session plan, PR1: the first date is a speed date (6 lines, about a minute to write) in three build steps.
describe("the first date's format and the three-step build (lib/first-date.ts)", () => {
  it("firstDateFormat is the speed date unless FIRST_DATE_FORMAT names another free format we have", () => {
    expect(DEFAULT_FIRST_DATE_FORMAT).toBe("speed_date");
    expect(firstDateFormat({})).toBe("speed_date");
    expect(firstDateFormat({ FIRST_DATE_FORMAT: "" })).toBe("speed_date");
    expect(firstDateFormat({ FIRST_DATE_FORMAT: "classic" })).toBe("classic");
    expect(firstDateFormat({ FIRST_DATE_FORMAT: " meet_the_parents " })).toBe("meet_the_parents");
    expect(firstDateFormat({ FIRST_DATE_FORMAT: "no_such_format" })).toBe("speed_date");
    // Whatever the env says, a first date is never a premium format: a newcomer owns no packs.
    const premium = { FIRST_DATE_FORMAT: "classic" };
    expect(format(firstDateFormat(premium)).premiumSku).toBeNull();
    // The speed date itself is what the plan counts on: 6 lines, free, no moves.
    const speed = format("speed_date");
    expect(speed.turns).toBe(6);
    expect(speed.premiumSku).toBeNull();
    expect(speed.moves).toBe(false);
  });

  it("the first character's steps are identity, look, review: the dating profile waits", () => {
    expect([...FIRST_DATE_STEPS]).toEqual(["identity", "look", "review"]);
  });
});

describe("a dating profile from the sheet (lib/profile-fill.ts)", () => {
  const sheet = { traits: ["bookish", "warm", "stubborn"], want: "Someone who reads the last page first, bravely" };

  it("writes two prompts from the traits and the want, and two interests from the traits, the same every time", () => {
    const filled = fillProfile({}, sheet);
    expect(filled.prompts).toEqual([
      { id: "dating_me_is_like", answer: "Equal parts bookish and warm, with a stubborn streak." },
      { id: "fall_for_you", answer: "You're someone who reads the last page first, bravely." },
    ]);
    expect(filled.hobbies).toEqual(["Reading", "Cooking for friends"]);
    expect(fillProfile({}, sheet)).toEqual(filled);
    // "an" before a vowel; a want that already ends a sentence isn't given a second full stop.
    expect(promptsFromSheet({ traits: ["dry", "bold", "optimistic"], want: "A quiet evening that doesn't blow up." })).toEqual([
      { id: "dating_me_is_like", answer: "Equal parts dry and bold, with an optimistic streak." },
      { id: "fall_for_you", answer: "You're a quiet evening that doesn't blow up." },
    ]);
  });

  it("never touches what's written, only tops up to what the deck needs, and returns the same object when nothing is missing", () => {
    const partial = { prompts: [{ id: "geek_out" as const, answer: "Cloud types." }], hobbies: ["Tarot"], occupation: "Weather reader" };
    const filled = fillProfile(partial, sheet);
    expect(filled.occupation).toBe("Weather reader");
    expect(filled.prompts).toEqual([{ id: "geek_out", answer: "Cloud types." }, { id: "dating_me_is_like", answer: "Equal parts bookish and warm, with a stubborn streak." }]);
    expect(filled.hobbies).toEqual(["Tarot", "Reading"]);
    const done = { prompts: [{ id: "geek_out" as const, answer: "a" }, { id: "two_truths" as const, answer: "b" }], hobbies: ["Chess", "Baking"] };
    expect(fillProfile(done, sheet)).toBe(done);
    // Traits that read as the same interest don't repeat it; a trait with no reading still gets a stable pick.
    expect(fillProfile({}, { traits: ["bookish", "literary", "shy"], want: "" }).hobbies).toEqual(["Reading", "Birdwatching"]);
    expect(interestFor("zxqv")).toBe(interestFor("zxqv"));
    expect(interestFor("Fiercely loyal")).toBe("Pub quizzes");
    // A bare sheet gives what it can: no traits, no want, nothing invented beyond the seeded interests.
    const bare = fillProfile({}, { traits: ["", "", ""], want: "" });
    expect(bare.prompts).toEqual([]);
    expect(bare.hobbies).toHaveLength(2);
  });
});

describe("a speed date booked through POST /api/episodes (the first date's path)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    setConversationEnabledForTests(false);
    await t.close();
  });

  it("is accepted with a house cast partner, runs 6 turns, and spends one free date and nothing else", async () => {
    await t.reset();
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    const before = await episodeAllowance(t.db, userIdOf(creator));
    expect(before).toMatchObject({ free_left: FREE_EPISODES_PER_SEASON, pack_left: 0 });

    // With the conversation on, a date's model is called plan → turns → recap; a speed date asks for 6 turns, not 12.
    setConversationEnabledForTests(true);
    const lines = ["Hi.", "Hello.", "So.", "Yes?", "Well.", "Right."];
    const turnJson = (i: number) => JSON.stringify({ dialogue: lines[i], action: "leans in", emotion: "curious", interest_signal: 0.5 });
    scriptOutcome({ ending: "second_date" });
    const { calls } = scriptedModel([planJson(), ...lines.map((_, i) => turnJson(i)), episodeJson()]);
    const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, format: firstDateFormat({}) }, creator);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe("speed_date");
    expect(calls).toHaveLength(1 + 6 + 1);

    const { rows } = await t.db.query<{ transcript: { dialogue: string }[]; setup: { format: string; moves?: boolean }; status: string }>(
      `select transcript, setup, status from episodes where id = $1`,
      [body.id],
    );
    expect(rows[0].status).toBe("ready");
    expect(rows[0].setup.format).toBe("speed_date");
    expect(rows[0].transcript).toHaveLength(6);
    expect(rows[0].transcript.map((l) => l.dialogue)).toEqual(lines);

    // No premium charge (402 format_locked) and no pack date: one of the week's free dates, like any other date.
    const after = await episodeAllowance(t.db, userIdOf(creator));
    expect(after.free_left).toBe(FREE_EPISODES_PER_SEASON - 1);
    expect(after.pack_left).toBe(0);
  });
});
