import { readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { POINTS_PER_CORRECT_PICK, WATCH_PHASES } from "@/lib/rules";
import {
  castVote,
  createPremiereParty,
  createTemplateParty,
  getRoomState,
  guestHandle,
  postMessage,
  reportMessage,
  syncRoom,
  toggleReaction,
  watchClock,
} from "@/lib/watch";
import { setConversationEnabledForTests } from "@/lib/conversation";
import {
  api,
  episodeJson,
  newUserCookie,
  scriptOutcome,
  scriptedModel,
  setupEpisode,
  startTestDb,
  userIdOf,
} from "./helpers";

// A premiere starts at this fixed instant, so every phase is reachable with an explicit `now`.
const T0 = new Date("2026-06-01T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const phaseAt = (id: string) => WATCH_PHASES.find((p) => p.id === id)!.at;

const A = HOUSE_CHARACTERS[0].id;
const B = HOUSE_CHARACTERS[1].id;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/** A premiere over a fresh host episode, pinned to T0. Returns the party id and the episode/host. */
async function premiereAtT0(ending: Parameters<typeof setupEpisode>[0] = "second_date") {
  const { creator, episode } = await setupEpisode(ending);
  const result = await createPremiereParty(t.db, episode.id, userIdOf(creator), T0);
  if (!result.ok) throw new Error(`premiere setup failed: ${result.error}`);
  return { partyId: result.id, episode, creator, hostId: userIdOf(creator) };
}

/** A template over a house-vs-house date. Scripts the engine + model so the outcome is known. */
async function templateRoom(ending: Parameters<typeof setupEpisode>[0] = "second_date") {
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const result = await createTemplateParty(t.db, A, B);
  if (!result || !result.ok) throw new Error("template setup failed");
  return result.id;
}

async function backdate(partyId: string, secondsAgo: number) {
  await t.db.query(
    `update watch_parties set starts_at = now() - ($2::int * interval '1 second') where id = $1`,
    [partyId, secondsAgo],
  );
}

describe("M9: the turn-by-turn conversation in the room", () => {
  const TRANSCRIPT = [
    { side: "a", act: 0, dialogue: "A act0", action: "", emotion: "", interest: 0.5 },
    { side: "b", act: 0, dialogue: "B act0", action: "", emotion: "", interest: 0.5 },
    { side: "a", act: 1, dialogue: "A act1", action: "", emotion: "", interest: 0.5 },
    { side: "b", act: 1, dialogue: "B act1", action: "", emotion: "", interest: 0.5 },
    { side: "a", act: 2, dialogue: "A act2 ENDING", action: "", emotion: "", interest: 0.5 },
    { side: "b", act: 2, dialogue: "B act2 ENDING", action: "", emotion: "", interest: 0.5 },
  ];

  it("unlocks turns on the same clock as the scenes, and never shows the final act before the decision", async () => {
    const { partyId, episode } = await premiereAtT0("second_date");
    await t.db.query(`update episodes set transcript = $2::jsonb where id = $1`, [episode.id, JSON.stringify(TRANSCRIPT)]);

    expect((await getRoomState(t.db, partyId, null, at(phaseAt("preshow"))))!.turns).toHaveLength(0);
    expect((await getRoomState(t.db, partyId, null, at(phaseAt("act1"))))!.turns).toHaveLength(2);

    const act2 = (await getRoomState(t.db, partyId, null, at(phaseAt("act2"))))!;
    expect(act2.turns).toHaveLength(4);
    expect(act2.turns.some((x) => x.dialogue.includes("ENDING"))).toBe(false); // final-act turns are the ending: hidden

    const decision = (await getRoomState(t.db, partyId, null, at(phaseAt("decision"))))!;
    expect(decision.turns).toHaveLength(6);
    expect(decision.turns.filter((x) => x.act === 2)).toHaveLength(2);
  });

  it("stores a transcript on a template room when the conversation is on", async () => {
    setConversationEnabledForTests(true);
    try {
      scriptOutcome({ ending: "second_date" });
      const turn = JSON.stringify({ dialogue: "a line", action: "answers", emotion: "curious", interest_signal: 0.5 });
      // One narration output, then one per conversation turn.
      scriptedModel([episodeJson(), turn, turn, turn, turn, turn, turn, turn, turn]);
      const result = await createTemplateParty(t.db, A, B);
      if (!result || !result.ok) throw new Error("template setup failed");
      const row = (
        await t.db.query<{ transcript: { act: number }[] }>(
          `select e.transcript from episodes e join watch_parties w on w.episode_id = e.id where w.id = $1`,
          [result.id],
        )
      ).rows[0];
      expect(row.transcript).toHaveLength(8);
    } finally {
      setConversationEnabledForTests(false);
    }
  });
});

describe("watchClock: the phase is a pure function of the shared clock", () => {
  it("has not started with no start time", () => {
    const clock = watchClock(null, at(0));
    expect(clock.started).toBe(false);
    expect(clock.phase).toBe("preshow");
  });

  it("advances through every phase in order as the clock runs", () => {
    for (const phase of WATCH_PHASES) {
      expect(watchClock(T0, at(phase.at)).phase).toBe(phase.id);
    }
  });

  it("gives the same phase for the same start and now (reproducible, no realtime server)", () => {
    expect(watchClock(T0, at(120)).phase_index).toBe(watchClock(T0, at(120)).phase_index);
    expect(watchClock(T0, at(phaseAt("decision"))).phase).toBe("decision");
    expect(watchClock(T0, at(99999)).ended).toBe(true);
  });
});

describe("createPremiereParty: host-only, one room per episode", () => {
  it("lets the host create a room and is idempotent", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const first = await createPremiereParty(t.db, episode.id, userIdOf(creator), T0);
    const second = await createPremiereParty(t.db, episode.id, userIdOf(creator), T0);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.id).toBe(second.id);
    expect(await t.count("watch_parties", `episode_id = '${episode.id}'`)).toBe(1);
  });

  it("refuses a non-host (403) and an unknown episode (404)", async () => {
    const { episode } = await setupEpisode("friends");
    const stranger = await createPremiereParty(t.db, episode.id, userIdOf(newUserCookie()), T0);
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.status).toBe(403);
    const missing = await createPremiereParty(t.db, "nope", userIdOf(newUserCookie()), T0);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);
  });

  it("is reachable through the host's route, and 403 for everyone else", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const ok = await api.createWatchParty(episode.id, {}, creator);
    expect(ok.status).toBe(200);
    expect((await ok.json()).room_path).toMatch(/^\/watch\//);
    const denied = await api.createWatchParty(episode.id, {}, newUserCookie());
    expect(denied.status).toBe(403);
  });
});

