import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as dailyJob } from "@/app/api/jobs/daily/route";
import { BACKFILL_MAX_ATTEMPTS, backfillTranscripts } from "@/lib/backfill";
import { setConversationEnabledForTests } from "@/lib/conversation";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ModelError } from "@/lib/model";
import { CONVERSATION_TURNS, ENDING_LABELS } from "@/lib/rules";
import { createTemplateParty, listLobby, refreshLobby } from "@/lib/watch";
import { BASE_URL, episodeJson, planJson, scriptedModel, scriptOutcome, setupEpisode, startTestDb } from "./helpers";

const turnJson = (i: number) =>
  JSON.stringify({ dialogue: `Line ${i}: a safe, friendly thing to say.`, action: "asks", emotion: "curious", interest_signal: 0.5 });
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

describe("the showcase bar (template rooms are the shop window)", () => {
  const line = (dialogue: string) => JSON.stringify({ dialogue, action: "", emotion: "curious", interest_signal: 0.5 });
  // Quip ping-pong: no questions, the same words from both sides, every line the same length.
  const flat = Array.from({ length: CONVERSATION_TURNS }, () => line("Nice weather."));
  const alive = [
    "What brings you out on a night like this?",
    "Curiosity, mostly, and a friend who dared me. What about you?",
    "A dare too, sort of. Do you always say yes to dares?",
    "Only the ones with snacks involved. Do you?",
    "Snacks are my weakness. What's the strangest dare you've taken?",
    "I once sang shanties to an empty car park at two in the morning. The echo was incredible.",
    "That's oddly beautiful. Would you sing one now?",
    "Maybe after another round. You'd have to join the chorus.",
    "Deal, though I warn you my voice frightens seagulls.",
    "Then we'll practise somewhere gull-free. Same time next week?",
  ].map(line);

  it("a date under the bar gets one more take — same outcome — and the better take airs", async () => {
    setConversationEnabledForTests(true);
    scriptOutcome({ ending: "second_date" });
    const { calls } = scriptedModel([planJson(), ...flat, episodeJson(), planJson(), ...alive, episodeJson()]);
    const room = await createTemplateParty(t.db, HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id);
    if (!room?.ok) throw new Error("template setup failed");
    const { rows } = await t.db.query<{ transcript: { dialogue: string }[]; ending: string }>(
      `select e.transcript, e.ending from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`,
      [room.id],
    );
    expect(rows[0].transcript[0].dialogue).toBe("What brings you out on a night like this?");
    expect(rows[0].ending).toBe("second_date");
    expect(calls).toHaveLength(2 * (CONVERSATION_TURNS + 2));
  });

  it("a date that clears the bar airs on the first take (no extra calls)", async () => {
    setConversationEnabledForTests(true);
    scriptOutcome({ ending: "friends" });
    const { calls } = scriptedModel([planJson(), ...alive, episodeJson()]);
    const room = await createTemplateParty(t.db, HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id);
    expect(room?.ok).toBe(true);
    expect(calls).toHaveLength(CONVERSATION_TURNS + 2);
  });
});

describe("refreshLobby (daily)", () => {
  it("adds one fresh room with a full conversation per day, between two distinct house characters", async () => {
    setConversationEnabledForTests(true);
    scriptOutcome({ ending: "second_date" });
    scriptedModel([planJson(), ...turns(CONVERSATION_TURNS), episodeJson()]);
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
    // Two unusable plans → the rules plan (built from the STORED outcome), then the turns.
    const { calls } = scriptedModel(["{}", "{}", ...turns(CONVERSATION_TURNS)]);

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
      scriptedModel(["{}", "{}", new Error("model down"), new Error("model down")]); // rules plan; the first turn fails twice
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
    // The plan falls back to rules; then the newest date's first turn is refused twice with a 429.
    scriptedModel(["{}", "{}", new ModelError("model returned HTTP 429"), new ModelError("model returned HTTP 429")]);
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
    scriptedModel([planJson(), ...turns(CONVERSATION_TURNS), episodeJson()]);
    const res = await call({ authorization: `Bearer ${secret}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lobby.created).toBeTruthy();
    expect(body.backfill).toEqual({ filled: [], failed: [] });
  });
});
