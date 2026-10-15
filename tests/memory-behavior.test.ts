import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sheetSignals } from "@/lib/temperament";
import { buildDate, DEFAULT_DATE_REQUEST, slidingDoors } from "@/lib/simulation";
import { characterSheet, loadCharacter } from "@/lib/character";
import type { SideOutcome } from "@/lib/engine";
import {
  api,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  startTestDb,
  userIdOf,
  validCharacter,
} from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;

const so = (over: Partial<SideOutcome> = {}): SideOutcome => ({
  wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null, ...over,
});

/** Writes a learned drift directly onto a character's memory (bypassing the date pipeline). */
// A memory row as the current code writes it (with its milestones), so lib/memory.ts doesn't treat it as one from
// before the story existed and rebuild it from the (empty) aired record.
async function setMemoryDelta(id: string, delta: Record<string, number>): Promise<void> {
  await t.db.query(
    `insert into character_memory (character_id, dates, second_dates, friends, disasters, signal_delta, milestones, sources)
     values ($1, 3, 3, 0, 0, $2::jsonb, '[{"id":"first_date"}]'::jsonb, '{}'::jsonb)
     on conflict (character_id) do update set signal_delta = excluded.signal_delta, dates = 3, second_dates = 3, milestones = excluded.milestones`,
    [id, JSON.stringify(delta)],
  );
}

async function makeOc(cookie: string) {
  return (await (await api.createCharacter(validCharacter(), cookie)).json()) as { id: string };
}

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe("memory-as-behavior — the engine runs on effective signals", () => {
  it("buildDate feeds the engine the memory-drifted signals and snapshots them on the setup", async () => {
    const creator = newUserCookie();
    const oc = await makeOc(creator);
    // No soul => base signals are the temperament its own sheet describes (lib/temperament.ts). A learned drift
    // shows through on top of them as the effective signals.
    await setMemoryDelta(oc.id, { warmth: 0.1, openness: 0.12 });

    const [ocChar, houseChar] = await Promise.all([loadCharacter(t.db, oc.id), loadCharacter(t.db, HOUSE_PARTNER_ID)]);
    const built = await buildDate(
      t.db,
      "ep-snap",
      { id: oc.id, sheet: characterSheet(ocChar!) },
      { id: HOUSE_PARTNER_ID, sheet: characterSheet(houseChar!) },
      DEFAULT_DATE_REQUEST,
      777,
    );

    const base = sheetSignals(characterSheet(ocChar!));
    const snap = built.setup.signals_a!;
    expect(snap.warmth).toBeCloseTo(Math.min(1, base.warmth + 0.1), 5);
    expect(snap.openness).toBeCloseTo(Math.min(1, base.openness + 0.12), 5);
    expect(snap.guardedness).toBe(base.guardedness);
    expect(snap.humor).toBe(base.humor);
    // The engine input used exactly that snapshot (side A is the owner's side).
    expect(built.input.a.signals).toEqual(built.setup.signals_a);
  });

  it("a fresh character with no memory runs on its base signals (no drift)", async () => {
    const creator = newUserCookie();
    const oc = await makeOc(creator);
    const [ocChar, houseChar] = await Promise.all([loadCharacter(t.db, oc.id), loadCharacter(t.db, HOUSE_PARTNER_ID)]);
    const built = await buildDate(
      t.db,
      "ep-fresh",
      { id: oc.id, sheet: characterSheet(ocChar!) },
      { id: HOUSE_PARTNER_ID, sheet: characterSheet(houseChar!) },
      DEFAULT_DATE_REQUEST,
      777,
    );
    expect(built.setup.signals_a).toEqual(sheetSignals(characterSheet(ocChar!)));
    expect(built.input.a.signals).toEqual(built.setup.signals_a);
  });
});

describe("memory-as-behavior — replays are reproducible from the snapshot", () => {
  it("Sliding Doors returns the identical alternate before and after the character's memory drifts", async () => {
    const creator = newUserCookie();
    const oc = await makeOc(creator);
    await api.putSoul(oc.id, { values: "warm and curious" }, creator); // base signals non-zero

    // Real engine (no forced outcome) so the stored box score + snapshot are genuine; narration scripted so
    // the inline job succeeds (conversation/afterglow are off in tests).
    scriptedModel([episodeJson()]);
    const episode = await (await api.createEpisode({ character_id: oc.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    expect(episode.status).toBe("ready");

    const before = await slidingDoors(t.db, episode.id, userIdOf(creator), "bolder");
    expect(before).not.toBeNull();

    // Drift the character's memory hard. This changes what the LIVE effective signals would be, but must NOT
    // change a replay of this past date — the replay reads the signals snapshot stored on the episode.
    await setMemoryDelta(oc.id, { warmth: 0.15, openness: 0.15, guardedness: 0.15, humor: 0.15 });

    const after = await slidingDoors(t.db, episode.id, userIdOf(creator), "bolder");
    expect(after).toEqual(before);
  });

  it("still replays a pre-snapshot episode (setup without signals_*) by falling back to the soul", async () => {
    const creator = newUserCookie();
    const oc = await makeOc(creator);
    const oldSetup = {
      autonomy: "balanced", strategy: "genuine_chemistry", agenda_a: "find_adventurous", agenda_b: "find_adventurous",
      game_budget_a: 25, game_budget_b: 25, producer: "a_hard_question", venue: "rooftop_bar", format: "classic",
    };
    const boxScore = {
      chemistry: { start: 50, delta: 0, final: 50 }, attraction: { start: 48, delta: 0, final: 48 },
      trust: { start: 45, delta: 0, final: 45 }, awkwardness: { start: 40, delta: 0, final: 40 },
    };
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                             drama_question, drama_answer, seed, box_score, sides, setup, status)
       values ('old-ep', $1, $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'leaves_first', 'neither',
               4242, $4::jsonb, $5::jsonb, $6::jsonb, 'ready')`,
      [userIdOf(creator), oc.id, HOUSE_PARTNER_ID, JSON.stringify(boxScore), JSON.stringify([so(), so()]), JSON.stringify(oldSetup)],
    );

    const result = await slidingDoors(t.db, "old-ep", userIdOf(creator), "safer");
    expect(result).not.toBeNull();
    expect(result!.base.ending).toBe("friends");
  });
});
