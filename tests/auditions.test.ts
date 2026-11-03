import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as castingGet, POST as castingPost } from "@/app/api/casting/route";
import { DELETE as auditionDelete, GET as auditionGet, POST as auditionPost } from "@/app/api/characters/[id]/audition/route";
import { PATCH as editCharacter } from "@/app/api/characters/[id]/route";
import { auditionBlocks, auditionSeasonId, reviewAudition, voteAudition } from "@/lib/auditions";
import { setDbForTests } from "@/lib/db";
import { ctaMine } from "@/lib/date-cta";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import {
  DEFAULT_SEASON_CAST_SIZE,
  ensureSeasonCast,
  HOUSE_MIN,
  refreshSeasonCast,
  resetStoredSeasonCastForTests,
  seasonCastIds,
  seasonFanCastIds,
  setSeasonCastForTests,
  showCastIds,
} from "@/lib/season-cast";
import { jsonRequest, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// Auditions (lib/auditions.ts; David 2026-11-03): people's own characters audition for next month's cast, the audience
// votes, the admin shortlists, and the shortlisted ones with the most votes take the open places before any house
// newcomer — leaving the house its HOUSE_MIN places. seasonCastIds stays the house cast; fan picks are their own list.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
  setDbForTests(null);
});
beforeEach(async () => {
  await t.reset();
  setDbForTests(t.db);
  setSeasonCastForTests(null);
  resetStoredSeasonCastForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => {
  setSwipeGateForTests(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const OCT = new Date("2026-10-20T12:00:00Z");
const NOV = new Date("2026-11-01T00:00:01Z");
const ROSTER = HOUSE_CHARACTERS.map((c) => c.id);

let n = 0;
/** A person (with an account) and their character, public and open, with a portrait and `dates` aired public dates. */
async function person(name: string, opts: { dates?: number; via?: "web" | "mcp"; account?: boolean; portrait?: boolean; bio?: string } = {}) {
  const owner = randomUUID();
  const id = `fan-${++n}`;
  if (opts.account !== false) await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [owner, `g-${owner}`, `${owner}@example.test`]);
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates, created_via)
     values ($1, $2, false, $3, 30, $4, '["bold","warm","odd"]'::jsonb, 'love', 'rudeness', 'public', true, $5)`,
    [id, owner, name, opts.bio ?? "A lighthouse keeper who collects storms.", opts.via ?? "web"],
  );
  if (opts.portrait !== false) {
    await t.db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', 'data:image/png;base64,AA==', 'approved', 'pg')`,
      [`asset-${id}`, id],
    );
  }
  for (let i = 0; i < (opts.dates ?? 3); i++) {
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, visibility, revealed_at)
       values ($1, $2, $3, $4, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready', '[]'::jsonb, '[]'::jsonb, 'public', '2026-10-10T00:00:00Z')`,
      [`ep-${id}-${i}`, owner, id, ROSTER[i % ROSTER.length]],
    );
  }
  return { owner, id, cookie: signedInCookie(owner) };
}

const getReq = (path: string, cookie: string) => new Request(`http://localhost:3000${path}`, { headers: { cookie } });
const call = (handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, cookie: string, method: string, body?: unknown) =>
  handler(method === "GET" ? getReq(`/api/characters/${id}/audition`, cookie) : jsonRequest(`/api/characters/${id}/audition`, body ?? {}, { cookie, method }), { params: Promise.resolve({ id }) });

