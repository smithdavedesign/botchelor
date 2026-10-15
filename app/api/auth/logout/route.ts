import { randomUUID } from "@/lib/auth";
import { clearSessionCookies, handle, jsonWithSession } from "@/lib/http";

/** Sign out: clear the session and drop back to a fresh anonymous identity (anonymous play always works). */
export const POST = handle(async () =>
  jsonWithSession({ authenticated: false }, { userId: randomUUID(), authenticated: false }, 200, clearSessionCookies()),
);
