// Creator invites for casting (lib/casting-invites.ts; docs/casting-invites.md): a code the owner sends an original-character
// creator by hand. Applying with it skips the three public dates an audition needs (and only that), goes in approved, and
// books the character's audition date with the casting lead at once, paid by the show. One code, one character.
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { beaconPath } from "@/app/funnel";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/casting-invites/route";
import { POST as inviteApply } from "@/app/api/casting/invite/[code]/route";
import { POST as auditionPost } from "@/app/api/characters/[id]/audition/route";
import { claimAdmin } from "@/lib/admins";
import { episodeAllowance } from "@/lib/allowance";
import { auditionBlocks, auditionSeasonId } from "@/lib/auditions";
import { CASTING_MET_VIA } from "@/lib/casting";
import { INVITE_COOKIE, INVITE_TERMS, inviteFromCookie, invitePath, isInviteCode } from "@/lib/casting-invite-shared";
import {
  applyWithInvite,
  castingDateWith,
  castingInvitesOn,
  inviteBlocks,
  inviteStatus,
  inviteView,
  loadInvite,
  makeInvites,
  MAX_INVITES_AT_ONCE,
  newInviteCode,
} from "@/lib/casting-invites";
import { openThread } from "@/lib/companion";
import { firstDateFormat } from "@/lib/first-date";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLeadOverride } from "@/lib/season-cast";
import { setSeasonFormat, setSeasonFormatForTests } from "@/lib/season-format-store";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "@/lib/season-window";
import { BASE_URL, episodeJson, jsonRequest, scriptedModel, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// The pages read their cookies through next/headers, and their buttons the router: both stood in for here.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

let logs: string[] = [];
beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from casting_invites`);
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("SITE_URL", "https://botchelor.com");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
});
afterEach(() => {
  setSeasonFormatForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const DAY = 24 * 60 * 60 * 1000;
const PW = ["pw", "for", "invite", "tests"].join("-");
// The lead as casting.test.ts has it: a house character, picked as next season's lead (the preseason, whatever today is).
const LEAD = HOUSE_CHARACTERS[5].id;
const NOW = new Date();
const NEXT = seasonIdOf(nextSeasonStart(NOW));
async function preseason() {
  await setSeasonFormat(t.db, NEXT, "botchelor");
  await setLeadOverride(t.db, NEXT, LEAD);
  await t.db.query(`insert into season_casts (season_id, character_id, slot, source) values ($1, $2, 0, 'lead')`, [NEXT, LEAD]);
}

let n = 0;
/**
 * A person with an account, signed in, and their character made on the site: public, open to dates, a PG portrait, and
 * `dates` aired public dates (none by default: an invited creator's new character).
 */
async function creator(opts: { dates?: number; via?: "web" | "mcp"; account?: boolean; portrait?: boolean; visibility?: string } = {}) {
  const owner = randomUUID();
  const id = `inv-${++n}`;
  const name = `${["Ines", "Tavi", "Bram", "Odile", "Cass", "Wren"][n % 6]} Varga ${n}`;
  if (opts.account !== false) await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [owner, `g-${owner}`, `${owner}@example.test`]);
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates, created_via)
     values ($1, $2, false, $3, 30, 'A lighthouse keeper who collects storms.', '["bold","warm","odd"]'::jsonb, 'love', 'rudeness', $4, true, $5)`,
    [id, owner, name, opts.visibility ?? "public", opts.via ?? "web"],
  );
  if (opts.portrait !== false) {
    await t.db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', 'data:image/png;base64,AA==', 'approved', 'pg')`,
      [`asset-${id}`, id],
    );
  }
  for (let i = 0; i < (opts.dates ?? 0); i++) {
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, visibility, revealed_at)
       values ($1, $2, $3, $4, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready', '[]'::jsonb, '[]'::jsonb, 'public', '2026-10-10T00:00:00Z')`,
      [`ep-${id}-${i}`, owner, id, HOUSE_CHARACTERS[i % 3].id],
    );
  }
  return { owner, id, name, cookie: signedInCookie(owner), auth: { userId: owner, authenticated: true } };
}

async function oneCode(days?: number): Promise<string> {
  const [made] = await makeInvites(t.db, { count: 1, note: "for a test", days });
  return made.code;
}

