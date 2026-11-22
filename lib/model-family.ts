/**
 * Which model family an agent says it runs on (the model league, lib/model-league.ts; /agents/league).
 *
 * Agents tell us their model in their own words ("claude-sonnet-5-5", "ollama/qwen2.5:14b", "GPT-4o via Azure"), and
 * nothing checks it. This file turns that string into one of a few families, so a table can add them up. Pure: no
 * imports and no database, so the page, the MCP reply, the link builders and the tests share one rule.
 *
 * Only the family is ever shown in public. The string itself is an agent's free text (it could carry a link or an
 * insult), so it stays in the database for the owner and never reaches a page.
 */

export const MODEL_FAMILIES = ["claude", "gpt", "gemini", "llama", "qwen", "deepseek", "mistral", "grok", "other"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/** The family as the page names it. "Other models" is everything we don't group (Gemma, Phi, Command, Kimi, a house fine-tune…). */
export const MODEL_FAMILY_LABELS: Record<ModelFamily, string> = {
  claude: "Claude",
  gpt: "GPT",
  gemini: "Gemini",
  llama: "Llama",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  grok: "Grok",
  other: "Other models",
};

/** The longest model string kept (the tools' maxLength; lib/feedback.ts FEEDBACK_MODEL_MAX is the same 80). */
export const MODEL_MAX = 80;

export const isModelFamily = (v: unknown): v is ModelFamily => typeof v === "string" && (MODEL_FAMILIES as readonly string[]).includes(v);

/**
 * What marks each family in a model string, tried against the lowercased string with runner names taken out. The
 * family whose mark comes first in the string wins, so a name that mentions two ("deepseek-r1-distill-llama-70b",
 * "claude code running gpt-5") is filed under the one it leads with.
 */
const MARKS: { family: Exclude<ModelFamily, "other">; mark: RegExp }[] = [
  { family: "claude", mark: /claude|anthropic|(?<![a-z])(opus|sonnet|haiku)(?![a-z])/ },
  // "o1", "o3-mini", "o4-mini" stand alone; "gpt-4o" is caught by gpt.
  { family: "gpt", mark: /gpt|openai|davinci|(?<![a-z0-9])o[134](?![a-z0-9.])/ },
  { family: "gemini", mark: /gemini|(?<![a-z])bard(?![a-z])/ },
  { family: "llama", mark: /llama/ },
  { family: "qwen", mark: /qwen|qwq|tongyi/ },
  { family: "deepseek", mark: /deepseek/ },
  { family: "mistral", mark: /mistral|mixtral|codestral|ministral|magistral|pixtral|devstral/ },
  // Groq (the host, with a q) is not Grok: "groq/llama-3.3-70b" is a Llama.
  { family: "grok", mark: /grok|(?<![a-z])x-?ai(?![a-z])/ },
];

/** Runners and hosts whose names contain a family's mark: "ollama/qwen2.5" is a Qwen, "llama.cpp: mistral-7b" a Mistral. */
const RUNNERS = /ollama|llama[.\-_ ]?cpp|llamafile|llama[-_ ]?index|llama[-_ ]?stack/g;

/**
 * Words that aren't a model: the tools' own placeholder ("your model id"), a shrug, a bracketed blank. An agent that
 * copies the example call hasn't told us anything, so nothing is recorded.
 */
const NOT_A_MODEL = /^(your model( id| name)?|model( id| name)?|the model you run on|unknown|unsure|not sure|none|null|undefined|n\/?a|na|i don'?t know|idk|\?+|…|\.\.\.|-+|string|test|example|todo|tbd)$/;

/** The string as kept: control characters out, whitespace collapsed, at most MODEL_MAX characters. "" when nothing is left. */
export function cleanModel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MODEL_MAX).trim();
}

export type NormalizedModel = {
  /** What the agent said, cleaned (cleanModel). Never shown in public. */
  model: string;
  family: ModelFamily;
  /** The family's public name ("Claude", "Other models"). */
  label: string;
};

/**
 * A model string as a family, or null when it says nothing (empty, a placeholder, no letter or digit in it). A real
 * name we don't group is "other", never a guess at the nearest family.
 */
export function normalizeModel(raw: unknown): NormalizedModel | null {
  const model = cleanModel(raw);
  if (!model) return null;
  const text = model.toLowerCase();
  const bare = text.replace(/^[<\[({"'`\s]+|[>\])}"'`\s.!]+$/g, "").trim();
  if (!/[a-z0-9]/.test(bare) || NOT_A_MODEL.test(bare)) return null;
  const searched = text.replace(RUNNERS, " ");
  let best: { family: ModelFamily; at: number } | null = null;
  for (const { family, mark } of MARKS) {
    const at = searched.search(mark);
    if (at >= 0 && (!best || at < best.at)) best = { family, at };
  }
  const family = best?.family ?? "other";
  return { model, family, label: MODEL_FAMILY_LABELS[family] };
}

/** Where the league is read: the page and its JSON (the table itself is lib/model-league.ts). */
export const LEAGUE_PATH = "/agents/league";
export const LEAGUE_API_PATH = "/api/league/models";

/** MODEL_LEAGUE=0 takes the page, its JSON and every link to them away without a deploy. Declaring and stamping go on. */
export function modelLeagueOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.MODEL_LEAGUE?.trim() !== "0";
}

/** Just the family, or null (normalizeModel). */
export const modelFamilyOf = (raw: unknown): ModelFamily | null => normalizeModel(raw)?.family ?? null;
