// The data plan's privacy fixes (review of #666–#668/#676 on #678; docs/data-plan.md): nothing the data plan keeps
// outlives a forget or a delete, the soul-derived numbers go with the soul, and every kind of kept data is pruned on time.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivacySections } from "@/app/legal/sections";
import { deleteAccount, deleteCharacter, exportAccount, TRACE_SOUL_PATHS } from "@/lib/account";
import { setLineVote } from "@/lib/line-feedback";
import { pruneKeptData, RETENTION_DAYS } from "@/lib/retention";
import { slidingDoors } from "@/lib/simulation";
import { logTurnDraft } from "@/lib/turn-drafts";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

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
});

/** An owner's date with a house character, booked through the real route; the real engine unless told otherwise. */
async function bookedDate(o: { fixed?: boolean } = {}) {
  const cookie = newUserCookie();
  const owner = userIdOf(cookie);
  const character = (await (await api.createCharacter(validCharacter(), cookie)).json()).id as string;
  if (o.fixed) scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: character, partner_id: HOUSE_PARTNER_ID }, cookie);
  if (res.status !== 200) throw new Error(`booking failed: ${res.status}`);
  const ep = (await t.db.query<{ id: string; character_a: string; character_b: string }>(`select id, character_a, character_b from episodes where character_a = $1 or character_b = $1`, [character]))
    .rows[0];
  const side: "a" | "b" = ep.character_a === character ? "a" : "b";
  return { cookie, owner, character, episode: ep.id, side, other: (side === "a" ? "b" : "a") as "a" | "b", partner: side === "a" ? ep.character_b : ep.character_a };
}
const count = async (sql: string, params: unknown[]) => (await t.db.query(sql, params)).rows.length;
const episodeRow = async (id: string) => (await t.db.query<{ engine_trace: Any; setup: Any }>(`select engine_trace, setup from episodes where id = $1`, [id])).rows[0];
const at = (path: readonly string[], o: Any) => path.reduce((x, k) => (x == null ? undefined : x[k]), o);

/** Everything the data plan keeps about one date's characters, so a forget or delete has something to remove. */
async function keepEverything(d: Awaited<ReturnType<typeof bookedDate>>, fan: string) {
  const [lo, hi] = [d.character, d.partner].sort();
  await t.db.query(
    `insert into swipe_impressions (viewer, card, serve_id, rank, served_via) values ($1, $2, 'serve-1', 1, 'web'), ($2, $1, 'serve-2', 1, 'mcp')`,
    [d.character, d.partner],
  );
  await t.db.query(`insert into relationship_events (character_a, character_b, layer, from_stage, to_stage, episode_id) values ($1, $2, 'public', null, 'met', $3)`, [lo, hi, d.episode]);
  await logTurnDraft(t.db, { episodeId: d.episode, turnIndex: 0, side: d.side, source: "critic", reason: "too long", rejected: "Mine, rewritten." });
  await logTurnDraft(t.db, { episodeId: d.episode, turnIndex: 1, side: d.other, source: "critic", reason: "too long", rejected: "Theirs, rewritten." });
  expect(await slidingDoors(t.db, d.episode, d.owner, "bolder")).not.toBeNull();
  await setLineVote(t.db, { userId: fan, kind: "episode", refId: d.episode, lineIndex: 0, vote: 1 });
  await setLineVote(t.db, { userId: d.owner, kind: "episode", refId: d.episode, lineIndex: 1, vote: -1 });
}

async function expectForgotten(d: Awaited<ReturnType<typeof bookedDate>>) {
  expect(await count(`select 1 from swipe_impressions where viewer = $1 or card = $1`, [d.character])).toBe(0);
  expect(await count(`select 1 from relationship_events where character_a = $1 or character_b = $1`, [d.character])).toBe(0);
  expect(await count(`select 1 from episode_variations where varies_episode_id = $1`, [d.episode])).toBe(0);
  // Only their side's drafts go: the other side's stay with the shared date.
  expect((await t.db.query<{ side: string }>(`select side from turn_drafts where episode_id = $1`, [d.episode])).rows).toEqual([{ side: d.other }]);
  // The trace keeps what explains the ending, never what was read off a soul.
  const { engine_trace: trace, setup } = await episodeRow(d.episode);
  for (const path of TRACE_SOUL_PATHS) expect(at(path, trace), path.join(".")).toBeUndefined();
  expect(typeof trace.margin).toBe("number");
  expect(typeof trace.terms.chemistry.base).toBe("number");
  expect(setup[`signals_${d.side}`]).toBeUndefined();
  expect(setup[`signals_${d.other}`]).toBeDefined();
}

describe("forgetting a character", () => {
  it("removes its impressions, timeline, its side's drafts and the Sliding Doors runs, and strips the soul's numbers", async () => {
    const d = await bookedDate();
    const before = await episodeRow(d.episode);
    for (const path of TRACE_SOUL_PATHS) expect(at(path, before.engine_trace), path.join(".")).toBeDefined();
    expect(before.setup[`signals_${d.side}`]).toBeDefined();
    await keepEverything(d, "fan-1");
    expect((await exportAccount(t.db, d.owner)).episode_variations).toEqual([expect.objectContaining({ episode_id: d.episode, variation: "bolder" })]);

    expect(await deleteCharacter(t.db, d.owner, d.character)).toEqual({ deleted: false, anonymized: true });
    await expectForgotten(d);
    // Votes on a shared date are the voters' (they go with the voter's account, as predictions do).
    expect(await count(`select 1 from line_feedback where ref_id = $1`, [d.episode])).toBe(2);
  });
});

