// Thumbs on lines (lib/line-feedback.ts, /api/line-feedback, app/ChatThread.tsx): a session, only lines the viewer can
// see, one vote per person per line (a 0 vote takes it back), rate limited; After Dark votes for a signed-in admin only,
// and they follow their lines when a scene is filed as a night. Then the vote metrics in Real use, the preference export
// and the thread's markup.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ChatThread, { LineVoteButtons } from "@/app/ChatThread";
import { GET as getVotes, POST as postVote } from "@/app/api/line-feedback/route";
import * as observer from "@/lib/adult/observer";
import { resetScene } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import type { CharacterRef } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { visitorKey } from "@/lib/limits";
import { LINE_FEEDBACK_LIMITS, moveLineFeedback, setLineVote } from "@/lib/line-feedback";
import { realMetrics } from "@/lib/real-metrics";
import { collectPreferences, exportPreferences } from "../scripts/eval/export-preferences.mjs";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

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
const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id].sort();
const TRANSCRIPT = [
  { side: "a", act: 0, dialogue: "You're on time. I like that.", action: "straightens the napkin", emotion: "pleased", interest: 0.6 },
  { side: "b", act: 0, dialogue: "The gulls said you'd be late.", action: "", emotion: "dry", interest: 0.5 },
  { side: "a", act: 1, dialogue: "Do the gulls take bookings?", action: "", emotion: "amused", interest: 0.7 },
  { side: "b", act: 1, dialogue: "Only for lighthouses.", action: "smiles", emotion: "warm", interest: 0.7 },
];

let n = 0;
/** A date by `owner` (their character × a house character), ready, with a 4-line transcript. */
async function episode(owner: string, o: { visibility?: string; status?: string; creator?: string } = {}): Promise<string> {
  const id = `ep-${++n}`;
  const character = `char-${n}`;
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ($1, $2, 'Cass Vega', 33, 'A florist.', '["bold","gentle","precise"]'::jsonb, 'Quiet.', 'Fireworks.')`,
    [character, owner],
  );
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status)
     values ($1, $2, $3, $4, 'A lighthouse bar.', '[]'::jsonb, '[]'::jsonb, 'Twist.', 'Finale.', 'friends', $5::jsonb, $6, $7)`,
    [id, o.creator ?? owner, character, HOUSE, JSON.stringify(TRANSCRIPT), o.visibility ?? "public", o.status ?? "ready"],
  );
  return id;
}

const vote = (body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  postVote(new Request(`${BASE_URL}/api/line-feedback`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) }));
const votes = (kind: string, ref: string, cookie?: string) => getVotes(new Request(`${BASE_URL}/api/line-feedback?kind=${kind}&ref=${encodeURIComponent(ref)}`, { headers: cookie ? { cookie } : {} }));
const rows = async () => (await t.db.query<{ user_id: string; kind: string; ref_id: string; line_index: number; vote: number }>(`select user_id, kind, ref_id, line_index, vote from line_feedback order by line_index`)).rows;

