// What a line ranker would need, kept and counted, with no ranker built (docs/ideas.md "Parked": pairwise line labels wait
// for 100 thumbs a week): the "Not them" tag on a thumbs-down, end to end (the route, the buttons, the export, the
// readiness readout); the join from a stored candidate line (turn_drafts) to the thumbs on the line that aired; and the
// gate's numbers. Anonymous votes stay out of every dataset exactly as before.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LineVoteButtons } from "@/app/ChatThread";
import { ReadinessView } from "@/app/admin/analytics/QualityTab";
import { GET as getVotes, POST as postVote } from "@/app/api/line-feedback/route";
import { exportAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { registerAccount } from "@/lib/auth";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLineVote } from "@/lib/line-feedback";
import * as mlConsent from "@/lib/ml-consent";
import { setMlConsent } from "@/lib/ml-consent";
import { candidatePairs, fineTuneReadiness, RANKER_GATE, rankerReadiness, trainingReadiness } from "@/lib/training-readiness";
import { logTurnDraft } from "@/lib/turn-drafts";
import { collectPreferences } from "../scripts/eval/export-preferences.mjs";
import { BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

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
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const HOUSE = HOUSE_CHARACTERS[0].id;
const LINES = [
  { side: "a", act: 0, dialogue: "Hello there.", action: "", emotion: "pleased", interest: 0.6 },
  { side: "b", act: 0, dialogue: "Hi. You found the place.", action: "", emotion: "dry", interest: 0.5 },
  { side: "a", act: 1, dialogue: "I followed the smell of dumplings.", action: "", emotion: "warm", interest: 0.6 },
  { side: "b", act: 1, dialogue: "Everyone does.", action: "", emotion: "dry", interest: 0.5 },
];

let n = 0;
async function account(): Promise<string> {
  const userId = userIdOf(newUserCookie());
  await registerAccount(t.db, userId, `rnk${++n}${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
  return userId;
}
async function optedIn(): Promise<string> {
  const user = await account();
  await setMlConsent(t.db, user, true);
  return user;
}
async function character(owner: string): Promise<string> {
  const id = `rnk-char-${++n}`;
  await t.db.query(`insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, visibility) values ($1, $2, $3, 30, 'bio', '["kind","bold","warm"]'::jsonb, 'love', 'rudeness', 'public')`, [id, owner, `Char ${n}`]);
  return id;
}
async function episode(a: string, b: string, o: { visibility?: string; creator?: string; lines?: unknown[] } = {}): Promise<string> {
  const id = `rnk-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status, revealed_at, setup)
     values ($1, $2, $3, $4, 'A bar.', '[]'::jsonb, '[]'::jsonb, '', '', 'friends', $5::jsonb, $6, 'ready', now(), '{}'::jsonb)`,
    [id, o.creator ?? "creator-x", a, b, JSON.stringify(o.lines ?? LINES), o.visibility ?? "public"],
  );
  return id;
}
const post = (body: unknown, cookie: string) => postVote(new Request(`${BASE_URL}/api/line-feedback`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const read = (ep: string, cookie: string) => getVotes(new Request(`${BASE_URL}/api/line-feedback?kind=episode&ref=${ep}`, { headers: { cookie } }));
const tagOf = async (user: string, ep: string, line: number) =>
  (await t.db.query<{ vote: number; tag: string | null }>(`select vote, tag from line_feedback where user_id = $1 and ref_id = $2 and line_index = $3`, [user, ep, line])).rows[0] ?? null;
const query = async (sql: string, params: unknown[] = []) => (await t.db.query(sql, params)).rows as Record<string, unknown>[];

describe('"Not them": a thumbs-down tagged out of character', () => {
  it("rides the 👎 through the route: set, read back, cleared by a 👍 or by sending the 👎 without it", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    const ep = await episode(await character(userIdOf(newUserCookie())), HOUSE);
    const down = await post({ kind: "episode", ref_id: ep, line_index: 2, vote: -1, tag: "out_of_character" }, cookie);
    expect(await down.json()).toEqual({ kind: "episode", ref_id: ep, line_index: 2, vote: -1, tag: "out_of_character" });
    expect(await tagOf(user, ep, 2)).toEqual({ vote: -1, tag: "out_of_character" });
    expect(await (await read(ep, cookie)).json()).toMatchObject({ votes: { 2: -1 }, tags: { 2: "out_of_character" } });
    // Someone else's tags are theirs.
    expect((await (await read(ep, newUserCookie())).json()).tags).toEqual({});
    // The 👎 sent again without the tag: still a 👎, no longer "Not them".
    expect((await post({ kind: "episode", ref_id: ep, line_index: 2, vote: -1 }, cookie)).status).toBe(200);
    expect(await tagOf(user, ep, 2)).toEqual({ vote: -1, tag: null });
    // Tagged again, then flipped to a 👍: the tag goes with the 👎 it was on.
    await post({ kind: "episode", ref_id: ep, line_index: 2, vote: -1, tag: "out_of_character" }, cookie);
    expect((await post({ kind: "episode", ref_id: ep, line_index: 2, vote: 1 }, cookie)).status).toBe(200);
    expect(await tagOf(user, ep, 2)).toEqual({ vote: 1, tag: null });
    expect((await (await read(ep, cookie)).json()).tags).toEqual({});
    // Taking the vote back removes the row.
    await post({ kind: "episode", ref_id: ep, line_index: 2, vote: 0 }, cookie);
    expect(await tagOf(user, ep, 2)).toBeNull();
  });

  it("only a thumbs-down can carry it, and only a tag the show knows", async () => {
    const cookie = newUserCookie();
    const ep = await episode(await character(userIdOf(newUserCookie())), HOUSE);
    expect((await post({ kind: "episode", ref_id: ep, line_index: 0, vote: 1, tag: "out_of_character" }, cookie)).status).toBe(422);
    expect((await post({ kind: "episode", ref_id: ep, line_index: 0, vote: 0, tag: "out_of_character" }, cookie)).status).toBe(422);
    expect((await post({ kind: "episode", ref_id: ep, line_index: 0, vote: -1, tag: "boring" }, cookie)).status).toBe(422);
    expect(await query(`select 1 from line_feedback`)).toEqual([]);
    // The library holds the same line: a tag handed in with a 👍 is dropped, and the table refuses one outright.
    await setLineVote(t.db, { userId: "u1", kind: "episode", refId: ep, lineIndex: 0, vote: 1, tag: "out_of_character" });
    expect(await tagOf("u1", ep, 0)).toEqual({ vote: 1, tag: null });
    await expect(t.db.query(`update line_feedback set tag = 'out_of_character' where user_id = 'u1'`)).rejects.toThrow();
  });

  it('the buttons offer "Not them" only after a 👎, and only where the page can save it', () => {
    const html = (props: Partial<Parameters<typeof LineVoteButtons>[0]>) =>
      renderToStaticMarkup(createElement(LineVoteButtons, { index: 0, vote: 0, name: "Cass Vega", onVote: () => {}, ...props }));
    expect(html({ vote: 0, onTag: () => {} })).not.toContain("Not them");
    expect(html({ vote: 1, onTag: () => {} })).not.toContain("Not them");
    expect(html({ vote: -1 })).not.toContain("Not them"); // no onTag: nothing to save it with
    const offered = html({ vote: -1, onTag: () => {} });
    expect(offered).toContain("Not them");
    expect(offered).toMatch(/class="chat-vote-tag"[^>]*aria-pressed="false"[^>]*aria-label="Not them: this didn&#x27;t sound like Cass"/);
    expect(html({ vote: -1, tagged: true, onTag: () => {} })).toMatch(/class="chat-vote-tag"[^>]*aria-pressed="true"/);
  });

  it("the export and the readiness readout read it, from opted-in voters only: an anonymous vote stays out as before", async () => {
    const owner = await optedIn();
    const fan = await optedIn();
    const anon = userIdOf(newUserCookie());
    const silent = await account(); // signed in, never opted in
    const ep = await episode(await character(owner), HOUSE, { creator: owner });
    await setLineVote(t.db, { userId: fan, kind: "episode", refId: ep, lineIndex: 0, vote: -1, tag: "out_of_character" });
    await setLineVote(t.db, { userId: owner, kind: "episode", refId: ep, lineIndex: 0, vote: -1 });
    await setLineVote(t.db, { userId: anon, kind: "episode", refId: ep, lineIndex: 0, vote: -1, tag: "out_of_character" });
    await setLineVote(t.db, { userId: silent, kind: "episode", refId: ep, lineIndex: 0, vote: -1, tag: "out_of_character" });
    await setLineVote(t.db, { userId: anon, kind: "episode", refId: ep, lineIndex: 2, vote: -1, tag: "out_of_character" }); // only an anonymous vote: no record

    const { records, excluded } = await collectPreferences(query, { consent: mlConsent });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ line_index: 0, votes: { up: 0, down: 2, voters: 2, score: -2, out_of_character: 1 } });
    expect(excluded).toBe(1);
    for (const id of [fan, owner, anon, silent]) expect(JSON.stringify(records)).not.toContain(id);

    const r = await fineTuneReadiness(t.db);
    expect(r.detail).toMatchObject({ voted_lines: 1, out_of_character_lines: 1 });
    // A person's own tags are in their account export.
    expect((await exportAccount(t.db, fan)).line_feedback).toEqual([expect.objectContaining({ ref_id: ep, line_index: 0, vote: -1, tag: "out_of_character" })]);
  });
});

describe("the join a ranker needs: a stored candidate to the thumbs on the line that aired", () => {
  it("turn_drafts (episode, turn) is line_feedback (ref, line): the draft, the line kept in its place, and that line's thumbs", async () => {
    const owner = await optedIn();
    const [v1, v2] = [await optedIn(), userIdOf(newUserCookie())];
    const ep = await episode(await character(owner), HOUSE, { creator: owner });
    // The critic sent back side b's draft at turn 1, and side a's at turn 2; the lines at those turns are what aired.
    await logTurnDraft(t.db, { episodeId: ep, turnIndex: 1, side: "b", source: "critic", reason: "profile reading", rejected: "A florist who likes quiet, huh?" });
    await logTurnDraft(t.db, { episodeId: ep, turnIndex: 2, side: "a", source: "critic", reason: "repeats itself", rejected: "Hello there, again." });
    // A draft a safety filter caught keeps no text: it's no candidate. One logged against the other side's turn joins nothing.
    await logTurnDraft(t.db, { episodeId: ep, turnIndex: 3, side: "b", source: "agent_refused", reason: "filtered", rejected: null });
    await logTurnDraft(t.db, { episodeId: ep, turnIndex: 0, side: "b", source: "critic", reason: "wrong side", rejected: "Not the speaker of line 0." });
    // A turn that was never filled (a date abandoned mid-way) has no kept line.
    await logTurnDraft(t.db, { episodeId: ep, turnIndex: 9, side: "b", source: "agent_check", reason: "check_only", rejected: "A try that never aired." });
    await setLineVote(t.db, { userId: v1, kind: "episode", refId: ep, lineIndex: 1, vote: 1 });
    await setLineVote(t.db, { userId: v2, kind: "episode", refId: ep, lineIndex: 1, vote: -1, tag: "out_of_character" });
    await setLineVote(t.db, { userId: v1, kind: "episode", refId: ep, lineIndex: 0, vote: 1 }); // a line with no draft: not a pair
    // An After Dark vote on the same ref and line is never read.
    await t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote) values ('ad-1', $1, 'after_dark', $2, 1, 1)`, [v1, ep]);

    const pairs = await candidatePairs(t.db, ep);
    expect(pairs.map(({ draft_id: _id, ...p }) => p)).toEqual([
      { episode_id: ep, turn_index: 1, side: "b", source: "critic", reason: "profile reading", rejected: "A florist who likes quiet, huh?", kept: LINES[1].dialogue, up: 1, down: 1, out_of_character: 1 },
      { episode_id: ep, turn_index: 2, side: "a", source: "critic", reason: "repeats itself", rejected: "Hello there, again.", kept: LINES[2].dialogue, up: 0, down: 0, out_of_character: 0 },
    ]);
    // No voter's id comes through the join.
    for (const id of [v1, v2]) expect(JSON.stringify(pairs)).not.toContain(id);
    expect(await candidatePairs(t.db)).toHaveLength(2);
  });
});

