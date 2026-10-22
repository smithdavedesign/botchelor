// Tier 0 of the data plan (David, 2026-10-22; docs/data-plan.md): opt-in consent to machine-learning use, the gates on
// the preference export (public, aired, opted-in characters AND opted-in voters, the current wording, never After Dark),
// and the cross-species north-star counted from the dates themselves.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as consentRoute from "@/app/api/me/ml-consent/route";
import { exportAccount, deleteAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { agentFunnel, crossSpeciesPairs, recordCrossSpecies } from "@/lib/agent-funnel";
import { confirmLink, createLinkCode } from "@/lib/agent-links";
import { registerAccount } from "@/lib/auth";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLineVote } from "@/lib/line-feedback";
import * as mlConsent from "@/lib/ml-consent";
import { consentedOwnerSql, getMlConsent, ML_CONSENT_VERSION, setMlConsent } from "@/lib/ml-consent";
import { collectPreferences, loadConsent, parseArgs } from "../scripts/eval/export-preferences.mjs";
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
const TRANSCRIPT = [
  { side: "a", act: 0, dialogue: "Hello there.", action: "", emotion: "pleased", interest: 0.6 },
  { side: "b", act: 0, dialogue: "Hi.", action: "", emotion: "dry", interest: 0.5 },
];

