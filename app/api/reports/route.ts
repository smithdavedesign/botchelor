import { afterAired } from "@/lib/story-state";
import { z } from "zod";
import { track } from "@/lib/analytics";
import { saveContentReport } from "@/lib/content-reports";
import type { ContentReportCategory } from "@/lib/content-reports-shared";
import { getDb } from "@/lib/db";
import { invalidateGraph } from "@/lib/graph-cache";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { reportCounts, reportLimited, TOO_MANY_REPORTS } from "@/lib/report-trust";
import { REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from "@/lib/rules";
import { refreshEpisodePair } from "@/lib/relationships";

const ReportInput = z.object({
  episode_id: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS).default("other"),
});

/** The takedown request's kind for a date's report reason (lib/content-reports-shared.ts). */
const CATEGORY: Record<ReportReason, ContentReportCategory> = { sexual: "other", minor: "minor", real_person: "real_person", hateful: "other", self_harm: "other", other: "other" };

/**
 * Report an episode. One report per person per episode (primary key), so a repeat is a 200 that
 * doesn't count. "Hidden" is derived from the count of distinct reporters at read time
 * (REPORT_HIDE_THRESHOLD), so there is no status flag to race on. Only a report that counts (lib/report-trust.ts: a
 * signed-in account, or an identity a day old) goes there; anyone else's becomes a takedown request on the date for the
 * admins (/admin/reports), which hides nothing until one of them looks. Limited per address and per identity.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(ReportInput, await readJson(req), "invalid_report");
  const db = await getDb();
  if (await reportLimited(db, req, sess.userId)) return json(TOO_MANY_REPORTS, 429, sess);

  if (!reportCounts(req)) {
    const episode = (await db.query<{ id: string }>("select id from episodes where id = $1", [input.episode_id])).rows[0];
    if (!episode) return json({ error: "episode_not_found" }, 404, sess);
    const open = await db.query("select 1 from content_reports where reporter_id = $1 and episode_id = $2 and status = 'open'", [sess.userId, episode.id]);
    if (!open.rows.length) {
      await saveContentReport(
        db,
        { category: CATEGORY[input.reason], target: `/episodes/${episode.id}`, details: `Reported from the date's page: ${REPORT_REASON_LABELS[input.reason]}.`, email: null },
        { userId: sess.userId, account: false, userAgent: req.headers.get("user-agent") },
      );
      track("content_reported", { target: "episode", reason: input.reason, review: true });
    }
    return json({ episode_id: episode.id, reported: true }, open.rows.length ? 200 : 201, sess);
  }

  const inserted = await db.query(
    `insert into reports (episode_id, reporter_id, reason)
     select e.id, $2, $3 from episodes e where e.id = $1
     on conflict (episode_id, reporter_id) do nothing
     returning episode_id`,
    [input.episode_id, sess.userId, input.reason],
  );
  if (inserted.rows.length) {
    track("content_reported", { target: "episode", reason: input.reason });
    // Enough reports hide a date, which takes it out of the relationship graph's public layer.
    await refreshEpisodePair(db, input.episode_id).catch(() => {});
    // And out of the story state (lib/story-state.ts): nothing a hidden date left behind stays something a character knows.
    await afterAired(db, input.episode_id).catch(() => null);
    invalidateGraph(); // the Constellation's turned-down and left-first counts read the same rule
    return json({ episode_id: input.episode_id, reported: true }, 201, sess);
  }

  const exists = (await db.query("select 1 from episodes where id = $1", [input.episode_id])).rows.length > 0;
  if (!exists) return json({ error: "episode_not_found" }, 404, sess);
  return json({ episode_id: input.episode_id, reported: true }, 200, sess);
});
