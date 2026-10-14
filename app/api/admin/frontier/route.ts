import { z } from "zod";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized, frontierConfigured, getFrontierModel, getModel, ModelError } from "@/lib/model";
import { ENDING_LABELS, ENDINGS } from "@/lib/rules";

// One free call and one frontier call, up to 25s each.
export const maxDuration = 60;

const Input = z.object({
  a: z.string().trim().min(1).max(60),
  b: z.string().trim().min(1).max(60),
  scenario: z.string().trim().max(200).optional(),
  ending: z.enum(ENDINGS),
});

/**
 * Admin-only frontier eval (the owner's approval, gated by password): writes the same short scene with
 * the free model and the frontier model so the owner can compare dialogue quality on a handful of
 * examples. Gated by the x-frontier-key header, so it only spends on the owner's authorized runs. It is
 * deliberately self-contained (no episode is written, no shared generation code), so it never touches
 * the production date pipeline.
 */
export const POST = handle(async (req) => {
  if (!frontierAuthorized(req)) {
    return json({ error: "not_authorized", message: "Frontier runs need the password (x-frontier-key)." }, 403);
  }
  if (!frontierConfigured()) {
    return json({ error: "frontier_not_configured", message: "No frontier model is configured (set FRONTIER_LLM_* in the environment)." }, 503);
  }
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const prompt = [
    {
      role: "system" as const,
      content:
        "You are a comedic blind-date showrunner. Both characters are fictional adults; no sexual content, no real people, no one under 18. " +
        'Reply with only a JSON object: {"scene": "three short sentences"}.',
    },
    {
      role: "user" as const,
      content: `Write a three-sentence scene of a blind date between ${input.a} and ${input.b}${input.scenario ? ` (${input.scenario})` : ""} that ends in "${ENDING_LABELS[input.ending]}".`,
    },
  ];

  const run = async (model: { complete: (m: typeof prompt) => Promise<string> } | null): Promise<string> => {
    if (!model) return "(not configured)";
    try {
      const raw = await model.complete(prompt);
      try {
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        return typeof parsed?.scene === "string" ? parsed.scene : raw;
      } catch {
        return raw;
      }
    } catch (err) {
      return `(error: ${err instanceof ModelError ? err.message : "failed"})`;
    }
  };

  const [free, frontier] = await Promise.all([run(getModel()), run(getFrontierModel())]);
  return json({ free, frontier });
});