describe("content unlocks in order, never early", () => {
  it("reveals goals, then acts, then the twist, then the ending as the clock advances", async () => {
    const { partyId } = await premiereAtT0("second_date");

    const preshow = (await getRoomState(t.db, partyId, null, at(phaseAt("preshow"))))!;
    expect(preshow.acts).toHaveLength(0);
    expect(preshow.show_twist).toBe(false);
    expect(preshow.show_ending).toBe(false);
    expect(preshow.goals).toHaveLength(2);
    expect(preshow.predictions_open).toBe(true);

    expect((await getRoomState(t.db, partyId, null, at(phaseAt("act1"))))!.acts).toHaveLength(1);

    const act2 = (await getRoomState(t.db, partyId, null, at(phaseAt("act2"))))!;
    expect(act2.acts).toHaveLength(2);
    expect(act2.challenge).toBeTruthy();

    expect((await getRoomState(t.db, partyId, null, at(phaseAt("twist"))))!.show_twist).toBe(true);

    const decision = (await getRoomState(t.db, partyId, null, at(phaseAt("decision"))))!;
    expect(decision.acts).toHaveLength(3);
    expect(decision.show_ending).toBe(true);
    expect(decision.ending).toBe("second_date");
    expect(decision.predictions_open).toBe(false);
  });

  it("never leaks the ending before the decision, whatever the audience does", async () => {
    const { partyId } = await premiereAtT0("disaster");
    const viewer = newUserCookie();
    // A flood of audience input must not advance or change the stored outcome.
    await toggleReaction(t.db, partyId, userIdOf(viewer), "🍿");
    await castVote(t.db, partyId, userIdOf(viewer), "chemistry", "yes", at(phaseAt("verdict")));
    const beforeDecision = (await getRoomState(t.db, partyId, userIdOf(viewer), at(phaseAt("twist"))))!;
    expect(beforeDecision.ending).toBeNull();
    expect(beforeDecision.finale).toBeNull();
    const afterDecision = (await getRoomState(t.db, partyId, userIdOf(viewer), at(phaseAt("decision"))))!;
    expect(afterDecision.ending).toBe("disaster");
  });
});

