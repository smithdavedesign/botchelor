/**
 * One-off (2026-11-01): re-encode the big PNG pictures already in character_assets the way recordAsset now stores new
 * ones (lib/compact-image.ts), then stamp the AI mark again (lib/ai-mark.ts). Only generated pictures; a row is written
 * only if it still holds what was read (md5), one row at a time, so a run can be stopped and run again.
 *
 *   DATABASE_URL=… npx tsx scripts/compact-portraits.ts            # dry run: what would change, how much; writes nothing
 *   DATABASE_URL=… npx tsx scripts/compact-portraits.ts --apply    # writes
 *
 * Test it on a Neon branch of the database first (a branch's own DATABASE_URL), then run it against main.
 */
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { markAiDataUrl } from "../lib/ai-mark";
import { COMPACT_OVER_BYTES, compactImageDataUrl } from "../lib/compact-image";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

async function main() {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows: ids } = await pool.query<{ id: string }>(
      `select id from character_assets
        where source_type = 'generated' and url like 'data:image/png;base64,%' and octet_length(url) > $1
        order by created_at`,
      [Math.ceil((COMPACT_OVER_BYTES * 4) / 3)],
    );
    console.log(`${ids.length} big generated PNG pictures${apply ? "" : " (dry run: nothing is written)"}`);
    let before = 0;
    let after = 0;
    let changed = 0;
    const kept: Record<string, number> = {};
    for (const { id } of ids) {
      const row = (await pool.query<{ url: string }>(`select url from character_assets where id = $1`, [id])).rows[0];
      if (!row) continue;
      const c = await compactImageDataUrl(row.url);
      before += c.before;
      if (!c.changed) {
        kept[c.reason ?? "?"] = (kept[c.reason ?? "?"] ?? 0) + 1;
        after += c.before;
        continue;
      }
      const marked = markAiDataUrl(c.url);
      after += marked.length;
      changed++;
      if (apply) {
        const md5 = createHash("md5").update(row.url, "utf8").digest("hex");
        const res = await pool.query(`update character_assets set url = $2 where id = $1 and md5(url) = $3`, [id, marked, md5]);
        if (res.rowCount !== 1) console.log(`  ${id}: changed since it was read, left alone`);
      }
    }
    console.log(`${changed} re-encoded, ${mb(before)} → ${mb(after)}; left as they were: ${JSON.stringify(kept)}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
