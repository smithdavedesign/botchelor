import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// After Dark's agent cast (lib/adult/agent-cast.ts; David, 2026-11-04): the show's own agent-made characters join every
// person's After Dark once their sheet and their portrait pass, never an outside agent's character.
const hive = vi.hoisted(() => ({ verdicts: [] as unknown[], urls: [] as string[] }));
vi.mock("@/lib/adult/moderation", async (orig) => ({
  ...((await orig()) as object),
  checkMedia: async (_db: unknown, url: string) => {
    hive.urls.push(url);
    return hive.verdicts.shift() ?? { ok: true };
  },
}));
import { GET as statusGet, POST as castPost } from "@/app/api/admin/after-dark/agent-cast/route";
import { agentCastStatus, checkPortraits, checkSheets, PORTRAITS_PER_DAY, setAgentCastModelForTests, sheetVerdict } from "@/lib/adult/agent-cast";
import { eligibleIds, isShowsOwn } from "@/lib/adult/characters";
import { readinessOf } from "@/lib/adult/readiness";
import type { ChatMessage, Model } from "@/lib/model";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  hive.verdicts = [];
  hive.urls = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAgentCastModelForTests(null);
});

const PASS = JSON.stringify({ adult: true, humanoid: true, real_person: false, fits: true, reason: "A grown-up pirate captain." });
/** A model that answers each sheet by the character's name in it, counting its calls. */
function judge(answers: Record<string, string>): Model & { calls: number } {
  const m = {
    calls: 0,
    async complete(messages: ChatMessage[]) {
      m.calls++;
      const sheet = JSON.parse(messages[messages.length - 1].content) as { name: string };
      return answers[sheet.name] ?? PASS;
    },
  };
  return m as unknown as Model & { calls: number };
}

/** Our agent identity: owned characters of an admin are ours (lib/our-traffic.ts loadOurIds). */
async function ourAgent(): Promise<string> {
  const id = crypto.randomUUID();
  await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return id;
}
async function character(owner: string, name: string, extra: { age?: number; created_via?: "mcp" | "web"; portrait?: boolean; visibility?: string } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, visibility)
     values ($1, $2, false, $3, $4, 'Sails the northern routes.', '["bold","warm"]'::jsonb, 'Someone who keeps up', 'Cowardice', $5, $6)`,
    [id, owner, name, extra.age ?? 34, extra.created_via ?? "mcp", extra.visibility ?? "public"],
  );
  if (extra.portrait !== false) {
    await t.db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating)
       values ($1, $2, 'portrait', 'generated', 'test-model', 'https://files.example/p.webp', 'approved', 'pg')`,
      [`asset-${id}`, id],
    );
  }
  return id;
}
const sheetOf = async (id: string) =>
  (await t.db.query<{ sheet_ok: boolean | null; sheet_reason: string | null; portrait_ok: boolean | null }>(`select sheet_ok, sheet_reason, portrait_ok from adult_cast_checks where character_id = $1`, [id])).rows[0];
const isOpen = async (id: string) => (await t.db.query<{ open: boolean }>(`select after_dark_open as open from characters where id = $1`, [id])).rows[0]?.open;

