import { after } from "next/server";
import { z } from "zod";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { handle, isMcpCall, json, parseBody, readJson } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { addSignUp, newsletterOpen, sendConfirmation, SIGNUP_LIMITS } from "@/lib/newsletter";
import { EMAIL_MAX } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const SignUpInput = z.object({
  email: z
    .string("Enter your email address.")
    .trim()
    .toLowerCase()
    .max(EMAIL_MAX, `At most ${EMAIL_MAX} characters.`)
    .pipe(z.email("Enter a valid email address.")),
  attest: z.literal(true, "Confirm you are 18 or older."),
});

/**
 * Signs an address up for the Sunday letter (lib/newsletter.ts). Always 201 {ok: true} for a good address, new, waiting
 * on its confirmation or already on the list, so nobody can use it to check an address; the confirmation email goes
 * after the answer, so how long the answer takes doesn't say either. People only, a few sign-ups an hour from one
 * connection. No session cookie: the letter needs no account.
 */
export const POST = handle(async (req: Request) => {
  if (!newsletterOpen()) return json({ error: "newsletter_off", message: "The Sunday letter isn't open yet." }, 503);
  if (isMcpCall(req) || detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) {
    return json({ error: "people_only", message: "The letter is for people, signing up in a browser." }, 403);
  }
  const input = parseBody(SignUpInput, await readJson(req), "invalid_signup");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (visitor !== null && (await overLimit(db, "newsletter_signup", visitor, SIGNUP_LIMITS))) {
    return json({ error: "rate_limited", message: "Too many sign-ups from here. Try again in an hour." }, 429);
  }
  const now = new Date();
  await addSignUp(db, input.email, now);
  const confirm = () => sendConfirmation(db, input.email, now).then(
    () => undefined,
    () => undefined,
  );
  try {
    after(confirm);
  } catch {
    await confirm(); // no request scope (a test calling the route directly): send it now
  }
  return json({ ok: true }, 201);
});
