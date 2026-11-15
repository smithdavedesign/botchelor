import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminSeasonGet, POST as adminSeasonPost } from "@/app/api/admin/season/route";
import { auditionWords } from "@/lib/audition-words";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ensureSeasonCast, leadAndSuitors, refreshSeasonCast, resetStoredSeasonCastForTests, seasonCastIds, seasonFanCastIds, setLeadOverride, setSeasonCastForTests, showCastIds } from "@/lib/season-cast";
import { seasonFormat } from "@/lib/season-format";
import { setSeasonFormat, setSeasonFormatForTests } from "@/lib/season-format-store";
import { BASE_URL, startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetStoredSeasonCastForTests();
  setSeasonCastForTests(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  setSeasonFormatForTests(null);
  resetStoredSeasonCastForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const NOV = "2026-11-01";
const DEC = "2026-12-01";
const DEC_1 = new Date(Date.UTC(2026, 11, 1, 6));
const ROSTER = HOUSE_CHARACTERS.map((c) => c.id);

/** November's house cast, stored, with reviews so one of them is the most loved. */
async function november(loved: string) {
  for (const [slot, id] of ROSTER.slice(0, 4).entries()) {
    await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, $3, $4)`, [NOV, id, slot, slot < 2 ? "survivor" : "new"]);
  }
  for (let i = 0; i < 6; i++) await t.db.query(`insert into character_reviews (reviewer_id, character_id, stars, updated_at) values ($1, $2, 5, '2026-11-20T00:00:00Z')`, [`fan-${i}`, loved]);
  for (let i = 0; i < 6; i++) await t.db.query(`insert into character_reviews (reviewer_id, character_id, stars, updated_at) values ($1, $2, 4, '2026-11-20T00:00:00Z')`, [`fan-${i}`, ROSTER[1]]);
}

let n = 0;
/** A person's character, with an account, that applied for December and was approved, with `votes` votes. */
async function applicant(votes: number, opts: { via?: "web" | "mcp"; owner?: string } = {}) {
  const owner = opts.owner ?? randomUUID();
  const id = `app-${++n}`;
  await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3) on conflict do nothing`, [owner, `g-${owner}`, `${owner}@example.test`]);
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates, created_via)
     values ($1, $2, false, $3, 30, 'b', '["a","b","c"]'::jsonb, 'w', 'd', 'public', true, $4)`,
    [id, owner, `Applicant ${n}`, opts.via ?? "web"],
  );
  if (opts.via !== "mcp") {
    await t.db.query(`insert into cast_auditions (season_id, character_id, owner_id, status, decided_at) values ($1, $2, $3, 'approved', now())`, [DEC, id, owner]);
    for (let i = 0; i < votes; i++) await t.db.query(`insert into audition_votes (season_id, voter_id, character_id) values ($1, $2, $3)`, [DEC, `voter-${id}-${i}`, id]);
  }
  return id;
}

/** One of our own agents' characters (made over MCP by an admin-linked agent), with `dates` public dates aired. */
async function ours(dates: number) {
  await t.db.query(`insert into admins (user_id) values ('our-agent') on conflict do nothing`);
  const id = await applicant(0, { via: "mcp", owner: "our-agent" });
  for (let i = 0; i < dates; i++) {
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, seed, status, visibility, revealed_at, transcript)
       values ($1, 'our-agent', $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 1, 'ready', 'public', '2026-11-10T00:00:00Z', '[]'::jsonb)`,
      [`ep-${id}-${i}`, id, ROSTER[i % ROSTER.length]],
    );
  }
  return id;
}