describe("voting on a date's lines", () => {
  it("needs a session: a first GET hands one out, a cookieless POST is refused", async () => {
    const ep = await episode(userIdOf(newUserCookie()));
    const first = await votes("episode", ep);
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toMatch(/bz_sess=|bz_uid=/);
    expect(await first.json()).toEqual({ kind: "episode", ref_id: ep, lines: 4, votes: {} });
    const res = await vote({ kind: "episode", ref_id: ep, line_index: 1, vote: 1 });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("no_session");
    expect(await rows()).toEqual([]);
  });

  it("sets, replaces and takes back one vote per person per line (an anonymous viewer is fine)", async () => {
    const ep = await episode(userIdOf(newUserCookie()));
    const viewer = newUserCookie();
    expect(await (await vote({ kind: "episode", ref_id: ep, line_index: 2, vote: 1 }, viewer)).json()).toEqual({ kind: "episode", ref_id: ep, line_index: 2, vote: 1 });
    expect((await vote({ kind: "episode", ref_id: ep, line_index: 0, vote: -1 }, viewer)).status).toBe(200);
    expect((await (await votes("episode", ep, viewer)).json()).votes).toEqual({ 0: -1, 2: 1 });
    // The other thumb replaces it: still one row for that line.
    await vote({ kind: "episode", ref_id: ep, line_index: 2, vote: -1 }, viewer);
    expect((await rows()).filter((r) => r.line_index === 2)).toEqual([{ user_id: userIdOf(viewer), kind: "episode", ref_id: ep, line_index: 2, vote: -1 }]);
    // A 0 takes it back (the client sends 0 when the thumb already set is tapped again).
    await vote({ kind: "episode", ref_id: ep, line_index: 2, vote: 0 }, viewer);
    expect((await (await votes("episode", ep, viewer)).json()).votes).toEqual({ 0: -1 });
    // Someone else's votes are theirs alone.
    const other = newUserCookie();
    await vote({ kind: "episode", ref_id: ep, line_index: 0, vote: 1 }, other);
    expect((await (await votes("episode", ep, other)).json()).votes).toEqual({ 0: 1 });
    expect((await (await votes("episode", ep, viewer)).json()).votes).toEqual({ 0: -1 });
  });

  it("one vote per person per line, enforced by the database too", async () => {
    const ep = await episode(userIdOf(newUserCookie()));
    const user = randomUUID();
    await setLineVote(t.db, { userId: user, kind: "episode", refId: ep, lineIndex: 1, vote: 1 });
    await setLineVote(t.db, { userId: user, kind: "episode", refId: ep, lineIndex: 1, vote: 1 });
    expect(await t.count("line_feedback")).toBe(1);
    await expect(t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote) values ($1, $2, 'episode', $3, 1, -1)`, [randomUUID(), user, ep])).rejects.toThrow();
    await expect(t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote) values ($1, $2, 'episode', $3, 2, 2)`, [randomUUID(), user, ep])).rejects.toThrow();
  });

  it("only lines that exist", async () => {
    const ep = await episode(userIdOf(newUserCookie()));
    const viewer = newUserCookie();
    const past = await vote({ kind: "episode", ref_id: ep, line_index: 4, vote: 1 }, viewer);
    expect(past.status).toBe(422);
    expect((await past.json()).error).toBe("no_such_line");
    expect((await vote({ kind: "episode", ref_id: ep, line_index: -1, vote: 1 }, viewer)).status).toBe(422);
    expect((await vote({ kind: "episode", ref_id: ep, line_index: 1, vote: 2 }, viewer)).status).toBe(422);
    expect((await vote({ kind: "date", ref_id: ep, line_index: 1, vote: 1 }, viewer)).status).toBe(422);
    expect((await vote({ kind: "episode", ref_id: "nope; drop table", line_index: 1, vote: 1 }, viewer)).status).toBe(422);
    expect((await vote({ kind: "episode", ref_id: "ep-missing", line_index: 1, vote: 1 }, viewer)).status).toBe(404);
    expect((await votes("dates", ep, viewer)).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("a private date: its owner and its host only; unlisted is anyone with the link", async () => {
    const owner = newUserCookie();
    const host = newUserCookie();
    const stranger = newUserCookie();
    const priv = await episode(userIdOf(owner), { visibility: "private", creator: userIdOf(host) });
    expect((await vote({ kind: "episode", ref_id: priv, line_index: 0, vote: 1 }, stranger)).status).toBe(404);
    expect((await votes("episode", priv, stranger)).status).toBe(404);
    expect((await vote({ kind: "episode", ref_id: priv, line_index: 0, vote: 1 }, owner)).status).toBe(200);
    expect((await vote({ kind: "episode", ref_id: priv, line_index: 0, vote: 1 }, host)).status).toBe(200);
    const unlisted = await episode(userIdOf(owner), { visibility: "unlisted" });
    expect((await vote({ kind: "episode", ref_id: unlisted, line_index: 3, vote: -1 }, stranger)).status).toBe(200);
  });

  it("a date hidden by reports is its owners' only, and a date still being written isn't votable", async () => {
    const owner = newUserCookie();
    const stranger = newUserCookie();
    const hidden = await episode(userIdOf(owner));
    for (const reporter of ["r1", "r2", "r3"]) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [hidden, reporter]);
    expect((await vote({ kind: "episode", ref_id: hidden, line_index: 0, vote: 1 }, stranger)).status).toBe(404);
    expect((await vote({ kind: "episode", ref_id: hidden, line_index: 0, vote: 1 }, owner)).status).toBe(200);
    const writing = await episode(userIdOf(owner), { status: "generating" });
    expect((await vote({ kind: "episode", ref_id: writing, line_index: 0, vote: 1 }, owner)).status).toBe(404);
  });

  it("is rate limited per person and per connection", async () => {
    const ep = await episode(userIdOf(newUserCookie()));
    const viewer = newUserCookie();
    const at = new Date().toISOString();
    for (let i = 0; i < LINE_FEEDBACK_LIMITS.perHour; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ('line_feedback_user', $1, $2)`, [userIdOf(viewer), at]);
    const limited = await vote({ kind: "episode", ref_id: ep, line_index: 0, vote: 1 }, viewer);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("too_many_votes");
    // A fresh cookie from the same connection is caught by the connection's own limit.
    const ip = { "x-forwarded-for": "203.0.113.9" };
    const key = visitorKey(new Headers(ip))!;
    for (let i = 0; i < LINE_FEEDBACK_LIMITS.perHour; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ('line_feedback', $1, $2)`, [key, at]);
    expect((await vote({ kind: "episode", ref_id: ep, line_index: 0, vote: 1 }, newUserCookie(), ip)).status).toBe(429);
    expect((await vote({ kind: "episode", ref_id: ep, line_index: 0, vote: 1 }, newUserCookie(), { "x-forwarded-for": "198.51.100.4" })).status).toBe(200);
  });
});

