// Data plan Tier 1, part two (David, 2026-10-22): choices kept as a history instead of overwritten (predictions,
// nudges, reviews, consent), lines that didn't go in kept as drafts (with a safety filter's catch never stored), and an
// owner's Sliding Doors runs kept as counterfactuals — while the chaos replay a watch party polls is never stored.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as predict } from "@/app/api/predictions/route";
import { deleteAccount, exportAccount } from "@/lib/account";
import { registerAccount } from "@/lib/auth";
import { clearNudge, setNudge } from "@/lib/between-dates";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { setMlConsent } from "@/lib/ml-consent";
import { reviewCharacter } from "@/lib/reviews";
import { chaosReplay, slidingDoors } from "@/lib/simulation";
import { logTurnDraft, TURN_DRAFTS_PER_EPISODE } from "@/lib/turn-drafts";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const history = async (userId: string) =>
  (await t.db.query<{ kind: string; value: Any }>(`select kind, value from choice_history where user_id = $1 order by id`, [userId])).rows;

/** An owner's date with a house character, booked through the real route (fixed outcome unless told otherwise). */
async function bookedDate(o: { realEngine?: boolean } = {}) {
  const cookie = newUserCookie();
  const owner = userIdOf(cookie);
  const character = await (await api.createCharacter(validCharacter(), cookie)).json();
  if (!o.realEngine) scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, cookie);
  if (res.status !== 200) throw new Error(`booking failed: ${res.status}`);
  const id = (await t.db.query<{ id: string }>(`select id from episodes where character_a = $1 or character_b = $1`, [character.id])).rows[0].id;
  return { cookie, owner, character: character.id as string, episode: id };
}

describe("choice_history: every change, not just the latest", () => {
  it("a prediction changed twice: two history rows, still one prediction", async () => {
    const { episode } = await bookedDate();
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [episode]);
    const fan = newUserCookie();
    const send = (pick: string) => predict(new Request(`${BASE_URL}/api/predictions`, { method: "POST", headers: { cookie: fan, "content-type": "application/json" }, body: JSON.stringify({ episode_id: episode, pick }) }));
    expect((await send("second_date")).status).toBeLessThan(300);
    expect((await send("disaster")).status).toBeLessThan(300);
    expect((await t.db.query(`select 1 from predictions where episode_id = $1`, [episode])).rows).toHaveLength(1);
    expect((await history(userIdOf(fan))).map((h) => [h.kind, h.value.pick])).toEqual([
      ["prediction", "second_date"],
      ["prediction", "disaster"],
    ]);
  });

  it("a nudge set, replaced and cleared; a review edited; a consent decided — each kept", async () => {
    const { owner, character } = await bookedDate();
    expect((await setNudge(t.db, owner, character, HOUSE_PARTNER_ID, "Ask about the lighthouse.")).ok).toBe(true);
    await setNudge(t.db, owner, character, HOUSE_PARTNER_ID, "Order the soup.");
    await clearNudge(t.db, owner, character, HOUSE_PARTNER_ID);
    await clearNudge(t.db, owner, character, HOUSE_PARTNER_ID); // nothing left to clear: no row
    expect((await history(owner)).map((h) => h.kind)).toEqual(["nudge", "nudge", "nudge_cleared"]);

    const critic = userIdOf(newUserCookie());
    await reviewCharacter(t.db, critic, character, { stars: 3 }, "web");
    await reviewCharacter(t.db, critic, character, { stars: 5, body: "Grew on me." }, "web");
    expect((await history(critic)).map((h) => h.value.stars)).toEqual([3, 5]);

    await registerAccount(t.db, owner, `hist${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
    await setMlConsent(t.db, owner, true);
    await setMlConsent(t.db, owner, false);
    expect((await history(owner)).filter((h) => h.kind === "ml_consent").map((h) => h.value.granted)).toEqual([true, false]);

    // In the owner's export; gone with the account.
    expect((await exportAccount(t.db, owner)).choice_history.length).toBe(5);
    await deleteAccount(t.db, owner);
    expect(await history(owner)).toHaveLength(0);
  });
});

describe("turn_drafts: lines that didn't go in", () => {
  it("caps rows per episode and text per row; a filtered line's text is never stored", async () => {
    const { episode } = await bookedDate();
    await logTurnDraft(t.db, { episodeId: episode, turnIndex: 0, side: "a", source: "agent_refused", reason: "filtered", rejected: null });
    for (let i = 0; i < TURN_DRAFTS_PER_EPISODE + 5; i++) {
      await logTurnDraft(t.db, { episodeId: episode, turnIndex: i, side: "b", source: "critic", reason: "x".repeat(400), rejected: "y".repeat(900) });
    }
    const rows = (await t.db.query<Any>(`select reason, rejected from turn_drafts where episode_id = $1 order by id`, [episode])).rows;
    expect(rows).toHaveLength(TURN_DRAFTS_PER_EPISODE);
    expect(rows[0].rejected).toBeNull();
    expect(rows[1].rejected).toHaveLength(600);
    expect(rows[1].reason).toHaveLength(300);
  });

  it("an agent's refused line and its check_only try are kept, with why", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "drafts-test" } } }, ctx);
    const session = { sessionId: ctx.issuedSessionId };
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session)) as Any).result;
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }))).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }))).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b })).structuredContent.step;
    const good = { dialogue: "So what's the strangest map you've ever drawn?", action: "", emotion: "curious", interest_signal: 0.6 };
    await call("submit_own_date_step", { episode_id: step.episode_id, output: good, check_only: true });
    // No dialogue at all: refused as the wrong shape, and with no parsed line there's no text to keep.
    await call("submit_own_date_step", { episode_id: step.episode_id, output: { action: "waves", emotion: "shy" } });
    const rows = (await t.db.query<Any>(`select source, reason, rejected, turn_index from turn_drafts where episode_id = $1 order by id`, [step.episode_id])).rows;
    expect(rows).toEqual([
      { source: "agent_check", reason: "passed_check", rejected: good.dialogue, turn_index: 0 },
      expect.objectContaining({ source: "agent_refused", rejected: null, turn_index: 0 }),
    ]);
  });
});

describe("episode_variations: an owner's Sliding Doors runs, kept", () => {
  it("saves one row per change (asking again counts), replays faithfully, and stores no cue word", async () => {
    const { owner, episode } = await bookedDate({ realEngine: true });
    const first = await slidingDoors(t.db, episode, owner, "bolder");
    expect(first).not.toBeNull();
    await slidingDoors(t.db, episode, owner, "bolder");
    await slidingDoors(t.db, episode, owner, "long_game");
    const rows = (await t.db.query<Any>(`select * from episode_variations where varies_episode_id = $1 order by variation`, [episode])).rows;
    expect(rows.map((r: Any) => [r.variation, r.requests])).toEqual([
      ["bolder", 2],
      ["long_game", 1],
    ]);
    // Booked under the real engine: the replay of the unchanged setup reproduces the engine's own ending.
    expect(rows.every((r: Any) => r.faithful === true)).toBe(true);
    expect(rows[0].alt_ending).toBe(first!.alternate.ending);
    for (const s of rows[0].alt_sides) expect(typeof s.dealbreaker_hit).toBe("boolean");
  });

  it("the chaos replay a watch party polls is never stored", async () => {
    const { episode } = await bookedDate({ realEngine: true });
    expect(await chaosReplay(t.db, episode, "bolder")).not.toBeNull();
    expect((await t.db.query(`select 1 from episode_variations`)).rows).toHaveLength(0);
  });
});
