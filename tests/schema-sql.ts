// Reads the schema as it is written in lib/db.ts (the SQL text, not a running database), for tests that check every
// table or column of a kind is accounted for somewhere (tests/person-columns.test.ts). A helper, not a suite.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

/** The schema's SQL: the one template literal in lib/db.ts, which has no interpolation in it. */
export function readSchemaSql(): string {
  const src = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
  const opening = "const SCHEMA_SQL = `";
  const start = src.indexOf(opening);
  const end = src.indexOf("\n`;", start);
  if (start < 0 || end < 0) throw new Error("lib/db.ts: SCHEMA_SQL not found");
  const sql = src.slice(start + opening.length, end);
  if (sql.includes("${")) throw new Error("lib/db.ts: SCHEMA_SQL has an interpolation; this reader takes it as plain text");
  return sql;
}

/** The SQL's statements, split on `;` outside a string, a `$$` body or a `--` comment (comments are dropped). */
export function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "$" && sql[i + 1] === "$") {
      const j = sql.indexOf("$$", i + 2);
      if (j < 0) throw new Error("schema: an unclosed $$ body");
      cur += sql.slice(i, j + 2);
      i = j + 2;
      continue;
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A create-table body's parts, split on commas outside brackets and strings. */
function parts(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quoted = false;
  for (const ch of body) {
    if (quoted) {
      cur += ch;
      if (ch === "'") quoted = false;
      continue;
    }
    if (ch === "'") quoted = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export type SchemaColumn = { table: string; column: string; definition: string };
export type SchemaTable = { name: string; columns: Map<string, string> };

const TABLE_CONSTRAINT = /^(primary key|unique|check|foreign key|constraint|exclude)\b/i;

/**
 * Every table and its columns, from each `create table` and each `alter table … add column`. A statement that starts
 * like one of those and can't be read throws, so a new way of writing a column is noticed here and not skipped.
 */
export function schemaTables(sql: string = readSchemaSql()): Map<string, SchemaTable> {
  const tables = new Map<string, SchemaTable>();
  const table = (name: string): SchemaTable => {
    let t = tables.get(name);
    if (!t) tables.set(name, (t = { name, columns: new Map() }));
    return t;
  };
  for (const st of statements(sql)) {
    if (/^create table\b/i.test(st)) {
      const m = /^create table if not exists (\w+)\s*\(([\s\S]*)\)$/i.exec(st);
      if (!m) throw new Error(`schema: can't read this create table: ${st.slice(0, 80)}`);
      const t = table(m[1]);
      for (const part of parts(m[2])) {
        if (TABLE_CONSTRAINT.test(part)) continue;
        const c = /^(\w+)\s+([\s\S]*)$/.exec(part);
        if (!c) throw new Error(`schema: can't read a column of ${m[1]}: ${part.slice(0, 80)}`);
        t.columns.set(c[1], c[2].replace(/\s+/g, " "));
      }
      continue;
    }
    if (/^alter table\b[\s\S]*\badd column\b/i.test(st)) {
      const m = /^alter table (?:if exists )?(\w+) add column if not exists (\w+)\s+([\s\S]*)$/i.exec(st);
      if (!m) throw new Error(`schema: can't read this add column: ${st.slice(0, 80)}`);
      const t = table(m[1]);
      if (!t.columns.has(m[2])) t.columns.set(m[2], m[3].replace(/\s+/g, " "));
    }
  }
  return tables;
}

/** Every column of every table, flat. */
export function schemaColumns(sql: string = readSchemaSql()): SchemaColumn[] {
  return [...schemaTables(sql).values()].flatMap((t) => [...t.columns].map(([column, definition]) => ({ table: t.name, column, definition })));
}