describe("the gate, visible on the readiness readout", () => {
  it("counts the week's thumbs from people who aren't us against 100, and the pairs kept for it", async () => {
    const owner = await optedIn();
    const fan = await optedIn();
    const anon = userIdOf(newUserCookie());
    const us = await account();
    await claimAdmin(t.db, us);
    const ep = await episode(await character(owner), HOUSE, { creator: owner });
    const priv = await episode(await character(owner), HOUSE, { creator: owner, visibility: "private" });
    await setLineVote(t.db, { userId: fan, kind: "episode", refId: ep, lineIndex: 0, vote: 1 });
    await setLineVote(t.db, { userId: fan, kind: "episode", refId: ep, lineIndex: 1, vote: -1, tag: "out_of_character" });
    await setLineVote(t.db, { userId: anon, kind: "episode", refId: ep, lineIndex: 1, vote: 1 }); // counts toward the gate, never toward a dataset
    await setLineVote(t.db, { userId: us, kind: "episode", refId: ep, lineIndex: 2, vote: -1, tag: "out_of_character" }); // ours: left out of the week
    await setLineVote(t.db, { userId: fan, kind: "episode", refId: ep, lineIndex: 3, vote: 1 });
    await t.db.query(`update line_feedback set created_at = now() - interval '9 days', updated_at = now() - interval '9 days' where line_index = 3`); // last week's
    await t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote) values ('ad-2', $1, 'after_dark', 'night-1', 0, 1)`, [fan]); // never After Dark
    await logTurnDraft(t.db, { episodeId: ep, turnIndex: 1, side: "b", source: "critic", reason: "a note", rejected: "A draft." }); // rated, usable
    await logTurnDraft(t.db, { episodeId: ep, turnIndex: 3, side: "b", source: "critic", reason: "a note", rejected: "Another draft." }); // rated last week
    await logTurnDraft(t.db, { episodeId: priv, turnIndex: 1, side: "b", source: "critic", reason: "a note", rejected: "A private date's draft." }); // kept, but no dataset reads it

    const now = new Date(Date.now() + 1000); // after the votes above were cast
    const r = await rankerReadiness(t.db, now);
    expect(r.gates).toEqual([{ key: "thumbs", label: "Thumbs on lines, last 7 days", kind: "count", have: 3, need: RANKER_GATE.thumbs, met: false }]);
    expect(r.ready).toBe(false);
    expect(r.sentence).toMatch(/waits for 100 thumbs a week .* Still needed: 97 more thumbs this week\. Nothing is built until then/);
    expect(r.detail).toEqual({ opted_in_thumbs: 2, out_of_character_week: 1, out_of_character_total: 2, pairs: 3, pairs_rated: 2, pairs_usable: 2 });

    // The readout carries it beside the other two, and the page shows the gate and the pairs.
    const all = await trainingReadiness(t.db, now);
    expect(all.ranker).toEqual(r);
    const html = renderToStaticMarkup(createElement(ReadinessView, { data: all }));
    expect(html).toContain("A line ranker (pairwise line labels, docs/ideas.md)");
    expect(html).toContain("3 of 100");
    expect(html).toContain("3 candidate/kept pairs");
    expect(html).toContain("say “Not them”");
    // A payload from before the ranker's gate existed still renders.
    const { ranker: _gone, ...old } = all;
    expect(renderToStaticMarkup(createElement(ReadinessView, { data: old as typeof all }))).not.toContain("A line ranker");
  });

  it("is met at a hundred thumbs in the week", async () => {
    const ep = await episode(await character(userIdOf(newUserCookie())), HOUSE);
    for (let i = 0; i < RANKER_GATE.thumbs; i++) await setLineVote(t.db, { userId: `viewer-${i}`, kind: "episode", refId: ep, lineIndex: i % 4, vote: 1 });
    const r = await rankerReadiness(t.db);
    expect(r.gates[0]).toMatchObject({ have: 100, met: true });
    expect(r.ready).toBe(true);
    expect(r.sentence).toMatch(/^Pairwise line labels can start/);
  });
});