const apply = (code: string, cookie: string, body: Record<string, unknown>) =>
  inviteApply(jsonRequest(`/api/casting/invite/${code}`, body, { cookie }), { params: Promise.resolve({ code }) });
const applyAs = async (code: string, who: { cookie: string; id: string }, extra: Record<string, unknown> = {}) => {
  const res = await apply(code, who.cookie, { character_id: who.id, consent: true, ...extra });
  return { status: res.status, body: (await res.json()) as Record<string, any>, cookie: res.headers.get("set-cookie") };
};
const admin = (method: "GET" | "POST", body?: unknown, headers: Record<string, string> = { "x-frontier-key": PW }) =>
  (method === "GET" ? adminGet : adminPost)(
    new Request(`${BASE_URL}/api/admin/casting-invites`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  );

const auditionRow = async (characterId: string) =>
  (await t.db.query<{ season_id: string; status: string; owner_id: string }>(`select season_id, status, owner_id from cast_auditions where character_id = $1`, [characterId])).rows;
const datesWithLead = async (characterId: string) =>
  (await t.db.query<{ id: string; met_via: string | null; visibility: string; format: string | null; creator_id: string }>(
    `select id, setup->>'met_via' as met_via, visibility, setup->>'format' as format, creator_id from episodes
      where (character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1) order by created_at`,
    [characterId, LEAD],
  )).rows;
const events = (name: string) => logs.filter((l) => l.includes('"log":"analytics"')).map((l) => JSON.parse(l)).filter((e) => e.event === name);
const scriptDate = () => {
  scriptOutcome({ ending: "friends" });
  return scriptedModel([episodeJson()]);
};

describe("the codes (makeInvites, admin route)", () => {
  it("makes single-use, unguessable codes with their address, a note and an end date", async () => {
    const made = await makeInvites(t.db, { count: 3, note: "  for the SillyTavern writer  ", days: 7 }, NOW);
    expect(made).toHaveLength(3);
    expect(new Set(made.map((m) => m.code)).size).toBe(3);
    for (const m of made) {
      expect(isInviteCode(m.code)).toBe(true);
      expect(m.url).toBe(`https://botchelor.com/casting/invite/${m.code}`);
      expect(m.expires_at).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
    }
    const row = await loadInvite(t.db, made[0].code);
    expect(row).toMatchObject({ season_id: auditionSeasonId(NOW), note: "for the SillyTavern writer", used_at: null, used_by: null, character_id: null });
    // 30 days unless said; never more than MAX_INVITES_AT_ONCE at once; a string that isn't a code is never looked up.
    const [plain] = await makeInvites(t.db, { count: 1 }, NOW);
    expect(plain.expires_at).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(await makeInvites(t.db, { count: 99 }, NOW)).toHaveLength(MAX_INVITES_AT_ONCE);
    expect(await loadInvite(t.db, "nope")).toBeNull();
    expect(await loadInvite(t.db, "aaaaaaaaaa")).toBeNull();
    expect(new Set(Array.from({ length: 200 }, newInviteCode)).size).toBe(200);
    expect(Array.from({ length: 50 }, newInviteCode).every(isInviteCode)).toBe(true);
  });

  it("only the admin makes and lists them: the admin password or a signed-in admin account", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    expect((await admin("POST", { count: 2 }, {})).status).toBe(403);
    expect((await admin("GET", undefined, {})).status).toBe(403);
    expect((await admin("POST", { count: 2 }, { "x-frontier-key": "wrong" })).status).toBe(403);
    const someone = await creator();
    expect((await admin("POST", { count: 2 }, { cookie: someone.cookie })).status).toBe(403);
    // A bad count is refused before anything is made.
    expect((await admin("POST", { count: 0 })).status).toBe(422);
    expect((await admin("POST", { count: MAX_INVITES_AT_ONCE + 1 })).status).toBe(422);
    expect((await t.db.query(`select 1 from casting_invites`)).rows).toHaveLength(0);

    const res = await admin("POST", { count: 2, note: "Chub OC artist", days: 14 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { switched_on: boolean; invites: { code: string; url: string; expires_at: string }[] };
    expect(body.switched_on).toBe(true);
    expect(body.invites).toHaveLength(2);
    expect(body.invites[0].url).toBe(`https://botchelor.com/casting/invite/${body.invites[0].code}`);
    expect(events("casting_invites_made")[0]).toMatchObject({ count: 2 });

    // An admin's own account, signed in, works too.
    const boss = await creator();
    await claimAdmin(t.db, boss.owner);
    expect((await admin("POST", { count: 1 }, { cookie: boss.cookie })).status).toBe(201);

    const list = (await (await admin("GET")).json()) as { invites: { code: string; status: string; note: string | null; character: unknown }[] };
    expect(list.invites).toHaveLength(3);
    expect(list.invites.filter((i) => i.note === "Chub OC artist")).toHaveLength(2);
    expect(list.invites.every((i) => i.status === "open" && i.character === null)).toBe(true);
  });

  it("lists each one as open, used by which character, or expired", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    await preseason();
    const used = await oneCode();
    const open = await oneCode();
    const old = await oneCode(1);
    await t.db.query(`update casting_invites set expires_at = now() - interval '1 hour' where code = $1`, [old]);
    const a = await creator();
    scriptDate();
    expect((await applyAs(used, a)).status).toBe(201);
    const list = (await (await admin("GET")).json()) as { invites: { code: string; status: string; character: { id: string; name: string } | null; used_at: string | null }[] };
    const by = Object.fromEntries(list.invites.map((i) => [i.code, i]));
    expect(by[used]).toMatchObject({ status: "used", character: { id: a.id, name: a.name } });
    expect(by[used].used_at).not.toBeNull();
    expect(by[open]).toMatchObject({ status: "open", character: null });
    expect(by[old]).toMatchObject({ status: "expired", character: null });
    expect(inviteStatus({ used_at: null, expires_at: new Date(NOW.getTime() - 1) }, NOW)).toBe("expired");
  });
});

describe("applying with a code", () => {
  it("skips the three-date wait, and only with a code: everything else an audition asks still holds", async () => {
    const fresh = await creator({ dates: 0 });
    // Without a code: the usual audition still wants its three public dates.
    expect(await auditionBlocks(t.db, fresh.auth, fresh.id)).toEqual(["dates"]);
    const plain = await auditionPost(jsonRequest(`/api/characters/${fresh.id}/audition`, { consent: true }, { cookie: fresh.cookie }), { params: Promise.resolve({ id: fresh.id }) });
    expect(plain.status).toBe(409);
    expect(await auditionRow(fresh.id)).toEqual([]);
    expect(await inviteBlocks(t.db, fresh.auth, fresh.id)).toEqual([]);

    // Every other rule, with a code in hand; the code stays unused after each refusal.
    const code = await oneCode();
    const refused = async (who: { cookie: string; id: string }, status: number, block: string) => {
      const r = await applyAs(code, who);
      expect(r.status).toBe(status);
      expect(r.body.blocks).toContain(block);
      expect((await loadInvite(t.db, code))?.used_at).toBeNull();
    };
    await refused({ ...fresh, cookie: (await creator()).cookie }, 404, "not_yours");
    const anon = await creator({ account: false });
    await refused(anon, 401, "sign_in");
    await refused(await creator({ visibility: "private" }), 409, "private");
    await refused(await creator({ portrait: false }), 409, "portrait");
    await refused(await creator({ via: "mcp" }), 409, "agent_made");
    const closed = await creator();
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [closed.id]);
    await refused(closed, 409, "not_open");
    // One audition a person a season: another of theirs is in already.
    const busy = await creator({ dates: 3 });
    expect((await auditionPost(jsonRequest(`/api/characters/${busy.id}/audition`, { consent: true }, { cookie: busy.cookie }), { params: Promise.resolve({ id: busy.id }) })).status).toBe(201);
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates, created_via)
       values ('inv-second', $1, false, 'Second Act', 30, 'b', '["a","b","c"]'::jsonb, 'w', 'd', 'public', true, 'web')`,
      [busy.owner],
    );
    await t.db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ('asset-second', 'inv-second', 'portrait', 'generated', 'm', 'data:image/png;base64,AA==', 'approved', 'pg')`,
    );
    await refused({ id: "inv-second", cookie: busy.cookie }, 409, "one_each");
    // Turned down this season: a code doesn't bring it back.
    const turned = await creator();
    await t.db.query(`insert into cast_auditions (season_id, character_id, owner_id, status, decided_at) values ($1, $2, $3, 'rejected', now())`, [auditionSeasonId(), turned.id, turned.owner]);
    await refused(turned, 409, "rejected");
    // The terms are on the button: no consent, no application.
    const r = await apply(code, fresh.cookie, { character_id: fresh.id });
    expect(r.status).toBe(422);

    // The fresh character, with the code: in, approved, the code used by it.
    const ok = await applyAs(code, fresh);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ ok: true, season_id: auditionSeasonId(), character_id: fresh.id, again: false });
    expect(await auditionRow(fresh.id)).toEqual([{ season_id: auditionSeasonId(), status: "approved", owner_id: fresh.owner }]);
    expect(await loadInvite(t.db, code)).toMatchObject({ used_by: fresh.owner, character_id: fresh.id });
    // Applied: the cookie that remembered the code is cleared.
    expect(ok.cookie).toContain(`${INVITE_COOKIE}=;`);
    expect(ok.cookie).toContain("Max-Age=0");
    expect(events("audition").filter((e) => e.source === "invite")).toHaveLength(1);
    expect(events("casting_invite_used")[0]).toMatchObject({ code, character_id: fresh.id, step: "applied" });
  });

  it("an open audition of the same character becomes approved; a withdrawn one comes back approved", async () => {
    const a = await creator({ dates: 3 });
    expect((await auditionPost(jsonRequest(`/api/characters/${a.id}/audition`, { consent: true }, { cookie: a.cookie }), { params: Promise.resolve({ id: a.id }) })).status).toBe(201);
    const before = (await t.db.query<{ created_at: Date }>(`select created_at from cast_auditions where character_id = $1`, [a.id])).rows[0].created_at;
    expect((await applyWithInvite(t.db, a.auth, await oneCode(), a.id)).ok).toBe(true);
    const after = (await t.db.query<{ status: string; created_at: Date }>(`select status, created_at from cast_auditions where character_id = $1`, [a.id])).rows[0];
    expect(after.status).toBe("approved");
    expect(new Date(after.created_at).getTime()).toBe(new Date(before).getTime());

    const b = await creator();
    await t.db.query(`insert into cast_auditions (season_id, character_id, owner_id, status, decided_at) values ($1, $2, $3, 'withdrawn', now())`, [auditionSeasonId(), b.id, b.owner]);
    expect((await applyWithInvite(t.db, b.auth, await oneCode(), b.id)).ok).toBe(true);
    expect((await auditionRow(b.id))[0].status).toBe("approved");
  });

  it("one code, one character: used, expired and unknown codes are refused", async () => {
    const code = await oneCode();
    const a = await creator();
    const b = await creator();
    expect((await applyWithInvite(t.db, a.auth, code, a.id)).ok).toBe(true);
    // Someone else with the same code, or the same person with another character.
    expect(await applyWithInvite(t.db, b.auth, code, b.id)).toMatchObject({ ok: false, status: 409, error: "invite_used" });
    expect(await applyWithInvite(t.db, a.auth, code, "inv-another-of-theirs")).toMatchObject({ ok: false, status: 409, error: "invite_used" });
    expect(await auditionRow(b.id)).toEqual([]);

    const old = await oneCode(1);
    expect(await applyWithInvite(t.db, b.auth, old, b.id, { now: new Date(Date.now() + 2 * DAY) })).toMatchObject({ ok: false, status: 410, error: "invite_expired" });
    expect((await loadInvite(t.db, old))?.used_at).toBeNull();
    expect(await applyWithInvite(t.db, b.auth, "zzzzzzzzzz", b.id)).toMatchObject({ ok: false, status: 404, error: "invite_not_found" });
    expect(await applyWithInvite(t.db, b.auth, "../../etc", b.id)).toMatchObject({ ok: false, status: 404, error: "invite_not_found" });
  });

  it("two applications racing for one code: one wins, the other is told it's just been used", async () => {
    const code = await oneCode();
    const [a, b] = [await creator(), await creator()];
    const results = await Promise.all([applyWithInvite(t.db, a.auth, code, a.id), applyWithInvite(t.db, b.auth, code, b.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)[0]).toMatchObject({ status: 409, error: "invite_used" });
    expect((await t.db.query(`select 1 from cast_auditions`)).rows).toHaveLength(1);
  });

  it("saves the creator name they want to be credited by, and refuses one that can't be", async () => {
    const a = await creator();
    const code = await oneCode();
    const bad = await applyAs(code, a, { credit: { handle: "no spaces!", display_name: "Wren" } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.body.field).toBe("credit");
    expect((await loadInvite(t.db, code))?.used_at).toBeNull();
    const ok = await applyAs(code, a, { credit: { handle: "wren_writes", display_name: "Wren Writes" } });
    expect(ok.status).toBe(201);
    expect((await t.db.query(`select handle, display_name from creator_profiles where user_id = $1`, [a.owner])).rows).toEqual([{ handle: "wren_writes", display_name: "Wren Writes" }]);
  });
});

