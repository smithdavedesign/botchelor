/**
 * Captions in a character's own voice (the creator suite; David, 2026-10-26: "how else can we make this nice for content
 * creators"): three to post a picture or clip with, a few hashtags, and one line safe for anywhere (a public feed, a
 * profile). Written by a text model from what the picture shows (its tags, or the menu words it was made from: never the
 * picture itself, never a provider's prompt) and the character's own voice, then held to the lines: each one is
 * checked, and one that fails is dropped. Shared by both Studios (lib/adult/captions.ts, lib/studio/pg-captions.ts),
 * cached on the picture, free to write.
 */
import type { ChatMessage } from "../model";

export type Captions = {
  /** Up to three captions to post it with, in their voice. */
  options: string[];
  /** A few hashtags, the two that say it's AI-made always among them. */
  hashtags: string[];
  /** One line anyone could see: no innuendo, nothing sexual. */
  safe: string;
  /** Whose voice (a character id), and when. */
  voice: string | null;
  written_at: string;
};
export type CaptionResult = { ok: true; captions: Captions } | { ok: false; status: number; error: string; message: string };

export const CAPTION_MAX = 220;
/** The tags the platforms ask for, always last. */
export const AI_TAGS = ["#AIgenerated", "#AIart"] as const;
const MODEL_TAGS = 4;
const HASHTAG = /^#[A-Za-z][A-Za-z0-9_]{1,29}$/;

/** What the model reads: who's speaking and how they talk, what the picture shows, and the rules. */
export function captionMessages(input: { name: string; voice: readonly string[]; shows: string; together: boolean; spicy: boolean; note?: string }): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You write short captions for a fictional adult character's own photos, in their own voice, as they'd post them. " +
        "Never a real person, never an age, never anyone young. No hashtags inside a caption.",
    },
    {
      role: "user",
      content: [
        `The character: ${input.name}.`,
        ...(input.voice.length ? ["How they talk and who they are:", ...input.voice.map((v) => `- ${v}`)] : []),
        "",
        `The photo: ${input.shows}${input.together ? " (with their date, who stays unnamed)" : ""}.`,
        "",
        `Write three captions they'd post it with, first person, each under ${CAPTION_MAX} characters and each different: one playful, one tender, one teasing.`,
        input.spicy
          ? "Flirty and suggestive is fine; nothing graphic: no explicit body parts or sex words."
          : "Keep them warm and everyday: nothing sexual.",
        `Then up to ${MODEL_TAGS} hashtags for it (one word each, no spaces).`,
        'Then "safe": one more caption anyone could see on a public feed: no innuendo, nothing sexual.',
        ...(input.note ? ["", input.note] : []),
        'Reply with a JSON object: {"captions": ["...", "...", "..."], "hashtags": ["#..."], "safe": "..."}',
      ].join("\n"),
    },
  ];
}

/** The model's reply, read; null when it isn't the JSON asked for. */
export function parseCaptions(raw: string): { options: string[]; hashtags: string[]; safe: string } | null {
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { captions?: unknown; hashtags?: unknown; safe?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { options: strings(j.captions), hashtags: strings(j.hashtags), safe: typeof j.safe === "string" ? j.safe : "" };
  } catch {
    return null;
  }
}

/** One caption as it's kept: one line, its quotes and hashtags off, within the length. */
const tidy = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/(^|\s)#[A-Za-z0-9_]+/g, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim()
    .slice(0, CAPTION_MAX);

/**
 * What's kept of a reply: the captions that pass `ok` (at most three, no two the same), the hashtags that are hashtags
 * (the AI ones always added), and a safe line that passes `safeOk` (else `fallbackSafe`). Null with no caption left.
 */
export function holdCaptions(
  parsed: { options: string[]; hashtags: string[]; safe: string },
  ok: (text: string) => boolean,
  safeOk: (text: string) => boolean,
  fallbackSafe: string,
): Pick<Captions, "options" | "hashtags" | "safe"> | null {
  const options = [...new Set(parsed.options.map(tidy).filter((s) => s.length >= 3 && ok(s)))].slice(0, 3);
  if (!options.length) return null;
  const own = parsed.hashtags
    .map((h) => `#${h.trim().replace(/^#+/, "").replace(/\s+/g, "")}`)
    .filter((h) => HASHTAG.test(h) && ok(h) && !AI_TAGS.some((a) => a.toLowerCase() === h.toLowerCase()));
  const hashtags = [...new Set(own)].slice(0, MODEL_TAGS).concat(AI_TAGS);
  const safe = tidy(parsed.safe);
  return { options, hashtags, safe: safe.length >= 3 && safeOk(safe) ? safe : fallbackSafe };
}
