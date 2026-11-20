// Introductions (lib/social/introductions.ts; docs/PRDs/social-network.md section 7): some lobby deals go to two of the
// cast who share a friend, from public warm ties only, never two who've dated, are family or at odds; the date records
// met_via "introduced" and who set it up, and each actor is told who, in its own words.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedFrom } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { shortName } from "@/lib/names";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { INTRODUCTION_EVERY, introductionFor, introductionLine, roleOf } from "@/lib/social/introductions";
import { upsertTie } from "@/lib/social/ties";
import { buildTemplateDate, lobbyDeal } from "@/lib/watch";
import { startTestDb } from "./helpers";

const DAY = "2026-11-12";
const [A, B, C, FRIEND] = HOUSE_CHARACTERS.map((c) => c.id);
const name = (id: string) => shortName(HOUSE_CHARACTERS.find((c) => c.id === id)!.name);
const ON = {};
/** The deals of the day that try an introduction, and one that doesn't. */
const tries = Array.from({ length: 40 }, (_, n) => n).filter((n) => seedFrom("lobby-intro", DAY, n) % INTRODUCTION_EVERY === 0);
const skips = Array.from({ length: 40 }, (_, n) => n).find((n) => seedFrom("lobby-intro", DAY, n) % INTRODUCTION_EVERY !== 0)!;

describe("the lines (pure)", () => {
  it("says what the friend is to each side, in the kind's words, either way a directed tie runs", () => {
    expect(roleOf({ kind: "coworker", fromSide: true })).toBe("coworker");
    // A parent tie from X to Y: Y is X's parent, and X is Y's child.
    expect(roleOf({ kind: "parent", fromSide: true })).toBe("parent");
    expect(roleOf({ kind: "parent", fromSide: false })).toBe("child");
    expect(introductionLine("Mira Vale", { kind: "coworker", fromSide: true }, "Dex Hart", { kind: "close_friend", fromSide: false })).toBe(
      "Mira set the two of you up: Mira is your coworker, and Dex's close friend.",
    );
  });
});

describe("introductionFor and the lobby", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    setSeasonCastForTests([A, B, C]);
    vi.useFakeTimers({ now: new Date(`${DAY}T12:00:00Z`), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    setSeasonCastForTests(null);
  });

  /** A's coworker and C's close friend: the friend of both, who isn't in the cast. */
  async function friendOfBoth() {
    await upsertTie(t.db, { from: A, to: FRIEND, kind: "coworker", source: "house" }, ON);
    await upsertTie(t.db, { from: C, to: FRIEND, kind: "close_friend", source: "house" }, ON);
  }

  it("sets up two of the cast who share a friend, on the deals whose turn it is", async () => {
    await friendOfBoth();
    expect(tries.length).toBeGreaterThan(0);
    const intro = (await introductionFor(t.db, [A, B, C], DAY, tries[0], ON))!;
    expect([intro.a, intro.b].sort()).toEqual([A, C].sort());
    expect(intro).toMatchObject({ by: FRIEND, byName: name(FRIEND) });
    const lineFor = (side: string) => (side === intro.a ? intro.lines.a : intro.lines.b);
    expect(lineFor(A)).toBe(`${name(FRIEND)} set the two of you up: ${name(FRIEND)} is your coworker, and ${name(C)}'s close friend.`);
    expect(lineFor(C)).toBe(`${name(FRIEND)} set the two of you up: ${name(FRIEND)} is your close friend, and ${name(A)}'s coworker.`);
    expect(await introductionFor(t.db, [A, B, C], DAY, skips, ON)).toBeNull();
    expect(await introductionFor(t.db, [A, B, C], DAY, tries[0], { SOCIAL_DYNAMICS: "0" })).toBeNull();
  });

  it("never sets up two who've dated, are at odds, or through a friend who isn't public, or a tie that isn't", async () => {
    await friendOfBoth();
    await upsertTie(t.db, { from: A, to: C, kind: "dated", source: "derived", evidence: { ref: "episode:x" } }, ON);
    expect(await introductionFor(t.db, [A, B, C], DAY, tries[0], ON)).toBeNull();
    await t.db.query(`delete from social_ties where kind = 'dated'`);
    await upsertTie(t.db, { from: A, to: C, kind: "rival", source: "house" }, ON);
    expect(await introductionFor(t.db, [A, B, C], DAY, tries[0], ON)).toBeNull();
    await t.db.query(`delete from social_ties where kind = 'rival'`);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [FRIEND]);
    expect(await introductionFor(t.db, [A, B, C], DAY, tries[0], ON)).toBeNull();
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [FRIEND]);
    await t.db.query(`update social_ties set visibility = 'owner' where kind = 'coworker'`);
    expect(await introductionFor(t.db, [A, B, C], DAY, tries[0], ON)).toBeNull();
  });

  it("the lobby deals it, and the date says it was an introduction and tells both actors who set it up", async () => {
    await friendOfBoth();
    const now = new Date(`${DAY}T12:00:00Z`);
    const deal = (await lobbyDeal(t.db, now, tries[0]))!;
    expect([deal.a, deal.b].sort()).toEqual([A, C].sort());
    expect(deal.thumbs.introduction).toMatchObject({ by: FRIEND });
    // The same deal again (the night's plan and the day's room) is the same date.
    expect(await lobbyDeal(t.db, now, tries[0])).toEqual(deal);
    // A deal whose turn it isn't is dealt as before.
    expect((await lobbyDeal(t.db, now, skips))!.thumbs.introduction).toBeUndefined();
    const built = (await buildTemplateDate(t.db, "intro-ep", deal.a, deal.b, deal.thumbs))!.built;
    expect(built.setup).toMatchObject({ met_via: "introduced", introduced_by: FRIEND });
    const [ca, cb] = built.characters;
    expect(ca.introducedBy).toBe(deal.thumbs.introduction!.lines.a);
    expect(cb.introducedBy).toBe(deal.thumbs.introduction!.lines.b);
    expect(ca.introducedBy).toContain(`${name(FRIEND)} set the two of you up`);
    expect(ca.pairShared).toContain(name(FRIEND));
    // A date the show dealt as ever is a "show" date.
    const plain = (await lobbyDeal(t.db, now, skips))!;
    expect((await buildTemplateDate(t.db, "plain-ep", plain.a, plain.b, plain.thumbs))!.built.setup.met_via).toBe("show");
  });
});