/* ------------------------------------------------- After Dark ------------------------------------------------- */

const SCENE_LINES = [
  { who: "a", text: "*straightens his collar* You came.", why: "he's nervous: his tell", memory: null, stage: 0 },
  { who: "b", text: "I said yes before you finished asking!", why: "her want", memory: "she said yes to the karaoke first", stage: 0 },
  { who: "a", text: "Shall we go somewhere quieter?", why: "the moment", memory: null, stage: 1 },
  { who: "b", text: "Lead the way.", why: "the moment", memory: null, stage: 1 },
];
async function adminWithScene(lines = SCENE_LINES) {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  const sceneId = randomUUID();
  await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines) values ($1, $2, $3, $4, $5::jsonb)`, [sceneId, id, CAST_A, CAST_B, JSON.stringify(lines)]);
  const nightId = randomUUID();
  await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, chapter) values ($1, $2, $3, $4, $5::jsonb, 1)`, [nightId, id, CAST_A, CAST_B, JSON.stringify(lines.slice(0, 2))]);
  return { id, cookie: signedInCookie(id), sceneId, nightId };
}

describe("voting on After Dark lines", () => {
  it("a signed-in admin, on their own running scene or saved night; nobody else even learns it exists", async () => {
    const admin = await adminWithScene();
    const someone = signedInCookie(randomUUID());
    expect((await vote({ kind: "after_dark", ref_id: admin.sceneId, line_index: 1, vote: 1 }, someone)).status).toBe(404);
    expect((await votes("after_dark", admin.sceneId, someone)).status).toBe(404);
    // The admin's id without a signed-in session isn't the admin.
    expect((await vote({ kind: "after_dark", ref_id: admin.sceneId, line_index: 1, vote: 1 }, `bz_uid=${admin.id}`)).status).toBe(404);
    expect((await vote({ kind: "after_dark", ref_id: admin.sceneId, line_index: 1, vote: 1 }, admin.cookie)).status).toBe(200);
    expect((await vote({ kind: "after_dark", ref_id: admin.nightId, line_index: 0, vote: -1 }, admin.cookie)).status).toBe(200);
    expect((await vote({ kind: "after_dark", ref_id: admin.nightId, line_index: 2, vote: 1 }, admin.cookie)).status).toBe(422); // the night has 2 lines
    expect(await (await votes("after_dark", admin.sceneId, admin.cookie)).json()).toEqual({ kind: "after_dark", ref_id: admin.sceneId, lines: 4, votes: { 1: 1 } });
    // Another admin's scene is theirs.
    const other = await adminWithScene();
    expect((await vote({ kind: "after_dark", ref_id: other.sceneId, line_index: 0, vote: 1 }, admin.cookie)).status).toBe(404);
    // An After Dark id is never an episode, and the other way round.
    expect((await vote({ kind: "episode", ref_id: admin.sceneId, line_index: 0, vote: 1 }, admin.cookie)).status).toBe(404);
  });

  it("Start over files the scene as a night, and its votes go with its lines", async () => {
    const admin = await adminWithScene();
    await vote({ kind: "after_dark", ref_id: admin.sceneId, line_index: 1, vote: 1 }, admin.cookie);
    await vote({ kind: "after_dark", ref_id: admin.sceneId, line_index: 3, vote: -1 }, admin.cookie);
    await resetScene(t.db, admin.id, CAST_A, CAST_B);
    const filed = (await t.db.query<{ id: string }>(`select id from adult_nights where owner_id = $1 and id <> $2`, [admin.id, admin.nightId])).rows;
    expect(filed).toHaveLength(1);
    expect(await (await votes("after_dark", filed[0].id, admin.cookie)).json()).toMatchObject({ lines: 4, votes: { 1: 1, 3: -1 } });
    // The running scene starts again empty, with no votes left on it to land on its new lines.
    expect(await (await votes("after_dark", admin.sceneId, admin.cookie)).json()).toMatchObject({ lines: 0, votes: {} });
  });

  it("moving a ref's votes moves them all, and only that ref's", async () => {
    await setLineVote(t.db, { userId: "u1", kind: "after_dark", refId: "scene-1", lineIndex: 0, vote: 1 });
    await setLineVote(t.db, { userId: "u2", kind: "after_dark", refId: "scene-1", lineIndex: 0, vote: -1 });
    await setLineVote(t.db, { userId: "u1", kind: "after_dark", refId: "scene-2", lineIndex: 0, vote: 1 });
    await setLineVote(t.db, { userId: "u1", kind: "episode", refId: "scene-1", lineIndex: 0, vote: 1 });
    expect(await moveLineFeedback(t.db, "scene-1", "night-9")).toBe(2);
    expect((await rows()).map((r) => `${r.kind}:${r.ref_id}`).sort()).toEqual(["after_dark:night-9", "after_dark:night-9", "after_dark:scene-2", "episode:scene-1"]);
  });
});

