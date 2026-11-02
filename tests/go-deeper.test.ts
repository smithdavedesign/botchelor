/**
 * Go deeper (David 2026-11-01): the create wizard's optional step, the same fields on the edit page and over MCP. Hot
 * takes (public), what they're hiding (their own secrets in cast_secrets, not a second store), their last relationship
 * and what wins them over (private to their own side), and fun or serious (on the card, and planned when it mismatches).
 * Each one reaches its own side's prompt only. No paid calls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetTouchesForTests } from "@/lib/activity";
import { buildDirectorMessages, dateFacts } from "@/lib/beats";
import { cleanOwnSecrets, OWN_SEASON, ownSecrets, ownSecretsCard, recordSlips, secretsForDate } from "@/lib/cast-secrets";
import { assembleCharacter, type Character } from "@/lib/character";
import { choiceMessages } from "@/lib/choices";
import { buildTurnMessages } from "@/lib/conversation";
import { fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { extrasForPrompt, MOOD_IDS, normaliseExtras, publicExtras, type CharacterExtras } from "@/lib/extras";
import type { ChatMessage } from "@/lib/model";
import { orderConfessionals } from "@/lib/showrunner";
import type { StoredSoul } from "@/lib/souls";
import { pickVenue } from "@/lib/venues";
import { api, newUserCookie, setupEpisode, startTestDb, validCharacter } from "./helpers";

const BAGGAGE = "Engaged once, for eleven days; still keeps the empty ring box";
const WINS = "Someone who remembers the name of their first goldfish";
const HIDING = "Still sleeps with a night light on";

const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };
const side = (sheet: CharacterSheet): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_adventurous", note: null, gameBudget: 25 });
const INPUT: DateInput = { a: side(sheetA), b: side(sheetB) };
const soul = (): StoredSoul => ({ values: "honesty", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
const so = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = fixedEngine({ ending: "friends", sides: [so(true), so(false)] }).decide(INPUT, 1);
const VENUE = pickVenue(1);
const userText = (m: ChatMessage[]) => m.filter((x) => x.role === "user").map((x) => x.content).join("\n");
const systemText = (m: ChatMessage[]) => m.filter((x) => x.role === "system").map((x) => x.content).join("\n");

function chars(a: CharacterExtras, b: CharacterExtras = {}): [Character, Character] {
  const ca = assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: soul(), memory: null });
  const cb = assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: soul(), memory: null });
  ca.extras = normaliseExtras(a);
  cb.extras = normaliseExtras(b);
  ca.secrets = [{ season_id: OWN_SEASON, idx: 0, secret: HIDING }];
  return [ca, cb];
}

describe("the fields and who sees them", () => {
  it("the last relationship and what wins them over are private; fun or serious is on the card", () => {
    const e = normaliseExtras({ baggage: ` ${BAGGAGE} `, wins_them_over: WINS, mood: "earnest", hot_takes: ["Rain is the best weather."] });
    expect(e).toMatchObject({ baggage: BAGGAGE, wins_them_over: WINS, mood: "earnest" });
    const shown = publicExtras(e);
    expect(shown.baggage).toBeUndefined();
    expect(shown.wins_them_over).toBeUndefined();
    expect(shown.mood).toBe("earnest");
    expect(shown.hot_takes).toEqual(["Rain is the best weather."]);
    // Its own view on a date carries all three, in words it can act on.
    const own = extrasForPrompt(e);
    expect(own).toMatchObject({ your_last_relationship: BAGGAGE, what_really_wins_you_over: WINS });
    expect(String(own.how_you_date)).toMatch(/seriously/);
    expect(MOOD_IDS).toEqual(["playful", "balanced", "earnest"]);
  });

  it("each reaches its own side's prompt only, with the section that says what to do with it", () => {
    const c = chars({ baggage: BAGGAGE, wins_them_over: WINS, mood: "playful" }, { mood: "earnest" });
    const a = buildTurnMessages(INPUT, OUTCOME, c, "a_hard_question", VENUE, [], 0).messages;
    const b = buildTurnMessages(INPUT, OUTCOME, c, "a_hard_question", VENUE, [], 1).messages;
    for (const mine of [BAGGAGE, WINS, HIDING]) expect(userText(a)).toContain(mine);
    expect(systemText(a)).toContain("WHAT GOES DEEPER");
    expect(systemText(a)).toContain("YOUR SECRETS");
    for (const theirs of [BAGGAGE, WINS, HIDING]) expect(userText(b)).not.toContain(theirs);
    expect(systemText(b)).not.toContain("YOUR SECRETS");
    // What wins them over weighs on their own "see them again?", and only theirs.
    expect(userText(choiceMessages(c, "a", []))).toContain("weigh_this");
    expect(userText(choiceMessages(c, "a", []))).toContain(WINS);
    expect(userText(choiceMessages(c, "b", []))).not.toContain(WINS);
    expect(userText(choiceMessages(c, "b", []))).not.toContain("weigh_this");
    // A side that didn't go deeper keeps the prompt it had.
    const plain = chars({}, {});
    plain[0].secrets = [];
    expect(systemText(buildTurnMessages(INPUT, OUTCOME, plain, "a_hard_question", VENUE, [], 0).messages)).not.toContain("WHAT GOES DEEPER");
  });

  it("the director plans a fun-against-serious mismatch, and never hears what they're hiding", () => {
    const c = chars({ mood: "playful", baggage: BAGGAGE }, { mood: "earnest" });
    const facts = dateFacts(INPUT, OUTCOME, c).join("\n");
    expect(facts).toMatch(/Mira is here for fun and Rafe takes dating seriously/);
    expect(facts).toMatch(/Mira carries something from their last relationship/);
    expect(dateFacts(INPUT, OUTCOME, chars({ mood: "playful" }, { mood: "balanced" })).join("\n")).not.toMatch(/here for fun and/);
    expect(JSON.stringify(buildDirectorMessages(INPUT, OUTCOME, c, "a_hard_question", VENUE, "classic", {}))).not.toContain(HIDING);
  });
});

describe("what they're hiding, as their own secrets", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    forgetTouchesForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("cleans a list: trimmed, no blanks or repeats, at most three", () => {
    expect(cleanOwnSecrets([" a b ", "", "A B", "c", "d", "e", 4])).toEqual(["a b", "c", "d"]);
  });

  it("create stores them in cast_secrets, a date carries them, a slip on an aired date shows as out, and an edit keeps it", async () => {
    const cookie = newUserCookie();
    const res = await api.createCharacter(validCharacter({ hiding: [HIDING, "Writes poems they've never shown anyone", ""], extras: { baggage: BAGGAGE, mood: "playful" } }), cookie);
    expect(res.status).toBe(201);
    const made = await res.json();
    expect(made.hiding).toEqual([HIDING, "Writes poems they've never shown anyone"]);
    const rows = (await t.db.query<{ season_id: string; source: string }>(`select season_id, source from cast_secrets where character_id = $1`, [made.id])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.season_id === OWN_SEASON && r.source === "owner")).toBe(true);
    // Not on this season's cast, and still its side of a date carries them.
    const carried = await secretsForDate(t.db, made.id);
    expect(carried.map((s) => s.secret)).toEqual([HIDING, "Writes poems they've never shown anyone"]);
    // Nothing out yet: the card shows two locked.
    expect(await ownSecretsCard(t.db, made.id)).toMatchObject({ total: 2, out: [], next_in: null });

    // One slips on a date; it's out once that date airs publicly, and no longer carried.
    const { episode } = await setupEpisode("friends");
    await recordSlips(t.db, episode.id, [{ character_id: made.id, season_id: OWN_SEASON, idx: carried[0].idx, line: 4 }]);
    expect((await secretsForDate(t.db, made.id)).map((s) => s.secret)).toEqual(["Writes poems they've never shown anyone"]);
    expect((await ownSecretsCard(t.db, made.id))!.out).toEqual([]);
    await t.db.query(`update episodes set revealed_at = now() - interval '1 minute', visibility = 'public' where id = $1`, [episode.id]);
    expect((await ownSecretsCard(t.db, made.id))!.out.map((o) => o.secret)).toEqual([HIDING]);

    // An edit replaces the rest; the one that slipped stays, whatever the list says.
    const edit = await api.editCharacter(made.id, { hiding: ["Practised this date's small talk in the mirror"] }, cookie);
    expect(edit.status).toBe(200);
    const body = await edit.json();
    expect(body.updated).toContain("hiding");
    expect(body.hiding).toEqual([HIDING, "Practised this date's small talk in the mirror"]);
    expect((await ownSecrets(t.db, made.id)).map((s) => [s.secret, s.slipped])).toEqual([
      [HIDING, true],
      ["Practised this date's small talk in the mirror", false],
    ]);
    // [] clears the ones not out yet.
    await api.editCharacter(made.id, { hiding: [] }, cookie);
    expect((await ownSecrets(t.db, made.id)).map((s) => s.secret)).toEqual([HIDING]);
  });

  it("the same content rules as the sheet, and at most three", async () => {
    const cookie = newUserCookie();
    const bad = await api.createCharacter(validCharacter({ hiding: ["Works nights writing erotic poetry for strangers"] }), cookie);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "content_rejected", field: "hiding" });
    const many = await api.createCharacter(validCharacter({ hiding: ["one thing", "two things", "three things", "four things"] }), cookie);
    expect(many.status).toBe(422);
    expect(await many.json()).toMatchObject({ error: "invalid_character" });
    const badPrivate = await api.createCharacter(validCharacter({ extras: { baggage: "Works nights writing erotic poetry for strangers" } }), cookie);
    expect(badPrivate.status).toBe(422);
  });
});

describe("the diary cam's confessionals", () => {
  const draft = (confessionals: [string, string]) => ({ setting: "", goals: [], scenes: [], twist: "", finale: "", best_line: "", confessionals });
  it("a swapped pair is put back when the pronouns say so, and anything unclear is left as written", () => {
    const he = { pronouns: "he/him" };
    const she = { pronouns: "she/her" };
    const swapped = draft(["He is more playful than his swagger suggests.", "She is hard to read, and I like her."]);
    expect(orderConfessionals(swapped, [he, she]).confessionals).toEqual(["She is hard to read, and I like her.", "He is more playful than his swagger suggests."]);
    const right = draft(["She is hard to read.", "He made me laugh."]);
    expect(orderConfessionals(right, [he, she]).confessionals).toEqual(right.confessionals);
    expect(orderConfessionals(swapped, [he, he]).confessionals).toEqual(swapped.confessionals);
    expect(orderConfessionals(swapped, [{ pronouns: "they/them" }, she]).confessionals).toEqual(swapped.confessionals);
    expect(orderConfessionals(draft(["He and she both laughed.", "She is lovely."]), [he, she]).confessionals).toEqual(["He and she both laughed.", "She is lovely."]);
  });
});
