// The registry of every column that holds a person's id (lib/person-columns.ts, lib/adult/person-columns.ts): nothing
// in the schema is left out of it, it agrees with what the account export and delete are written to do, and then a row
// put in each column shows that they really do it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteAccount, exportAccount } from "@/lib/account";
import { ADULT_LOOK_ALIKES, ADULT_PERSON_COLUMNS } from "@/lib/adult/person-columns";
import { idTyped, LOOK_ALIKES, PERSON_COLUMNS, PERSON_ID_NAMES, personNamed, type PersonColumn } from "@/lib/person-columns";
import { startTestDb } from "./helpers";
import { makeWorld, readCatalog, seedPersonRows, uniqueIndexes, type Catalog, type World } from "./person-seed";
import { schemaColumns, schemaTables } from "./schema-sql";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const ALL: readonly PersonColumn[] = [...PERSON_COLUMNS, ...ADULT_PERSON_COLUMNS];
const ALIKE = [...LOOK_ALIKES, ...ADULT_LOOK_ALIKES];
const id = (e: { table: string; column: string }) => `${e.table}.${e.column}`;

describe("the schema against the registry", () => {
  const columns = schemaColumns();
  const tables = schemaTables();

  it("reads the whole schema", () => {
    // The reader is only worth trusting while it sees what the database has: more than 250 tables, the first and the last.
    expect(tables.size).toBeGreaterThan(250);
    expect(tables.get("characters")?.columns.has("owner_id")).toBe(true);
    // A column added later by alter table is seen too.
    expect(tables.get("mcp_sessions")?.columns.has("visitor")).toBe(true);
    expect(tables.get("show_idea_votes")?.columns.has("user_id")).toBe(true);
  });

  it("every column named like a person's id is in the registry: as a person's, or as a look-alike with what it holds", () => {
    const known = new Set([...ALL, ...ALIKE].map(id));
    const missing = columns.filter((c) => personNamed(c.column) && idTyped(c.definition) && !known.has(id(c))).map(id);
    // A new table with a person column: add it to lib/person-columns.ts (docs/data-plan.md, "Adding a table with a person column").
    expect(missing).toEqual([]);
  });

  it("names nothing twice, nothing that isn't in the schema, and nothing as both a person's and a look-alike", () => {
    const all = [...ALL, ...ALIKE].map(id);
    expect(all.filter((x, i) => all.indexOf(x) !== i)).toEqual([]);
    const real = new Set(columns.map(id));
    expect(all.filter((x) => !real.has(x))).toEqual([]);
  });

  it("lists every name it found a person's id under, so the next column with that name is caught", () => {
    const unlisted = [...new Set(ALL.map((e) => e.column))].filter((name) => !PERSON_ID_NAMES.includes(name));
    expect(unlisted).toEqual([]);
    // And the list has no name the schema never uses.
    const used = new Set(columns.map((c) => c.column));
    expect(PERSON_ID_NAMES.filter((name) => !used.has(name))).toEqual([]);
  });

  it("keeps After Dark's tables in After Dark's file, and only those", () => {
    expect(PERSON_COLUMNS.filter((e) => e.table.startsWith("adult_")).map(id)).toEqual([]);
    expect(ADULT_PERSON_COLUMNS.filter((e) => !e.table.startsWith("adult_")).map(id)).toEqual([]);
    // Nothing of After Dark is exported with the account, and nothing of it moves.
    expect(ADULT_PERSON_COLUMNS.filter((e) => "key" in e.export || e.move.does !== "skip").map(id)).toEqual([]);
  });

  it("gives every rule its reason", () => {
    const thin = ALL.filter(
      (e) => ("no" in e.export && e.export.no.length < 20) || (e.delete.does === "keep" && e.delete.why.length < 20) || (e.move.does === "skip" && e.move.why.length < 20),
    );
    expect(thin.map(id)).toEqual([]);
    expect(ALIKE.filter((e) => e.holds.length < 20).map(id)).toEqual([]);
  });
});