describe("template rooms: join and the date starts", () => {
  it("has no start time until the first viewer joins, then sets it once", async () => {
    const partyId = await templateRoom("friends");
    expect((await getRoomState(t.db, partyId, null))!.clock.started).toBe(false);

    const viewer = newUserCookie();
    const joined = (await syncRoom(t.db, partyId, userIdOf(viewer)))!;
    expect(joined.clock.started).toBe(true);
    expect(joined.clock.phase).toBe("preshow");

    const startedAt = (await t.db.query<{ starts_at: Date }>(`select starts_at from watch_parties where id = $1`, [partyId])).rows[0].starts_at;
    // A second join must not restart the clock.
    await syncRoom(t.db, partyId, userIdOf(newUserCookie()));
    const stillAt = (await t.db.query<{ starts_at: Date }>(`select starts_at from watch_parties where id = $1`, [partyId])).rows[0].starts_at;
    expect(new Date(stillAt).getTime()).toBe(new Date(startedAt).getTime());
  });

  it("shows the room in the lobby with a live watching count", async () => {
    const partyId = await templateRoom("second_date");
    await syncRoom(t.db, partyId, userIdOf(newUserCookie()));
    const res = await api.lobby();
    const rooms = (await res.json()).rooms as { id: string; kind: string; watching: number }[];
    const room = rooms.find((r) => r.id === partyId)!;
    expect(room.kind).toBe("template");
    expect(room.watching).toBeGreaterThanOrEqual(1);
  });
});

describe("the finale airs at the decision, and predictions resolve into points", () => {
  it("airs automatically once the clock reaches the decision — no manual step", async () => {
    const partyId = await templateRoom("second_date");
    const spectator = newUserCookie();
    // Predict before it airs (a template date has no human host to air it).
    expect((await api.predict({ episode_id: await episodeOf(partyId), pick: "second_date" }, spectator)).status).toBe(201);

    // Nudge the clock past the decision, then the heartbeat airs it.
    await backdate(partyId, phaseAt("wrap") + 10);
    const state = (await syncRoom(t.db, partyId, userIdOf(spectator)))!;
    expect(state.revealed).toBe(true);
    expect(state.show_ending).toBe(true);

    expect((await (await api.me(spectator)).json()).points).toBe(POINTS_PER_CORRECT_PICK);
  });

  it("does not air before the decision", async () => {
    const { partyId, episode } = await premiereAtT0("friends");
    await backdate(partyId, phaseAt("verdict")); // before the decision
    await syncRoom(t.db, partyId, userIdOf(newUserCookie()));
    const revealed = (await t.db.query<{ r: boolean }>(`select revealed_at is not null as r from episodes where id = $1`, [episode.id])).rows[0].r;
    expect(revealed).toBe(false);
  });
});

describe("reactions: one of each per viewer, toggled", () => {
  it("toggles on and off and counts distinct viewers", async () => {
    const { partyId } = await premiereAtT0();
    const one = newUserCookie();
    const two = newUserCookie();

    const on = await toggleReaction(t.db, partyId, userIdOf(one), "😂");
    expect(on).toMatchObject({ ok: true, count: 1, mine: true });

    const two_reacts = await toggleReaction(t.db, partyId, userIdOf(two), "😂");
    expect(two_reacts).toMatchObject({ ok: true, count: 2 });

    const off = await toggleReaction(t.db, partyId, userIdOf(one), "😂");
    expect(off).toMatchObject({ ok: true, count: 1, mine: false });
  });
});

