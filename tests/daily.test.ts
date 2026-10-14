import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as dailyJob } from "@/app/api/jobs/daily/route";
import { BACKFILL_MAX_ATTEMPTS, backfillTranscripts } from "@/lib/backfill";
import { setConversationEnabledForTests } from "@/lib/conversation";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ModelError } from "@/lib/model";
import { CONVERSATION_TURNS, ENDING_LABELS } from "@/lib/rules";
import { createTemplateParty, listLobby, refreshLobby } from "@/lib/watch";
import { BASE_URL, episodeJson, scriptedModel, scriptOutcome, setupEpisode, startTestDb } from "./helpers";

const turnJson = (i: number) =>
  JSON.stringify({ dialogue: `A safe, friendly line number ${i}.`, action: "asks", emotion: "curious", interest_signal: 0.5 });
const turns = (n: number) => Array.from({ length: n }, (_, i) => turnJson(i));
const userText = (messages: { role: string; content: string }[]) => messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

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
});
afterEach(() => {
  setConversationEnabledForTests(false);
  vi.unstubAllEnvs();
});

const transcriptOf = async (episodeId: string) =>
  (await t.db.query<{ transcript: unknown[] }>(`select transcript from episodes where id = $1`, [episodeId])).rows[0].transcript;

describe("the lobby only offers rooms that play line by line", () => {
  it("hides an always-on room whose date has no conversation, and shows it once it has one", async () => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]); // conversation off: the room's date has no transcript
    const room = await createTemplateParty(t.db, HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id);
    if (!room?.ok) throw new Error("template setup failed");
    expect((await listLobby(t.db)).map((r) => r.id)).not.toContain(room.id);

    await t.db.query(
      `update episodes set transcript = $2::jsonb where id = (select episode_id from watch_parties where id = $1)`,
      [room.id, JSON.stringify([{ side: "a", act: 0, dialogue: "hi", action: "", emotion: "", interest: 0.5 }])],
    );
    expect((await listLobby(t.db)).map((r) => r.id)).toContain(room.id);
  });
});

describe("refreshLobby (daily)", () => {
  it("adds one fresh room with a full conversation per day, between two distinct house characters", async () => {
    setConversationEnabledForTests(true);
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson(), ...turns(CONVERSATION_TURNS)]);
    const now = new Date();
    const first = await refreshLobby(t.db, now);
    expect(first.created).toBeTruthy();

    const { rows } = await t.db.query<{ a: string; b: string; n: number }>(
      `select e.character_a a, e.character_b b, jsonb_array_length(e.transcript)::int n
         from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
      [first.created],
    );
    expect(rows[0].a).not.toBe(rows[0].b);
    expect(rows[0].n).toBe(CONVERSATION_TURNS);
    expect((await listLobby(t.db)).map((r) => r.id)).toContain(first.created);

    // A retried cron the same day is a no-op (no extra model calls, no second room).
    expect(await refreshLobby(t.db, now)).toEqual({ created: null, reason: "already_today" });
  });
});

describe("backfillTranscripts", () => {
  it("fills a missing conversation steered to the STORED ending, even if the engine would now decide otherwise", async () => {
    const { episode } = await setupEpisode("friends"); // stored ending: friends; conversation off → no transcript
    expect(await transcriptOf(episode.id)).toEqual([]);

    // The engine would now say "second date" — a backfill must ignore that and land on the stored ending.
    scriptOutcome({ ending: "second_date" });
    setConversationEnabledForTests(true);
    const { calls } = scriptedModel(turns(CONVERSATION_TURNS));

    const result = await backfillTranscripts(t.db, 5);
    expect(result).toEqual({ filled: [episode.id], failed: [] });
    expect(await transcriptOf(episode.id)).toHaveLength(CONVERSATION_TURNS);

    // The final act is steered to the stored ending; the re-decided one never appears.
    const finalAct = calls.slice(-2).map(userText).join("\n");
    expect(finalAct).toContain(ENDING_LABELS.friends);
    expect(finalAct).not.toContain(ENDING_LABELS.second_date);
    // Nothing that was scored changes.
    const stored = (await t.db.query<{ ending: string }>(`select ending from episodes where id = $1`, [episode.id])).rows[0];
    expect(stored.ending).toBe("friends");

    // A re-run finds nothing to do.
    expect(await backfillTranscripts(t.db, 5)).toEqual({ filled: [], failed: [] });
  });

  it("gives up on a date after BACKFILL_MAX_ATTEMPTS failures, so it stops costing calls", async () => {
    const { episode } = await setupEpisode("disaster");
    setConversationEnabledForTests(true);
    for (let i = 0; i < BACKFILL_MAX_ATTEMPTS; i++) {
      scriptedModel([new Error("model down"), new Error("model down")]); // the first turn fails both attempts
      expect((await backfillTranscripts(t.db, 5)).failed).toEqual([episode.id]);
    }
    scriptedModel([]); // any call now would throw "ran out of outputs"
    expect(await backfillTranscripts(t.db, 5)).toEqual({ filled: [], failed: [] });
    expect(await transcriptOf(episode.id)).toEqual([]);
  });

  it("a rate limit costs the date no try and ends the batch (the next run picks up there)", async () => {
    const older = await setupEpisode("friends");
    const newer = await setupEpisode("disaster");
    setConversationEnabledForTests(true);
    // The newest date's first turn is refused twice with a 429 (after the client's own backoff).
    scriptedModel([new ModelError("model returned HTTP 429"), new ModelError("model returned HTTP 429")]);
    const result = await backfillTranscripts(t.db, 5);
    expect(result).toEqual({ filled: [], failed: [], rate_limited: true }); // stopped: the older date wasn't tried
    const attempts = async (id: string) =>
      (await t.db.query<{ n: number }>(`select backfill_failures n from episodes where id = $1`, [id])).rows[0].n;
    expect(await attempts(newer.episode.id)).toBe(0);
    expect(await attempts(older.episode.id)).toBe(0);
  });

  it("does nothing while the conversation is switched off", async () => {
    await setupEpisode("friends");
    expect(await backfillTranscripts(t.db, 5)).toEqual({ filled: [], failed: [] });
  });
});

describe("GET /api/jobs/daily", () => {
  const call = (headers: Record<string, string> = {}) => dailyJob(new Request(`${BASE_URL}/api/jobs/daily?backfill=0`, { headers }));
  const secret = ["cron", "test", "secret", "0123456789"].join("-");

  it("is not a public surface: 404 without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await call()).status).toBe(404);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(404);
  });

  it("runs with Vercel Cron's bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    setConversationEnabledForTests(true);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), ...turns(CONVERSATION_TURNS)]);
    const res = await call({ authorization: `Bearer ${secret}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lobby.created).toBeTruthy();
    expect(body.backfill).toEqual({ filled: [], failed: [] });
  });
});
