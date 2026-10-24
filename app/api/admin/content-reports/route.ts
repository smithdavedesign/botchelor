import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { decideContentReport, listContentReports } from "@/lib/content-reports";
import { CONTENT_REPORT_DECISIONS } from "@/lib/content-reports-shared";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin only: the complaints and takedown requests from /report, open ones first (?status=all adds the decided ones). */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const status = new URL(req.url).searchParams.get("status") === "all" ? "all" : "open";
  return json({ reports: await listContentReports(await getDb(), status) });
});

const Decision = z.object({
  id: z.string().min(1).max(100),
  decision: z.enum(CONTENT_REPORT_DECISIONS),
  note: z.string().trim().max(1000).optional(),
});

/** Admin only: resolve a report, hide the date it names (private to its creator), or dismiss it. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Decision, await readJson(req), "invalid_decision");
  const by = authFromRequest(req)?.userId ?? "admin-password";
  const r = await decideContentReport(await getDb(), input.id, input.decision, by, input.note || null);
  if (!r.ok && r.error === "not_found") return json({ error: "not_found", message: "No report with that id." }, 404);
  if (!r.ok) return json({ error: "no_episode", message: "This report doesn't name one of our dates, so there's nothing to hide. Resolve it instead." }, 422);
  return json({ id: input.id, status: r.status });
});
