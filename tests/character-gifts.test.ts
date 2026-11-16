// Small gifts between characters (lib/gift-catalog.ts: the rules and the catalogue; lib/character-gifts.ts: the writer
// the air job calls; 2026-11-16). When one happens and who gives it, what it is, how it lands, that it is only ever
// written for a date that aired publicly between public characters, the weekly cap, what it feeds (the thread, the
// story state through its own functions, the house's facts, the owners' texts) and CHARACTER_GIFTS.
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { giftAfterAir, giftOnAir, giftsFor, giftTextLines, injuredSide, nudgeOpinion } from "@/lib/character-gifts";
import { openThread } from "@/lib/companion";
import {
  characterGiftsOn, coldStage, GIFT_EVERY_DAYS, GIFT_NAME_MAX, GIFT_NOTE_MAX, GIFT_REPLIES, giftCandidates, giftChance, giftClaim, giftGiver, giftHappens, giftOccasion,
  giftReaction, giftReply, GIFTS, giftsOnAir, pickGift, setGiftsOnAirForTests, steadyStage, type GiftFacts,
} from "@/lib/gift-catalog";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sceneFacts, scenePrompt, sensitiveClaim, templateScene, type SceneFacts } from "@/lib/house-scenes";
import { pairKey, refreshRelationship } from "@/lib/relationships";
import type { Ending } from "@/lib/rules";
import { checkSheetText, checkShowText } from "@/lib/safety";
import { toneOf, TONES } from "@/lib/sheet-tone";
import { afterAired, forgetStory, stateFor } from "@/lib/story-state";
import { loadChain, PUBLIC_VIEWER, publicKeepsakes, type ChainGift, type ChainItem } from "@/lib/text-chain";
import { VENUE_IDS } from "@/lib/venues";
import { api, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setGiftsOnAirForTests(false);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const [A, B, C] = HOUSE_CHARACTERS.map((c) => c.id);
const NOW = new Date("2026-11-16T12:00:00Z");
const DAY = 86_400_000;

const facts = (over: Partial<GiftFacts> = {}): GiftFacts => ({ episode_id: "ep", ending: "second_date", stage: "sparks", dates: 2, injured: null, ...over });
/** The first id of a run for which `ok` holds: a gift is dealt by the date's id, so a test picks its dates. */
const idWhere = (prefix: string, ok: (id: string) => boolean): string => {
  for (let n = 0; n < 5000; n++) if (ok(`${prefix}-${n}`)) return `${prefix}-${n}`;
  throw new Error(`no id for ${prefix}`);
};
const happens = (prefix: string, over: Partial<GiftFacts> = {}) => idWhere(prefix, (id) => giftHappens(facts({ ...over, episode_id: id })));

type DateOpts = { ending?: Ending; venue?: string; at?: Date; visibility?: string; aired?: boolean; creator?: string; walked?: "a" | "b"; rejected?: "a" | "b"; line?: string };
/** A finished date between two characters, aired publicly unless told otherwise. */
async function dated(id: string, a: string, b: string, o: DateOpts = {}) {
  const at = (o.at ?? new Date(NOW.getTime() - 3_600_000)).toISOString();
  const transcript = [
    { side: "a", dialogue: "So this is the place.", ...(o.walked === "a" ? { walked_out: true } : {}) },
    { side: "b", dialogue: o.line ?? "I have never trusted a giraffe.", ...(o.walked === "b" ? { walked_out: true } : {}) },
  ];
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, created_at, revealed_at, transcript, status, visibility, setup, drama_question, drama_answer)
     values ($1, $2, $3, $4, 'a place', '{}'::jsonb, '[]'::jsonb, '', '', $5, $6, $7, $8::jsonb, 'ready', $9, $10::jsonb, $11, $12)`,
    [id, o.creator ?? "system", a, b, o.ending ?? "second_date", at, o.aired === false ? null : at, JSON.stringify(transcript), o.visibility ?? "public", JSON.stringify({ venue: o.venue ?? "safari" }), o.rejected ? "rejected" : null, o.rejected ?? null],
  );
  await refreshRelationship(t.db, a, b);
  return id;
}
const giftRows = async () => (await t.db.query<{ id: string; episode_id: string; giver: string; item: string; name: string; note: string; reaction: string; reply: string }>(`select * from character_gifts order by created_at`)).rows;
const gifts = (items: ChainItem[]) => items.filter((i): i is ChainGift => i.kind === "gift");

describe("the rules (lib/gift-catalog.ts)", () => {
  it("when: never after a disaster unless someone was wronged, rarely on a first date, more often the steadier the pair", () => {
    expect(giftChance(facts({ ending: "disaster", stage: "bad_blood", injured: null }))).toBe(0);
    expect(giftChance(facts({ ending: "disaster", stage: "bad_blood", injured: "a" }))).toBe(0.15);
    expect(giftChance(facts({ ending: "friends", stage: "bad_blood" }))).toBe(0);
    expect(giftChance(facts({ ending: "second_date", stage: "exes" }))).toBe(0);
    expect(giftChance(facts({ ending: "friends", stage: "friends" }))).toBe(0.12);
    expect(giftChance(facts({ stage: "just_met", dates: 1 }))).toBe(0.1);
    expect(giftChance(facts({ stage: "sparks", dates: 2 }))).toBe(0.25);
    expect(giftChance(facts({ stage: "dating", dates: 3 }))).toBe(0.4);
    expect(giftChance(facts({ stage: "going_steady", dates: 5 }))).toBe(0.6);
    // A stage this file has never heard of is read by its name, or as an ordinary couple: never a crash.
    expect(giftChance(facts({ stage: "exclusive", dates: 4 }))).toBe(0.6);
    expect(giftChance(facts({ stage: "moved_in", dates: 6 }))).toBe(0.6);
    expect(giftChance(facts({ stage: "keeping_it_casual", dates: 3 }))).toBe(0.25);
    expect(giftChance(facts({ stage: "broken_up", dates: 3 }))).toBe(0);
    expect(giftChance(facts({ stage: null, dates: 3 }))).toBe(0.25);
    expect([coldStage("bad_blood"), coldStage("exes"), coldStage("complex"), steadyStage("going_steady"), steadyStage("sparks")]).toEqual([true, true, false, true, false]);
    expect([giftOccasion(facts({ ending: "disaster" })), giftOccasion(facts({ ending: "friends" })), giftOccasion(facts({ dates: 1 })), giftOccasion(facts({ dates: 2 }))]).toEqual(["peace", "token", "token", "sweet"]);
  });

  it("is dealt by the date: the same date always answers the same, and the share that get one is the chance", () => {
    for (const [f, lo, hi] of [
      [facts({ stage: "just_met", dates: 1 }), 0.06, 0.14],
      [facts({ stage: "going_steady", dates: 5 }), 0.55, 0.65],
      [facts({ ending: "disaster", injured: null }), 0, 0],
    ] as const) {
      let n = 0;
      for (let i = 0; i < 3000; i++) if (giftHappens({ ...f, episode_id: `date-${i}` })) n++;
      expect(n / 3000).toBeGreaterThanOrEqual(lo);
      expect(n / 3000).toBeLessThanOrEqual(hi);
      expect(giftHappens({ ...f, episode_id: "date-7" })).toBe(giftHappens({ ...f, episode_id: "date-7" }));
    }
  });

  it("who: never the side that was walked out on or turned down; otherwise either of them", () => {
    expect(injuredSide({ drama_question: "rejected", drama_answer: "a", walked: null })).toBe("a");
    expect(injuredSide({ drama_question: null, drama_answer: null, walked: "a" })).toBe("b");
    // A walk-out outranks the rejection that led to it: the one left at the table is the wronged one.
    expect(injuredSide({ drama_question: "rejected", drama_answer: "a", walked: "a" })).toBe("b");
    expect(injuredSide({ drama_question: "leaves_first", drama_answer: "b", walked: null })).toBeNull();
    const givers = new Set<string>();
    for (let i = 0; i < 200; i++) {
      expect(giftGiver({ episode_id: `d-${i}`, injured: "a" })).toBe("b");
      expect(giftGiver({ episode_id: `d-${i}`, injured: "b" })).toBe("a");
      givers.add(giftGiver({ episode_id: `d-${i}`, injured: null }));
    }
    expect([...givers].sort()).toEqual(["a", "b"]);
  });

  it("the catalogue: dozens of small PG things, one for every place, none of them money, a milestone or a claim on anyone", () => {
    expect(GIFTS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(GIFTS.map((g) => g.id)).size).toBe(GIFTS.length);
    expect(new Set(GIFTS.map((g) => g.name)).size).toBe(GIFTS.length);
    for (const g of GIFTS) {
      const words = [g.name, g.note, ...Object.values(g.tones ?? {})];
      for (const w of words) {
        expect(checkShowText({ w }).ok, w).toBe(true);
        expect(checkSheetText({ w }).ok, w).toBe(true);
        // Nothing bought to impress, nothing that marks a step in a relationship, nothing the house may not repeat.
        expect(w, w).not.toMatch(/\$|dollar|bought|price|paid|cost|expensive|token|coins?|\bpoints\b|\brings?\b|(?:house|door|spare|front) keys?\b|propos|engag|move in/i);
      }
      expect(sensitiveClaim(giftClaim("Sable", "Juniper", g.name)), g.name).toBe(false);
      expect(g.name).toMatch(/^(?:a|an|the|two) /);
      expect(g.name).not.toMatch(/\byou\b|\byour\b|[.!?]$/i);
      expect(g.name.length).toBeLessThanOrEqual(GIFT_NAME_MAX);
      for (const w of words.slice(1)) expect(w.replace("{line}", "x".repeat(70)).length).toBeLessThanOrEqual(GIFT_NOTE_MAX);
      expect(Boolean(g.quotes)).toBe(words.slice(1).some((w) => w.includes("{line}")));
    }
    // Every place a date can happen has a gift of its own (a double date's table is anyone's).
    for (const venue of VENUE_IDS.filter((v) => v !== "double_date")) expect(GIFTS.some((g) => g.venues?.includes(venue)), venue).toBe(true);
    for (const reaction of ["touched", "amused", "unimpressed"] as const) {
      for (const tone of TONES) {
        expect(GIFT_REPLIES[reaction][tone].length).toBeGreaterThanOrEqual(2);
        for (const line of GIFT_REPLIES[reaction][tone]) expect(checkShowText({ line }).ok && checkSheetText({ line }).ok, line).toBe(true);
      }
    }
  });

  it("what: from the date's place, what the other is like, or a line of theirs; a peace offering after a disaster; never a gift that doesn't fit", () => {
    const nothing = { venue: "safari", sheet: "tall punctual", line: null };
    const ids = (c: { item: { id: string } }[]) => c.map((x) => x.item.id);
    const safari = giftCandidates("sweet", nothing);
    expect(ids(safari)).toContain("giraffe_postcard");
    expect(ids(safari)).not.toContain("dinosaur_postcard");
    expect(ids(safari)).not.toContain("bookmark");
    expect(ids(safari)).not.toContain("quote_card");
    expect(ids(safari)).not.toContain("shortbread");
    expect(safari.find((c) => c.item.id === "giraffe_postcard")!.weight).toBeGreaterThan(safari.find((c) => c.item.id === "paper_boat")!.weight);
    // A place with a "@label", and a sheet that says what they like.
    expect(ids(giftCandidates("token", { venue: "late_bookshop@the back room", sheet: "a librarian who reads on trains", line: "I alphabetise my spices." }))).toEqual(expect.arrayContaining(["margin_paperback", "bookmark", "quote_card"]));
    // Only a couple's gift for a couple; only a peace offering after a disaster.
    expect(ids(giftCandidates("token", nothing))).not.toContain("chipped_mug");
    expect(ids(giftCandidates("peace", nothing)).sort()).toEqual(["cactus", "paper_flag", "shortbread", "sorry_card"]);
    // A long line isn't quoted, and the pick is the date's: the same date, the same gift.
    expect(ids(giftCandidates("sweet", { ...nothing, line: "x".repeat(90) }))).not.toContain("quote_card");
    expect(pickGift("ep-1", "sweet", nothing, "plain")).toEqual(pickGift("ep-1", "sweet", nothing, "plain"));
    const picked = new Set(Array.from({ length: 300 }, (_, i) => pickGift(`ep-${i}`, "sweet", nothing, "wry")!.id));
    expect(picked.size).toBeGreaterThan(3);
    expect(picked.has("giraffe_postcard")).toBe(true);
    // The note is in the giver's tone where the item has one for it, and a quoted line sits in the card.
    const giraffe = idWhere("g", (id) => pickGift(id, "sweet", nothing, "wry")?.id === "giraffe_postcard");
    expect(pickGift(giraffe, "sweet", nothing, "wry")!.note).toBe("He asked for your number. I said I'd pass this on instead.");
    expect(pickGift(giraffe, "sweet", nothing, "plain")!.note).toBe("It stared at you first. I only noticed.");
    const quoted = idWhere("q", (id) => pickGift(id, "token", { ...nothing, line: "I have never trusted a giraffe." }, "plain")?.id === "quote_card");
    expect(pickGift(quoted, "token", { ...nothing, line: "I have never trusted a giraffe." }, "plain")!.note).toBe("“I have never trusted a giraffe.” You said it. I wrote it down.");
    expect(pickGift("ep-1", "sweet", nothing, "plain", GIFTS.map((g) => g.id))).toBeNull();
  });

  it("how it lands: by the occasion, how they stand and the receiver's own tone", () => {
    const share = (f: { occasion: "sweet" | "token" | "peace"; stage: string | null; dates: number }, tone: "warm" | "wry" | "reserved" | "plain") => {
      const n = { touched: 0, amused: 0, unimpressed: 0 };
      for (let i = 0; i < 2000; i++) n[giftReaction({ ...f, episode_id: `r-${i}` }, tone)]++;
      return n;
    };
    const steadyWarm = share({ occasion: "sweet", stage: "going_steady", dates: 6 }, "warm");
    expect(steadyWarm.touched).toBeGreaterThan(steadyWarm.amused + steadyWarm.unimpressed);
    const peaceReserved = share({ occasion: "peace", stage: "bad_blood", dates: 2 }, "reserved");
    expect(peaceReserved.unimpressed).toBeGreaterThan(peaceReserved.touched + peaceReserved.amused);
    const firstWry = share({ occasion: "token", stage: "just_met", dates: 1 }, "wry");
    expect(firstWry.amused).toBeGreaterThan(firstWry.touched);
    for (const n of [steadyWarm, peaceReserved, firstWry]) expect(Math.min(n.touched, n.amused, n.unimpressed)).toBeGreaterThan(0);
    expect(GIFT_REPLIES.amused.wry).toContain(giftReply("ep-1", "amused", "wry"));
    expect(giftReply("ep-1", "amused", "wry")).toBe(giftReply("ep-1", "amused", "wry"));
  });

  it("calls no model and has no route: the two files import neither, and nothing under app/ names a gift", () => {
    for (const file of ["lib/gift-catalog.ts", "lib/character-gifts.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from "\.\/(?:model|keys|conversation|engine-model)"|getModel|\.complete\(/);
      // Fiction between characters: nothing here reads or writes points, tokens, an ending or a stage.
      expect(src, file).not.toMatch(/token_grants|spendBoughtTokens|update episodes|update relationships|insert into relationships|from "\.\/(?:allowance|points|dare-points)"/);
    }
    // The only engine import is the seeded hash the show's other dealt choices use.
    expect(readFileSync("lib/gift-catalog.ts", "utf8").match(/from "\.\/engine"/g)).toHaveLength(1);
    expect(readFileSync("lib/gift-catalog.ts", "utf8")).toContain('import { seedFrom } from "./engine";');
    expect(readFileSync("lib/character-gifts.ts", "utf8")).not.toContain('"./engine"');
    expect(readFileSync("lib/air.ts", "utf8")).toContain("giftOnAir(db, id);");
    const named = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [...(/gift/i.test(e.name) ? [`${dir}/${e.name}`] : []), ...named(`${dir}/${e.name}`)] : []));
    expect(named("app")).toEqual([]);
  });
});

describe("after a date airs (lib/character-gifts.ts giftAfterAir)", () => {
  it("writes one gift for a public aired date between public characters, once, and it shows in their thread for anyone", async () => {
    const id = await dated(happens("first", { stage: "just_met", dates: 1 }), A, B);
    const gift = await giftAfterAir(t.db, id, { now: NOW });
    expect(gift).toMatchObject({ episode_id: id });
    const rows = await giftRows();
    expect(rows).toHaveLength(1);
    const [lo] = pairKey(A, B);
    expect(rows[0]).toMatchObject({ episode_id: id, giver: gift!.giver_id === lo ? "lo" : "hi", name: gift!.name, note: gift!.note, reaction: gift!.reaction, reply: gift!.reply });
    expect([A, B]).toContain(gift!.giver_id);
    expect(gift!.receiver_id).toBe(gift!.giver_id === A ? B : A);
    expect(GIFTS.map((g) => g.name)).toContain(gift!.name);
    // A first date's gift is a token, never a couple's.
    expect(GIFTS.find((g) => g.name === gift!.name)!.occasions ?? ["sweet", "token"]).toContain("token");
    // Again: nothing new.
    expect(await giftAfterAir(t.db, id, { now: NOW })).toBeNull();
    expect(await giftRows()).toHaveLength(1);

    // In the thread anyone may see: the date, its photo, then the gift (its note, how it landed, the reply).
    const seen = publicKeepsakes(await loadChain(t.db, A, B, PUBLIC_VIEWER, { keepsakes: true }));
    expect(seen.map((i) => i.kind)).toEqual(["date", "photo", "gift"]);
    expect(seen[2]).toMatchObject({ kind: "gift", episode_id: id, who: rows[0].giver, name: gift!.name, note: gift!.note, reaction: gift!.reaction, reply: gift!.reply, day: "2026-11-16" });
    // A reader that doesn't ask (a prompt, the agents) never gets one.
    expect(gifts(await loadChain(t.db, A, B, PUBLIC_VIEWER))).toEqual([]);
    expect(gifts(await loadChain(t.db, A, B, { usableBy: "system" }, { keepsakes: true }))).toEqual([]);
  });

  it("writes nothing when the rules say no, and never for a date that isn't a public aired one between public characters", async () => {
    const no = await dated(idWhere("no", (id) => !giftHappens(facts({ episode_id: id, stage: "just_met", dates: 1 }))), A, B);
    expect(await giftAfterAir(t.db, no, { now: NOW })).toBeNull();
    await t.db.query(`delete from episodes`);

    const yes = (n: number) => happens(`hidden${n}`, { stage: "just_met", dates: 1 });
    // Unaired (predictions are open), unlisted, private: none is the public record.
    expect(await giftAfterAir(t.db, await dated(yes(1), A, B, { aired: false }), { now: NOW })).toBeNull();
    await t.db.query(`delete from episodes`);
    expect(await giftAfterAir(t.db, await dated(yes(2), A, B, { visibility: "unlisted" }), { now: NOW })).toBeNull();
    await t.db.query(`delete from episodes`);
    expect(await giftAfterAir(t.db, await dated(yes(3), A, B, { visibility: "private" }), { now: NOW })).toBeNull();
    await t.db.query(`delete from episodes`);
    // A private character's date.
    const owner = newUserCookie();
    const mine = await (await api.createCharacter(validCharacter(), owner)).json();
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [mine.id]);
    expect(await giftAfterAir(t.db, await dated(yes(4), mine.id, B, { creator: userIdOf(owner) }), { now: NOW })).toBeNull();
    // Reported away.
    const reported = await dated(yes(5), A, C);
    for (let i = 0; i < 3; i++) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [reported, `reporter-${i}`]);
    expect(await giftAfterAir(t.db, reported, { now: NOW })).toBeNull();
    expect(await giftAfterAir(t.db, "no-such-date", { now: NOW })).toBeNull();
    expect(await giftRows()).toEqual([]);
  });

  it("a gift goes when its date does: made private, it leaves the thread anyone sees", async () => {
    const id = await dated(happens("gone", { stage: "just_met", dates: 1 }), A, B);
    expect(await giftAfterAir(t.db, id, { now: NOW })).not.toBeNull();
    expect(gifts(await loadChain(t.db, A, B, PUBLIC_VIEWER, { keepsakes: true }))).toHaveLength(1);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [id]);
    expect(publicKeepsakes(await loadChain(t.db, A, B, PUBLIC_VIEWER, { keepsakes: true }))).toEqual([]);
  });

  it("at most one a pair a week", async () => {
    const first = await dated(happens("week-a", { stage: "just_met", dates: 1 }), A, B, { at: new Date(NOW.getTime() - 2 * DAY) });
    expect(await giftAfterAir(t.db, first, { now: new Date(NOW.getTime() - 2 * DAY) })).not.toBeNull();
    // Their next date, two days on: the rules would say yes (sparks, a second date), the week says no.
    const second = await dated(happens("week-b", { stage: "sparks", dates: 2 }), A, B);
    expect(giftHappens(facts({ episode_id: second, stage: "sparks", dates: 2 }))).toBe(true);
    expect(await giftAfterAir(t.db, second, { now: NOW })).toBeNull();
    // Another pair isn't held back by theirs.
    const other = await dated(happens("week-c", { stage: "just_met", dates: 1 }), A, C);
    expect(await giftAfterAir(t.db, other, { now: NOW })).not.toBeNull();
    // Once the week is up, the same date may bring one.
    expect(await giftAfterAir(t.db, second, { now: new Date(NOW.getTime() + (GIFT_EVERY_DAYS - 2) * DAY + 60_000) })).not.toBeNull();
    expect((await giftRows()).map((r) => r.episode_id).sort()).toEqual([first, other, second].sort());
  });

  it("after a disaster: nothing when it just went badly, and only ever a peace offering from the one who walked out", async () => {
    for (let n = 0; n < 40; n++) {
      const id = await dated(`plain-disaster-${n}`, A, B, { ending: "disaster" });
      expect(await giftAfterAir(t.db, id, { now: NOW })).toBeNull();
      await t.db.query(`delete from episodes where id = $1`, [id]);
    }
    // Side a walked out: b was wronged, so b never gives; a may send a peace offering.
    const id = await dated(happens("walked", { ending: "disaster", stage: "bad_blood", dates: 1, injured: "b" }), A, B, { ending: "disaster", walked: "a" });
    const gift = await giftAfterAir(t.db, id, { now: NOW });
    expect(gift).toMatchObject({ giver_id: A, receiver_id: B });
    expect(GIFTS.find((g) => g.id === gift!.item)!.occasions).toEqual(["peace"]);
    await t.db.query(`delete from episodes`);
    // The same when b was turned down: across many dates, the turned-down side never gives.
    for (let n = 0; n < 60; n++) {
      const d = await dated(`turned-down-${n}`, A, B, { ending: "disaster", rejected: "b" });
      const g = await giftAfterAir(t.db, d, { now: NOW });
      if (g) expect(g.giver_id).toBe(A);
      await t.db.query(`delete from episodes where id = $1`, [d]);
    }
  });

  it("the story state: a gift that touched them lifts the receiver's trust by one, through setOpinion on that date's opinion", async () => {
    const tones = Object.fromEntries((await t.db.query<{ id: string; traits: string[]; voice: string | null }>(`select id, traits, voice from characters where id = any($1)`, [[A, B]])).rows.map((c) => [c.id, toneOf(c)]));
    const landing = (id: string) => giftReaction({ episode_id: id, occasion: "token", stage: "just_met", dates: 1 }, tones[giftGiver({ episode_id: id, injured: null }) === "a" ? B : A]);
    const touched = await dated(idWhere("touched", (id) => giftHappens(facts({ episode_id: id, stage: "just_met", dates: 1 })) && landing(id) === "touched"), A, B);
    await afterAired(t.db, touched, { now: NOW });
    const before = { a: (await stateFor(t.db, A, { withId: B }))!.opinions[0], b: (await stateFor(t.db, B, { withId: A }))!.opinions[0] };
    expect(before.a.trust).toBeLessThan(2);
    const gift = (await giftAfterAir(t.db, touched, { now: NOW }))!;
    expect(gift.reaction).toBe("touched");
    const holder = gift.receiver_id === A ? "a" : "b";
    const after = { a: (await stateFor(t.db, A, { withId: B }))!.opinions[0], b: (await stateFor(t.db, B, { withId: A }))!.opinions[0] };
    // Only the receiver's, only trust, only by one; the take, the attraction and where it came from are the date's.
    expect(after[holder]).toMatchObject({ trust: before[holder].trust + 1, attraction: before[holder].attraction, take: before[holder].take, basis: "firsthand", source: touched });
    const giver = holder === "a" ? "b" : "a";
    expect(after[giver]).toMatchObject({ trust: before[giver].trust, take: before[giver].take });
    // The date's own rebuild resets it (the story state stays derived from what aired), and a second nudge can't stack.
    expect(await nudgeOpinion(t.db, gift)).toBe(after[holder].trust < 2);
    await afterAired(t.db, touched, { now: NOW });
    expect((await stateFor(t.db, gift.receiver_id, { withId: gift.giver_id }))!.opinions[0].trust).toBe(before[holder].trust);

    // Told to forget: it stays forgotten. An opinion from another date, or at the top of the scale, isn't touched.
    await forgetStory(t.db, gift.receiver_id, "opinion", gift.giver_id);
    expect(await nudgeOpinion(t.db, gift)).toBe(false);
    expect(await stateFor(t.db, gift.receiver_id, { withId: gift.giver_id }).then((s) => s?.opinions ?? [])).toEqual([]);
    expect(await nudgeOpinion(t.db, { ...gift, reaction: "amused" })).toBe(false);
    expect(await nudgeOpinion(t.db, { ...gift, giver_id: gift.receiver_id, receiver_id: gift.giver_id, episode_id: "another-date" })).toBe(false);
  });

  it("an amused or unimpressed receiver's opinion doesn't move, and STORY_STATE=0 writes nothing", async () => {
    const tones = Object.fromEntries((await t.db.query<{ id: string; traits: string[]; voice: string | null }>(`select id, traits, voice from characters where id = any($1)`, [[A, B]])).rows.map((c) => [c.id, toneOf(c)]));
    const landing = (id: string) => giftReaction({ episode_id: id, occasion: "token", stage: "just_met", dates: 1 }, tones[giftGiver({ episode_id: id, injured: null }) === "a" ? B : A]);
    const cool = await dated(idWhere("cool", (id) => giftHappens(facts({ episode_id: id, stage: "just_met", dates: 1 })) && landing(id) !== "touched"), A, B);
    await afterAired(t.db, cool, { now: NOW });
    const before = await t.db.query(`select holder_id, trust, attraction, take from character_opinions order by holder_id`);
    expect((await giftAfterAir(t.db, cool, { now: NOW }))!.reaction).not.toBe("touched");
    expect((await t.db.query(`select holder_id, trust, attraction, take from character_opinions order by holder_id`)).rows).toEqual(before.rows);

    await t.db.query(`delete from character_gifts`);
    await t.db.query(`delete from character_opinions`);
    vi.stubEnv("STORY_STATE", "0");
    expect(await giftAfterAir(t.db, cool, { now: NOW })).not.toBeNull();
    expect((await t.db.query(`select 1 from character_opinions`)).rows).toEqual([]);
  });

  it("CHARACTER_GIFTS=0: none is written, none is shown, and the house hears of none", async () => {
    expect([characterGiftsOn({}), characterGiftsOn({ CHARACTER_GIFTS: "0" })]).toEqual([true, false]);
    const id = await dated(happens("switch", { stage: "just_met", dates: 1 }), A, B);
    expect(await giftAfterAir(t.db, id, { now: NOW, env: { CHARACTER_GIFTS: "0" } })).toBeNull();
    expect(await giftRows()).toEqual([]);
    expect(await giftAfterAir(t.db, id, { now: NOW })).not.toBeNull();
    expect(gifts(await loadChain(t.db, A, B, PUBLIC_VIEWER, { keepsakes: true, env: { CHARACTER_GIFTS: "0" } }))).toEqual([]);
    expect((await giftsFor(t.db, [id], { CHARACTER_GIFTS: "0" })).size).toBe(0);
    expect((await giftsFor(t.db, [id])).size).toBe(1);
  });

  it("the air job's hook is off in tests unless one turns it on, and never throws", async () => {
    expect(giftsOnAir()).toBe(false);
    const id = await dated(happens("hook", { stage: "just_met", dates: 1 }), A, B);
    giftOnAir(t.db, id);
    await new Promise((r) => setTimeout(r, 50));
    expect(await giftRows()).toEqual([]);
    setGiftsOnAirForTests(true);
    giftOnAir(t.db, id);
    giftOnAir(t.db, "no-such-date");
    await vi.waitFor(async () => expect(await giftRows()).toHaveLength(1));
  });
});

describe("what a gift feeds", () => {
  it("the house: the gift rides beside the aired date it followed, as one public sentence the room may repeat", async () => {
    const id = await dated(happens("house", { stage: "just_met", dates: 1 }), A, B);
    const gift = (await giftAfterAir(t.db, id, { now: NOW }))!;
    const names = Object.fromEntries(HOUSE_CHARACTERS.map((c) => [c.id, c.name.split(" ")[0]]));
    const said = `${names[gift.giver_id]} sent ${names[gift.receiver_id]} ${gift.name}.`;
    expect([...(await giftsFor(t.db, [id, "another"]))]).toEqual([[id, said]]);
    expect(sensitiveClaim(said)).toBe(false);

    const f = await sceneFacts(t.db, NOW);
    const about = f?.dates.find((d) => d.episode_id === id);
    // Only when this season's cast can seat a room for it; then the fact carries the gift and the prompt says it.
    if (about) {
      expect(about.gift).toBe(said);
      expect(scenePrompt(f!)).toContain(`Afterwards, ${said}`);
    }
    // The template scene, from fixed facts: with three in the room, the third brings up the gift.
    const fixed: SceneFacts = {
      id: "2026-11-16-gossip", day: "2026-11-16", place: "kitchen", notes: {}, takes: {}, askWrong: false, tension: null,
      speakers: HOUSE_CHARACTERS.slice(2, 5).map((c) => ({ id: c.id, name: c.name, bio: c.bio, house: true })),
      dates: [{ episode_id: id, a: A, b: B, a_name: HOUSE_CHARACTERS[0].name, b_name: HOUSE_CHARACTERS[1].name, ending: "second_date", ending_detail: null, venue: "safari", date_number: null, rejected: null, walked_out: null, gift: said }],
    };
    expect(scenePrompt(fixed)).toContain(`1. `);
    expect(scenePrompt(fixed)).toContain(` Afterwards, ${said}`);
    expect(templateScene(fixed).map((l) => l.text)).toContain(`And afterwards, ${said} Nobody tell me that means nothing.`);
    // Without one, the scene is word for word what it was.
    const plain = { ...fixed, dates: [{ ...fixed.dates[0], gift: undefined }] };
    expect(scenePrompt(plain)).not.toContain("Afterwards");
    expect(templateScene(plain).map((l) => l.text).join(" ")).not.toContain("afterwards");
    // What the room "heard" is still the date's own claim, never the gift.
    expect(templateScene(fixed).filter((l) => l.tell).every((l) => !l.tell!.claim.includes("sent"))).toBe(true);
  });

  it("the owners: only one whose own character's texts are on hears of it, in that character's voice, once; never our own accounts", async () => {
    const lines = giftTextLines("receiver", { name: "a postcard of a giraffe", note: "It stared at you first. I only noticed.", reaction: "amused", reply: "A bold choice. I respect it." }, "Sable Quist");
    expect(lines).toEqual(["Sable left me a postcard of a giraffe.", 'The note said: "It stared at you first. I only noticed."', "It made me laugh."]);
    expect(giftTextLines("giver", { name: "a postcard of a giraffe", note: "n", reaction: "unimpressed", reply: "Noted." }, "Juniper Vale")).toEqual(["I left Juniper a postcard of a giraffe.", 'They said: "Noted."', "It did not land. Noted."]);

    const texts = async (userId: string) => (await t.db.query<{ text: string; action: string }>(`select m.text, m.action from companion_messages m join companion_threads th on th.id = m.thread_id where th.user_id = $1 and m.action like 'gift:%' order by m.created_at, m.id`, [userId])).rows;
    const person = async (optIn: boolean | null) => {
      const cookie = newUserCookie();
      const c = await (await api.createCharacter(validCharacter({ name: `Mira ${crypto.randomUUID().slice(0, 5)}` }), cookie)).json();
      if (optIn !== null) {
        const opened = await openThread(t.db, userIdOf(cookie), c.id, NOW, { opener: false });
        if (!opened.ok) throw new Error("no thread");
        await t.db.query(`update companion_threads set muted_proactive = $2 where id = $1`, [opened.thread_id, !optIn]);
      }
      return { userId: userIdOf(cookie), id: c.id as string };
    };
    const on = await person(true);
    const off = await person(false);
    const none = await person(null);
    const ours = await person(true);
    await t.db.query(`insert into admins (user_id) values ($1)`, [ours.userId]);

    const heard: Record<string, number> = {};
    for (const [n, p] of [on, off, none, ours].entries()) {
      const id = await dated(happens(`owner${n}`, { stage: "just_met", dates: 1 }), p.id, B, { creator: p.userId });
      const gift = (await giftAfterAir(t.db, id, { now: NOW }))!;
      expect(gift).not.toBeNull();
      const got = await texts(p.userId);
      heard[["on", "off", "none", "ours"][n]] = got.length;
      if (p === on) {
        expect(got.map((m) => m.action)).toEqual(Array(3).fill(`gift:${gift.id}`));
        expect(got.map((m) => m.text)).toEqual(giftTextLines(gift.giver_id === p.id ? "giver" : "receiver", gift, HOUSE_CHARACTERS[1].name));
      }
    }
    expect(heard).toEqual({ on: 3, off: 0, none: 0, ours: 0 });
    // Nobody is texted on behalf of a house character.
    expect((await t.db.query(`select 1 from companion_threads where character_id = $1`, [B])).rows).toEqual([]);
  });
});