describe("the audition date with the lead", () => {
  it("is booked once, show-paid, public, in the first-date format, and it is the character's casting date", async () => {
    await preseason();
    const a = await creator();
    const allowance = await episodeAllowance(t.db, a.owner);
    const model = scriptDate();
    const r = await applyAs(await oneCode(), a);
    expect(r.status).toBe(201);
    expect(r.body.lead).toMatchObject({ id: LEAD });
    expect(r.body.date).toMatchObject({ booked: true, fresh: true });
    expect(model.calls.length).toBeGreaterThan(0);
    const dates = await datesWithLead(a.id);
    expect(dates).toHaveLength(1);
    expect(dates[0]).toMatchObject({ id: r.body.date.episode_id, met_via: CASTING_MET_VIA, visibility: "public", format: firstDateFormat(), creator_id: a.owner });
    // The show paid: none of the owner's own dates went.
    expect(await episodeAllowance(t.db, a.owner)).toEqual(allowance);
    expect(await castingDateWith(t.db, a.id, { season_id: NEXT, lead: { id: LEAD } as never })).toMatchObject({ id: dates[0].id });

    // The owner hears it, linked to the date.
    const note = (await t.db.query<{ kind: string; title: string; body: string; link: string }>(`select kind, title, body, link from notifications where user_id = $1`, [a.owner])).rows;
    expect(note).toHaveLength(1);
    expect(note[0]).toMatchObject({ kind: "audition", link: `/episodes/${dates[0].id}?play=1` });
    expect(note[0].title).toContain(`shortlisted for ${seasonLabel(auditionSeasonId())}`);
    expect(note[0].body).toContain("no three-date wait");
    expect(events("casting_invite_used")[0]).toMatchObject({ step: "applied", booked: true, fresh: true });
  });

  it("isn't booked again when the character already has its casting date with the lead", async () => {
    await preseason();
    const a = await creator();
    // Its instant first date from the builder went to the lead, as a casting date (either way round).
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, visibility, setup)
       values ('ep-cast', $1, $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'generating', '[]'::jsonb, '[]'::jsonb, 'public', $4::jsonb)`,
      [a.owner, LEAD, a.id, JSON.stringify({ met_via: CASTING_MET_VIA })],
    );
    scriptedModel([]); // any model call would fail the booking
    const r = await applyAs(await oneCode(), a);
    expect(r.status).toBe(201);
    expect(r.body.date).toEqual({ booked: true, episode_id: "ep-cast", fresh: false });
    expect(await datesWithLead(a.id)).toHaveLength(1);
    // A date with the lead that wasn't a casting date doesn't count.
    const b = await creator();
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, visibility, setup)
       values ('ep-chosen', $1, $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready', '[]'::jsonb, '[]'::jsonb, 'public', '{"met_via":"chosen"}'::jsonb)`,
      [b.owner, b.id, LEAD],
    );
    expect(await castingDateWith(t.db, b.id, { season_id: NEXT, lead: { id: LEAD } as never })).toBeNull();
  });

  it("a date that can't be booked leaves the audition standing; the owner's retry books it, once", async () => {
    // No lead picked yet: in, approved, no date.
    const a = await creator();
    const code = await oneCode();
    const first = await applyAs(code, a);
    expect(first.status).toBe(201);
    expect(first.body.date).toMatchObject({ booked: false, reason: "no_lead" });
    expect((await auditionRow(a.id))[0].status).toBe("approved");
    const note = (await t.db.query<{ link: string; body: string }>(`select link, body from notifications where user_id = $1`, [a.owner])).rows[0];
    expect(note.link).toBe(invitePath(code));
    expect(note.body).toContain("The application stands.");

    // The show paused: still no date.
    await preseason();
    vi.stubEnv("BOTCHELOR_PAUSE", "1");
    const paused = await applyAs(code, a);
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ again: true, date: { booked: false, reason: "paused" } });
    vi.stubEnv("BOTCHELOR_PAUSE", "");

    // Someone else can't use the retry.
    const b = await creator();
    expect((await applyAs(code, b)).status).toBe(409);

    // The owner's retry books it; another retry finds it and books nothing more.
    scriptDate();
    const retry = await applyAs(code, a);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ again: true, date: { booked: true, fresh: true } });
    expect(await datesWithLead(a.id)).toHaveLength(1);
    const again = await applyAs(code, a);
    expect(again.body.date).toMatchObject({ booked: true, fresh: false, episode_id: retry.body.date.episode_id });
    expect(await datesWithLead(a.id)).toHaveLength(1);
    expect(events("casting_invite_used").filter((e) => e.step === "date_retry")).toHaveLength(1);

    // Withdrawn since: the retry has nothing to book for.
    await t.db.query(`update cast_auditions set status = 'withdrawn' where character_id = $1`, [a.id]);
    expect((await applyAs(code, a)).body).toMatchObject({ error: "not_auditioning" });
  });

  it("the character texts its person when they opted in to its texts, once", async () => {
    await preseason();
    const a = await creator();
    const opened = await openThread(t.db, a.owner, a.id, new Date(), { opener: false });
    if (!opened.ok) throw new Error("could not open the thread");
    await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [opened.thread_id]);
    scriptDate();
    const code = await oneCode();
    expect((await applyAs(code, a)).status).toBe(201);
    const texts = async () =>
      (await t.db.query<{ text: string; action: string }>(`select m.text, m.action from companion_messages m join companion_threads th on th.id = m.thread_id where th.character_id = $1 and m.action like 'casting_invite:%'`, [a.id])).rows;
    const first = await texts();
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((m) => m.action === `casting_invite:${code}`)).toBe(true);
    expect(first.map((m) => m.text).join(" ")).toContain("No waiting in line.");
    // Not opted in: no text (a second person, same flow).
    const b = await creator();
    scriptDate();
    expect((await applyAs(await oneCode(), b)).status).toBe(201);
    expect((await t.db.query(`select 1 from companion_threads where character_id = $1`, [b.id])).rows).toHaveLength(0);
  });
});