let n = 0;
async function account(): Promise<string> {
  const userId = userIdOf(newUserCookie());
  await registerAccount(t.db, userId, `mlc${++n}${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
  return userId;
}
/** An account that opted in. */
async function optedIn(): Promise<string> {
  const user = await account();
  await setMlConsent(t.db, user, true);
  return user;
}
async function character(owner: string, via: "web" | "mcp" = "web"): Promise<string> {
  const id = `mlc-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, created_via)
     values ($1, $2, $3, 30, 'bio', '["kind","bold","warm"]'::jsonb, 'love', 'rudeness', $4)`,
    [id, owner, `Char ${n}`, via],
  );
  return id;
}
type EpisodeOpts = { visibility?: string; revealed?: boolean; afterDark?: boolean; status?: string; at?: string };
async function episode(a: string, b: string, o: EpisodeOpts = {}): Promise<string> {
  const id = `mlc-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status, revealed_at, setup, created_at)
     values ($1, 'creator', $2, $3, 'A bar.', '[]'::jsonb, '[]'::jsonb, '', '', 'friends', $4::jsonb, $5, $6, $7, $8::jsonb, coalesce($9::timestamptz, now()))`,
    [
      id,
      a,
      b,
      JSON.stringify(TRANSCRIPT),
      o.visibility ?? "public",
      o.status ?? "ready",
      o.revealed === false ? null : new Date().toISOString(),
      JSON.stringify(o.afterDark ? { after_dark: true } : {}),
      o.at ?? null,
    ],
  );
  return id;
}
/** A vote by `voter` on line 0 (or `line`), at `at` when given. */
async function vote(voter: string, ep: string, o: { line?: number; value?: 1 | -1; at?: string } = {}) {
  await setLineVote(t.db, { userId: voter, kind: "episode", refId: ep, lineIndex: o.line ?? 0, vote: o.value ?? 1 });
  if (o.at) {
    await t.db.query(`update line_feedback set created_at = $2, updated_at = $2 where user_id = $1 and ref_id = $3 and line_index = $4`, [voter, o.at, ep, o.line ?? 0]);
  }
}
const query = async (sql: string, params: unknown[] = []) => (await t.db.query(sql, params)).rows as Record<string, unknown>[];
/** The export as the script runs it, with lib/ml-consent.ts handed in (loadConsent's own test is below). */
const exported = async () => collectPreferences(query, { consent: mlConsent });
const refsOf = (r: { records: { ref_id: string }[] }) => r.records.map((x) => x.ref_id);

describe("ml consent: opt-in per account", () => {
  const call = (method: "GET" | "POST" | "DELETE", cookie?: string) =>
    consentRoute[method](new Request(`${BASE_URL}/api/me/ml-consent`, { method, headers: cookie ? { cookie } : {} }));

  it("is off until chosen, and an anonymous session can't choose", async () => {
    const anon = newUserCookie();
    expect((await call("POST", anon)).status).toBe(401);
    expect((await call("DELETE", anon)).status).toBe(401);
    expect(await getMlConsent(t.db, userIdOf(anon))).toEqual({ granted: false, version: null, decided_at: null });
    // No account row: setMlConsent records nothing.
    await setMlConsent(t.db, userIdOf(anon), true);
    expect((await getMlConsent(t.db, userIdOf(anon))).granted).toBe(false);
  });

  it("a signed-in account opts in and out, with the wording version", async () => {
    const user = await account();
    const cookie = signedInCookie(user);
    const on = await (await call("POST", cookie)).json();
    expect(on).toMatchObject({ granted: true, version: ML_CONSENT_VERSION });
    const off = await (await call("DELETE", cookie)).json();
    expect(off.granted).toBe(false);
    expect((await (await call("GET", cookie)).json()).granted).toBe(false);
  });

  it("a yes to an older wording counts as no until it's given again, and the account page is told", async () => {
    const user = await account();
    await t.db.query(`insert into ml_consents (user_id, granted, version) values ($1, true, '2026-01-01')`, [user]);
    const ok = async () => (await t.db.query<{ ok: boolean }>(`select ${consentedOwnerSql("$1", "now()")} as ok`, [user])).rows[0].ok;
    expect(await getMlConsent(t.db, user)).toMatchObject({ granted: false, version: "2026-01-01", outdated: true });
    expect(await ok()).toBe(false);
    expect(await setMlConsent(t.db, user, true)).toMatchObject({ granted: true, version: ML_CONSENT_VERSION });
    expect((await getMlConsent(t.db, user)).outdated).toBeUndefined();
    expect(await ok()).toBe(true);
  });

  it("an agent linked to an account follows its person's choice, from the link on", async () => {
    const user = await account();
    await t.db.query(`insert into agent_links (agent_id, user_id, linked_at) values ('agent-xyz', $1, '2026-10-10T00:00:00Z')`, [user]);
    const ok = async (at: string) => (await t.db.query<{ ok: boolean }>(`select ${consentedOwnerSql("$1", "$2::timestamptz")} as ok`, ["agent-xyz", at])).rows[0].ok;
    expect(await ok("2026-10-11T00:00:00Z")).toBe(false);
    await setMlConsent(t.db, user, true);
    expect(await ok("2026-10-11T00:00:00Z")).toBe(true);
    // Before the link, the agent wasn't this person's to speak for.
    expect(await ok("2026-10-09T00:00:00Z")).toBe(false);
  });

  it("a link to the same account again keeps its time; a move to another account starts a new one", async () => {
    const first = await account();
    const second = await account();
    const linkAt = async (who: string, at: string) => {
      const { code } = await createLinkCode(t.db, "agent-move", new Date(at));
      expect((await confirmLink(t.db, code, who, new Date(at))).ok).toBe(true);
      return (await t.db.query<{ user_id: string; linked_at: Date }>(`select user_id, linked_at from agent_links where agent_id = 'agent-move'`)).rows[0];
    };
    expect(new Date((await linkAt(first, "2026-10-01T00:00:00Z")).linked_at).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date((await linkAt(first, "2026-10-05T00:00:00Z")).linked_at).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const moved = await linkAt(second, "2026-10-08T00:00:00Z");
    expect(moved.user_id).toBe(second);
    expect(new Date(moved.linked_at).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("is in the account export, and goes when the account is deleted, with its votes and its agents' links", async () => {
    const user = await optedIn();
    await t.db.query(`insert into agent_links (agent_id, user_id) values ('agent-of-user', $1)`, [user]);
    const ep = await episode(await character(user), HOUSE);
    await vote(user, ep);
    const out = await exportAccount(t.db, user);
    expect(out.ml_consent).toEqual([expect.objectContaining({ granted: true, version: ML_CONSENT_VERSION })]);
    expect(out.line_feedback).toEqual([expect.objectContaining({ kind: "episode", ref_id: ep, line_index: 0, vote: 1 })]);
    await deleteAccount(t.db, user);
    expect((await t.db.query(`select 1 from ml_consents where user_id = $1`, [user])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from line_feedback where user_id = $1`, [user])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from agent_links where user_id = $1`, [user])).rows).toHaveLength(0);
  });
});

describe("the preference export's gates (on by default)", () => {
  it("only aired public dates of opted-in owners; never private, unlisted, unaired, unfinished, report-hidden or After Dark", async () => {
    const yes = await optedIn();
    const fan = await optedIn();
    const consented = await character(yes);
    const silent = await character(await account());

    const good = await episode(consented, HOUSE);
    const dropped = {
      noConsent: await episode(silent, HOUSE),
      priv: await episode(consented, HOUSE, { visibility: "private" }),
      unlisted: await episode(consented, HOUSE, { visibility: "unlisted" }),
      unaired: await episode(consented, HOUSE, { revealed: false }),
      unfinished: await episode(consented, HOUSE, { status: "generating" }),
      afterDark: await episode(consented, HOUSE, { afterDark: true }),
      hidden: await episode(consented, HOUSE),
    };
    for (let i = 0; i < 3; i++) {
      await t.db.query(`insert into reports (episode_id, reporter_id, reason) values ($1, $2, 'other')`, [dropped.hidden, `reporter-${i}`]);
    }
    for (const ep of [good, ...Object.values(dropped)]) await vote(fan, ep);
    await setLineVote(t.db, { userId: fan, kind: "after_dark", refId: "scene-x", lineIndex: 0, vote: 1 });

    const r = await exported();
    expect(refsOf(r)).toEqual([good]);
    expect(r.excluded).toBe(Object.keys(dropped).length);
    // After Dark votes never even enter the query.
    expect(r.votes).toBe(1 + Object.keys(dropped).length);
  });

  it("a vote counts only from someone who opted in: a line nobody who opted in rated is left out", async () => {
    const fan = await optedIn();
    const lapsed = await optedIn();
    await setMlConsent(t.db, lapsed, false); // opted in, then out
    const good = await episode(await character(await optedIn()), HOUSE);
    await vote(fan, good, { line: 0, value: 1 });
    await vote("anon-stranger", good, { line: 0, value: -1 });
    await vote(lapsed, good, { line: 0, value: -1 });
    await vote("anon-stranger", good, { line: 1, value: 1 });
    await vote(lapsed, good, { line: 1, value: 1 });

    const r = await exported();
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ ref_id: good, line_index: 0, votes: { up: 1, down: 0, voters: 1, score: 1 } });
    expect(r.excluded).toBe(1);
  });

  it("an opted-in person's date with a non-consenting person's character drops whole", async () => {
    const fan = await optedIn();
    const mixed = await episode(await character(await optedIn()), await character(await account()));
    await vote(fan, mixed);
    const r = await exported();
    expect(r.records).toEqual([]);
    expect(r.excluded).toBe(1);
  });

  it("opting out leaves you out of the next export", async () => {
    const fan = await optedIn();
    const owner = await optedIn();
    const ep = await episode(await character(owner), HOUSE);
    await vote(fan, ep);
    expect(refsOf(await exported())).toEqual([ep]);
    await setMlConsent(t.db, owner, false);
    expect(refsOf(await exported())).toEqual([]);
    await setMlConsent(t.db, owner, true);
    await setMlConsent(t.db, fan, false);
    expect(refsOf(await exported())).toEqual([]);
  });

  it("a yes to an older wording is left out", async () => {
    const fan = await optedIn();
    const owner = await account();
    await t.db.query(`insert into ml_consents (user_id, granted, version) values ($1, true, '2026-01-01')`, [owner]);
    await vote(fan, await episode(await character(owner), HOUSE));
    expect((await exported()).records).toEqual([]);
  });

  it("an agent: unlinked, no consent; linked, its person's from the link on; relinked, the new account never covers the old dates", async () => {
    const fan = await optedIn();
    const quiet = await account();
    const keen = await optedIn();

    // Never linked to anyone: nobody consented for it.
    const loner = await character("agent-loner", "mcp");
    const lonerDate = await episode(loner, HOUSE);

    // Linked to a quiet account on the 1st, then moved to an opted-in one on the 10th (what confirmLink does).
    const mover = await character("agent-mover", "mcp");
    await t.db.query(`insert into agent_links (agent_id, user_id, linked_at) values ('agent-mover', $1, '2026-10-01T00:00:00Z')`, [quiet]);
    const before = await episode(mover, HOUSE, { at: "2026-10-05T00:00:00Z" });
    await t.db.query(`update agent_links set user_id = $1, linked_at = '2026-10-10T00:00:00Z' where agent_id = 'agent-mover'`, [keen]);
    const after = await episode(mover, HOUSE, { at: "2026-10-12T00:00:00Z" });

    for (const ep of [lonerDate, before, after]) await vote(fan, ep);
    const r = await exported();
    expect(refsOf(r)).toEqual([after]);
    expect(r.excluded).toBe(2);

    // The agent's own votes follow the same rule: one cast before the link doesn't count, one after does.
    const house = await episode(HOUSE_CHARACTERS[1].id, HOUSE);
    await vote("agent-mover", house, { line: 0, at: "2026-10-09T00:00:00Z" });
    await vote("agent-mover", house, { line: 1, at: "2026-10-11T00:00:00Z" });
    const lines = (await exported()).records.filter((x) => x.ref_id === house).map((x) => x.line_index);
    expect(lines).toEqual([1]);
  });

  it("the script loads lib/ml-consent.ts itself: the same SQL, never a copy", async () => {
    const loaded = await loadConsent();
    expect(loaded.consentedOwnerSql("c.owner_id", "e.created_at")).toBe(consentedOwnerSql("c.owner_id", "e.created_at"));
    // And collecting without handing it in loads it the same way, gates on.
    const fan = await optedIn();
    const ep = await episode(await character(await optedIn()), HOUSE);
    await vote(fan, ep);
    await vote(fan, await episode(await character(await account()), HOUSE));
    const r = await collectPreferences(query);
    expect(refsOf(r)).toEqual([ep]);
    expect(r.excluded).toBe(1);
  }, 60_000);

  it("has no way to ask for After Dark", () => {
    expect(() => parseArgs(["--include-after-dark"])).toThrow(/never exported/);
    expect(() => parseArgs(["--kind", "after_dark"])).toThrow(/unknown option/);
  });
});

describe("the cross-species north-star: real pairs, counted from the dates", () => {
  it("counts a web × MCP pair once, however many dates and booking paths; same-kind or same-owner pairs don't count", async () => {
    const human = await account();
    const web = await character(human, "web");
    const bot = await character("agent-owner-1", "mcp");
    const otherWeb = await character(await account(), "web");
    const ep1 = await episode(web, bot);
    const ep2 = await episode(bot, web);
    const same = await episode(web, otherWeb);
    await recordCrossSpecies(t.db, ep1, "booking");
    await recordCrossSpecies(t.db, ep2, "own_date");
    await recordCrossSpecies(t.db, same, "booking");
    const rows = (await t.db.query<{ user_id: string; props: Record<string, unknown> }>(`select user_id, props from analytics_events where event = 'cross_species_match'`)).rows;
    expect(rows).toHaveLength(1);
    const [lo, hi] = [web, bot].sort();
    expect(rows[0].user_id).toBe(`pair:${lo}:${hi}`);
    // No owner ids in the props.
    expect(JSON.stringify(rows[0].props)).not.toContain(human);
    expect((await agentFunnel(t.db)).cross_species).toBe(1);
  });

  it("never counts a private or unfinished date, our own traffic, or a person with their own linked agent", async () => {
    const pair = async (o: EpisodeOpts = {}, owners: { person?: string; agent?: string } = {}) =>
      episode(await character(owners.person ?? (await account()), "web"), await character(owners.agent ?? `agent-${++n}`, "mcp"), o);
    await pair(); // counts
    await pair({ visibility: "unlisted" }); // counts: viewable by link, a real date
    await pair({ visibility: "private" });
    await pair({ status: "generating" });
    // A person's web character dating the character of the agent linked to that same person.
    const self = await account();
    await t.db.query(`insert into agent_links (agent_id, user_id) values ('agent-self', $1)`, [self]);
    await pair({}, { person: self, agent: "agent-self" });
    // Ours: an admin's character, and an agent that connects as one of our checks.
    const admin = await account();
    await claimAdmin(t.db, admin);
    await pair({}, { person: admin });
    await t.db.query(`insert into mcp_sessions (id, agent_id, client_name) values ('sess-ours', 'agent-check', 'botchelor-live-check')`);
    await pair({}, { agent: "agent-check" });

    expect(await crossSpeciesPairs(t.db)).toBe(2);
    expect((await agentFunnel(t.db)).cross_species).toBe(2);
  });

  it("reads the same with no booking log at all: the rows #666 stripped can't change it", async () => {
    await episode(await character(await account(), "web"), await character("agent-solo", "mcp"));
    // An old episode-keyed row with its owner ids stripped, and nothing else in the log.
    await t.db.query(`insert into analytics_events (user_id, event, props) values ('some-episode-id', 'cross_species_match', '{}'::jsonb)`);
    expect((await agentFunnel(t.db)).cross_species).toBe(1);
    await t.db.query(`delete from analytics_events`);
    expect((await agentFunnel(t.db)).cross_species).toBe(1);
  });
});
