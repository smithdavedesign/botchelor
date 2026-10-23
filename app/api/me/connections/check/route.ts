import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { checkKey, openConnection, recordCheck, recordError, type CheckResult } from "@/lib/connections";
import { checkLimit, connectionsGate, PastedKey } from "@/lib/connections-http";
import { isUserProvider } from "@/lib/connections-shared";

export const dynamic = "force-dynamic";

const CheckInput = z.object({
  provider: z.string().trim().min(1).max(40),
  /** A pasted key to try before saving it. Left out: check the key already stored for this provider ("Check"). */
  key: PastedKey.optional(),
});

/** What a check says back: whether it worked, and what the key can do. Never the key. */
const reply = (r: CheckResult) =>
  r.ok
    ? { ok: true, checked_at: r.checked_at, latency_ms: r.latency_ms, models_count: r.models?.length ?? null, account: r.account, can: r.can }
    : { ok: false, error: r.error };

/**
 * Test a key live, for free (the provider's key-info or model-list endpoint, lib/connections.ts checkKey). A pasted key
 * is only tried, never stored here. With no key, the stored one is checked again and its card updated: checked now, or
 * what went wrong in plain words.
 */
export const POST = handle(async (req) => {
  const gate = connectionsGate(req);
  if (gate.error) return gate.error;
  const input = parseBody(CheckInput, await readJson(req), "invalid_check");
  if (!isUserProvider(input.provider)) return json({ error: "unknown_provider", message: "Pick one of the providers listed." }, 422);
  const limited = checkLimit(gate.userId);
  if (limited) return limited;
  if (input.key) return json(reply(await checkKey(input.provider, input.key)));
  const db = await getDb();
  const stored = await openConnection(db, gate.userId, input.provider);
  if (!stored) return json({ error: "no_key", message: "There's no readable key stored for that provider. Paste one to connect it." }, 404);
  const result = await checkKey(input.provider, stored);
  if (result.ok) await recordCheck(db, gate.userId, input.provider, result.checked_at);
  else await recordError(db, gate.userId, input.provider, result.error.kind);
  return json(reply(result));
});
