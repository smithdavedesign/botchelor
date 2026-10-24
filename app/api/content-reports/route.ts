import { z } from "zod";
import { track } from "@/lib/analytics";
import { CONTENT_REPORT_LIMITS, saveContentReport } from "@/lib/content-reports";
import {
  CONTENT_REPORT_CATEGORIES,
  CONTENT_REPORT_DETAILS_MAX,
  CONTENT_REPORT_EMAIL_MAX,
  CONTENT_REPORT_TARGET_MAX,
  responsePromise,
} from "@/lib/content-reports-shared";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";

export const dynamic = "force-dynamic";

// Blank means "not given", not a mistake.
const blank = (v: unknown) => (v === null || (typeof v === "string" && !v.trim()) ? undefined : v);
const optionalEmail = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .toLowerCase()
    .max(CONTENT_REPORT_EMAIL_MAX, `At most ${CONTENT_REPORT_EMAIL_MAX} characters.`)
    .pipe(z.email("That email doesn't look right. Fix it, or leave it empty."))
    .optional(),
);

const Input = z.object({
  category: z.enum(CONTENT_REPORT_CATEGORIES),
  target: z.preprocess(blank, z.string().trim().max(CONTENT_REPORT_TARGET_MAX, `At most ${CONTENT_REPORT_TARGET_MAX} characters.`).optional()),
  details: z.preprocess(blank, z.string().trim().max(CONTENT_REPORT_DETAILS_MAX, `At most ${CONTENT_REPORT_DETAILS_MAX} characters.`).optional()),
  email: optionalEmail,
  // The honeypot: a field people never see. Anything in it came from a script filling every box.
  website: z.string().max(2000).optional(),
});

/**
 * A complaint or takedown request from /report (lib/content-reports.ts): why (a category), what (a link or an id) and/or
 * the details, and an optional email for the reply. Anyone can send one. Rate limited per connection and per session.
 * The reply says when to expect an answer (48 hours or 7 business days).
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_report");
  const target = input.target ?? null;
  const details = input.details ?? null;
  // A filled honeypot gets the same thank-you as a person, so the script learns nothing, and nothing is stored.
  if (input.website?.trim()) return json({ ok: true, promise: responsePromise(input.category) }, 201, sess);
  if (!target && !details) {
    return json({ error: "empty_report", message: "Tell us what to look at: a link or an id, or a few words about it." }, 422, sess);
  }

  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (visitor !== null && (await overLimit(db, "content_report", visitor, CONTENT_REPORT_LIMITS))) ||
    (await overLimit(db, "content_report_user", sess.userId, CONTENT_REPORT_LIMITS));
  if (limited) {
    return json({ error: "too_many_reports", message: "That's a lot of reports in a short time. Try again in an hour, or email us." }, 429, sess);
  }

  const saved = await saveContentReport(
    db,
    { category: input.category, target, details, email: input.email ?? null },
    { userId: sess.userId, account: sess.authenticated, userAgent: req.headers.get("user-agent") },
  );
  track("content_reported", { target: "takedown", reason: input.category, urgent: saved.urgent, flagged: saved.flagged });
  return json({ ok: true, id: saved.id, urgent: saved.urgent, promise: saved.promise }, 201, sess);
});
