// Puts one row in a person column, for any table, so a test can prove what the registry (lib/person-columns.ts) says
// about each of them (tests/person-columns.test.ts). A helper, not a suite.
//
// A row is built from the running database's own catalogs: every column that must have a value gets the least that its
// type and its check constraints allow. Foreign keys are switched off while the rows go in (session_replication_role),
// so a row needs no real parent: a character or a date it points at is always SOMEONE ELSE'S, which is what makes the
// proof honest. A row keyed to the person only through the column under test can only go, move or be exported
// because of that column.
import type { Db } from "@/lib/db";
import type { PersonColumn } from "@/lib/person-columns";

type ColumnInfo = { name: string; type: string; notNull: boolean; hasDefault: boolean };
type ForeignKey = { columns: string[]; refTable: string; refColumns: string[] };
type TableInfo = { columns: ColumnInfo[]; checks: string[]; keyColumns: Set<string>; foreignKeys: ForeignKey[] };

export type Catalog = Map<string, TableInfo>;

/** Every table's columns, checks, unique-key columns and foreign keys, read once. */
export async function readCatalog(db: Db): Promise<Catalog> {
  const catalog: Catalog = new Map();
  const table = (name: string): TableInfo => {
    let t = catalog.get(name);
    if (!t) catalog.set(name, (t = { columns: [], checks: [], keyColumns: new Set(), foreignKeys: [] }));
    return t;
  };
  const cols = await db.query<{ t: string; name: string; type: string; not_null: boolean; has_default: boolean }>(
    `select c.relname as t, a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null, a.atthasdef or a.attidentity <> '' as has_default
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum`,
  );
  for (const r of cols.rows) table(r.t).columns.push({ name: r.name, type: r.type, notNull: r.not_null, hasDefault: r.has_default });
  const checks = await db.query<{ t: string; def: string }>(
    `select c.relname as t, pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and k.contype = 'c'`,
  );
  for (const r of checks.rows) table(r.t).checks.push(r.def);
  const keys = await db.query<{ t: string; name: string }>(
    `select c.relname as t, a.attname as name from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
      where n.nspname = 'public' and i.indisunique`,
  );
  for (const r of keys.rows) table(r.t).keyColumns.add(r.name);
  const fks = await db.query<{ t: string; cols: string[]; ref: string; ref_cols: string[] }>(
    `select c.relname as t, r.relname as ref,
            (select array_agg(a.attname order by x.ord) from unnest(k.conkey) with ordinality x(num, ord) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.num) as cols,
            (select array_agg(a.attname order by x.ord) from unnest(k.confkey) with ordinality x(num, ord) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.num) as ref_cols
       from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and k.contype = 'f'`,
  );
  for (const r of fks.rows) table(r.t).foreignKeys.push({ columns: r.cols, refTable: r.ref, refColumns: r.ref_cols });
  return catalog;
}

/** Each unique index of a table, as its column names (an expression column is `?`), and whether it covers only some rows. */
export async function uniqueIndexes(db: Db, tableName: string): Promise<{ name: string; columns: string[]; partial: boolean }[]> {
  const { rows } = await db.query<{ name: string; columns: string[]; partial: boolean }>(
    `select ic.relname as name, i.indpred is not null as partial,
            (select array_agg(coalesce(a.attname, '?') order by x.ord)
               from unnest(string_to_array(i.indkey::text, ' ')::int[]) with ordinality x(num, ord) left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = x.num) as columns
       from pg_index i join pg_class c on c.oid = i.indrelid join pg_class ic on ic.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and i.indisunique`,
    [tableName],
  );
  return rows;
}

