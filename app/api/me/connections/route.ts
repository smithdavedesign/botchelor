import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { checkKey, listConnections, removeConnection, saveConnection, assignJob, unassignJob } from "@/lib/connections";
import { checkLimit, connectionsGate, ModelId, PastedKey } from "@/lib/connections-http";
import { JOB_INFO, JOBS, jobCards, PROVIDER_INFO, isUserProvider, providersFor, type Job } from "@/lib/connections-shared";

export const dynamic = "force-dynamic";

/**
 * A signed-in person's connections (docs/PRDs/connections.md): their own provider keys and the job each one does. The
 * key is write-only: it's checked live, sealed and stored, and from then on only its last four and its status come
 * back, from every route here.
 */
async function view(userId: string) {
  const listing = await listConnections(await getDb(), userId);
  return {
    cards: jobCards(listing),
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
  return json(await view(gate.userId));
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
  const stored = (await listConnections(db, gate.userId)).connections.find((c) => c.provider === provider);
  if (input.key) {
    const limited = checkLimit(gate.userId);
    if (limited) return limited;
    const check = await checkKey(provider, input.key);
    if (!check.ok) return json({ error: "key_check_failed", message: check.error.message, kind: check.error.kind, fix: check.error.fix }, 422);
    await saveConnection(db, gate.userId, provider, input.key, { verifiedAt: check.checked_at });
  } else if (!stored) {
    return json({ error: "needs_key", message: `Paste a ${PROVIDER_INFO[provider].label} key first.` }, 422);
  } else if (!input.job) {
    return json({ error: "needs_key", message: "Paste the new key to replace this one." }, 422);
  }
  if (input.job) await assignJob(db, gate.userId, input.job, provider, input.model ?? null);
  for (const job of input.also ?? []) if (job !== input.job) await assignJob(db, gate.userId, job, provider, null);
  return json({ saved: true, ...(await view(gate.userId)) });
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
  return json({ removed, ...(await view(gate.userId)) });
});
