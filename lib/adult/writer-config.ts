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
});
export type WriterModel = z.infer<typeof WriterModel>;

/**
 * The writers on offer by default (the 2026-10-24 sim, one night each on the reviewed hosts: GLM-4.6 scored 83 and won
 * the blind read, 26 steps without a failure but about 47 s a step; DeepSeek V3.1, production's model until now, 66 at
 * about 11 s a step).
 */
export const DEFAULT_WRITERS: WriterModel[] = [
  { id: "z-ai/glm-4.6", label: "GLM-4.6", note: "the richest writing; about 45 s a step" },
  { id: "deepseek/deepseek-chat-v3.1:nitro", label: "DeepSeek V3.1", note: "fast; about 10 s a step" },
];
export const DEFAULT_WRITER = "z-ai/glm-4.6";

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
  return parsed.models.some((m) => m.id === parsed.default) ? parsed : { ...parsed, default: parsed.models[0].id };
}

/** A save: the stored config with these keys replaced. Throws on a bad value, a default that isn't on the list, or a repeat. */
export function mergeWriterConfig(current: WriterConfig, patch: Record<string, unknown>): WriterConfig {
  const next = WriterConfig.parse({ ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
  if (new Set(next.models.map((m) => m.id)).size !== next.models.length) throw new Error("each writer once");
  if (!next.models.some((m) => m.id === next.default)) throw new Error("the default must be one of the writers");
  return next;
}
