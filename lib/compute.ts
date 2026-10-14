/**
 * M10 — compute controls.
 *
 * PRD "Budget and autonomy": the backend (never the AI) enforces real spend — hard caps, and a way to
 * stop generation. This file is the global stop: a PAUSE kill switch read from the environment, so a
 * runaway or a cost spike can be halted without a deploy. Episodes then fail closed with a clear state,
 * exactly like no free model answering (PRD: "an episode fails closed").
 *
 * The per-date model-call count is already bounded (one narration + the capped conversation turns), and
 * the frontier model's hard MONEY cap lives at the provider, set with the key itself
 * (`~/ai-stack/bin/secrets add <scope> FRONTIER_LLM_API_KEY --cap "<limit>"`; see docs/frontier.md), so
 * even an authorized frontier run can't exceed the owner's limit. This switch is the on/off on top of that.
 */

export const PAUSED_MESSAGE =
  "Generation is paused right now. Nothing was saved; try again in a little while.";

/** True when generation is paused by the environment (BOTCHELOR_PAUSE=1/true/on). */
export function generationPaused(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.BOTCHELOR_PAUSE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}
