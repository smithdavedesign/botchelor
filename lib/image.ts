/**
 * Portrait generation on a user's own key (BYOK, M16). Only OpenAI's image API is wired, for one reason:
 * it moderates its own input and output, so a user-key portrait is provider-moderated. On top of that the
 * prompt is built ONLY from the character's already content-filtered sheet (bio, appearance, traits —
 * each passed checkFields at creation/edit), never free-form input, so nothing unsafe can be steered in.
 * The user pays (their key), so the marginal cost to us is $0.
 *
 * The result is a PNG data URL. The caller records it in the asset ledger (lib/assets) and serves it through
 * the assets route, so the heavy bytes never sit inline in a page or an API body.
 */
export const PROMPT_VERSION = "portrait-v1";
/**
 * The portrait model. OpenAI retires gpt-image-1 on 2026-10-23 (its /v1/models entry carries a shutdown_date), so
 * the default is gpt-image-2, which has none and takes the same request.
 */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";

/** Image models OpenAI has retired or is retiring: a key saved with one of these uses the default instead. */
export const RETIRED_IMAGE_MODELS: readonly string[] = ["gpt-image-1", "dall-e-2", "dall-e-3"];

/** The model a user's saved image key should run: their chosen one, unless it's retired (or unset). */
export function imageModelFor(saved: string | null | undefined): string {
  return saved && !RETIRED_IMAGE_MODELS.includes(saved) ? saved : DEFAULT_IMAGE_MODEL;
}

/**
 * The provider's own reason for a refusal, short and safe to show the user: its error message, with anything
 * shaped like a key scrubbed out. Empty when there's none.
 */
export async function providerReason(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let message = "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === "string") message = parsed.error.message;
  } catch {
    /* not JSON: no reason to show */
  }
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 240);
}

export type PortraitInput = {
  name: string;
  age: number;
  bio: string;
  traits: string[];
  appearance?: string | null;
  pronouns?: string | null;
};

/**
 * Visual style of a generated portrait. The user picks per generation, so an anime character gets an anime
 * baseline and a photoreal one gets photoreal; both the still and the Veo clip read from this choice so the
 * clip's first frame matches what the user approved. `illustrated` is the historical default (non-photorealistic
 * drawn style); `anime` leans into cel-shaded manga/anime; `semi_real` is stylised realism; `photoreal` is
 * photographic. Prompts stay tasteful and non-explicit at every setting — the sheet-text filter still applies.
 */
export const PORTRAIT_STYLES = ["illustrated", "anime", "semi_real", "photoreal"] as const;
export type PortraitStyle = (typeof PORTRAIT_STYLES)[number];
export const DEFAULT_PORTRAIT_STYLE: PortraitStyle = "illustrated";
export const PORTRAIT_STYLE_LABELS: Record<PortraitStyle, string> = {
  illustrated: "Illustrated",
  anime: "Anime / manga",
  semi_real: "Semi-realistic",
  photoreal: "Photorealistic",
};
export const isPortraitStyle = (s: unknown): s is PortraitStyle =>
  typeof s === "string" && (PORTRAIT_STYLES as readonly string[]).includes(s);

const STYLE_PROMPT: Record<PortraitStyle, string> = {
  illustrated: "A tasteful, non-photorealistic illustrated character portrait",
  anime: "A tasteful anime-style character portrait (cel-shaded, clean linework, manga/anime aesthetic)",
  semi_real: "A tasteful semi-realistic illustrated character portrait (painterly, stylised realism)",
  photoreal: "A tasteful photorealistic character portrait (photographic, natural skin and lighting)",
};

/** The generation prompt, from filtered sheet fields and the chosen style. A fictional adult; a tasteful character portrait. */
export function portraitPrompt(c: PortraitInput, style: PortraitStyle = DEFAULT_PORTRAIT_STYLE): string {
  const who = c.pronouns ? ` (${c.pronouns})` : "";
  const look = c.appearance ? ` They look like: ${c.appearance}.` : "";
  return (
    `${STYLE_PROMPT[style]} for a fictional adult dating-show contestant. ` +
    `${c.name}${who}, an adult around ${Math.max(18, c.age)}, described as ${c.traits.join(", ")}.${look} ` +
    `Head and shoulders, warm studio lighting, friendly expression, clean simple background. ` +
    `No text, no watermark, fully clothed, suitable for all audiences.`
  );
}

export type GeneratedPortrait = { dataUrl: string; model: string; prompt: string };

/**
 * Generates one portrait through OpenAI's images API with the user's key. fetchImpl is injectable for tests.
 * Throws a plain Error (the route turns it into a message) on refusal or a bad response.
 */
export async function generatePortrait(
  apiKey: string,
  character: PortraitInput,
  model: string = DEFAULT_IMAGE_MODEL,
  fetchImpl: typeof fetch = fetch,
  style: PortraitStyle = DEFAULT_PORTRAIT_STYLE,
): Promise<GeneratedPortrait> {
  const prompt = portraitPrompt(character, style);
  const body: Record<string, unknown> = { model, prompt, size: "1024x1024", n: 1 };
  // dall-e models need an explicit b64 format; the gpt-image models always return b64_json.
  if (/^dall-e/.test(model)) body.response_format = "b64_json";
  const res = await fetchImpl("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    // The provider's own moderation refuses unsafe prompts/outputs here (and a bad key, a spent quota, …): say why.
    const reason = await providerReason(res);
    const blocked = /safety|moderation|content_policy/i.test(reason);
    throw new Error(blocked ? "OpenAI blocked this image." : `OpenAI couldn't make the portrait (HTTP ${res.status})${reason ? `: ${reason}` : "."}`);
  }
  const data = (await res.json().catch(() => null)) as { data?: { b64_json?: unknown }[] } | null;
  const b64 = data?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || b64.length === 0) throw new Error("image provider returned no image");
  return { dataUrl: `data:image/png;base64,${b64}`, model, prompt };
}

/* Intro clips moved to Veo on the player's own Google key (lib/video.ts): OpenAI shut down Sora 2, which they ran
 * on, on 2026-09-24. */