describe("the registry against lib/account.ts", () => {
  const source = readFileSync(join(ROOT, "lib", "account.ts"), "utf8");
  const between = (from: string, to: string): string => {
    const a = source.indexOf(from);
    const b = source.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`lib/account.ts: no ${from} … ${to}`);
    return source.slice(a, b);
  };
  const exportCode = between("export async function exportAccount", "export const TRACE_SOUL_PATHS");
  // deleteAccount and what it calls: forgetEverything, deleteTheRest, the After Dark lists and deleteAfterDarkData, and
  // After Dark's own deleteAdultProfile.
  const adultProfile = readFileSync(join(ROOT, "lib", "adult", "profile-data.ts"), "utf8");
  const deleteCode = between("async function forgetEverything", "export type AdminRemoval") + adultProfile.slice(adultProfile.indexOf("export async function deleteAdultProfile"));
  const word = (w: string) => new RegExp(`\\b${w}\\b`);

  it("a table marked exported is named in exportAccount", () => {
    const unnamed = ALL.filter((e) => "key" in e.export && !word(e.table).test(exportCode)).map(id);
    expect(unnamed).toEqual([]);
  });

  it("a column whose rows are deleted is named, with its table, in deleteAccount", () => {
    const direct = ALL.filter((e) => e.delete.does === "rows" && !e.delete.via);
    const unnamed = direct.filter((e) => {
      const listed = new RegExp(`\\["${e.table}", "${e.column}"\\]`).test(deleteCode);
      const statement = new RegExp(`delete from ${e.table}\\b[^\`"]*\\b${e.column}\\b`).test(deleteCode);
      return !listed && !statement;
    });
    expect(unnamed.map(id)).toEqual([]);
  });

  it("rows that go by a cascade hang off a table whose rows are deleted, through a real on delete cascade", () => {
    const tables = schemaTables();
    const sql = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
    for (const e of ALL) {
      if (e.delete.does !== "rows" || !e.delete.via) continue;
      const parent = e.delete.via;
      expect(tables.has(parent), id(e)).toBe(true);
      // The parent's own rows go: it is deleted by name, or is itself in the registry as deleted.
      expect(word(parent).test(deleteCode) || ALL.some((p) => p.table === parent && p.delete.does === "rows"), `${id(e)} via ${parent}`).toBe(true);
      const create = new RegExp(`create table if not exists ${e.table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? "";
      expect(new RegExp(`references ${parent} \\([^)]*\\) on delete cascade`).test(create), `${id(e)}: no cascade from ${parent}`).toBe(true);
    }
  });

  it("a column that is cleared is updated in deleteAccount", () => {
    const unnamed = ALL.filter((e) => e.delete.does === "anonymise").filter((e) => {
      const unlinked = new RegExp(`AFTER_DARK_UNLINKED[^;]*"${e.table}"`).test(deleteCode) && e.column === "user_id";
      const statement = new RegExp(`update ${e.table} set\\b[^\`"]*\\b${e.column} = `).test(deleteCode);
      return !unlinked && !statement;
    });
    expect(unnamed.map(id)).toEqual([]);
  });
});

