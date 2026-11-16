/**
 * Which model reads a pasted history (POST /api/characters/import/history), and how it is asked. Kept out of the route
 * file, which may export only its handlers.
 */
import { getFrontierModel, getModel, type Model } from "./model";

/**
 * Who reads a history (the owner's call, 2026-11-15): the show's PAID model, and nothing when there is none. A history
 * is someone's private chat log, and a free tier's terms may let its provider use what it is sent; the paid model's do
 * not. So there is no quiet fall back to the free model: without a paid model the reading fails the way an outage
 * does, and the character comes in without its history. IMPORT_HISTORY_MODEL=free puts it back on the free model
 * (a local setup with no paid key, the visual harness).
 */
export function historyReader(env: Record<string, string | undefined> = process.env, thinking = false): Model | null {
  if (env.IMPORT_HISTORY_MODEL === "free") return getModel("low", false);
  return getFrontierModel(thinking ? undefined : NO_THINKING);
}

/**
 * The paid model reasons before it answers unless told not to, and its reasoning counts against the call's token
 * allowance: the first live readings (2026-11-16) spent all 1,000 tokens thinking and came back with no text
 * ("finish_reason: length"), billed all the same. Copying lines out of a chat log needs no thinking, so the reading
 * asks for none (OpenRouter's `reasoning.effort`). A model that cannot switch it off refuses that with a 400: then
 * once more, thinking, with room for both.
 */
const NO_THINKING = { reasoning: { effort: "none" } };
/** Room for eight one-sentence lines and their JSON, with slack. */
export const HISTORY_ANSWER_TOKENS = 1500;
/** The same answer from a model that insists on thinking first. */
export const HISTORY_THINKING_TOKENS = 4000;
