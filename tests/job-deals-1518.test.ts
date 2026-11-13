import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { dealJobs, JOB_HOLD_MINUTES, unusedJobs, type SheetDraft } from "@/lib/originality";
import { startTestDb } from "./helpers";

// #1518 (the 2026-11-13 visitor runs, 22 board votes): agents on one model checking at once were dealt the same "jobs
// nobody has", and a dealt job was refused as a look-alike on the very next check.
const sheet: SheetDraft = { name: "Odalys Varga", bio: "Keeps a ledger of every storm.", traits: ["dry", "warm", "exact"], extras: { occupation: "a lighthouse keeper" } };
let db: Db;

beforeAll(async () => {
  ({ db } = await startTestDb());
});
beforeEach(async () => {
  await db.query(`delete from job_deals`);
});

describe("dealJobs (#1518)", () => {
  it("never deals one job to two agents at once, even with the same sheet", async () => {
    const lists: string[][] = [];
    for (const by of ["agent-a", "agent-b", "agent-c", "agent-d", "agent-e"]) lists.push(await dealJobs(db, sheet, [], 3, by));
    for (const l of lists) expect(l).toHaveLength(3);
    expect(new Set(lists.flat()).size).toBe(15);
  });

  it("keeps an agent's own deal between check_only and create, and frees a job after the hold", async () => {
    const first = await dealJobs(db, sheet, [], 3, "agent-a");
    expect(await dealJobs(db, sheet, [], 3, "agent-a")).toEqual(first);
    // Another agent can't be dealt them now...
    expect((await dealJobs(db, sheet, [], 40, "agent-b")).filter((j) => first.includes(j))).toEqual([]);
    // ...and once another agent holds what this one would be dealt, this one gets other jobs, until that hold is over.
    await db.query(`update job_deals set holder = 'agent-z' where holder = 'agent-a'`);
    expect((await dealJobs(db, sheet, [], 3, "agent-a")).filter((j) => first.includes(j))).toEqual([]);
    await db.query(`delete from job_deals where holder = 'agent-a'`);
    await db.query(`update job_deals set dealt_at = now() - make_interval(mins => $1)`, [JOB_HOLD_MINUTES + 1]);
    expect(await dealJobs(db, sheet, [], 3, "agent-a")).toEqual(first);
  });

  it("drops a job the look-alike check says would still read like someone", async () => {
    const all = await dealJobs(db, sheet, [], 3, "agent-x");
    await db.query(`delete from job_deals`);
    const banned = all[0];
    const next = await dealJobs(db, sheet, [], 3, "agent-x", (j) => j !== banned);
    expect(next).toHaveLength(3);
    expect(next).not.toContain(banned);
  });

  it("an anonymous caller holds by the sheet's name", async () => {
    const anon = await dealJobs(db, sheet, [], 3, null);
    const agent = await dealJobs(db, sheet, [], 3, "agent-a");
    expect(anon.filter((j) => agent.includes(j))).toEqual([]);
  });

  it("unusedJobs deals through the look-alike pass and holds what it dealt", async () => {
    const dealt = await unusedJobs(db, sheet, 3, "agent-q");
    expect(dealt).toHaveLength(3);
    const { rows } = await db.query<{ job: string }>(`select job from job_deals where holder = 'agent-q'`);
    expect(rows.map((r) => r.job).sort()).toEqual(expect.arrayContaining([...dealt].sort()));
    expect(await unusedJobs(db, sheet, 3, "agent-q")).toEqual(dealt);
    expect((await unusedJobs(db, sheet, 3, "agent-r")).filter((j) => dealt.includes(j))).toEqual([]);
  });
});