describe("a Botchelor season's cast (lib/season-cast.ts pickLeadCast)", () => {
  it("casts the most reviewed house survivor as the lead and the approved applicants as suitors, by votes, then our agent-made characters by dates", async () => {
    await november(ROSTER[2]);
    await setSeasonFormat(t.db, DEC, "botchelor");
    const [a3, a1, a5] = [await applicant(3), await applicant(1), await applicant(5)];
    const [o2, o7, o0] = [await ours(2), await ours(7), await ours(0)];
    const cast = await ensureSeasonCast(t.db, DEC_1, {});
    expect(cast.map((c) => [c.character_id, c.source])).toEqual([
      [ROSTER[2], "lead"],
      [a5, "suitor"],
      [a3, "suitor"],
      [a1, "suitor"],
      [o7, "suitor"],
      [o2, "suitor"],
    ]);
    expect(cast).toHaveLength(seasonFormat("botchelor").lead!.places);
    expect(cast.map((c) => c.character_id)).not.toContain(o0);
    // Decided once.
    expect(await ensureSeasonCast(t.db, DEC_1, {})).toEqual(cast);

    // Loaded, the house side is the lead alone, the suitors are the fan side, and the show is both.
    await refreshSeasonCast(t.db, DEC_1);
    expect(seasonCastIds(DEC_1, {})).toEqual([ROSTER[2]]);
    expect(seasonFanCastIds(DEC_1)).toEqual([a5, a3, a1, o7, o2]);
    expect(showCastIds(DEC_1)).toHaveLength(6);
    expect(leadAndSuitors(DEC_1)).toEqual({ lead: ROSTER[2], suitors: [a5, a3, a1, o7, o2] });
  });

  it("the admin's pick of a lead wins over the reviews", async () => {
    await november(ROSTER[2]);
    await setSeasonFormat(t.db, DEC, "botchelor");
    await setLeadOverride(t.db, DEC, ROSTER[3]);
    await applicant(1);
    const cast = await ensureSeasonCast(t.db, DEC_1, {});
    expect(cast[0]).toEqual({ character_id: ROSTER[3], slot: 0, source: "lead" });
    expect(cast.filter((c) => c.source === "suitor")).toHaveLength(1);
  });

  it("a classic December is cast exactly as before: survivors, fan picks, newcomers, no lead", async () => {
    await november(ROSTER[2]);
    await applicant(1);
    const cast = await ensureSeasonCast(t.db, DEC_1, {});
    expect(cast.map((c) => c.source)).toEqual(["survivor", "survivor", "fan", "new"]);
    expect(cast[0].character_id).toBe(ROSTER[2]);
    await refreshSeasonCast(t.db, DEC_1);
    expect(leadAndSuitors(DEC_1)).toBeNull();
    expect(seasonCastIds(DEC_1, {})).toHaveLength(3);
  });
});

describe("the words (lib/audition-words.ts)", () => {
  it("call an audition an application to be a suitor under the format, and an audition everywhere else", () => {
    expect(auditionWords(seasonFormat("botchelor").lead)).toMatchObject({ verb: "Apply to be a suitor", noun: "suitor" });
    expect(auditionWords(seasonFormat("classic").lead)).toMatchObject({ verb: "Audition" });
  });
});

describe("/api/admin/season: the lead", () => {
  const PW = ["pw", "for", "lead", "tests"].join("-");
  const headers = { "content-type": "application/json", "x-frontier-key": PW };
  const post = (body: Record<string, unknown>) => adminSeasonPost(new Request(`${BASE_URL}/api/admin/season`, { method: "POST", headers, body: JSON.stringify(body) }));

  it("lists the formats with the lead flag, picks next season's lead, and refuses a stranger as lead", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const view = await (await adminSeasonGet(new Request(`${BASE_URL}/api/admin/season`, { headers }))).json();
    expect(view.formats.find((f: { slug: string }) => f.slug === "botchelor")).toMatchObject({ title: "The Botchelor", lead: true });
    expect(view.formats.find((f: { slug: string }) => f.slug === "classic").lead).toBe(false);
    expect(view.botchelor.leads.length).toBe(ROSTER.length);
    const set = await post({ action: "lead", season_id: view.next_season.id, character_id: ROSTER[1] });
    expect(set.status).toBe(200);
    const after = await set.json();
    expect(after.botchelor.next_season.override).toBe(ROSTER[1]);
    expect(after.note).toContain(HOUSE_CHARACTERS[1].name);
    expect((await post({ action: "lead", season_id: view.next_season.id, character_id: "not-a-house-character" })).status).toBe(400);
    expect((await post({ action: "lead", season_id: "2026-10-19", character_id: ROSTER[1] })).status).toBe(400);
    const cleared = await (await post({ action: "lead", season_id: view.next_season.id, character_id: null })).json();
    expect(cleared.botchelor.next_season.override).toBeNull();
  });
});
