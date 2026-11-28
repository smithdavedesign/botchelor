/**
 * npm run sweep:characters: which characters saved before the 2026-11-28 safety checks would be refused by them today.
 *
 * READ ONLY. It opens one read-only transaction, selects the characters and writes a report; it never updates or
 * deletes a row (David decides what to pull, from the report). The checks are the ones a save runs now
 * (app/api/characters): lib/franchises.ts characterCopy, then lib/safety.ts checkSheetText, or checkAdultText for an
 * After Dark character. Without the translation step (no model call), so a non-English sheet is read as written.
 *
 *   SWEEP_DB_URL="$DATABASE_URL" npm run sweep:characters
 * Options (env): SWEEP_BEFORE=2026-11-28 (created before this date), SWEEP_OUT=.data/sweep-characters.md.
 * The report holds people's own words, so it goes to .data/ (gitignored), never into the repo.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import { it } from "vitest";
import { characterCopy, sheetFields } from "@/lib/franchises";
import { checkAdultText, checkSheetText } from "@/lib/safety";

type Row = {
  id: string;
  owner_id: string | null;
  is_house: boolean;
  name: string;
  bio: string;
  appearance: string | null;
  voice: string | null;
  traits: unknown;
  want: string;
  dealbreaker: string;
  extras: unknown;
  visibility: string;
  after_dark: boolean;
  created_at: Date;
};

const texts = (v: unknown): string[] => {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (v && typeof v === "object") return Object.values(v).flatMap(texts);
  return [];
};

/** Why today's save would refuse this sheet, or null. */
function refusal(row: Row): { reason: string; field: string; phrase?: string } | null {
  const fields = sheetFields(row);
  const copy = characterCopy(fields);
  if (copy) return { reason: "franchise", field: copy.field, phrase: copy.phrase };
  const asText: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fields)) asText[k] = texts(v);
  const r = (row.after_dark ? checkAdultText : checkSheetText)(asText);
  return r.ok ? null : { reason: r.reason, field: r.field };
}

it("reports saved characters today's checks would refuse", async () => {
  const url = process.env.SWEEP_DB_URL;
  if (!url) throw new Error("SWEEP_DB_URL is not set");
  const before = process.env.SWEEP_BEFORE ?? "2026-11-28";
  const out = process.env.SWEEP_OUT ?? ".data/sweep-characters.md";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let rows: Row[];
  try {
    await client.query("begin transaction read only");
    ({ rows } = await client.query<Row>(
      `select c.id, c.owner_id, c.is_house, c.name, c.bio, c.appearance, c.voice, c.traits, c.want, c.dealbreaker,
              c.extras, c.visibility, (c.after_dark_open or a.character_id is not null) as after_dark, c.created_at
         from characters c left join adult_characters a on a.character_id = c.id
        where c.created_at < $1::date
        order by c.created_at`,
      [before],
    ));
    await client.query("rollback");
  } finally {
    await client.end();
  }

  const hits = rows.flatMap((row) => {
    const why = refusal(row);
    return why ? [{ row, why }] : [];
  });
  const byReason = new Map<string, number>();
  for (const h of hits) byReason.set(h.why.reason, (byReason.get(h.why.reason) ?? 0) + 1);
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 120);
  const lines = [
    `# Characters saved before ${before} that today's checks would refuse`,
    "",
    `Read ${rows.length} characters, ${hits.length} would be refused. Nothing was changed.`,
    "",
    ...[...byReason].sort((a, b) => b[1] - a[1]).map(([r, n]) => `- ${r}: ${n}`),
    "",
    "| id | name | house | visibility | After Dark | reason | field | phrase | created |",
    "|---|---|---|---|---|---|---|---|---|",
    ...hits.map(({ row, why }) =>
      `| ${row.id} | ${cell(row.name)} | ${row.is_house ? "yes" : ""} | ${row.visibility} | ${row.after_dark ? "yes" : ""} | ${why.reason} | ${why.field} | ${cell(why.phrase ?? "")} | ${row.created_at.toISOString().slice(0, 10)} |`,
    ),
  ];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`${hits.length} of ${rows.length} would be refused (${[...byReason].map(([r, n]) => `${r} ${n}`).join(", ")}). Report: ${out}`);
});