describe("audience polls are opinion, not control", () => {
  it("accepts a chemistry vote only inside its window, and hides the split until the decision", async () => {
    const { partyId } = await premiereAtT0();
    const viewer = newUserCookie();

    expect((await castVote(t.db, partyId, userIdOf(viewer), "chemistry", "yes", at(phaseAt("preshow")))).ok).toBe(false);
    expect((await castVote(t.db, partyId, userIdOf(viewer), "chemistry", "yes", at(phaseAt("verdict")))).ok).toBe(true);

    const atVerdict = (await getRoomState(t.db, partyId, userIdOf(viewer), at(phaseAt("verdict"))))!;
    expect(atVerdict.chemistry.total).toBe(1); // participation is visible…
    expect(atVerdict.chemistry.options.every((o) => o.count === 0)).toBe(true); // …but the split is not.
    expect(atVerdict.chemistry.my_choice).toBe("yes");

    const atDecision = (await getRoomState(t.db, partyId, userIdOf(viewer), at(phaseAt("decision"))))!;
    expect(atDecision.chemistry.show_results).toBe(true);
    expect(atDecision.chemistry.options.find((o) => o.id === "yes")!.count).toBe(1);
    expect(atDecision.chemistry.leading).toBe("yes");
  });

  it("the question poll opens during the challenge and closes at the verdict", async () => {
    const { partyId } = await premiereAtT0();
    const viewer = userIdOf(newUserCookie());
    expect((await castVote(t.db, partyId, viewer, "question", "truth", at(phaseAt("act2")))).ok).toBe(true);
    expect((await castVote(t.db, partyId, viewer, "question", "dare", at(phaseAt("verdict")))).ok).toBe(false);
  });

  it("a chemistry vote never earns points", async () => {
    const { partyId } = await premiereAtT0("second_date");
    const voter = newUserCookie();
    await castVote(t.db, partyId, userIdOf(voter), "chemistry", "yes", at(phaseAt("verdict")));
    await backdate(partyId, phaseAt("wrap") + 10);
    await syncRoom(t.db, partyId, userIdOf(voter)); // airs the finale
    // The voter never predicted, so voting on chemistry alone scores nothing.
    expect((await (await api.me(voter)).json()).points).toBe(0);
  });
});

describe("chat moderation: before thousands of viewers", () => {
  it("rejects empty and over-long messages", async () => {
    const { partyId } = await premiereAtT0();
    const u = userIdOf(newUserCookie());
    expect((await postMessage(t.db, partyId, u, "   ", at(10))).ok).toBe(false);
    expect((await postMessage(t.db, partyId, u, "x".repeat(400), at(10))).ok).toBe(false);
  });

  it("enforces slow mode between a viewer's messages", async () => {
    const { partyId } = await premiereAtT0();
    const u = userIdOf(newUserCookie());
    expect((await postMessage(t.db, partyId, u, "first", at(10))).ok).toBe(true);
    const tooSoon = await postMessage(t.db, partyId, u, "second", at(12));
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error).toBe("slow_mode");
    expect((await postMessage(t.db, partyId, u, "later", at(20))).ok).toBe(true);
  });

  it("rate-limits a viewer who floods the room", async () => {
    const { partyId } = await premiereAtT0();
    const u = userIdOf(newUserCookie());
    // Twelve messages already sent 10s ago (within the 60s window, outside slow mode).
    for (let i = 0; i < 12; i++) {
      await t.db.query(
        `insert into watch_messages (id, party_id, user_id, handle, body, created_at)
         values ($1, $2, $3, 'guest', 'spam', now() - interval '10 seconds')`,
        [crypto.randomUUID(), partyId, u],
      );
    }
    const limited = await postMessage(t.db, partyId, u, "one more");
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error).toBe("rate_limited");
  });

  it("runs the content filter through the chat route (no real people, minors or sexual content)", async () => {
    const { partyId } = await premiereAtT0();
    const res = await api.chat(partyId, "check out my onlyfans", newUserCookie());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("content_rejected");
  });

  it("hides a message after enough distinct reports and drops it from the room", async () => {
    const { partyId } = await premiereAtT0();
    const author = userIdOf(newUserCookie());
    const posted = await postMessage(t.db, partyId, author, "something spicy", at(10));
    expect(posted.ok).toBe(true);
    const id = posted.ok ? posted.id : "";

    await reportMessage(t.db, partyId, id, userIdOf(newUserCookie()));
    await reportMessage(t.db, partyId, id, userIdOf(newUserCookie()));
    expect((await getRoomState(t.db, partyId, null, at(10)))!.messages.some((m) => m.id === id)).toBe(true);
    const third = await reportMessage(t.db, partyId, id, userIdOf(newUserCookie()));
    expect(third.ok && third.hidden).toBe(true);
    expect((await getRoomState(t.db, partyId, null, at(10)))!.messages.some((m) => m.id === id)).toBe(false);
  });

  it("gives anonymous viewers a stable, friendly handle (never the raw id)", () => {
    const id = "9f8e7d6c-1234-4abc-8def-0123456789ab";
    expect(guestHandle(id)).toBe(guestHandle(id));
    expect(guestHandle(id)).not.toContain(id);
    expect(guestHandle("a")).not.toBe(guestHandle("b"));
  });
});