describe("the registry against a real database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let catalog: Catalog;
  let world: World;
  /** Every registered person column, as table.column: what a seeded row gives to someone else when it isn't the one under test. */
  const NAMES = new Set(ALL.map(id));
  /** Values the catalogs can't tell: a table-level rule, or a row the export reads through another table. */
  const OVERRIDES: Record<string, Record<string, unknown>> = {
    // The export leaves After Dark's side of the shared Studio tables out, so the rows it should show are the safe ones.
    identity_views: { studio: "pg" },
    showcase_posts: { source: "pg" },
    creator_roleplays: { mode: "safe" },
    // What an account claimed is an identity of its own, never the other person of these rows: deleting the account
    // deletes what is left under it, and the export names it.
    "account_aliases.user_id": { alias_id: crypto.randomUUID() },
  };

  beforeAll(async () => {
    t = await startTestDb();
    vi.spyOn(console, "log").mockImplementation(() => {});
    catalog = await readCatalog(t.db);
    world = await makeWorld(t.db, catalog, NAMES);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await t.close();
  });

  const count = async (e: { table: string; column: string }, who: string) =>
    Number((await t.db.query<{ n: number }>(`select count(*)::int as n from ${e.table} where ${e.column} = $1`, [who])).rows[0].n);
  const total = async (table: string) => Number((await t.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n);

  it("a merge rule names a real unique key, and no reassigned column sits in one", async () => {
    const wrong: string[] = [];
    for (const e of ALL) {
      const indexes = (await uniqueIndexes(t.db, e.table)).filter((i) => i.columns.includes(e.column));
      if (e.move.does === "reassign" && indexes.length) wrong.push(`${id(e)} is reassigned but is in a unique key (${indexes.map((i) => i.name).join(", ")}): make it a merge`);
      if (e.move.does !== "merge") continue;
      const key = [...e.move.key, e.column].sort().join(",");
      if (!indexes.some((i) => [...i.columns].sort().join(",") === key)) wrong.push(`${id(e)}: no unique key on (${key})`);
      if (indexes.some((i) => i.partial) !== Boolean(e.move.when)) wrong.push(`${id(e)}: a key that covers only some rows needs \`when\`, and only then`);
    }
    expect(wrong).toEqual([]);
  });

  it("deleting the account does to each column what its entry says, and the export has what it says", async () => {
    const person = crypto.randomUUID();
    const seeded = await seedPersonRows(t.db, catalog, ALL, person, world, NAMES, OVERRIDES);
    expect(seeded).toHaveLength(ALL.length);
    for (const e of ALL) expect(await count(e, person), `seeded ${id(e)}`).toBe(1);
    const tableNames = [...new Set(ALL.map((e) => e.table))];
    const before = new Map<string, number>();
    for (const name of tableNames) before.set(name, await total(name));

    // The export, first: every key an entry names has something in it, and nobody else's id is anywhere in it.
    const exported = (await exportAccount(t.db, person)) as unknown as Record<string, unknown>;
    const empty: string[] = [];
    for (const e of ALL) {
      if (!("key" in e.export)) continue;
      const value = e.export.key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), exported);
      const has = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== false;
      if (!has) empty.push(`${id(e)} → ${e.export.key}`);
    }
    expect(empty).toEqual([]);
    // Every seeded row has someone else's id in its other person columns: none of them may come out.
    const leaks = Object.entries(exported).filter(([, v]) => JSON.stringify(v ?? null).includes(world.otherUser)).map(([k]) => k);
    expect(leaks).toEqual([]);

    await deleteAccount(t.db, person);

    // What is left, read once; then compared with what a list of entries says should be.
    const left = new Map<string, number>();
    for (const e of ALL) left.set(id(e), await count(e, person));
    const after = new Map<string, number>();
    for (const name of tableNames) after.set(name, await total(name));
    const mismatches = (entries: readonly PersonColumn[]): string[] => {
      const wrong: string[] = [];
      for (const e of entries) {
        const n = left.get(id(e))!;
        if (e.delete.does === "keep" ? n !== 1 : n !== 0) wrong.push(`${id(e)}: ${e.delete.does}, but ${n} row(s) still carry the id`);
      }
      // A cleared or kept row is still there: each table lost exactly the rows its entries say are deleted.
      for (const name of tableNames) {
        const gone = entries.filter((e) => e.table === name && e.delete.does === "rows").length;
        if (after.get(name) !== before.get(name)! - gone) wrong.push(`${name}: expected to lose ${gone} row(s), lost ${before.get(name)! - after.get(name)!}`);
      }
      return wrong;
    };
    expect(mismatches(ALL)).toEqual([]);

    // The comparison has teeth: an entry that says the wrong thing is caught, whichever way it is wrong.
    const saying = (which: string, rule: PersonColumn["delete"]) => ALL.map((e) => (id(e) === which ? { ...e, delete: rule } : e));
    expect(mismatches(saying("thread_reads.user_id", { does: "keep", why: "(a wrong entry, for this test)" }))).toEqual([
      "thread_reads.user_id: keep, but 0 row(s) still carry the id",
      "thread_reads: expected to lose 0 row(s), lost 1",
    ]);
    expect(mismatches(saying("episodes.creator_id", { does: "rows" }))).toEqual([
      "episodes.creator_id: rows, but 1 row(s) still carry the id",
      "episodes: expected to lose 1 row(s), lost 0",
    ]);
    expect(mismatches(saying("double_links.taken_by", { does: "rows" }))).toEqual(["double_links: expected to lose 2 row(s), lost 1"]);
    // Someone else's rows are untouched.
    expect(Number((await t.db.query<{ n: number }>(`select count(*)::int as n from characters where owner_id = $1`, [world.otherUser])).rows[0].n)).toBe(world.characters.length);
  });
});
