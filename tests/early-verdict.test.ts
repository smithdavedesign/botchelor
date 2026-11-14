/**
 * The early verdict (the 2026-11-14 core plan, PR3): the ending is saved the moment the characters' own answers have
 * weighed in, before the recap, afterglow and reflections are written, so the creator's filming stage can show the verdict
 * card 30-60 s before the date is ready. lib/pipeline.ts onOutcome → lib/jobs.ts writes ending + setup.ending_final while
 * the date is still 'generating'; lib/game.ts shows `ending_final` to the creator only. No paid calls: scripted models.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setChoicesAskedForTests } from "@/lib/choices";
import type { Db } from "@/lib/db";
import { fixedEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import { getEpisodeView } from "@/lib/game";
import { runGenerationJob, setInlineGenerationForTests } from "@/lib/jobs";
import type { ChatMessage, Model } from "@/lib/model";
import { generateDate } from "@/lib/pipeline";
import { CONVERSATION_TURNS } from "@/lib/rules";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, planJson, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

const userText = (m: ChatMessage[]) => m.filter((x) => x.role === "user").map((x) => x.content).join("\n");
const line = (dialogue: string) => JSON.stringify({ dialogue, action: "", emotion: "flat", interest_signal: 0.3 });
function recording(outputs: string[]): Model & { seen: ChatMessage[][] } {
  const q = [...outputs];
  const seen: ChatMessage[][] = [];
  return {
    seen,
    async complete(m) {
      seen.push(m);
      const n = q.shift();
      if (n === undefined) throw new Error("out of outputs");
      return n;
    },
  };
}

describe("generateDate: onOutcome", () => {
  afterEach(() => setChoicesAskedForTests(false));

  it("is called once, after the characters' answers and before the recap, with the ending the date is written to", async () => {
    setChoicesAskedForTests(true);
    const built = buildEvalDate(EVAL_CASES.find((x) => x.id === "mira-dex")!);
    const decided = fixedEngine({ ending: "friends" }, { wishes: true }).decide(built.input, built.seed);
    const director = recording([planJson(), episodeJson()]);
    const date = Array.from({ length: CONVERSATION_TURNS }, (_, i) => line(`Line ${i}: and what do you do with a ferry, exactly?`));
    let asked = 0;
    const actor: Model = {
      async complete(messages) {
        if (messages[0].content.includes("Would you see them again?")) {
          asked++;
          return userText(messages).includes(`"you":{"name":"${built.characters[0].name}`) ? '{"see_again":"yes","reason":"I want more."}' : '{"see_again":"maybe","reason":"Ask me tomorrow."}';
        }
        const n = date.shift();
        if (!n) throw new Error("out of lines");
        return n;
      },
    };
    const calls: { ending: string; lines: number; askedByThen: number; directorCallsByThen: number }[] = [];
    const gen = await generateDate({ actor, director }, built, decided, {
      formatId: "classic",
      formatCtx: {},
      conversation: true,
      afterglow: false,
      reflection: false,
      wishes: true,
      engineVersion: 5,
      onOutcome: (outcome, transcript) => void calls.push({ ending: outcome.ending, lines: transcript.length, askedByThen: asked, directorCallsByThen: director.seen.length }),
    });
    expect(calls).toHaveLength(1);
    // Both sides had answered, and the director had only planned (the recap is its second call) when the verdict was given.
    expect(calls[0]).toMatchObject({ askedByThen: 2, directorCallsByThen: 1, lines: CONVERSATION_TURNS });
    expect(calls[0].ending).toBe(gen.outcome.ending);
    expect(director.seen).toHaveLength(2);
  });

  it("a failing onOutcome never costs the date", async () => {
    const built = buildEvalDate(EVAL_CASES.find((x) => x.id === "mira-dex")!);
    const decided = fixedEngine({ ending: "disaster" }).decide(built.input, built.seed);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gen = await generateDate({ actor: recording([episodeJson()]), director: recording([episodeJson()]) }, built, decided, {
      formatId: "classic",
      formatCtx: {},
      conversation: false,
      afterglow: false,
      reflection: false,
      onOutcome: () => {
        throw new Error("database away");
      },
    });
    expect(gen.outcome.ending).toBe("disaster");
    expect(gen.draft.scenes).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith("[pipeline] early verdict not saved:", "database away");
    warn.mockRestore();
  });
});

describe("the job writes the verdict early, the creator reads it, a stranger doesn't", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    // A real 'generating' row, as production has it (the harness generates inline by default).
    setInlineGenerationForTests(false);
  });
  afterEach(() => {
    setInlineGenerationForTests(true);
    vi.restoreAllMocks();
  });

  type Snap = { status: string; ending: string | null; ending_final: boolean | null; scenes: number };

  async function newDate(ending: "second_date" | "friends" | "disaster", outputs: Array<string | Error> = [episodeJson()]) {
    const creator = newUserCookie();
    const char = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending });
    scriptedModel(outputs);
    const res = await api.createEpisode({ character_id: char.id, partner_id: HOUSE_PARTNER_ID }, creator);
    expect(res.status).toBe(200);
    return { creator, ep: (await res.json()) as { id: string; status: string } };
  }

  /** The episode's row after every statement the job runs: the order things were written in. */
  function watching(episodeId: string): { db: Db; snaps: Snap[] } {
    const snaps: Snap[] = [];
    const peek = async () => {
      const r = await t.db.query<Snap>(
        `select status, ending, (setup->>'ending_final')::boolean as ending_final, jsonb_array_length(scenes) as scenes from episodes where id = $1`,
        [episodeId],
      );
      if (r.rows[0]) snaps.push(r.rows[0]);
    };
    const db: Db = {
      query: async (sql, params) => {
        const r = await t.db.query(sql, params);
        await peek();
        return r;
      },
      exec: (sql) => t.db.exec(sql),
    };
    return { db, snaps };
  }

  it("a generating date carries ending_final with its ending after the choices step and before it is ready; the final write still wins", async () => {
    const { creator, ep } = await newDate("second_date");
    expect(ep.status).toBe("generating");
    const { db, snaps } = watching(ep.id);

    await runGenerationJob(db, ep.id);

    const early = snaps.findIndex((s) => s.ending_final === true);
    expect(early).toBeGreaterThan(-1);
    // Decided while still filming, with no recap yet: that is what the stage shows the card from.
    expect(snaps[early]).toMatchObject({ status: "generating", ending: "second_date", scenes: 0 });
    expect(snaps.slice(0, early).every((s) => s.status === "generating" && !s.ending_final)).toBe(true);
    const readyAt = snaps.findIndex((s) => s.status === "ready");
    expect(readyAt).toBeGreaterThan(early);
    // The finished date's write: everything, on the same ending.
    const ready = await (await api.getEpisode(ep.id, creator)).json();
    expect(ready).toMatchObject({ status: "ready", ending: "second_date" });
    expect(ready.scenes).toHaveLength(3);
    // `ending_final` is a word for a date still being written; a ready date's ending is always final.
    expect(ready).not.toHaveProperty("ending_final");
  });

  it("a failed job behaves as before: the early write happens, then the date is deleted and given back", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { creator, ep } = await newDate("friends", ["bad json", "still bad"]); // the recap fails both attempts
    const { db, snaps } = watching(ep.id);

    await runGenerationJob(db, ep.id);

    expect(snaps.some((s) => s.status === "generating" && s.ending_final === true)).toBe(true);
    expect(await t.count("episodes")).toBe(0);
    expect(await t.count("generation_jobs")).toBe(0);
    expect(await t.count("free_episode_usage", `user_id = '${userIdOf(creator)}' and used = 1`)).toBe(0);
  });

  it("the creator reads ending and ending_final while generating; a stranger and a signed-out reader see neither", async () => {
    const { creator, ep } = await newDate("disaster");
    const stranger = userIdOf(newUserCookie());

    // Booked, not yet decided for good: the creator sees the booked ending, but nothing says it will stand.
    const booked = await getEpisodeView(t.db, ep.id, userIdOf(creator));
    expect(booked).toMatchObject({ status: "generating", is_creator: true, ending: "disaster" });
    expect(booked).not.toHaveProperty("ending_final");

    // What the job writes at the choices step (lib/jobs.ts onOutcome).
    await t.db.query(`update episodes set setup = coalesce(setup, '{}'::jsonb) || '{"ending_final":true}'::jsonb where id = $1 and status = 'generating'`, [ep.id]);
    const mine = await getEpisodeView(t.db, ep.id, userIdOf(creator));
    expect(mine).toMatchObject({ status: "generating", ending: "disaster", ending_final: true });
    // The route the stage polls says the same.
    expect(await (await api.getEpisode(ep.id, creator)).json()).toMatchObject({ ending: "disaster", ending_final: true });

    for (const viewer of [stranger, null]) {
      const theirs = await getEpisodeView(t.db, ep.id, viewer);
      expect(theirs).toMatchObject({ status: "generating", is_creator: false, revealed: false });
      expect(theirs).not.toHaveProperty("ending");
      expect(theirs).not.toHaveProperty("ending_final");
      expect(theirs).not.toHaveProperty("transcript");
    }
  });
});