describe("the switch and the page's states", () => {
  it("CASTING_INVITES=0 closes the page and refuses every application; the admin can still make codes", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const code = await oneCode();
    const a = await creator();
    expect(castingInvitesOn()).toBe(true);
    vi.stubEnv("CASTING_INVITES", "0");
    expect(castingInvitesOn()).toBe(false);
    const r = await applyAs(code, a);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("invites_closed");
    expect(await auditionRow(a.id)).toEqual([]);
    expect(inviteView(await loadInvite(t.db, code), a.owner)).toEqual({ state: "closed" });
    const made = await admin("POST", { count: 1 });
    expect(made.status).toBe(201);
    expect(((await made.json()) as { switched_on: boolean }).switched_on).toBe(false);
    vi.stubEnv("CASTING_INVITES", "1");
    expect(castingInvitesOn()).toBe(true);
  });

  it("says what a code is to whoever opens it", async () => {
    const code = await oneCode();
    const row = await loadInvite(t.db, code);
    expect(inviteView(null, null)).toEqual({ state: "invalid" });
    expect(inviteView(row, null)).toMatchObject({ state: "open" });
    expect(inviteView(row, null, new Date(Date.now() + 31 * DAY))).toEqual({ state: "expired" });
    const a = await creator();
    expect((await applyWithInvite(t.db, a.auth, code, a.id)).ok).toBe(true);
    const used = await loadInvite(t.db, code);
    expect(inviteView(used, a.owner)).toMatchObject({ state: "yours", character_id: a.id });
    expect(inviteView(used, "someone-else")).toEqual({ state: "used" });
    expect(inviteView(used, null)).toEqual({ state: "used" });
    // The cookie holds a code only.
    expect(inviteFromCookie(code)).toBe(code);
    expect(inviteFromCookie("not a code")).toBeNull();
    expect(inviteFromCookie(undefined)).toBeNull();
  });
});

