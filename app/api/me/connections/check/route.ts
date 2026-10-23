import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { checkKey, modelsFor, openConnection, recordCheck, recordError, type CheckResult } from "@/lib/connections";
import { checkLimit, connectionsGate, PastedKey } from "@/lib/connections-http";
import { isUserProvider, JOBS, PROVIDER_INFO, type ModelOption } from "@/lib/connections-shared";

export const dynamic = "force-dynamic";

const CheckInput = z.object({
  provider: z.string().trim().min(1).max(40),
  /** A pasted key to try before saving it. Left out: check the key already stored for this provider ("Check"). */
  key: PastedKey.optional(),
  /** The job the key is for: a passing check then lists the models it can use for it (the connect flow's model step). */
  job: z.enum(JOBS).optional(),
});

/** What a check says back: whether it worked, what the key can do, and (for a job) its models. Never the key. */
const reply = (r: CheckResult, models?: ModelOption[]) =>
  r.ok
    ? { ok: true, checked_at: r.checked_at, latency_ms: r.latency_ms, models_count: r.models?.length ?? null, account: r.account, can: r.can, ...(models ? { models } : {}) }
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
  const provider = input.provider;
  const job = input.job && PROVIDER_INFO[provider].jobs.includes(input.job) ? input.job : null;
  const models = async (r: CheckResult) => (r.ok && job ? (await modelsFor(null, null, provider, job, { listed: r.models })).models : undefined);
  if (input.key) {
    const result = await checkKey(provider, input.key);
    return json(reply(result, await models(result)));
  }
  const db = await getDb();
  const stored = await openConnection(db, gate.userId, provider);
  if (!stored) return json({ error: "no_key", message: "There's no readable key stored for that provider. Paste one to connect it." }, 404);
  const result = await checkKey(provider, stored);
  if (result.ok) await recordCheck(db, gate.userId, provider, result.checked_at, result.models);
  else await recordError(db, gate.userId, provider, result.error.kind);
  return json(reply(result, await models(result)));
});