// A route-path guard, mirroring tests/routes.test.ts: no watch-party route may take money or move points.
describe("watch-party routes take no money and move no points (exit criterion)", () => {
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const APP_DIR = join(ROOT, "app");
  const MONEY = /pay|checkout|purchase|buy|billing|stripe|invoice|price|wallet|credit|coin|cash|withdraw|redeem|subscri|donat|tip(s)?(\/|$)/i;
  const TRANSFER = /points|transfer|send|gift|redeem|withdraw|balance|award|grant/i;
  const POINTS = /points|score|rank|leaderboard/i;

  it("has watch routes, and none of them look like money or points", () => {
    const files = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" }).filter(
      (f) => /(^|[\\/])route\.(ts|tsx)$/.test(f) && f.includes("watch"),
    );
    const paths = files.map((f) => "/" + dirname(f).split(sep).join("/"));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p, p).not.toMatch(MONEY);
      expect(p, p).not.toMatch(TRANSFER);
      expect(p, p).not.toMatch(POINTS);
    }
  });
});

/** The episode id behind a party (templates have no exposed episode elsewhere in tests). */
async function episodeOf(partyId: string): Promise<string> {
  return (await t.db.query<{ episode_id: string }>(`select episode_id from watch_parties where id = $1`, [partyId])).rows[0].episode_id;
}

describe("the chaos button (fair interactive theatre)", () => {
  it("accepts a chaos curveball during the challenge, and rejects it when the window is closed", async () => {
    const { partyId } = await premiereAtT0("friends");
    const voter = userIdOf(newUserCookie());
    expect((await castVote(t.db, partyId, voter, "chaos", "heat", at(phaseAt("act2")))).ok).toBe(true);
    expect((await castVote(t.db, partyId, voter, "chaos", "heat", at(phaseAt("preshow")))).ok).toBe(false);
  });

  it("reveals a non-canon chaos timeline at the decision; the real ending is untouched", async () => {
    const { partyId } = await premiereAtT0("friends");
    await castVote(t.db, partyId, userIdOf(newUserCookie()), "chaos", "heat", at(phaseAt("act2")));
    await castVote(t.db, partyId, userIdOf(newUserCookie()), "chaos", "heat", at(phaseAt("act2")));

    // During the challenge: votes open, no timeline yet.
    const mid = (await getRoomState(t.db, partyId, null, at(phaseAt("act2"))))!;
    expect(mid.chaos.open).toBe(true);
    expect(mid.chaos.timeline).toBeNull();

    // At the decision: the winning curveball's deterministic alternate appears (computed for an anonymous viewer).
    const decision = (await getRoomState(t.db, partyId, null, at(phaseAt("decision"))))!;
    expect(decision.chaos.open).toBe(false);
    expect(decision.chaos.timeline).not.toBeNull();
    expect(decision.chaos.timeline!.label).toContain("heat");
    expect(["second_date", "friends", "disaster"]).toContain(decision.chaos.timeline!.ending);
    // Predictions still resolve on the canonical ending, which the chaos vote never changed.
    expect(decision.ending).toBe("friends");
  });
});