/** The least value a check constraint allows a column, if a check pins one. */
function fromChecks(checks: string[], column: string): string | number | undefined {
  for (const def of checks) {
    const list = new RegExp(`\\(?\\b${column}\\b\\)?(?:::\\w+)? = ANY \\(+ARRAY\\[([^\\]]*)\\]`).exec(def);
    if (list) {
      const first = list[1].split(",")[0].trim();
      const text = /^'((?:[^']|'')*)'/.exec(first);
      if (text) return /::(integer|smallint|bigint|numeric)/.test(first) ? Number(text[1]) : text[1];
      return Number(first.replace(/::\w+/g, ""));
    }
    const one = new RegExp(`\\b${column}\\b = '((?:[^']|'')*)'`).exec(def);
    if (one) return one[1];
    const atLeast = new RegExp(`\\b${column}\\b >= \\(?'?(-?\\d+)`).exec(def);
    if (atLeast) return Number(atLeast[1]);
    const above = new RegExp(`\\b${column}\\b > \\(?'?(-?\\d+)`).exec(def);
    if (above) return Number(above[1]) + 1;
  }
  return undefined;
}

export type World = {
  /** Another person: every other person column of a seeded row is theirs. */
  otherUser: string;
  /**
   * Four characters (their ids in order) and a date of theirs: what a seeded row points at when it has to point at a
   * character or a date. A table's second row starts one character on, so a key made of a character never repeats.
   */
  characters: string[];
  episode: string;
};

export type SeededRow = { table: string; column: string; values: Record<string, unknown> };

/**
 * One row's values for `table`, with `personId` in `column`. `parents`: rows already seeded, by table, whose keys a
 * foreign key takes (so a row that should go by cascade really hangs off its parent). `overrides` wins over all of it.
 */
export function rowFor(
  catalog: Catalog,
  entry: Pick<PersonColumn, "table" | "column">,
  personId: string,
  world: World,
  o: { parents?: Map<string, Record<string, unknown>>; via?: string; personColumns: ReadonlySet<string>; overrides?: Record<string, unknown>; tag?: string; nth?: number },
): Record<string, unknown> {
  const info = catalog.get(entry.table);
  if (!info) throw new Error(`no such table: ${entry.table}`);
  const tag = o.tag ?? `seed-${entry.table}-${entry.column}`;
  const values: Record<string, unknown> = {};
  let nthCharacter = o.nth ?? 0;
  for (const c of info.columns) {
    if (c.name === entry.column) {
      values[c.name] = personId;
      continue;
    }
    const fk = info.foreignKeys.find((f) => f.columns.includes(c.name));
    // Only the parent the row is meant to go with: any other foreign key points at nothing, so no other cascade can take it.
    const parent = fk && fk.refTable === o.via ? o.parents?.get(fk.refTable) : undefined;
    if (fk && parent) {
      values[c.name] = parent[fk.refColumns[fk.columns.indexOf(c.name)]];
      continue;
    }
    // Only what the table insists on: a nullable column stays null, a default stands.
    if (!c.notNull || c.hasDefault) continue;
    if (fk?.refTable === "characters") values[c.name] = world.characters[nthCharacter++ % world.characters.length];
    else if (fk?.refTable === "episodes") values[c.name] = world.episode;
    // Another person column of the same row (the blocked side of a block) is someone else's, never the person's.
    else if (o.personColumns.has(`${entry.table}.${c.name}`)) values[c.name] = world.otherUser;
    else {
      const pinned = fromChecks(info.checks, c.name);
      if (pinned !== undefined) values[c.name] = pinned;
      else if (/^(text|character varying)$/.test(c.type)) values[c.name] = info.keyColumns.has(c.name) ? `${tag}-${c.name}` : "x";
      else if (/^(integer|smallint|bigint|real|double precision|numeric)/.test(c.type)) values[c.name] = 1;
      else if (c.type === "boolean") values[c.name] = false;
      else if (/^timestamp/.test(c.type)) values[c.name] = "2026-01-01T00:00:00Z";
      else if (c.type === "date") values[c.name] = "2026-01-01";
      else if (c.type === "jsonb") values[c.name] = "{}";
      else if (c.type === "bytea") values[c.name] = "\\x00";
      else if (/\[\]$/.test(c.type)) values[c.name] = "{}";
      else throw new Error(`${entry.table}.${c.name}: no seed value for type ${c.type}`);
    }
  }
  return { ...values, ...(o.overrides ?? {}) };
}

