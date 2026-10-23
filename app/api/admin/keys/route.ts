import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { keySecretState } from "@/lib/key-crypto";
import { keyStoreStatus, resealAll } from "@/lib/key-store-admin";

export const dynamic = "force-dynamic";

/** Admin: how every stored key is sealed (lib/key-store-admin.ts). Counts only, never a key. */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await keyStoreStatus(await getDb()));
});

/** Admin: seal every legacy key again under KEY_ENCRYPTION_SECRET now. Refused until that secret is set. */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  if (keySecretState() !== "on") {
    return json({ error: "no_key_secret", message: "Add KEY_ENCRYPTION_SECRET (32 characters or more) first, then redeploy." }, 409);
  }
  const db = await getDb();
  const moved = await resealAll(db);
  return json({ moved, status: await keyStoreStatus(db) });
});
