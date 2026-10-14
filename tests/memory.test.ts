import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadCharacterMemory, MEMORY_SIGNAL_CAP, updateCharacterMemory } from "@/lib/memory";
import type { SideOutcome } from "@/lib/engine";
import type { Turn } from "@/lib/conversation";
import type { Ending } from "@/lib/rules";
import { api, HOUSE_PARTNER_ID, newUserCookie, startTestDb, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
let clock = 0;

/** A SideOutcome with only the fields memory reads mattering; the rest are plausible defaults. */
const so = (over: Partial<SideOutcome> = {}): SideOutcome => ({
  wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null, ...over,
});

const turn = (side: "a" | "b", dialogue: string, interest: number): Turn =>
  ({ side, act: 1, dialogue, action: "", emotion: "", interest });

/** Inserts a finished (ready) episode with controlled sides and transcript. created_at increases so order is stable. */
async function insertEpisode(opts: {
  id: string; a: string; b: string; ending: Ending; sides: [SideOutcome, SideOutcome]; transcript?: Turn[];
}): Promise<void> {
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale,
                           ending, status, sides, transcript, created_at)
     values ($1, 'sys', $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', $4, 'ready', $5::jsonb, $6::jsonb, to_timestamp($7))`,
    [opts.id, opts.a, opts.b, opts.ending, JSON.stringify(opts.sides), JSON.stringify(opts.transcript ?? []), 1_000 + clock++],
  );
}

/** Creates one OC to be the memory subject; the other side is a house character. */
async function subject(): Promise<string> {
  const creator = newUserCookie();
  const created = await (await api.createCharacter(validCharacter(), creator)).json();
  return created.id;
}

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clock = 0;
});

describe("updateCharacterMemory — deterministic aggregation", () => {
  it("counts endings, learns likes/turnoffs from the subject's OWN side, and writes an arc", async () => {
    const s = await subject();
    // ep1: S is A, a second date, S's want met by "adventurous"; the OTHER side's want must not leak in.
    await insertEpisode({
      id: "e1", a: s, b: HOUSE_PARTNER_ID, ending: "second_date",
      sides: [so({ want_met: "adventurous" }), so({ want_met: "OTHERSIDECUE" })],
      transcript: [turn("a", "I only trust people who get lost on purpose", 0.9), turn("b", "their line", 0.95)],
    });
    // ep2: S is B this time, another second date, want met by "adventurous" again.
    await insertEpisode({
      id: "e2", a: HOUSE_PARTNER_ID, b: s, ending: "second_date",
      sides: [so(), so({ want_met: "adventurous" })],
      transcript: [turn("b", "a calmer line", 0.5)],
    });
    // ep3: S is A, a disaster, dealbreaker tripped by "aloof".
    await insertEpisode({
      id: "e3", a: s, b: HOUSE_PARTNER_ID, ending: "disaster",
      sides: [so({ want_met: null, dealbreaker_hit: "aloof", wants_another: false, satisfied: false }), so()],
      transcript: [turn("a", "a middling line", 0.7)],
    });
    // ep4: S is A, just friends, want met by "curious".
    await insertEpisode({
      id: "e4", a: s, b: HOUSE_PARTNER_ID, ending: "friends",
      sides: [so({ want_met: "curious" }), so()],
    });

    const m = await updateCharacterMemory(t.db, s);

    expect(m.dates).toBe(4);
    expect(m.second_dates).toBe(2);
    expect(m.friends).toBe(1);
    expect(m.disasters).toBe(1);
    // likes: "adventurous" twice, "curious" once; the other side's cue never appears.
    expect(m.likes).toEqual(["adventurous", "curious"]);
    expect(m.turnoffs).toEqual(["aloof"]);
    // memorable lines: the subject's OWN lines, highest interest first (the other side's 0.95 is excluded).
    expect(m.memorable_lines[0]).toBe("I only trust people who get lost on purpose");
    expect(m.memorable_lines).not.toContain("their line");
    expect(m.memorable_lines.length).toBe(3);
    // signal_delta: 2 second dates, 1 disaster -> bounded drift on openness/warmth/guardedness.
    expect(m.signal_delta.openness).toBeCloseTo(0.08, 5);
    expect(m.signal_delta.warmth).toBeCloseTo(0.06, 5);
    expect(m.signal_delta.guardedness).toBeCloseTo(0.05, 5);
    // arc: a single human sentence naming the top like and turnoff.
    expect(m.arc).toContain("4 dates in");
    expect(m.arc).toContain("adventurous");
    expect(m.arc).toContain("aloof");
  });

  it("is deterministic: recomputing yields the identical row", async () => {
    const s = await subject();
    await insertEpisode({ id: "e1", a: s, b: HOUSE_PARTNER_ID, ending: "second_date", sides: [so({ want_met: "kind" }), so()] });
    await insertEpisode({ id: "e2", a: s, b: HOUSE_PARTNER_ID, ending: "friends", sides: [so({ want_met: "kind" }), so()] });

    const first = await updateCharacterMemory(t.db, s);
    const second = await updateCharacterMemory(t.db, s);
    expect(second).toEqual(first);
    // and it matches what loadCharacterMemory reads back
    expect(await loadCharacterMemory(t.db, s)).toEqual(first);
  });

  it("caps the learned drift at ±MEMORY_SIGNAL_CAP no matter how many dates", async () => {
    const s = await subject();
    for (let i = 0; i < 6; i++) {
      await insertEpisode({ id: `e${i}`, a: s, b: HOUSE_PARTNER_ID, ending: "second_date", sides: [so({ want_met: "warm" }), so()] });
    }
    const m = await updateCharacterMemory(t.db, s);
    expect(m.second_dates).toBe(6);
    expect(m.signal_delta.openness).toBe(MEMORY_SIGNAL_CAP); // 6 * 0.04 = 0.24, clamped to 0.15
    expect(m.signal_delta.warmth).toBe(MEMORY_SIGNAL_CAP); // 6 * 0.03 = 0.18, clamped
  });

  it("keeps only lines that still pass the content filter", async () => {
    const s = await subject();
    await insertEpisode({
      id: "e1", a: s, b: HOUSE_PARTNER_ID, ending: "friends", sides: [so(), so()],
      transcript: [turn("a", "She was barely legal.", 0.99), turn("a", "a wholesome safe line", 0.2)],
    });
    const m = await updateCharacterMemory(t.db, s);
    expect(m.memorable_lines).not.toContain("She was barely legal.");
    expect(m.memorable_lines).toContain("a wholesome safe line");
  });

  it("a character with no finished dates has a zeroed memory and no arc", async () => {
    const s = await subject();
    const m = await updateCharacterMemory(t.db, s);
    expect(m.dates).toBe(0);
    expect(m.likes).toEqual([]);
    expect(m.turnoffs).toEqual([]);
    expect(m.signal_delta).toEqual({});
    expect(m.arc).toBeNull();
  });

  it("ignores episodes that are still generating", async () => {
    const s = await subject();
    await insertEpisode({ id: "ready", a: s, b: HOUSE_PARTNER_ID, ending: "second_date", sides: [so({ want_met: "kind" }), so()] });
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides)
       values ('pending', 'sys', $1, $2, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'disaster', 'generating', $3::jsonb)`,
      [s, HOUSE_PARTNER_ID, JSON.stringify([so({ dealbreaker_hit: "cruel" }), so()])],
    );
    const m = await updateCharacterMemory(t.db, s);
    expect(m.dates).toBe(1); // only the ready one
    expect(m.disasters).toBe(0);
    expect(m.turnoffs).toEqual([]); // the generating episode's dealbreaker is not counted
  });
});
