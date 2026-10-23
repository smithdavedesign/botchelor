import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { modelsFor } from "@/lib/connections";
import { connectionsGate } from "@/lib/connections-http";
import { isJob, isUserProvider, PROVIDER_INFO } from "@/lib/connections-shared";

export const dynamic = "force-dynamic";

/**
 * The models a job can run on a provider, for the connect flow's model step (docs/PRDs/connections.md, M2): OpenRouter's
 * live list with its prices, or the models this person's stored key listed at its last check, or the curated ones;
 * Recommended first, each with its tags and price hint. `?provider=openrouter&job=text`. No key is sent or returned.
 */
export const GET = handle(async (req) => {
  const gate = connectionsGate(req);
  if (gate.error) return gate.error;
  const params = new URL(req.url).searchParams;
  const provider = params.get("provider") ?? "";
  const job = params.get("job") ?? "text";
  if (!isUserProvider(provider) || !isJob(job) || !PROVIDER_INFO[provider].jobs.includes(job)) {
    return json({ error: "invalid_request", message: "Pick a provider and a job it can do." }, 422);
  }
  return json(await modelsFor(await getDb(), gate.userId, provider, job));
});
