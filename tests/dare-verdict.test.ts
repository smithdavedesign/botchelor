import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { askDareVerdict, judgeDare, judgePendingDares, verdictPrompt, VERDICT_LINES } from "@/lib/dare-verdict";
import { dareBoard, dareChoices, daredOf, dareReveal, voteDare } from "@/lib/dares";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, Model } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { playVotedSituation, situationPair, utcDay } from "@/lib/situations";
import { episodeJson, scriptedModel, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from watch_parties");
  setSeasonCastForTests(HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id));
});
afterEach(() => setSeasonCastForTests(null));

const DAY = new Date("2026-11-01T15:00:00Z");
const NEXT = new Date("2026-11-02T00:20:00Z");
const day = utcDay(DAY);

/** A model that answers every call with `reply`, and remembers what it was asked. */
const answering = (reply: string | Error) => {
  const calls: ChatMessage[][] = [];
  const model: Model = {
    async complete(messages) {
      calls.push(messages);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { model, calls };
};

/** Plays yesterday's dare night (the harness's judge is off, so it takes the roll), then clears the verdict to re-judge. */
async function dareNight() {
  const dare = dareChoices(day)[0];
  await voteDare(t.db, "fan-a", dare.id, DAY);
  scriptedModel([episodeJson()]);
  const played = await playVotedSituation(t.db, NEXT);
  if (!played.played) throw new Error(`not played: ${played.reason}`);
  const night = (await t.db.query<{ episode_id: string; verdict: string | null; verdict_source: string | null }>(`select episode_id, verdict, verdict_source from dare_nights`)).rows[0];
  return { dare, night, dared: daredOf(day, situationPair(day)!) };
}

describe("the dare verdict, read from the date", () => {
  it("parses the three answers, fenced or bare, and refuses anything else", async () => {
    const lines = [{ dialogue: "I'll order for both of us.", action: "waves at the waiter" }];
    expect(await askDareVerdict(answering('{"verdict":"went_through"}').model, "Ana", "Order for both.", lines)).toBe("went_through");
    expect(await askDareVerdict(answering('```json\n{"verdict": "sort_of"}\n```').model, "Ana", "Order for both.", lines)).toBe("sort_of");
    expect(await askDareVerdict(answering("chickened_out").model, "Ana", "Order for both.", lines)).toBe("chickened_out");
    expect(await askDareVerdict(answering('{"verdict":"yes"}').model, "Ana", "Order for both.", lines)).toBeNull();
    expect(await askDareVerdict(answering(new Error("429")).model, "Ana", "Order for both.", lines)).toBeNull();
    // No lines: nothing to judge, no call.
    const idle = answering('{"verdict":"went_through"}');
    expect(await askDareVerdict(idle.model, "Ana", "Order for both.", [])).toBeNull();
    expect(idle.calls).toHaveLength(0);
  });

  it("keeps the prompt small: the dare and at most VERDICT_LINES of the dared side's lines", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ dialogue: `line ${i} ${"x".repeat(400)}`, action: "" }));
    const prompt = verdictPrompt("Ana", "Order for both.", many);
    expect(prompt).toContain("Order for both.");
    expect(prompt).toContain(`${VERDICT_LINES}. "line ${VERDICT_LINES - 1}`);
    expect(prompt).not.toContain(`line ${VERDICT_LINES} `);
    expect(prompt.length).toBeLessThan(5_000);
  });

  it("the night's date gets its verdict once, from the dared side's own lines", async () => {
    const { dare, night, dared } = await dareNight();
    // The harness's judge is off: the night took the engine's roll, so it always has a verdict.
    expect(night.verdict_source).toBe("roll");
    expect(["went_through", "chickened_out"]).toContain(night.verdict);

    await t.db.query(`update dare_nights set verdict = null, verdict_source = null`);
    // Give the date lines on both sides: only the dared side's reach the check.
    const isA = (await t.db.query<{ a: string }>(`select character_a as a from episodes where id = $1`, [night.episode_id])).rows[0].a === dared;
    const mine = isA ? "a" : "b";
    const theirs = isA ? "b" : "a";
    const transcript = [
      { side: mine, act: 0, dialogue: "I'm ordering for both of us. Trust me.", action: "", emotion: "", interest: 0.6 },
      { side: theirs, act: 0, dialogue: "THEIR-SIDE-ONLY line.", action: "", emotion: "", interest: 0.5 },
    ];
    await t.db.query(`update episodes set transcript = $2::jsonb where id = $1`, [night.episode_id, JSON.stringify(transcript)]);
    const judge = answering('{"verdict":"sort_of"}');
    expect(await judgeDare(t.db, day, { model: judge.model })).toEqual({ day, verdict: "sort_of", source: "model" });
    const asked = judge.calls[0].map((m) => m.content).join("\n");
    expect(asked).toContain(dare.text);
    expect(asked).toContain("ordering for both of us");
    expect(asked).not.toContain("THEIR-SIDE-ONLY");

    // Stored once: a second judge doesn't call or change it.
    const again = answering('{"verdict":"went_through"}');
    expect(await judgeDare(t.db, day, { model: again.model })).toBeNull();
    expect(again.calls).toHaveLength(0);

    // Revealed only once the date airs, on the episode page and the next day's card.
    expect((await dareBoard(t.db, "fan-a", new Date("2026-11-02T09:00:00Z")))!.last).toMatchObject({ aired: false, verdict: null, followed: null });
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [night.episode_id]);
    expect(await dareReveal(t.db, night.episode_id)).toMatchObject({ verdict: "sort_of", followed: null });
    expect((await dareBoard(t.db, "fan-a", new Date("2026-11-02T09:00:00Z")))!.last).toMatchObject({ aired: true, verdict: "sort_of" });
  });

  it("falls back to the roll when the check fails, and the hourly backstop judges a night left without one", async () => {
    const { night } = await dareNight();
    const rolled = night.verdict;
    await t.db.query(`update dare_nights set verdict = null, verdict_source = null`);
    await t.db.query(
      `update episodes set transcript = '[{"side":"a","act":0,"dialogue":"Hi.","action":"","emotion":"","interest":0.5},{"side":"b","act":0,"dialogue":"Hello.","action":"","emotion":"","interest":0.5}]'::jsonb where id = $1`,
      [night.episode_id],
    );
    expect(await judgePendingDares(t.db, { model: answering(new Error("down")).model })).toEqual([{ day, verdict: rolled, source: "roll" }]);
    expect(await judgePendingDares(t.db, { model: answering('{"verdict":"went_through"}').model })).toEqual([]);
  });

  it("an older night with no stored verdict still reads the roll", async () => {
    const { night } = await dareNight();
    await t.db.query(`update dare_nights set verdict = null, verdict_source = null`);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [night.episode_id]);
    const reveal = (await dareReveal(t.db, night.episode_id))!;
    expect(reveal.verdict).toBe(night.verdict);
    expect(reveal.followed).toBe(night.verdict === "went_through");
  });
});
