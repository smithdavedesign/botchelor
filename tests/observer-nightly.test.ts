// The nightly After Dark observer (scripts/eval/observer-nightly.mjs) on a PGlite fixture: which pairs changed in the last
// day, each observed with lib/adult/observer.ts through the observer script's own fromDb, the report written, one summary
// row posted and one event emitted. The database is read-only throughout, as it is on production.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as observer from "@/lib/adult/observer";
import { ensureSchema, pgliteDb } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runNightly, selectChangedPairs, summarize, type Query, type QualityRow } from "../scripts/eval/observer-nightly.mjs";

const NOW = new Date("2026-10-21T06:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const [H0, H1, H2, H3] = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id).sort();
const ADMIN = "admin-1";
const OTHER_ADMIN = "admin-2";

let pg: PGlite;
let query: Query;
let dir: string;

const line = (who: "a" | "b", text: string, why?: string, memory?: string | null) => ({ who, text, ...(why ? { why, memory: memory ?? null } : {}) });
const NIGHT = [
  line("a", "*smiles* Hi there, you came.", "she's glad", null),
  line("b", "I said I would. I keep promises.", "his want", "the karaoke night"),
  line("a", "*smiles* Hi there, you came.", "nerves", null), // a word-for-word repeat
  line("b", "Shall we go somewhere quieter?"),
  line("a", "Lead the way."),
];

async function scene(id: string, owner: string, a: string, b: string, lines: unknown[], updatedHoursAgo: number) {
  await pg.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines, created_at, updated_at) values ($1, $2, $3, $4, $5::jsonb, $6, $6)`, [
    id,
    owner,
    a,
    b,
    JSON.stringify(lines),
    hoursAgo(updatedHoursAgo),
  ]);
}
async function night(id: string, owner: string, a: string, b: string, lines: unknown[], createdHoursAgo: number, chapter = 1) {
  await pg.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, chapter, created_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`, [
    id,
    owner,
    a,
    b,
    JSON.stringify(lines),
    chapter,
    hoursAgo(createdHoursAgo),
  ]);
}

