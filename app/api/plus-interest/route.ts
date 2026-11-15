import { after } from "next/server";
import { z } from "zod";
import { track } from "@/lib/analytics";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { handle, isMcpCall, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { addSignUp, newsletterOpen, sendConfirmation } from "@/lib/newsletter";
import { PLUS_INTEREST_LIMITS, PLUS_PLACES, recordPlusInterest } from "@/lib/plus-interest";
import { EMAIL_MAX } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const Input = z.object({
  place: z.enum(PLUS_PLACES, "Say where the tile was."),
  // An email is optional (a blank one is none); with one, the 18+ box is required (the Sunday letter's own rule).
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().toLowerCase().max(EMAIL_MAX, `At most ${EMAIL_MAX} characters.`).pipe(z.email("Enter a valid email address.")).optional(),
  ),
  attest: z.boolean().optional(),
});

/**
 * "Tell me when it opens" on the Botchelor Plus tile (lib/plus-interest.ts): one row per person and place, nothing sold,
 * nothing charged. An email, if left, goes on the Sunday letter's list the way the letter's own form puts it there
 * (pending until the link in the confirmation email is clicked), since the letter is how the news would reach them;
 * the row only remembers that one was left. People only: an agent's interest is a different buyer. A few taps an hour
 * from one connection. The visitor keeps their cookie, so the admin count is of people, not taps.
 */
export const POST = handle(async (req: Request) => {
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "This counts people, tapping in a browser." }, 403);
  }
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.email && input.attest !== true) {
    return json({ error: "invalid_request", field: "attest", message: "Confirm you are 18 or older to leave an email." }, 422, sess);
  }
  if (input.email && !newsletterOpen()) {
    return json({ error: "newsletter_off", message: "We can't take emails yet. Your interest still counts: tap without one." }, 503, sess);
  }
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (visitor !== null && (await overLimit(db, "plus_interest", visitor, PLUS_INTEREST_LIMITS))) {
    return json({ error: "rate_limited", message: "That's noted already. Try again in an hour." }, 429, sess);
  }

  const created = await recordPlusInterest(db, sess.userId, input.place, Boolean(input.email));
  track("plus_interest", { place: input.place, with_email: Boolean(input.email), new: created });

  if (input.email) {
    const email = input.email;
    const now = new Date();
    await addSignUp(db, email, now);
    const confirm = () => sendConfirmation(db, email, now).then(
      () => undefined,
      () => undefined,
    );
    try {
      after(confirm);
    } catch {
      await confirm(); // no request scope (a test calling the route directly): send it now
    }
  }
  return json({ ok: true, with_email: Boolean(input.email) }, 201, sess);
});