describe("deleting an account", () => {
  it("removes all of it: the forget above, plus their votes, their Sliding Doors runs and their agents' links", async () => {
    const d = await bookedDate();
    await keepEverything(d, "fan-2");
    await t.db.query(`insert into agent_links (agent_id, user_id) values ('agent-of-owner', $1)`, [d.owner]);
    const out = await exportAccount(t.db, d.owner);
    expect(out.line_feedback).toEqual([expect.objectContaining({ ref_id: d.episode, line_index: 1, vote: -1 })]);
    expect(out.episode_variations).toHaveLength(1);
    // The run's trace averages both characters' temperaments: not exported.
    expect(out.episode_variations[0]).not.toHaveProperty("alt_trace");

    await deleteAccount(t.db, d.owner);
    await expectForgotten(d);
    expect(await count(`select 1 from line_feedback where user_id = $1`, [d.owner])).toBe(0);
    expect(await count(`select 1 from line_feedback where user_id = 'fan-2'`, [])).toBe(1);
    expect(await count(`select 1 from agent_links where user_id = $1`, [d.owner])).toBe(0);
  });
});

describe("the privacy page says it", () => {
  it("names the Sliding Doors replays and the votes with the kept data, and how long each kind is kept", () => {
    const html = renderToStaticMarkup(createElement(PrivacySections));
    expect(html).toContain("Sliding Doors");
    expect(html).toContain("How long we keep it");
    expect(html).toContain(`${RETENTION_DAYS.turn_drafts} days`);
    // The promise the export keeps (scripts/eval/export-preferences.mjs refuses After Dark).
    expect(html).toMatch(/never After Dark/);
  });
});

describe("retention (lib/retention.ts)", () => {
  it("prunes each kind of kept data past its time, keeps what's newer, and keeps consent decisions", async () => {
    const d = await bookedDate({ fixed: true });
    const now = new Date();
    const old = new Date(now.getTime() - (RETENTION_DAYS.choice_history + 1) * 86_400_000).toISOString();
    const recent = new Date(now.getTime() - 10 * 86_400_000).toISOString();
    const [lo, hi] = [d.character, d.partner].sort();
    for (const when of [old, recent]) {
      await t.db.query(`insert into choice_history (kind, user_id, episode_id, value, at) values ('prediction', 'fan', $1, '{"pick":"friends"}'::jsonb, $2)`, [d.episode, when]);
      await t.db.query(`insert into swipe_impressions (viewer, card, serve_id, rank, served_via, at) values ($1, $2, 's', 1, 'web', $3)`, [d.character, d.partner, when]);
      await t.db.query(`insert into turn_drafts (episode_id, turn_index, side, source, reason, rejected, created_at) values ($1, 0, 'a', 'critic', 'r', 'x', $2)`, [d.episode, when]);
      await t.db.query(`insert into relationship_events (character_a, character_b, layer, to_stage, at) values ($1, $2, 'all', 'met', $3)`, [lo, hi, when]);
      await t.db.query(`insert into language_seen (day, surface, lang, actor) values ($1::timestamptz::date, 'web_text', 'es', 'fan')`, [when]);
    }
    const variation = (name: string, when: string) =>
      t.db.query(
        `insert into episode_variations (varies_episode_id, variation, engine_version, base_ending, stored_ending, alt_ending, alt_box_score, alt_sides, faithful, created_at)
         values ($1, $2, 3, 'friends', 'friends', 'disaster', '{}'::jsonb, '[]'::jsonb, true, $3)`,
        [d.episode, name, when],
      );
    await variation("bolder", old);
    await variation("long_game", recent);
    // A consent decision is the record of what someone agreed to: it stays while the account does.
    await t.db.query(`insert into choice_history (kind, user_id, value, at) values ('ml_consent', 'fan', '{"granted":true}'::jsonb, $1)`, [old]);

    expect(await pruneKeptData(t.db, now)).toEqual({ choice_history: 1, swipe_impressions: 1, turn_drafts: 1, relationship_events: 1, episode_variations: 1, language_seen: 1 });
    expect((await t.db.query(`select kind from choice_history where user_id = 'fan' order by kind`)).rows).toEqual([{ kind: "ml_consent" }, { kind: "prediction" }]);
    expect(await count(`select 1 from swipe_impressions where at < $1`, [recent])).toBe(0);
    expect(await count(`select 1 from turn_drafts where created_at < $1`, [recent])).toBe(0);
    expect(await count(`select 1 from relationship_events where at < $1`, [recent])).toBe(0);
    expect((await t.db.query(`select variation from episode_variations`)).rows).toEqual([{ variation: "long_game" }]);
    // A second run has nothing left to do.
    expect(Object.values(await pruneKeptData(t.db, now)).every((n) => n === 0)).toBe(true);
  });
});
