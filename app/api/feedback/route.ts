import { z } from "zod";
import { track } from "@/lib/analytics";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { appVersion, saveUserFeedback, USER_FEEDBACK_LIMITS, viewerFacts } from "@/lib/user-feedback";
import {
  cleanPage,
  cleanViewport,
  FEEDBACK_CATEGORIES,
  FEEDBACK_EMAIL_MAX,
  FEEDBACK_MESSAGE_MAX,
  RATING_MAX,
  RATING_MIN,
} from "@/lib/user-feedback-shared";

export const dynamic = "force-dynamic";

/**
 * What the feedback modal and the beta prompt need to know about the viewer: an address to prefill for a reply (signed
 * in only), and the server's facts for the one-time prompt. The page decides with betaPromptDue
 * (lib/user-feedback-shared.ts), adding this browser's memory and where they are. A crawler counts as an agent.
 */
export const GET = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth) return json({ email: null, prompt: { used_it: false, seen_on_account: false, agent: false } });
  const facts = await viewerFacts(await getDb(), auth);
  const bot = detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent")) !== null;
  return json({ email: facts.email, prompt: { used_it: facts.usedIt, seen_on_account: facts.seenOnAccount, agent: facts.agent || bot } });
});

// An empty, blank or null email means "no reply needed", not a mistake.
const optionalEmail = z.preprocess(
  (v) => (v === null || (typeof v === "string" && !v.trim()) ? undefined : v),
  z
    .string()
    .trim()
    .toLowerCase()
    .max(FEEDBACK_EMAIL_MAX, `At most ${FEEDBACK_EMAIL_MAX} characters.`)
    .pipe(z.email("That email doesn't look right. Fix it, or leave it empty."))
    .optional(),
);

const Input = z.object({
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX, `A whole number from ${RATING_MIN} to ${RATING_MAX}.`).nullable().optional(),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  message: z.string().trim().max(FEEDBACK_MESSAGE_MAX, `At most ${FEEDBACK_MESSAGE_MAX} characters.`).optional(),
  email: optionalEmail,
  page: z.string().max(2000).optional(),
  viewport: z.string().max(40).optional(),
  // The honeypot: a field people never see. Anything in it came from a script filling every box.
  website: z.string().max(2000).optional(),
});

/**
 * A person's note about the show: a 0-10 rating, a category, a message (needed unless there's a rating) and an optional
 * email for a reply. The page adds where it was sent from and the screen size; the server adds the session, whether
 * it's an account, the browser and the deployed commit. Rate limited per connection and per session. Nothing they
 * wrote comes back in the reply.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_feedback");
  // A filled honeypot gets the same thank-you as a person, so the script learns nothing, and nothing is stored.
  if (input.website?.trim()) return json({ ok: true }, 201, sess);
  const message = input.message || null;
  const rating = input.rating ?? null;
  if (!message && rating === null) {
    return json({ error: "empty_feedback", message: "Write a few words, or pick a number from 0 to 10." }, 422, sess);
  }

  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (visitor !== null && (await overLimit(db, "user_feedback", visitor, USER_FEEDBACK_LIMITS))) ||
    (await overLimit(db, "user_feedback_user", sess.userId, USER_FEEDBACK_LIMITS));
  if (limited) {
    return json({ error: "too_many_notes", message: "Thank you, that's a lot of notes in a short time. Try again in an hour." }, 429, sess);
  }

  const category = input.category ?? "other";
  const saved = await saveUserFeedback(
    db,
    { rating, category, message, email: input.email ?? null, page: cleanPage(input.page), viewport: cleanViewport(input.viewport) },
    { userId: sess.userId, account: sess.authenticated, userAgent: req.headers.get("user-agent"), version: appVersion() },
  );
  track("user_feedback", { category, rated: rating !== null, flagged: saved.flagged, ours: saved.ours, account: sess.authenticated });
  return json({ ok: true, id: saved.id }, 201, sess);
});