describe("who can audition", () => {
  it("only a person's own character made on the site, signed in, public, open, PG, with a portrait and three dates", async () => {
    vi.useFakeTimers({ now: OCT, toFake: ["Date"] });
    const ready = await person("Mara Quill");
    expect(await auditionBlocks(t.db, { userId: ready.owner, authenticated: true }, ready.id)).toEqual([]);
    expect(await auditionBlocks(t.db, { userId: "someone-else", authenticated: true }, ready.id)).toEqual(["not_yours"]);
    // Signed out on an account, or no account at all: sign in first.
    expect(await auditionBlocks(t.db, { userId: ready.owner, authenticated: false }, ready.id)).toEqual(["sign_in"]);
    const anon = await person("Pell Anon", { account: false });
    expect(await auditionBlocks(t.db, { userId: anon.owner, authenticated: true }, anon.id)).toEqual(["sign_in"]);

    const agent = await person("Bot Made", { via: "mcp" });
    expect(await auditionBlocks(t.db, { userId: agent.owner, authenticated: true }, agent.id)).toEqual(["agent_made"]);
    expect(await auditionBlocks(t.db, { userId: "house", authenticated: true }, ROSTER[0])).toEqual(["not_yours"]);

    const thin = await person("New Face", { dates: 1, portrait: false, bio: "Loves exploring in the bedroom." });
    expect(await auditionBlocks(t.db, { userId: thin.owner, authenticated: true }, thin.id)).toEqual(["pg", "portrait", "dates"]);
    await t.db.query(`update characters set visibility = 'private', open_to_dates = false where id = $1`, [ready.id]);
    expect(await auditionBlocks(t.db, { userId: ready.owner, authenticated: true }, ready.id)).toEqual(["private", "not_open"]);
  });

  it("auditions with the owner's consent, one a person a month, and withdraws", async () => {
    vi.useFakeTimers({ now: OCT, toFake: ["Date"] });
    const a = await person("Mara Quill");
    expect((await call(auditionPost, a.id, a.cookie, "POST", {})).status).toBe(422); // no consent, no audition
    const res = await call(auditionPost, a.id, a.cookie, "POST", { consent: true });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ season_id: auditionSeasonId(OCT), label: "November 2026", status: "open", votes: 0, on_cast: null });

    // A second character of the same person can't audition the same month.
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates) values ('fan-two', $1, false, 'Second Act', 30, 'b', '["a","b","c"]'::jsonb, 'w', 'd', 'public', true)`,
      [a.owner],
    );
    expect(await auditionBlocks(t.db, { userId: a.owner, authenticated: true }, "fan-two")).toContain("one_each");

    const back = await (await call(auditionDelete, a.id, a.cookie, "DELETE")).json();
    expect(back).toMatchObject({ status: "withdrawn", blocks: [] });
    expect(await auditionBlocks(t.db, { userId: a.owner, authenticated: true }, "fan-two")).not.toContain("one_each");
    expect((await call(auditionGet, a.id, a.cookie, "GET")).status).toBe(200);
  });
});

describe("the casting board", () => {
  it("one vote a viewer a season (voting again moves it), never for your own, most votes first", async () => {
    vi.useFakeTimers({ now: OCT, toFake: ["Date"] });
    const a = await person("Mara Quill");
    const b = await person("Tobin Reyes");
    for (const p of [a, b]) expect((await call(auditionPost, p.id, p.cookie, "POST", { consent: true })).status).toBe(201);

    expect(await voteAudition(t.db, a.owner, a.id)).toMatchObject({ ok: false, error: "own_character" });
    expect(await voteAudition(t.db, "viewer-1", "nobody")).toMatchObject({ ok: false, error: "not_auditioning" });
    await voteAudition(t.db, "viewer-1", a.id);
    await voteAudition(t.db, "viewer-1", b.id); // moved, not added
    await voteAudition(t.db, "viewer-2", b.id);

    const viewer = signedInCookie(randomUUID());
    const res = await castingPost(jsonRequest("/api/casting", { character_id: a.id }, { cookie: viewer }));
    expect(res.status).toBe(201);
    const board = await (await castingGet(getReq("/api/casting", viewer))).json();
    expect(board).toMatchObject({ label: "November 2026", my_vote: a.id });
    expect(board.auditions.map((x: { character_id: string; votes: number }) => [x.character_id, x.votes])).toEqual([
      [b.id, 2],
      [a.id, 1],
    ]);
  });

  it("the admin's call reaches the owner, and a turned-down audition can't come back this month", async () => {
    vi.useFakeTimers({ now: OCT, toFake: ["Date"] });
    const a = await person("Mara Quill");
    await call(auditionPost, a.id, a.cookie, "POST", { consent: true });
    expect(await reviewAudition(t.db, a.id, "rejected")).toBe(true);
    const notes = (await t.db.query<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'audition'`, [a.owner])).rows;
    expect(notes.map((x) => x.title)).toEqual(["Mara Quill wasn't picked for November 2026"]);
    expect((await call(auditionPost, a.id, a.cookie, "POST", { consent: true })).status).toBe(409);
    expect(await reviewAudition(t.db, "nobody", "approved")).toBe(false);
  });
});

