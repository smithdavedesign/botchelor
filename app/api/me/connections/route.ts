import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { checkKey, currentUsage, listConnections, removeConnection, saveConnection, assignJob, unassignJob } from "@/lib/connections";
import { checkLimit, connectionsGate, ModelId, PastedKey } from "@/lib/connections-http";
import { ADULT_JOBS, CAP_MAX_USD, JOB_INFO, JOBS, jobCards, ON_CAP, PRESET_IDS, PROVIDER_INFO, isUserProvider, providersFor, type Feel, type Job } from "@/lib/connections-shared";
import { canAfterDark } from "@/lib/adult/entitlement";
import { lockedForRequest } from "@/lib/adult/privacy";

export const dynamic = "force-dynamic";

/** Whether After Dark's own job is for this person on this device: After Dark open to them, the device not PIN-locked. */
async function adultOpen(req: Request, userId: string): Promise<boolean> {
  const db = await getDb();
  return (await canAfterDark(db, authFromRequest(req))).ok && !(await lockedForRequest(db, userId, req));
}

/**
 * A signed-in person's connections (docs/PRDs/connections.md): their own provider keys and the job each one does. The
 * key is write-only: it's checked live, sealed and stored, and from then on only its last four and its status come
 * back, from every route here. After Dark's own job is there only for someone it's open to (as on the page).
 */
async function view(req: Request, userId: string) {
  const db = await getDb();
  const listing = await listConnections(db, userId);
  const open = await adultOpen(req, userId);
  return {
    cards: jobCards(listing, Date.now(), await currentUsage(db, userId)).filter((c) => open || !ADULT_JOBS.includes(c.job)),
    connections: listing.connections.map(({ provider, last4, verified_at, last_used_at, last_error, last_error_at, created_at, jobs }) => ({
      provider,
      last4,
      verified_at,
      last_used_at,
      last_error,
      last_error_at,
      created_at,
      jobs,
    })),
  };
}

export const GET = handle(async (req) => {
  const gate = connectionsGate(req);
  if (gate.error) return gate.error;
  return json(await view(req, gate.userId));
});

const SaveInput = z.object({
  provider: z.string().trim().min(1).max(40),
  /** The job to point at this provider's key. Left out: replace the key only, keeping what it does. */
  job: z.enum(JOBS).optional(),
  /** A new key to check and store. Left out: use the key already stored for this provider. */
  key: PastedKey.optional(),
  model: ModelId.optional(),
  /** Other jobs this key should do too (a Google key for dates can make clips). */
  also: z.array(z.enum(JOBS)).max(JOBS.length).optional(),
  /**
   * Dates & texts' feel (M2): a preset, and under Advanced the raw numbers. Any number is clamped to its bounds on the way
   * in (and again where it's used); one set by hand makes the preset "custom".
   */
  preset: z.enum([...(PRESET_IDS as [string, ...string[]]), "custom"]).optional(),
  temperature: z.number().finite().nullable().optional(),
  frequency_penalty: z.number().finite().nullable().optional(),
  presence_penalty: z.number().finite().nullable().optional(),
  /** M3: the job's monthly cap in USD (null or 0: none), and what happens at it (Dates & texts only: the free model, or wait). */
  cap_usd: z.number().finite().min(0).max(CAP_MAX_USD).nullable().optional(),
  on_cap: z.enum(ON_CAP).optional(),
});

/**
 * Connect: check a pasted key live (for free), store it sealed, and point the job at it with its model. Or use a key
 * already stored for another job, or replace a key in place. A key that fails its check is never stored.
 */
export const PUT = handle(async (req) => {
  const gate = connectionsGate(req);
  if (gate.error) return gate.error;
  const input = parseBody(SaveInput, await readJson(req), "invalid_connection");
  if (!isUserProvider(input.provider)) return json({ error: "unknown_provider", message: "Pick one of the providers listed." }, 422);
  const provider = input.provider;
  const jobs: Job[] = [...new Set([...(input.job ? [input.job] : []), ...(input.also ?? [])])];
  for (const job of jobs) {
    if (!providersFor(job).includes(provider)) {
      return json({ error: "wrong_provider", message: `A ${PROVIDER_INFO[provider].label} key can't do ${JOB_INFO[job].title}.` }, 422);
    }
  }
  const db = await getDb();
  // After Dark's own job (the Studio's pictures) is only for someone After Dark is open to.
  if (jobs.some((j) => ADULT_JOBS.includes(j)) && !(await adultOpen(req, gate.userId))) return json({ error: "not_found" }, 404);
  const stored = (await listConnections(db, gate.userId)).connections.find((c) => c.provider === provider);
  if (input.key) {
    const limited = checkLimit(gate.userId);
    if (limited) return limited;
    const check = await checkKey(provider, input.key);
    if (!check.ok) return json({ error: "key_check_failed", message: check.error.message, kind: check.error.kind, fix: check.error.fix }, 422);
    await saveConnection(db, gate.userId, provider, input.key, { verifiedAt: check.checked_at, models: check.models });
  } else if (!stored) {
    return json({ error: "needs_key", message: `Paste a ${PROVIDER_INFO[provider].label} key first.` }, 422);
  } else if (!input.job) {
    return json({ error: "needs_key", message: "Paste the new key to replace this one." }, 422);
  }
  const custom = [input.temperature, input.frequency_penalty, input.presence_penalty].some((v) => v !== undefined && v !== null);
  const feel: Partial<Feel> = {
    preset: custom ? "custom" : ((input.preset as Feel["preset"]) ?? null),
    temperature: input.temperature ?? null,
    frequency_penalty: input.frequency_penalty ?? null,
    presence_penalty: input.presence_penalty ?? null,
  };
  if (input.job) await assignJob(db, gate.userId, input.job, provider, input.model ?? null, feel, { cap_usd: input.cap_usd ?? null, on_cap: input.on_cap });
  for (const job of input.also ?? []) if (job !== input.job) await assignJob(db, gate.userId, job, provider, null);
  return json({ saved: true, ...(await view(req, gate.userId)) });
});

const RemoveInput = z.union([
  z.object({ provider: z.string().trim().min(1).max(40), job: z.undefined().optional() }),
  z.object({ job: z.enum(JOBS), provider: z.undefined().optional() }),
]);

/** Remove a key (and stop every job using it), or stop one job using its key (the free model again, for dates). */
export const DELETE = handle(async (req) => {
  const gate = connectionsGate(req);
  if (gate.error) return gate.error;
  const input = parseBody(RemoveInput, await readJson(req), "invalid_connection");
  const db = await getDb();
  const removed = input.job ? await unassignJob(db, gate.userId, input.job) : await removeConnection(db, gate.userId, input.provider!);
  return json({ removed, ...(await view(req, gate.userId)) });
});