describe("the invite page (/casting/invite/[code])", () => {
  const render = async (code: string) => {
    const Page = (await import("@/app/casting/invite/[code]/page")).default;
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ code }) }));
  };
  /** As the browser sends it: the signed session cookie only. */
  const signIn = (cookie: string) => {
    const [name, value] = cookie.split("=");
    jar.cookies.set(name, value);
  };
  const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

  it("is never indexed, and a code that can't be used says so in one line, with the way to the casting", async () => {
    const { metadata } = await import("@/app/casting/invite/[code]/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    // A code that was never made is a real 404 (2026-11-22 audit): the site's not-found page, not a 200 that says so.
    await expect(render("zzzzzzzzzz")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    const old = await oneCode(1);
    await t.db.query(`update casting_invites set expires_at = now() - interval '1 minute' where code = $1`, [old]);
    expect(await render(old)).toContain("This invite has expired");
    vi.stubEnv("CASTING_INVITES", "0");
    expect(await render(await oneCode())).toContain("Creator invites are closed right now");
  });

  it("shows the lead, the offer and the terms; a visitor without a character makes or brings one, and the builder comes back", async () => {
    await preseason();
    const code = await oneCode();
    const html = unescape(await render(code));
    const lead = HOUSE_CHARACTERS[5];
    const first = lead.name.split(/\s+/)[0];
    expect(html).toContain(`You're invited to ${new Date(`${NEXT}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}'s The Botchelor`);
    expect(html).toContain(lead.name);
    expect(html).toContain("five suitors, a rose ceremony every Sunday, and the audience votes");
    expect(html).toContain(`skips the usual three-date wait and goes straight on an audition date with ${first}`);
    expect(html).toContain(INVITE_TERMS);
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/content-policy"');
    expect(html).toContain(`href="/create?next=${encodeURIComponent(invitePath(code))}"`);
    expect(html).toContain('href="/import"');
    expect(html).toContain(`/account?next=${encodeURIComponent(invitePath(code))}`);
    expect(html).not.toContain("Apply with");
    // The analytics count every invite as one page, never its code.
    expect(beaconPath(invitePath(code))).toBe("/casting/invite");
    expect(beaconPath("/gate", `?from=${encodeURIComponent(invitePath(code))}`)).toBe("/casting/invite");
  });

  it("a signed-in owner picks a character that can apply; after applying, the page is theirs: shortlisted, and the date", async () => {
    await preseason();
    const code = await oneCode();
    const a = await creator();
    const thin = await creator({ portrait: false });
    await t.db.query(`update characters set owner_id = $1 where id = $2`, [a.owner, thin.id]);
    signIn(a.cookie);
    const before = unescape(await render(code));
    expect(before).toContain(`Apply with ${a.name.split(/\s+/)[0]}`);
    expect(before).toContain("Your creator name (optional)");
    // Only the ones that can apply are offered.
    expect(before).not.toContain(thin.name);
    scriptDate();
    expect((await applyAs(code, a)).status).toBe(201);
    const after = unescape(await render(code));
    expect(after).toContain(`${a.name.split(/\s+/)[0]} is in`);
    expect(after).toContain(`Shortlisted for ${seasonLabel(auditionSeasonId())}`);
    expect(after).toMatch(/href="\/episodes\/[^"]+\?play=1"/);
    // Anyone else opening it sees a used invite.
    jar.cookies.clear();
    expect(await render(code)).toContain("This invite has been used");
    // A person whose characters can't apply yet hears why, and can start a new one.
    const other = await creator({ portrait: false });
    signIn(other.cookie);
    const blocked = unescape(await render(await oneCode()));
    expect(blocked).toContain(`${other.name}</a>: It needs a portrait first.`);
    expect(blocked).toContain("Make your character");
    expect(blocked).not.toContain("Apply with");
  });
});
