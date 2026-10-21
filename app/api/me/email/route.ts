import { z } from "zod";
import { needsSignIn } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emailStatus, startEmailOptIn, turnOffEmail } from "@/lib/email";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

/** Your email notification settings (lib/email.ts). */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  if (await needsSignIn(db, sess)) return json({ error: "sign_in_required", message: "This is an account: sign in to do that." }, 401);
  return json(await emailStatus(db, sess.userId), 200, sess);
});

const Input = z.object({ email: z.string().trim().max(254).optional() });

/**
 * Turns email notifications on: with no address, your Google sign-in address (on at once, Google verified it);
 * with another address, a confirmation link goes to it first. Signed-in players only.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  if (!sess.authenticated) return json({ error: "account_required", message: "Sign in or create an account to get email." }, 401, sess);
  const { email } = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const r = await startEmailOptIn(db, sess.userId, email || null);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ ...(await emailStatus(db, sess.userId)), message: r.status === "pending" ? "Check your inbox for the confirmation link." : "Email is on." }, 200, sess);
});

/** Turns email notifications off. */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  if (await needsSignIn(db, sess)) return json({ error: "sign_in_required", message: "This is an account: sign in to do that." }, 401);
  await turnOffEmail(db, sess.userId);
  return json(await emailStatus(db, sess.userId), 200, sess);
});
