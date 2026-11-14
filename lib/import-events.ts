/**
 * The engagement events "Bring your character" (/import) sends, built here so tests can pin them: the beacon itself
 * never sends in dev, headless or test runs (app/funnel.ts trackingAllowed), so the plumbing is checked as data.
 *
 *  - import_opened fires on its own when /import opens (app/engagement.ts, with create_opened).
 *  - imported: a paste or card read and handed to the builder (ImportForm, before the move to /create?imported=1).
 *  - import_failed: the page refused it, or couldn't hand it over.
 *
 * `from` is the door the page was opened through (?from=cai, the Character.AI rescue; lib/import-character.ts
 * CAI_SOURCE); null when it was opened plainly, and the server drops a null prop.
 */
import type { ImportFormat, ImportResult } from "./import-character";

export type ImportEvent = { name: "imported" | "import_failed"; props: Record<string, string | number | boolean | null> };

/** Who read the paste: the parser for labelled text and cards (null), the show's free model, or the no-model fallback. */
export type ReadBy = "model" | "fallback" | null;

/** Why an import stopped: the parser's own reasons, the model's minor refusal, or this browser's storage refusing the hand-over. */
export type ImportFailure = Extract<ImportResult, { ok: false }>["reason"] | "storage";

export function importedEvent(format: ImportFormat, readBy: ReadBy, ready: boolean, from: string | null = null): ImportEvent {
  return { name: "imported", props: { format, read_by: readBy ?? "parser", ready, from: from || null } };
}

export function importFailedEvent(reason: ImportFailure, from: string | null = null): ImportEvent {
  return { name: "import_failed", props: { reason, from: from || null } };
}

/** The ?from= value a door passes along: a short word, or nothing (never an address or anything typed). */
export function importDoor(raw: string | string[] | undefined | null): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && /^[a-z][a-z0-9_-]{0,15}$/.test(v) ? v : null;
}