describe("the sheet check", () => {
  it("passes only an adult person, not modelled on a real one, written for adult scenes; anything unreadable fails", () => {
    expect(sheetVerdict(PASS)).toEqual({ ok: true, reason: "A grown-up pirate captain." });
    const v = (o: Record<string, unknown>) => sheetVerdict(JSON.stringify({ adult: true, humanoid: true, real_person: false, fits: true, reason: "x", ...o }));
    expect(v({ adult: false }).reason).toMatch(/^Not clearly an adult/);
    expect(v({ humanoid: false }).reason).toMatch(/^Not a person's body/);
    expect(v({ real_person: true }).reason).toMatch(/^Based on a real person/);
    expect(v({ fits: false }).reason).toMatch(/^Not written for adult scenes/);
    expect(sheetVerdict("not json").ok).toBe(false);
    expect(sheetVerdict(JSON.stringify({ adult: true })).ok).toBe(false);
  });

  it("reads our agent cast once each and never touches an outside agent's (an age under 18 is refused by the table itself)", async () => {
    const ours = await ourAgent();
    const captain = await character(ours, "Captain Ines Varga");
    const minotaur = await character(ours, "Brom the Minotaur");
    const outside = await character(crypto.randomUUID(), "Visitor Vale");
    const model = judge({ "Brom the Minotaur": JSON.stringify({ adult: true, humanoid: false, real_person: false, fits: true, reason: "Half bull." }) });
    setAgentCastModelForTests(model);
    expect(await checkSheets(t.db, { dryRun: true })).toEqual({ checked: 2, passed: 0, failed: 0 });
    expect(await checkSheets(t.db)).toEqual({ checked: 2, passed: 1, failed: 1 });
    expect(model.calls).toBe(2);
    expect((await sheetOf(captain))?.sheet_ok).toBe(true);
    expect((await sheetOf(minotaur))?.sheet_reason).toMatch(/Half bull/);
    expect(await sheetOf(outside)).toBeUndefined();
    // Checked once: a second run asks nothing.
    expect(await checkSheets(t.db)).toEqual({ checked: 0, passed: 0, failed: 0 });
    expect(await isOpen(captain)).toBe(false);
    // After the check changes, the failed ones can be asked again.
    setAgentCastModelForTests(judge({}));
    expect(await checkSheets(t.db, { recheckFailed: true })).toEqual({ checked: 1, passed: 1, failed: 0 });
    expect((await sheetOf(minotaur))?.sheet_ok).toBe(true);
  });
});

describe("the portrait check", () => {
  it("asks Hive about the passed sheets' portraits, opens each adult one, and stops (recording nothing) when Hive can't answer", async () => {
    const ours = await ourAgent();
    const [a, b, c, d] = [
      await character(ours, "Ada Quill"),
      await character(ours, "Bea Strand"),
      await character(ours, "Cal Moreno"),
      await character(ours, "Dee Faraday", { portrait: false }),
    ];
    setAgentCastModelForTests(judge({}));
    await checkSheets(t.db);
    hive.verdicts = [{ ok: true }, { ok: false, reason: "Hive: a possible minor." }, { ok: false, reason: "Hive is paused.", paused: "2026-11-05T00:00:00Z" }];
    const first = await checkPortraits(t.db);
    expect(first).toEqual({ checked: 2, opened: 1, failed: 1, stopped: "Hive is paused." });
    expect(hive.urls[0]).toMatch(/\/api\/assets\/asset-/);
    expect(await isOpen(a)).toBe(true);
    expect(await isOpen(b)).toBe(false);
    expect((await sheetOf(c))?.portrait_ok).toBeNull();
    // The next day: the one Hive couldn't answer is asked again; one with no portrait fails without a check.
    hive.verdicts = [{ ok: true }];
    expect(await checkPortraits(t.db)).toEqual({ checked: 2, opened: 1, failed: 1, stopped: null });
    expect(await isOpen(c)).toBe(true);
    expect(await isOpen(d)).toBe(false);
    const status = await agentCastStatus(t.db);
    expect(status).toMatchObject({ ours: 4, open: 2, sheets: { waiting: 0, passed: 4, failed: 0 }, portraits: { waiting: 0, passed: 2, failed: 2 } });
    expect(status.failures.map((f) => f.reason).sort()).toEqual(["Hive: a possible minor.", "No approved portrait to check."]);
  });

  it("asks at most a day's share of Hive", async () => {
    const ours = await ourAgent();
    for (let i = 0; i < PORTRAITS_PER_DAY + 2; i++) await character(ours, `Crew ${i}`);
    setAgentCastModelForTests(judge({}));
    await checkSheets(t.db);
    expect((await checkPortraits(t.db)).checked).toBe(PORTRAITS_PER_DAY);
    expect((await checkPortraits(t.db)).checked).toBe(2);
  });
});

describe("in After Dark", () => {
  it("is in everyone's After Dark like the house cast: always ready, curated by an admin, and out again when closed", async () => {
    const ours = await ourAgent();
    const captain = await character(ours, "Captain Ines Varga");
    const someone = crypto.randomUUID();
    expect((await eligibleIds(t.db, someone)).has(captain)).toBe(false);
    await t.db.query(`update characters set after_dark_open = true where id = $1`, [captain]);
    expect((await eligibleIds(t.db, someone)).has(captain)).toBe(true);
    expect(await isShowsOwn(t.db, captain)).toBe(true);
    expect(await readinessOf(t.db, ours, captain)).toMatchObject({ own: false, ready: true });
    // A private one never shows, open or not.
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [captain]);
    expect((await eligibleIds(t.db, someone)).has(captain)).toBe(false);
  });

  it("is run by admins only: where it stands, the checks, and taking one out", async () => {
    const ours = await ourAgent();
    const captain = await character(ours, "Captain Ines Varga");
    const call = (body: unknown, cookie: string) =>
      castPost(new Request(`${BASE_URL}/api/admin/after-dark/agent-cast`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    const stranger = signedInCookie(crypto.randomUUID());
    expect((await call({ action: "check_sheets" }, stranger)).status).toBe(403);
    expect((await statusGet(new Request(`${BASE_URL}/api/admin/after-dark/agent-cast`, { headers: { cookie: stranger } }))).status).toBe(403);
    const admin = signedInCookie(ours);
    setAgentCastModelForTests(judge({}));
    expect(await (await call({ action: "check_sheets", dry_run: true }, admin)).json()).toEqual({ checked: 1, passed: 0, failed: 0 });
    expect(await (await call({ action: "check_sheets" }, admin)).json()).toEqual({ checked: 1, passed: 1, failed: 0 });
    expect(await (await call({ action: "check_portraits", max: 5 }, admin)).json()).toEqual({ checked: 1, opened: 1, failed: 0, stopped: null });
    const status = (await (await statusGet(new Request(`${BASE_URL}/api/admin/after-dark/agent-cast`, { headers: { cookie: admin } }))).json()) as { open: number };
    expect(status.open).toBe(1);
    expect((await call({ action: "close", character_id: captain }, admin)).status).toBe(200);
    expect(await isOpen(captain)).toBe(false);
    expect((await call({ action: "close", character_id: captain }, admin)).status).toBe(404);
  });
});
