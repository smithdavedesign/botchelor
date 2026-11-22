import { claimCookie } from "@/lib/account-claim";
import { randomUUID } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { authFromRequest, clearSessionCookies, handle, jsonWithSession, readJson } from "@/lib/http";
import { bumpSessionVersion } from "@/lib/session-versions";

/**
 * Sign out: clear the session and drop back to a fresh anonymous identity (anonymous play always works). That ends this
 * browser's session only. `{ "everywhere": true }` from a signed-in session ends every session the account has handed
 * out, on every device and browser (lib/session-versions.ts).
 */
export const POST = handle(async (req) => {
  const body = /^application\/json\b/i.test(req.headers.get("content-type") ?? "") ? await readJson(req).catch(() => null) : null;
  const everywhere = body !== null && typeof body === "object" && (body as Record<string, unknown>).everywhere === true;
  const auth = everywhere ? authFromRequest(req) : null;
  if (auth?.authenticated) await bumpSessionVersion(await getDb(), auth.userId);
  // An offer to bring things into the account (lib/account-claim.ts) ends with the session it was made for.
  return jsonWithSession({ authenticated: false, ...(auth?.authenticated ? { everywhere: true } : {}) }, { userId: randomUUID(), authenticated: false }, 200, [
    ...clearSessionCookies(),
    claimCookie(null),
  ]);
});