/* --------------------------------------------------- Real use --------------------------------------------------- */

describe("line votes in Real use", () => {
  const NOW = new Date("2026-10-21T12:00:00Z");
  const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
  async function cast(user: string, ref: string, line: number, value: 1 | -1, daysAgo: number, kind = "episode") {
    await t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $7)`, [randomUUID(), user, kind, ref, line, value, ago(daysAgo)]);
  }

  it("up, down, the share up and the people who voted, our own votes left out", async () => {
    const admin = randomUUID();
    await claimAdmin(t.db, admin);
    await cast("p1", "ep-a", 0, 1, 1);
    await cast("p1", "ep-a", 1, 1, 2);
    await cast("p2", "ep-a", 0, 1, 3);
    await cast("p2", "ep-b", 4, -1, 6);
    await cast("p3", "ep-b", 2, -1, 20); // inside 30 days, not 7
    await cast(admin, "scene-1", 0, 1, 1, "after_dark"); // ours
    await cast(admin, "ep-a", 2, -1, 1); // ours
    const week = await realMetrics(t.db, 7, NOW);
    expect(week.feedback).toEqual({
      votes_up: { kind: "count", value: 3 },
      votes_down: { kind: "count", value: 1 },
      share_up: { kind: "share", num: 3, den: 4 },
      voters: { kind: "count", value: 2 },
    });
    const month = await realMetrics(t.db, 30, NOW);
    expect(month.feedback).toMatchObject({ votes_down: { value: 2 }, share_up: { num: 3, den: 5 }, voters: { value: 3 } });
  });
});

/* -------------------------------------------------- the export -------------------------------------------------- */

describe("the preference export", () => {
  const query = async (sql: string, params: unknown[] = []) => (await t.db.query(sql, params)).rows as Record<string, unknown>[];

  it("one record per rated line: votes, words, context, the After Dark notes and observer flags, never who voted", async () => {
    const owner = userIdOf(newUserCookie());
    const ep = await episode(owner);
    const admin = await adminWithScene();
    const fan = randomUUID();
    await setLineVote(t.db, { userId: fan, kind: "episode", refId: ep, lineIndex: 2, vote: 1 });
    await setLineVote(t.db, { userId: owner, kind: "episode", refId: ep, lineIndex: 2, vote: 1 });
    await setLineVote(t.db, { userId: fan, kind: "episode", refId: ep, lineIndex: 3, vote: -1 });
    await setLineVote(t.db, { userId: admin.id, kind: "after_dark", refId: admin.sceneId, lineIndex: 1, vote: -1 });
    await setLineVote(t.db, { userId: admin.id, kind: "after_dark", refId: "night-gone", lineIndex: 0, vote: 1 }); // its night is gone

    const { records, skipped, votes: rated } = await collectPreferences(query, { lib: observer, context: 2 });
    expect(rated).toBe(4);
    expect(skipped).toBe(1);
    expect(records).toHaveLength(3);

    const date = records.find((r) => r.kind === "episode" && r.line_index === 2)!;
    expect(date).toMatchObject({
      ref_id: ep,
      votes: { up: 2, down: 0, voters: 2, score: 2 },
      speaker: { side: "a", name: "Cass Vega", character_id: expect.any(String) },
      other: { name: HOUSE_CHARACTERS[0].name, character_id: HOUSE },
      text: "Do the gulls take bookings?",
      emotion: "amused",
      act: 1,
      why: null,
      observer_flags: null,
      source: { setting: "A lighthouse bar.", ending: "friends", performed_by: "platform" },
    });
    expect(date.context).toEqual([
      { side: "a", name: "Cass Vega", text: "You're on time. I like that." },
      { side: "b", name: HOUSE_CHARACTERS[0].name, text: "The gulls said you'd be late." },
    ]);

    const night = records.find((r) => r.kind === "after_dark")!;
    expect(night).toMatchObject({
      ref_id: admin.sceneId,
      line_index: 1,
      votes: { up: 0, down: 1, voters: 1, score: -1 },
      speaker: { side: "b", character_id: CAST_B },
      text: "I said yes before you finished asking!",
      action: null,
      why: "her want",
      memory: "she said yes to the karaoke first",
      stage: 0,
      source: { kind: "scene", chapter: 1 },
    });
    expect(night.context).toEqual([{ side: "a", name: expect.any(String), text: "*straightens his collar* You came." }]);
    // The observer read the pair: the memory cited on that line isn't in anything they could remember.
    expect(night.observer_flags).toEqual([expect.objectContaining({ check: "unfounded_memory", from: 1, to: 1 })]);

    // No voter's id anywhere.
    const dump = JSON.stringify(records);
    for (const id of [fan, owner, admin.id]) expect(dump).not.toContain(id);
  });

  it("writes JSONL, filters by kind, and leaves the flags out without the observer", async () => {
    const ep = await episode(userIdOf(newUserCookie()));
    const admin = await adminWithScene();
    await setLineVote(t.db, { userId: "u1", kind: "episode", refId: ep, lineIndex: 0, vote: 1 });
    await setLineVote(t.db, { userId: admin.id, kind: "after_dark", refId: admin.nightId, lineIndex: 0, vote: 1 });
    const dir = mkdtempSync(join(tmpdir(), "prefs-"));
    try {
      const out = join(dir, "sub", "prefs.jsonl");
      const r = await exportPreferences({ query, lib: null, out });
      expect(r.count).toBe(2);
      const lines = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.map((l) => l.kind).sort()).toEqual(["after_dark", "episode"]);
      expect(lines.find((l) => l.kind === "after_dark")).toMatchObject({ ref_id: admin.nightId, action: "straightens his collar", text: "You came.", observer_flags: null, source: { kind: "night" } });
      expect((await collectPreferences(query, { kind: "episode" })).records.map((x) => x.kind)).toEqual(["episode"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* -------------------------------------------------- the thread -------------------------------------------------- */

describe("the thumbs on the thread", () => {
  const chars: [CharacterRef, CharacterRef] = [
    { id: "a", name: "Cass Vega", house: false, hue: 30, portrait: null },
    { id: "b", name: "Sable Quist", house: true, hue: 75, portrait: null },
  ];
  const turns = TRANSCRIPT.map((x) => ({ ...x, side: x.side as "a" | "b" }));

  it("appear only when the page says what the lines are, two per line, beside the caption", () => {
    const plain = renderToStaticMarkup(createElement(ChatThread, { characters: chars, turns }));
    expect(plain).not.toContain("chat-vote");
    expect(plain).not.toContain("chat-foot");
    const rated = renderToStaticMarkup(createElement(ChatThread, { characters: chars, turns, feedback: { kind: "episode", refId: "ep-1" } }));
    expect(rated.match(/class="chat-vote"/g)).toHaveLength(8);
    expect(rated.match(/<div class="chat-foot"><span class="chat-meta">straightens the napkin · pleased<\/span><span class="chat-votes"/g)).toHaveLength(1);
    expect(rated).toContain('aria-label="Rate Cass&#x27;s line"');
    expect(rated).toContain('aria-label="Rate Sable&#x27;s line"');
    expect(rated).toContain('aria-pressed="false" aria-label="Good line"');
  });

  it("a set thumb says so, and lights its line's thumbs", () => {
    const html = renderToStaticMarkup(createElement(LineVoteButtons, { index: 0, vote: 1, name: "Cass Vega", onVote: () => {} }));
    expect(html).toContain('class="chat-votes voted"');
    expect(html).toMatch(/aria-pressed="true" aria-label="Good line"/);
    expect(html).toMatch(/aria-pressed="false" aria-label="Not a good line"/);
  });

  it("the After Dark theater passes its scene or night, and nothing without one", async () => {
    const { default: AfterDarkTheater } = await import("@/app/after-dark/[a]/[b]/AfterDarkTheater");
    const scene = { lines: [{ who: "a" as const, text: "*smiles* Hi." }], place: null, stage: 0, dateVenue: null };
    // A saved night plays from the top, so nothing is on screen at first render: the thread is there, the thumbs come with the lines.
    const html = renderToStaticMarkup(createElement(AfterDarkTheater, { scene, characters: chars, onExit: () => {}, feedbackRef: "night-1" }));
    expect(html).toContain("chat-thread");
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    // 44px on touch screens, and the default button's gradient and lift reset.
    expect(css).toMatch(/@media \(pointer: coarse\) \{[^}]*\.chat-foot[\s\S]*?button\.chat-vote \{\s*width: 2\.75rem;\s*height: 2\.75rem;/);
    expect(css).toMatch(/button\.chat-vote \{[\s\S]*?background: none;[\s\S]*?box-shadow: none;/);
  });
});
