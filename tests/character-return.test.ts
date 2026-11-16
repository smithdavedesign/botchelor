// "Came back for their character" (lib/character-return.ts): the count, what feeds it from the database, and the date
// id the "watched it end" beacon now carries.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { characterReturn, describeReturns, loadCharacterActs, type CharacterAct } from "@/lib/character-return";
import { METRIC_DEFS, realUse } from "@/lib/real-metrics";
import { HOUSE_PARTNER_ID, setupEpisode, startTestDb, userIdOf } from "./helpers";

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number, hours = 0) => new Date(NOW.getTime() - daysAgo * DAY + hours * 3_600_000);
const act = (user: string, character: string, kind: CharacterAct["kind"], when: Date): CharacterAct => ({ user, character, kind, at: when });
const everyone = () => true;

describe("the count", () => {
  it("counts a person who watched their character's date end and did more with it on a later day within seven", () => {
    const r = characterReturn([act("u1", "c1", "watch", at(5)), act("u1", "c1", "message", at(3))], { now: NOW, days: 30, real: everyone });
    expect(r).toMatchObject({ num: 1, den: 1, pending: 0 });
    expect(r.rows[0]).toMatchObject({ user: "u1", character: "c1", first_kind: "watch", returned_kind: "message", pending: false });
  });

  it("the same day, another character, or the eighth day is not coming back", () => {
    const acts = [
      act("same-day", "c1", "message", at(5)),
      act("same-day", "c1", "book", at(5, 2)),
      act("other", "c1", "message", at(5)),
      act("other", "c2", "book", at(3)),
      act("late", "c1", "watch", at(10)),
      act("late", "c1", "message", at(2)),
    ];
    const r = characterReturn(acts, { now: NOW, days: 30, real: everyone });
    expect(r).toMatchObject({ num: 0, den: 3 });
    expect(r.rows.every((row) => row.returned_at === null && !row.pending)).toBe(true);
  });

  it("booking a date or leaving advice brings someone back but never puts them in the count", () => {
    const only = characterReturn([act("u1", "c1", "book", at(5)), act("u1", "c1", "advice", at(4))], { now: NOW, days: 30, real: everyone });
    expect(only).toMatchObject({ num: 0, den: 0, rows: [] });
    const back = characterReturn([act("u1", "c1", "message", at(5)), act("u1", "c1", "advice", at(4))], { now: NOW, days: 30, real: everyone });
    expect(back).toMatchObject({ num: 1, den: 1 });
  });

  it("someone whose first day is today waits; our own, agents and people first seen before the window are left out", () => {
    const acts = [
      act("today", "c1", "message", at(0, -1)),
      act("ours", "c1", "message", at(5)),
      act("ours", "c1", "message", at(4)),
      act("old", "c1", "message", at(40)),
      act("old", "c1", "message", at(2)),
      act("new", "c1", "message", at(6)),
      act("new", "c1", "watch", at(1)),
    ];
    const r = characterReturn(acts, { now: NOW, days: 30, real: (id) => id !== "ours" });
    expect(r).toMatchObject({ num: 1, den: 1, pending: 1 });
    expect(r.rows.map((row) => row.user).sort()).toEqual(["new", "today"]);
    // A shorter window keeps only whose first moment is inside it.
    expect(characterReturn(acts, { now: NOW, days: 3, real: everyone }).rows.map((row) => row.user)).toEqual(["today"]);
  });
});

describe("from the database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from admins");
    await t.db.query("delete from web_events");
  });

  it("reads watched endings of one's own character, own messages, booked dates and advice; texts sent to a person never count", async () => {
    const made = await setupEpisode();
    const user = userIdOf(made.creator);
    const character = made.character.id as string;
    const episode = made.episode.id as string;
    // The harness's default name is one of our own test names (lib/our-traffic.ts), which Real use leaves out.
    await t.db.query(`update characters set name = 'Odalys Brandt' where id = $1`, [character]);
    await t.db.query(`update episodes set created_at = $2 where id = $1`, [episode, at(6).toISOString()]);
    const beacon = (who: string | null, ep: string, when: Date) =>
      t.db.query(`insert into web_events (at, visitor, session, user_id, event, path, props) values ($1, 'visitor-0001', 'session-0001', $2, 'date_watched', '/episodes/:id', $3)`, [when.toISOString(), who, JSON.stringify({ via: "theater", episode_id: ep })]);
    await beacon(user, episode, at(6, 1));
    // Someone else watching the same date isn't an act with a character of theirs; nor is a watch with no date named.
    await beacon("stranger-1", episode, at(6, 2));
    await t.db.query(`insert into web_events (at, visitor, session, user_id, event, path, props) values ($1, 'visitor-0001', 'session-0001', $2, 'date_watched', '/episodes/:id', '{}')`, [at(5).toISOString(), user]);
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('th-1', $1, $2)`, [user, character]);
    await t.db.query(`insert into companion_messages (id, thread_id, role, text, created_at) values ('m-1', 'th-1', 'character', 'Back from the date.', $1), ('m-2', 'th-1', 'user', 'How did it go?', $2)`, [at(5).toISOString(), at(3).toISOString()]);
    await t.db.query(`insert into nudges (character_id, other_id, user_id, note, created_at) values ($1, $2, $3, 'Ask about the boat.', $4)`, [character, HOUSE_PARTNER_ID, user, at(2).toISOString()]);

    const acts = (await loadCharacterActs(t.db)).filter((a) => a.user === user);
    expect(acts.map((a) => a.kind).sort()).toEqual(["advice", "book", "message", "watch"]);
    expect(acts.every((a) => a.character === character)).toBe(true);
    expect((await loadCharacterActs(t.db)).some((a) => a.user === "stranger-1")).toBe(false);

    const r = characterReturn(acts, { now: NOW, days: 30, real: everyone });
    expect(r).toMatchObject({ num: 1, den: 1 });
    expect(r.rows[0]).toMatchObject({ first_kind: "watch", returned_kind: "message" });
    const [row] = await describeReturns(t.db, r.rows);
    expect(row.name).toBe("Odalys Brandt");

    // On the admin's Real use section: the metric, its definition and the row.
    const use = await realUse(t.db, NOW);
    expect(use.windows.map((w) => w.people.character_return)).toEqual([
      { kind: "share", num: 1, den: 1 },
      { kind: "share", num: 1, den: 1 },
    ]);
    expect(METRIC_DEFS.find((d) => d.key === "character_return")?.section).toBe("people");
    expect(use.returns.map((x) => x.user)).toEqual([user]);
  });
});

describe("the beacon names its date", () => {
  it("date_watched picks the episode id off the address, in one place", () => {
    const src = readFileSync(join(process.cwd(), "app/engagement.ts"), "utf8");
    expect(src).toContain('name === "date_watched" ? withEpisode(props) : props');
    const re = /^\/episodes\/([A-Za-z0-9-]{8,64})(?:\/|$)/;
    expect(src).toContain(String(re).slice(1, -1));
    expect(re.exec("/episodes/5305594b-ea07-4b56-ad87-a1725c18113f")?.[1]).toBe("5305594b-ea07-4b56-ad87-a1725c18113f");
    expect(re.exec("/episodes")).toBeNull();
    expect(re.exec("/characters/5305594b-ea07-4b56-ad87-a1725c18113f")).toBeNull();
  });
});
