import { z } from "zod";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { getDb } from "@/lib/db";
import { byokAvailable, deleteUserKey, isImageProvider, isTextProvider, listUserKeys, pingKey, saveUserKey, type KeyKind } from "@/lib/keys";

/**
 * A signed-in user's own model keys (BYOK). Account-only: anonymous sessions can't store a key (it needs an
 * account to protect it). The key value is write-only — it's never returned, only the provider and last four.
 */
function requireAccount(req: Request) {
  const auth = authFromRequest(req);
  if (!byokAvailable()) return { error: json({ error: "byok_unavailable", message: "Bringing your own key isn't enabled on this deployment yet." }, 503) };
  if (!auth?.authenticated) return { error: json({ error: "sign_in_required", message: "Sign in to store your own model key." }, 401) };
  return { userId: auth.userId };
}

export const GET = handle(async (req) => {
  const gate = requireAccount(req);
  if (gate.error) return gate.error;
  return json({ keys: await listUserKeys(await getDb(), gate.userId) });
});

const KeyInput = z.object({
  provider: z.string().trim().min(1).max(40),
  kind: z.enum(["text", "image"]).default("text"),
  key: z.string().trim().min(8).max(400),
  model: z.string().trim().max(80).optional(),
});

/** Save (or replace) a key for a provider. Known providers only — no custom endpoints. */
export const PUT = handle(async (req) => {
  const gate = requireAccount(req);
  if (gate.error) return gate.error;
  const input = parseBody(KeyInput, await readJson(req), "invalid_key");
  const kind = input.kind as KeyKind;
  const known = kind === "text" ? isTextProvider(input.provider) : isImageProvider(input.provider);
  if (!known) return json({ error: "unknown_provider", message: "Pick a supported provider." }, 422);
  const saved = await saveUserKey(await getDb(), gate.userId, input.provider, kind, input.key, input.model ?? null);
  return json({ saved });
});

const TestInput = z.object({
  provider: z.string().trim().min(1).max(40),
  key: z.string().trim().min(8).max(400),
  model: z.string().trim().max(80).optional(),
});

/**
 * Test a key before saving. One tiny chat-completions call to the provider at the chosen model; returns
 * ok + the model that answered + the latency, or ok: false with the provider's error. The key itself is
 * never stored by this path.
 */
export const POST = handle(async (req) => {
  const gate = requireAccount(req);
  if (gate.error) return gate.error;
  const input = parseBody(TestInput, await readJson(req), "invalid_test");
  if (!isTextProvider(input.provider)) return json({ error: "unknown_provider", message: "Pick a supported provider." }, 422);
  const result = await pingKey(input.provider, input.key, input.model ?? null);
  return json({ test: result });
});

const DeleteInput = z.object({ provider: z.string().trim().min(1).max(40), kind: z.enum(["text", "image"]).default("text") });

export const DELETE = handle(async (req) => {
  const gate = requireAccount(req);
  if (gate.error) return gate.error;
  const input = parseBody(DeleteInput, await readJson(req), "invalid_key");
  const removed = await deleteUserKey(await getDb(), gate.userId, input.provider, input.kind as KeyKind);
  return json({ removed });
});
