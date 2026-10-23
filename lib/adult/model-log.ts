/**
 * Which text model wrote a pair's lines (David, 2026-10-22: nobody could tell which model wrote an old scene). Each step
 * records the model that answered it (adult_steps.text_model, from 2026-10-23); a chapter's models are its steps'.
 * For lines from before that, the settings history (adult_settings_history, lib/adult/settings.ts) says which text model
 * was set at the time, when it has a change around then. Nothing is guessed: with neither, it says so ("before model
 * logging" for lines older than step logging, 2026-10-22; "not recorded" after). Admin-only, like the steps.
 */
import type { Db } from "../db";
import { settingsHistory, type SettingsChange } from "./settings";

/** When steps started being logged (lib/adult/steps.ts): lines before this have no steps at all. */
export const STEP_LOGGING_FROM = "2026-10-22T00:00:00.000Z";

/**
 * Who wrote a chapter: its steps' models (and the hosts OpenRouter routed to) when they say, else the text model the
 * settings history had set at that time ("history"), else nothing and why (`note`).
 */
export type WrittenBy = { models: string[]; providers: string[]; source: "steps" | "history" | "none"; note: string | null };

export type StepModel = { text_model?: string | null; text_provider?: string | null };

const distinct = (xs: (string | null | undefined)[]): string[] => [
  ...new Set(xs.flatMap((x) => (x ?? "").split(",").map((s) => s.trim())).filter(Boolean)),
];

/**
 * The text model set at `at`, from the history of text_model changes (newest first or any order): the value the latest
 * change at or before it set, or, when every change came after, the value the first one changed from. Null with no
 * history.
 */
export function textModelAt(history: readonly SettingsChange[], at: string): string | null {
  const changes = history.filter((h) => h.field === "text_model").sort((p, q) => p.at.localeCompare(q.at));
  if (!changes.length) return null;
  const before = changes.filter((h) => h.at <= at).at(-1);
  return before ? before.to_value : changes[0].from_value;
}

/** Who wrote one chapter (a saved night's, or the running one's), from its steps and the history. */
export function writtenBy(steps: readonly StepModel[], at: string, history: readonly SettingsChange[]): WrittenBy {
  const models = distinct(steps.map((s) => s.text_model));
  if (models.length) return { models, providers: distinct(steps.map((s) => s.text_provider)), source: "steps", note: null };
  const inferred = textModelAt(history, at);
  if (inferred) return { models: [inferred], providers: [], source: "history", note: "from the settings history (the model set then)" };
  return { models: [], providers: [], source: "none", note: !steps.length && at < STEP_LOGGING_FROM ? "before model logging" : "not recorded" };
}

/** The text model's history, for writtenBy: empty when there's none (or the table isn't there yet). */
export async function textModelHistory(db: Db): Promise<SettingsChange[]> {
  return settingsHistory(db, "text_model", 500);
}

/** "deepseek/deepseek-chat-v3.1 (DeepInfra)", or the note when nothing says. */
export function writtenByLabel(w: WrittenBy): string {
  if (!w.models.length) return w.note ?? "not recorded";
  const hosts = w.providers.length ? ` (${w.providers.join(", ")})` : "";
  return `${w.models.join(", ")}${hosts}${w.source === "history" ? ", from the settings history" : ""}`;
}