beforeAll(async () => {
  pg = new PGlite();
  await ensureSchema(pgliteDb(pg));
  // Changed: a scene written 2 hours ago (and a night filed earlier the same day).
  await scene("s1", ADMIN, H0, H1, NIGHT, 2);
  await night("n1a", ADMIN, H0, H1, NIGHT.slice(0, 2), 30);
  // Changed only by a night filed 5 hours ago (its scene, empty since, was last written three days ago).
  await scene("s2", ADMIN, H0, H2, [], 72);
  await night("n2", ADMIN, H0, H2, NIGHT, 5);
  // Not changed: everything older than a day.
  await scene("s3", ADMIN, H1, H2, NIGHT, 30);
  await night("n3", ADMIN, H1, H2, NIGHT, 40);
  // Another admin's pair, written an hour ago.
  await scene("s4", OTHER_ADMIN, H2, H3, NIGHT.slice(0, 3), 1);
  // Changed but empty (Start over on a scene with no lines yet): nothing to observe.
  await scene("s5", ADMIN, H1, H3, [], 3);
  // From here on, read-only, like production.
  await pg.query("set default_transaction_read_only = on");
  query = async (sql, params = []) => (await pg.query(sql, params)).rows as Record<string, unknown>[];
  dir = mkdtempSync(join(tmpdir(), "observer-nightly-"));
});
afterAll(async () => {
  await pg.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("which pairs changed in the last day", () => {
  it("a scene written, or a night filed, since then: one row per owner and pair, the latest first", async () => {
    const pairs = await selectChangedPairs(query, { since: hoursAgo(24) });
    expect(pairs.map((p) => [p.owner, p.a, p.b])).toEqual([
      [OTHER_ADMIN, H2, H3],
      [ADMIN, H0, H1],
      [ADMIN, H1, H3],
      [ADMIN, H0, H2],
    ]);
    expect(pairs[1]).toMatchObject({ scene_changed: true, nights_changed: 0, changed_at: hoursAgo(2) });
    expect(pairs[3]).toMatchObject({ scene_changed: false, nights_changed: 1, changed_at: hoursAgo(5) });
  });

  it("only one admin's pairs, and a longer window", async () => {
    expect((await selectChangedPairs(query, { since: hoursAgo(24), owner: OTHER_ADMIN })).map((p) => p.b)).toEqual([H3]);
    expect(await selectChangedPairs(query, { since: hoursAgo(48) })).toHaveLength(5);
  });
});

describe("the nightly run", () => {
  it("observes each changed pair's latest night, writes the report, posts one summary row and emits one event", async () => {
    const posted: QualityRow[] = [];
    const events: [string, string][] = [];
    const r = await runNightly({
      query,
      lib: observer,
      now: NOW,
      outDir: dir,
      sha: "abc1234",
      post: async (row) => {
        posted.push(row);
        return { ok: true };
      },
      emit: async (status, message) => {
        events.push([status, message]);
      },
    });
    expect(r.file).toBe(join(dir, "nightly-2026-10-21.json"));
    const out = JSON.parse(readFileSync(r.file!, "utf8"));
    expect(out).toMatchObject({ date: "2026-10-21", since: hoursAgo(24), hours: 24, sha: "abc1234" });
    expect(out.pairs).toHaveLength(4);

    const byPair = Object.fromEntries(out.pairs.map((p: { a: string; b: string }) => [`${p.a}/${p.b}`, p]));
    // The running scene is the pair's latest night (its night of 30 hours ago was an earlier one, started over since).
    const s1 = byPair[`${H0}/${H1}`];
    expect(s1.report.lines).toBe(5);
    expect(s1.chapters).toEqual([{ chapter: 1, id: "s1", source: "scene", lines: 5 }]);
    expect(s1.report.summary.verbatim_repeats).toBe(1);
    expect(s1.report.findings.map((f: { check: string }) => f.check)).toEqual(expect.arrayContaining(["verbatim_repeat", "unfounded_memory"]));
    // The night filed 5 hours ago is that pair's latest; each chapter keeps its id, for the preference export.
    expect(byPair[`${H0}/${H2}`].chapters).toEqual([{ chapter: 1, id: "n2", source: "night", lines: 5 }]);
    // The empty one can't be observed, and the rest carry on.
    expect(byPair[`${H1}/${H3}`]).toMatchObject({ error: expect.stringMatching(/no saved nights or scene lines/) });

    expect(r.summary).toMatchObject({ pairs: 4, observed: 3, errors: 1, lines: 5 + 5 + 3, verbatim_repeats: 3, unfounded_memories: 3, unprovoked_moves: 0 });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: "after_dark_observer", label: "nightly-2026-10-21", sha: "abc1234", at: NOW.toISOString(), metrics: { pairs: 4, errors: 1, lines: 13 } });
    expect(events).toEqual([["ok", "4 pairs, 13 lines: 0 unprovoked moves, 0 my-place-when-there, 3 repeats, 3 unfounded memories, 1 couldn't be read"]]);
  });

  it("a quiet night writes its report, posts nothing and says so", async () => {
    const posted: unknown[] = [];
    const events: [string, string][] = [];
    const later = new Date(NOW.getTime() + 10 * 86_400_000);
    const r = await runNightly({ query, lib: observer, now: later, outDir: dir, post: async (row) => posted.push(row), emit: async (s, m) => void events.push([s, m]) });
    expect(r.out.pairs).toEqual([]);
    expect(posted).toEqual([]);
    expect(events).toEqual([["skipped", "no After Dark pair changed in the last 24h"]]);
  });

  it("summarises lines with a private why, weighting the shares by them", () => {
    const report = (lines_with_why: number, share_memory: number) =>
      ({ pair: "x", chapters: 1, lines: 10, findings: [], summary: { lines_with_why, share_memory, share_trait: 0, share_moment: 0, unprovoked_moves: 0, agreed_moves: 0, refused_moves: 0, my_place_when_there: 0, verbatim_repeats: 0, near_repeats: 0, unfounded_memories: 0 } }) as never;
    const s = summarize([
      { owner: "o", a: "a", b: "b", changed_at: "", scene_changed: true, nights_changed: 0, report: report(10, 0.5) },
      { owner: "o", a: "a", b: "c", changed_at: "", scene_changed: true, nights_changed: 0, report: report(30, 0.1) },
    ]);
    expect(s.lines_with_why).toBe(40);
    expect(s.share_memory).toBe(0.2); // (10 × 0.5 + 30 × 0.1) / 40
  });
});