describe("fan picks on the cast", () => {
  /** October's cast stored, and three shortlisted November auditions with 3, 2 and 1 votes. */
  async function shortlisted() {
    vi.useFakeTimers({ now: OCT, toFake: ["Date"] });
    await ensureSeasonCast(t.db, OCT, {});
    const fans = [await person("Mara Quill"), await person("Tobin Reyes"), await person("Ines Haldane")];
    for (const [i, f] of fans.entries()) {
      await call(auditionPost, f.id, f.cookie, "POST", { consent: true });
      await reviewAudition(t.db, f.id, "approved");
      for (let v = 0; v < 3 - i; v++) await voteAudition(t.db, `voter-${i}-${v}`, f.id);
    }
    vi.setSystemTime(NOV);
    return fans;
  }

  it("take the open places by votes before any house newcomer, and the house keeps its two", async () => {
    const fans = await shortlisted();
    const november = await ensureSeasonCast(t.db, NOV, {});
    expect(november).toHaveLength(DEFAULT_SEASON_CAST_SIZE);
    const fanSlots = november.filter((c) => c.source === "fan").map((c) => c.character_id);
    // Two survivors from October, then the two most-voted fans: the third waits for another month.
    expect(fanSlots).toEqual([fans[0].id, fans[1].id]);
    expect(november.filter((c) => c.source !== "fan").every((c) => ROSTER.includes(c.character_id))).toBe(true);
    expect(november.filter((c) => c.source !== "fan")).toHaveLength(HOUSE_MIN);

    await refreshSeasonCast(t.db, NOV);
    expect(seasonCastIds(NOV, {})).toHaveLength(HOUSE_MIN); // the house cast: After Dark, Shorts and step-in read this
    expect(seasonFanCastIds(NOV)).toEqual(fanSlots);
    expect(showCastIds(NOV)).toEqual([...seasonCastIds(NOV, {}), ...fanSlots]);

    // Each owner hears: two are on, the third didn't make it.
    const titles = (await t.db.query<{ title: string }>(`select title from notifications where kind = 'audition' and title like '%cast%' order by title`)).rows.map((r) => r.title);
    expect(titles).toEqual(["Ines Haldane didn't make the November 2026 cast", "Mara Quill is on the November 2026 cast", "Tobin Reyes is on the November 2026 cast"]);
  });

  it("are dated by name without a match, have their sheet locked, and can leave the show at once", async () => {
    const [mara] = await shortlisted();
    await ensureSeasonCast(t.db, NOV, {});
    await refreshSeasonCast(t.db, NOV);
    setSwipeGateForTests(true);

    // Someone else's character books Mara straight from her page: no match needed while she's on the cast.
    const stranger = await person("Rook Danner");
    expect((await ctaMine(t.db, stranger.owner, { id: mara.id, house: false }))[0]).toMatchObject({ mode: "book" });

    // Her sheet is locked; her switches aren't.
    const edit = (body: unknown) => editCharacter(jsonRequest(`/api/characters/${mara.id}`, body, { cookie: mara.cookie, method: "PATCH" }), { params: Promise.resolve({ id: mara.id }) });
    const locked = await edit({ bio: "A new bio entirely." });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ error: "on_the_cast", field: "bio" });

    const status = await (await call(auditionGet, mara.id, mara.cookie, "GET")).json();
    expect(status.on_cast).toMatchObject({ label: "November 2026" });
    await call(auditionDelete, mara.id, mara.cookie, "DELETE");
    expect(seasonFanCastIds(NOV)).toEqual([]); // this instance forgot the loaded cast
    await refreshSeasonCast(t.db, NOV);
    expect(seasonFanCastIds(NOV)).not.toContain(mara.id);
    expect((await edit({ bio: "A new bio entirely." })).status).toBe(200);
    expect((await ctaMine(t.db, stranger.owner, { id: mara.id, house: false }))[0]).toMatchObject({ mode: "match" });
  });

  it("a fan pick that goes private is off the show at the next load", async () => {
    const [mara] = await shortlisted();
    await ensureSeasonCast(t.db, NOV, {});
    await refreshSeasonCast(t.db, NOV);
    expect(seasonFanCastIds(NOV)).toContain(mara.id);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [mara.id]);
    resetStoredSeasonCastForTests();
    await refreshSeasonCast(t.db, NOV);
    expect(seasonFanCastIds(NOV)).not.toContain(mara.id);
  });
});
