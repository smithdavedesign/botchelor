// Tier 0 of the data plan (David, 2026-10-22): opt-in consent to machine-learning use, the gates on the preference
// export (public, aired, opted-in, no After Dark by default), and the cross-species north-star counted once per pair
// from every booking path.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as consentRoute from "@/app/api/me/ml-consent/route";
import { exportAccount, deleteAccount } from "@/lib/account";
import { agentFunnel, recordCrossSpecies } from "@/lib/agent-funnel";
import { registerAccount } from "@/lib/auth";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLineVote } from "@/lib/line-feedback";
import { consentedOwnerSql, getMlConsent, ML_CONSENT_VERSION, setMlConsent } from "@/lib/ml-consent";
import { collectPreferences } from "../scripts/eval/export-preferences.mjs";
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
  await t.db.query("delete from ml_consents");
  await t.db.query("delete from analytics_events");
  await t.db.query("delete from line_feedback");
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
async function character(owner: string, via: "web" | "mcp" = "web"): Promise<string> {
  const id = `mlc-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, created_via)
     values ($1, $2, $3, 30, 'bio', '["kind","bold","warm"]'::jsonb, 'love', 'rudeness', $4)`,
    [id, owner, `Char ${n}`, via],
  );
  return id;
}
async function episode(a: string, b: string, o: { visibility?: string; revealed?: boolean; afterDark?: boolean } = {}): Promise<string> {
  const id = `mlc-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status, revealed_at, setup)
     values ($1, 'creator', $2, $3, 'A bar.', '[]'::jsonb, '[]'::jsonb, '', '', 'friends', $4::jsonb, $5, 'ready', $6, $7::jsonb)`,
    [id, a, b, JSON.stringify(TRANSCRIPT), o.visibility ?? "public", o.revealed === false ? null : new Date().toISOString(), JSON.stringify(o.afterDark ? { after_dark: true } : {})],
  );
  return id;
}
const query = async (sql: string, params: unknown[] = []) => (await t.db.query(sql, params)).rows as Record<string, unknown>[];

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

  it("an agent linked to an account follows its person's choice", async () => {
    const user = await account();
    await t.db.query(`insert into agent_links (agent_id, user_id) values ('agent-xyz', $1)`, [user]);
    const ok = async () => (await t.db.query<{ ok: boolean }>(`select ${consentedOwnerSql("$1")} as ok`, ["agent-xyz"])).rows[0].ok;
    expect(await ok()).toBe(false);
    await setMlConsent(t.db, user, true);
    expect(await ok()).toBe(true);
  });

  it("is in the account export, and goes when the account is deleted", async () => {
    const user = await account();
    await setMlConsent(t.db, user, true);
    expect((await exportAccount(t.db, user)).ml_consent).toEqual([expect.objectContaining({ granted: true, version: ML_CONSENT_VERSION })]);
    await deleteAccount(t.db, user);
    expect((await t.db.query(`select 1 from ml_consents where user_id = $1`, [user])).rows).toHaveLength(0);
  });
});

describe("the preference export's gates (on by default)", () => {
  it("only aired public dates of opted-in owners; never private, unaired or After Dark; drops counted as excluded", async () => {
    const yes = await account();
    const no = await account();
    const consented = await character(yes);
    const silent = await character(no);
    await setMlConsent(t.db, yes, true);

    const good = await episode(consented, HOUSE);
    const noConsent = await episode(silent, HOUSE);
    const priv = await episode(consented, HOUSE, { visibility: "private" });
    const unaired = await episode(consented, HOUSE, { revealed: false });
    const adDate = await episode(consented, HOUSE, { afterDark: true });
    for (const ep of [good, noConsent, priv, unaired, adDate]) await setLineVote(t.db, { userId: "voter", kind: "episode", refId: ep, lineIndex: 0, vote: 1 });
    await setLineVote(t.db, { userId: "voter", kind: "after_dark", refId: "scene-x", lineIndex: 0, vote: 1 });

    const r = await collectPreferences(query, { observer: false });
    expect(r.records.map((x: { ref_id: string }) => x.ref_id)).toEqual([good]);
    expect(r.excluded).toBe(4);
    // After Dark votes never even enter the default query.
    expect(r.votes).toBe(5);
  });
});

describe("the cross-species north-star: once per pair, every booking path", () => {
  it("counts a web × MCP pair once, however many dates; same-kind or same-owner pairs don't count", async () => {
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

  it("the funnel ignores the old episode-keyed rows", async () => {
    await t.db.query(`insert into analytics_events (user_id, event, props) values ('some-episode-id', 'cross_species_match', '{}'::jsonb)`);
    expect((await agentFunnel(t.db)).cross_species).toBe(0);
  });
});