/** Inserts a row as given (jsonb and the rest by the column's own type). */
export async function insertRow(db: Db, catalog: Catalog, tableName: string, values: Record<string, unknown>): Promise<void> {
  const info = catalog.get(tableName)!;
  const names = Object.keys(values);
  const params = names.map((n, i) => `$${i + 1}::${info.columns.find((c) => c.name === n)!.type}`);
  await db.query(`insert into ${tableName} (${names.join(", ")}) values (${params.join(", ")})`, names.map((n) => values[n]));
}

/** Foreign keys off (rows without parents go in), then back on: cascades run on delete as they do live. */
export async function withoutForeignKeys<T>(db: Db, work: () => Promise<T>): Promise<T> {
  await db.exec(`set session_replication_role = replica`);
  try {
    return await work();
  } finally {
    await db.exec(`set session_replication_role = origin`);
  }
}

/** Someone else, with two characters and a date between them. */
export async function makeWorld(db: Db, catalog: Catalog, personColumns: ReadonlySet<string>): Promise<World> {
  const run = crypto.randomUUID();
  const world: World = { otherUser: crypto.randomUUID(), characters: ["a", "b", "c", "d"].map((x) => `seed-char-${x}-${run}`), episode: `seed-episode-${run}` };
  await withoutForeignKeys(db, async () => {
    for (const id of world.characters) {
      await insertRow(db, catalog, "characters", rowFor(catalog, { table: "characters", column: "owner_id" }, world.otherUser, world, { personColumns, overrides: { id, name: `Seed ${id.slice(10, 11).toUpperCase()} ${run.slice(0, 6)}`, age: 30 } }));
    }
    await insertRow(
      db,
      catalog,
      "episodes",
      rowFor(catalog, { table: "episodes", column: "creator_id" }, world.otherUser, world, {
        personColumns,
        overrides: { id: world.episode, character_a: world.characters[0], character_b: world.characters[1], ending: "friends" },
      }),
    );
  });
  return world;
}

/**
 * A row for each entry, keyed to `personId` by that entry's column alone. Entries whose rows go by a cascade (`via`)
 * are seeded after their parent and hang off it. `overrides`: values a table needs that the catalogs can't tell.
 */
export async function seedPersonRows(
  db: Db,
  catalog: Catalog,
  entries: readonly PersonColumn[],
  personId: string,
  world: World,
  personColumns: ReadonlySet<string>,
  overrides: Record<string, Record<string, unknown>> = {},
): Promise<SeededRow[]> {
  const seeded: SeededRow[] = [];
  const parents = new Map<string, Record<string, unknown>>();
  const parentOf = (e: PersonColumn): string | undefined => (e.delete.does === "rows" ? e.delete.via : undefined);
  // Parents first: a table hung off another cascaded table (user_connection_jobs off user_connections) waits for it.
  const ordered: PersonColumn[] = [];
  let waiting = [...entries];
  while (waiting.length) {
    const ready = waiting.filter((e) => !parentOf(e) || ordered.some((p) => p.table === parentOf(e)));
    if (!ready.length) throw new Error(`no parent row to hang these off: ${waiting.map((e) => `${e.table} (via ${parentOf(e)})`).join(", ")}`);
    ordered.push(...ready);
    waiting = waiting.filter((e) => !ready.includes(e));
  }
  await withoutForeignKeys(db, async () => {
    for (const e of ordered) {
      const nth = seeded.filter((r) => r.table === e.table).length;
      const values = rowFor(catalog, e, personId, world, { parents, via: parentOf(e), personColumns, nth, overrides: overrides[`${e.table}.${e.column}`] ?? overrides[e.table] });
      try {
        await insertRow(db, catalog, e.table, values);
      } catch (err) {
        throw new Error(`seeding ${e.table}.${e.column} failed: ${err instanceof Error ? err.message : String(err)}\n${JSON.stringify(values)}`);
      }
      if (!parents.has(e.table)) parents.set(e.table, values);
      seeded.push({ table: e.table, column: e.column, values });
    }
  });
  return seeded;
}
