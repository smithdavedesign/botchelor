import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import {
  feedbackCsv,
  listUserFeedback,
  newUserFeedbackCount,
  PEOPLE_CSV_MAX,
  PEOPLE_LIST_MAX,
  setUserFeedbackStatus,
  updateUserFeedback,
  userFeedbackSummary,
  userFeedbackTrend,
  type PeopleFilter,
} from "@/lib/user-feedback";
import { FEEDBACK_CATEGORIES, FEEDBACK_NOTE_MAX, FEEDBACK_STATUSES, RATING_MAX, RATING_MIN } from "@/lib/user-feedback-shared";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD.")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date.");
const Rating = z.coerce.number().int().min(RATING_MIN).max(RATING_MAX);

const Query = z.object({
  /** Just the number of new notes, for the badge on /admin. */
  count: z.literal("1").optional(),
  format: z.enum(["json", "csv"]).optional(),
  /** The period when there's no from/to: the last N days (today included), or all of it. 30 by default. */
  days: z.union([z.literal("all"), z.coerce.number().int().min(1).max(3650)]).optional(),
  from: Day.optional(),
  to: Day.optional(),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  min: Rating.optional(),
  max: Rating.optional(),
  /** 1 includes our own checks' notes. */
  ours: z.enum(["0", "1"]).optional(),
});
type Query = z.infer<typeof Query>;

/** The query as a filter: from/to are whole UTC days, both included; without them, the last `days` days. */
function filterOf(q: Query, now = new Date()): PeopleFilter {
  const start = (day: string) => new Date(`${day}T00:00:00Z`);
  let from: Date | null = null;
  let to: Date | null = null;
  if (q.from || q.to) {
    from = q.from ? start(q.from) : null;
    to = q.to ? new Date(start(q.to).getTime() + DAY_MS) : null;
  } else if (q.days !== "all") {
    from = new Date(start(utcDay(now)).getTime() - ((q.days ?? 30) - 1) * DAY_MS);
  }
  // A range typed backwards still means the range between them.
  const [minRating, maxRating] = q.min !== undefined && q.max !== undefined && q.min > q.max ? [q.max, q.min] : [q.min ?? null, q.max ?? null];
  return { from, to, category: q.category ?? null, status: q.status ?? null, minRating, maxRating, includeOurs: q.ours === "1" };
}

/**
 * Owner-only: people's notes (lib/user-feedback.ts) for the People tab on /admin/feedback. The summary (count, average,
 * NPS), a per-day trend and the newest notes, all for one filter; or the same notes as a CSV (format=csv); or just how
 * many are new (count=1). Takes the admin password (x-frontier-key) or a signed-in admin account (lib/admin-auth.ts).
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  // An empty box in the filter form means "any", not an invalid value.
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v.trim() !== ""));
  const q = parseBody(Query, params, "invalid_filter");
  const db = await getDb();
  if (q.count) return json({ new_count: await newUserFeedbackCount(db) });

  const filter = filterOf(q);
  if (q.format === "csv") {
    return new Response(feedbackCsv(await listUserFeedback(db, filter, PEOPLE_CSV_MAX)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="botchelor-feedback-${utcDay(new Date())}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  const [summary, trend, items, newCount] = await Promise.all([
    userFeedbackSummary(db, filter),
    userFeedbackTrend(db, filter),
    listUserFeedback(db, filter, PEOPLE_LIST_MAX),
    newUserFeedbackCount(db),
  ]);
  return json({
    filter: { ...filter, from: filter.from?.toISOString() ?? null, to: filter.to?.toISOString() ?? null },
    summary,
    trend,
    items,
    new_count: newCount,
  });
});

const Id = z.string().trim().min(1).max(64);
const One = z
  .object({
    id: Id,
    status: z.enum(FEEDBACK_STATUSES).optional(),
    note: z.string().max(FEEDBACK_NOTE_MAX, `At most ${FEEDBACK_NOTE_MAX} characters.`).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.note !== undefined, "Send a status, a note, or both.");
const Many = z.object({ ids: z.array(Id).min(1).max(PEOPLE_LIST_MAX), status: z.enum(FEEDBACK_STATUSES) });

/**
 * Owner-only triage: { id, status?, note? } moves one note along (new → seen → done) and/or sets the owner's private
 * note on it (null or "" clears it); { ids, status } sets one status on many ("mark these seen").
 */
export const PATCH = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const body = await readJson(req);
  const db = await getDb();
  if (body && typeof body === "object" && Array.isArray((body as { ids?: unknown }).ids)) {
    const input = parseBody(Many, body, "invalid_request");
    return json({ updated: await setUserFeedbackStatus(db, input.ids, input.status) });
  }
  const input = parseBody(One, body, "invalid_request");
  const updated = await updateUserFeedback(db, input.id, { status: input.status, note: input.note });
  return updated ? json(updated) : json({ error: "not_found", message: "No note with that id." }, 404);
});
