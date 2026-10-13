import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { REPORT_REASONS } from "@/lib/rules";

const ReportInput = z.object({
  episode_id: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS).default("other"),
});

/**
 * Report an episode. One report per person per episode (primary key), so a repeat is a 200 that
 * doesn't count. "Hidden" is derived from the count of distinct reporters at read time
 * (REPORT_HIDE_THRESHOLD), so there is no status flag to race on.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(ReportInput, await readJson(req), "invalid_report");
  const db = await getDb();

  const inserted = await db.query(
    `insert into reports (episode_id, reporter_id, reason)
     select e.id, $2, $3 from episodes e where e.id = $1
     on conflict (episode_id, reporter_id) do nothing
     returning episode_id`,
    [input.episode_id, sess.userId, input.reason],
  );
  if (inserted.rows.length) return json({ episode_id: input.episode_id, reported: true }, 201, sess);

  const exists = (await db.query("select 1 from episodes where id = $1", [input.episode_id])).rows.length > 0;
  if (!exists) return json({ error: "episode_not_found" }, 404, sess);
  return json({ episode_id: input.episode_id, reported: true }, 200, sess);
});
