/**
 * Who writes the scenes (David, 2026-10-24: "yes do it [GLM-4.6] and allow a user to switch the model in After Dark"):
 * the writers a person can pick from, and the one they get when they haven't picked. A writer writes the scene steps and
 * the two sides of a night; recaps, memory, facts and a clip's direction stay on the settings' text_model, the fast one,
 * so they don't wait four times as long. Every writer runs on After Dark's reviewed OpenRouter hosts (lib/adult/mode.ts
 * adultProviderRouting): one neither host serves fails with OpenRouter's 404, so add a model only after a test step.
 * Client-safe: no server imports (the settings page shares it).
 */
import { z } from "zod";

export const WriterModel = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(40),
  /** What to expect from it, on the picker. */
  note: z.string().trim().max(80).default(""),
  /**
   * How much it thinks before it writes (a reasoning model's hidden tokens, billed as output): added to every reply's
   * budget, so the thinking never crowds out the lines. GLM-4.6 thought 960 tokens a call on 2026-10-24, which left a
   * 1,600-token step about 600 for its lines, and one call ran out.
   */
  think_tokens: z.number().int().min(0).max(8000).default(0),
});
export type WriterModel = z.infer<typeof WriterModel>;

/**
 * The writers on offer by default (the 2026-10-24 sim, one night each on the reviewed hosts: GLM-4.6 scored 83 and won
 * the blind read, 26 steps without a failure, about 47 s a step; DeepSeek V3.1, production's model until now, 66 at about
 * 11 s. Measured again that evening, real steps on DeepInfra and CoreWeave: GLM-4.6 90 to 100 s and about 0.4¢ a call,
 * DeepSeek 6 to 8 s and about 0.24¢; docs/costs.md).
 */
export const DEFAULT_WRITERS: WriterModel[] = [
  { id: "z-ai/glm-4.6", label: "GLM-4.6", note: "the richest writing; slow, about 1 to 2 min a step", think_tokens: 1200 },
  { id: "deepseek/deepseek-chat-v3.1:nitro", label: "DeepSeek V3.1", note: "fast; about 10 s a step", think_tokens: 0 },
];
/**
 * The quick one (David, 2026-11-01, "yes do 1-3" on the After Dark review: the slow default writer was the most-cited
 * drag across 24 After Dark visitor runs, "1 to 2½ minutes a step"). The richer one stays a pick away.
 */
export const DEFAULT_WRITER = "deepseek/deepseek-chat-v3.1:nitro";

/**
 * What a person reads for each writer, in plain words, before the model's name (the audit, 2026-10-29: "GLM-4.6" and
 * "DeepSeek V3.1" mean nothing to someone picking how their night is written). By id, so a list already saved in the
 * settings reads the same; a writer added later shows its label.
 */
const PLAIN: Record<string, string> = { "z-ai/glm-4.6": "Richer, slower", "deepseek/deepseek-chat-v3.1:nitro": "Quick" };
export const plainName = (m: Pick<WriterModel, "id" | "label">): string => PLAIN[m.id] ?? m.label;

/**
 * How long a step usually takes on each writer, in seconds and in words (#1164, the 2026-10-31-1905 visitor: "Still
 * writing … up to a minute" while GLM-4.6 took two). From the measured steps above; a writer added later has none.
 */
const TYPICAL: Record<string, { max: number; words: string }> = {
  "z-ai/glm-4.6": { max: 150, words: "1 to 2½ minutes a step" },
  "deepseek/deepseek-chat-v3.1:nitro": { max: 20, words: "about 10 seconds a step" },
};

/** The theater's note while a step is written: how long this writer usually takes, then, past that, that it's late. */
export function writingNoteFor(writer: Pick<WriterModel, "id" | "label"> | null | undefined, waited: number): string {
  const typical = writer ? TYPICAL[writer.id] : undefined;
  const leaving = "Leaving doesn't stop it: the lines are here when you come back.";
  if (typical && waited > typical.max) return `Taking longer than usual (${waited} s): it's still going. ${leaving}`;
  if (typical && writer) return `Still writing, ${waited} s so far: the ${plainName(writer).toLowerCase()} writer usually takes ${typical.words}. ${leaving}`;
  return `Still writing, ${waited} s so far. ${leaving}`;
}
/**
 * Who writes a step when the writer twice sends nothing back (2026-10-25: GLM-4.6 returned no text on 5 of 18 steps in
 * six hours, each one an error the owner had to retry): the fast one, with no thinking to run out of room on.
 */
export const FALLBACK_WRITER = "deepseek/deepseek-chat-v3.1:nitro";

/**
 * #1053 (the 2026-10-30 ad visitor: "the settings say the default is GLM-4.6, but the theater showed DeepSeek. Which one
 * is actually writing is unclear"): what the theater says when a step wasn't written by the viewer's own writer. `asked`:
 * who was asked to write it; `wrote`: who did; `theirs`: their writer (picked or the default). Null when it was theirs.
 * Two ways it isn't: the asked one twice sent nothing back (FALLBACK_WRITER wrote it), or it's the night's opening, which
 * the fast one writes for someone who hasn't picked (lib/adult/writer.ts writerChoice).
 */
export function writerNote(models: readonly Pick<WriterModel, "id" | "label">[], o: { asked: string; wrote: string; theirs: string }): string | null {
  const name = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  if (o.wrote !== o.asked) return `✍️ ${name(o.asked)} sent nothing back: ${name(o.wrote)} wrote this one.`;
  if (o.wrote !== o.theirs) return `✍️ ${name(o.wrote)} wrote the opening so it starts quickly; ${name(o.theirs)} writes from the next step.`;
  return null;
}

export const WriterConfig = z.object({
  /** The writer of everyone who hasn't picked one. */
  default: z.string().trim().min(1).max(120).default(DEFAULT_WRITER),
  models: z.array(WriterModel).min(1).max(8).default(DEFAULT_WRITERS),
});
export type WriterConfig = z.infer<typeof WriterConfig>;
export const DEFAULT_WRITER_CONFIG: WriterConfig = WriterConfig.parse({});

/** The stored JSON as settings, defaults filled in; anything that doesn't parse falls back to the defaults for that part. */
export function writerConfigOf(raw: unknown): WriterConfig {
  const r = WriterConfig.safeParse(raw ?? {});
  if (r.success && r.data.models.some((m) => m.id === r.data.default)) return r.data;
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const one = WriterConfig.safeParse({ [k]: v });
      if (one.success) out[k] = (one.data as Record<string, unknown>)[k];
    }
  }
  const parsed = WriterConfig.parse(out);
  if (parsed.models.some((m) => m.id === parsed.default)) return parsed;
  // A default that's gone from the list: the show's own default if it's still listed, else the first.
  return { ...parsed, default: parsed.models.some((m) => m.id === DEFAULT_WRITER) ? DEFAULT_WRITER : parsed.models[0].id };
}

/** A save: the stored config with these keys replaced. Throws on a bad value, a default that isn't on the list, or a repeat. */
export function mergeWriterConfig(current: WriterConfig, patch: Record<string, unknown>): WriterConfig {
  const next = WriterConfig.parse({ ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
  if (new Set(next.models.map((m) => m.id)).size !== next.models.length) throw new Error("each writer once");
  if (!next.models.some((m) => m.id === next.default)) throw new Error("the default must be one of the writers");
  return next;
}
