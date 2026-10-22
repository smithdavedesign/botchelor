import { needsSignIn } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { getMlConsent, setMlConsent } from "@/lib/ml-consent";

/** Your choice on machine-learning use of your data (lib/ml-consent.ts). Opt-in; no choice means no. */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  if (await needsSignIn(db, sess)) return json({ error: "sign_in_required", message: "This is an account: sign in to do that." }, 401);
  return json(await getMlConsent(db, sess.userId), 200, sess);
});

/** Opts in. Signed-in accounts only: an anonymous session can't consent for anyone. */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  if (!sess.authenticated) return json({ error: "account_required", message: "Sign in to choose how your data is used." }, 401, sess);
  return json(await setMlConsent(await getDb(), sess.userId, true), 200, sess);
});

/** Opts out: you're left out of every dataset built from now on. */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  if (!sess.authenticated) return json({ error: "account_required", message: "Sign in to choose how your data is used." }, 401, sess);
  return json(await setMlConsent(await getDb(), sess.userId, false), 200, sess);
});
