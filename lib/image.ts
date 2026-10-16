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

/** The generation prompt, from filtered sheet fields only. A fictional adult; a tasteful character portrait. */
export function portraitPrompt(c: PortraitInput): string {
  const who = c.pronouns ? ` (${c.pronouns})` : "";
  const look = c.appearance ? ` They look like: ${c.appearance}.` : "";
  return (
    `A tasteful, non-photorealistic illustrated character portrait for a fictional adult dating-show contestant. ` +
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
): Promise<GeneratedPortrait> {
  const prompt = portraitPrompt(character);
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

/* ------------------------------------- video clips ------------------------------------- */

export const DEFAULT_VIDEO_MODEL = "sora-2";
/**
 * OpenAI shut sora-2 and sora-2-pro down on 2026-09-24, and its /v1/videos API now answers 404, with no successor
 * model. So clips are retired: nothing new is started, and existing clips keep their stored poster as a still.
 */
export const CLIPS_RETIRED = true;
export const CLIPS_RETIRED_MESSAGE =
  "Clips are off: OpenAI retired its video model (Sora 2) on 24 September 2026 and hasn't replaced it. Portraits still work.";
export const CLIP_PROMPT_VERSION = "clip-v1";
const VIDEOS_URL = "https://api.openai.com/v1/videos";

/** A short clip prompt, from filtered sheet text only. A fictional adult; a brief, tasteful intro. */
export function clipPrompt(c: PortraitInput): string {
  const who = c.pronouns ? ` (${c.pronouns})` : "";
  const look = c.appearance ? ` They look like: ${c.appearance}.` : "";
  return (
    `A short, tasteful, non-photorealistic animated introduction of a fictional adult dating-show contestant. ` +
    `${c.name}${who}, an adult around ${Math.max(18, c.age)}, described as ${c.traits.join(", ")}.${look} ` +
    `A friendly wave and a smile to camera, warm studio lighting, clean simple background. ` +
    `No text, no watermark, fully clothed, suitable for all audiences.`
  );
}

export type VideoJob = { id: string; status: string; prompt: string; model: string };
export type VideoStatus = { status: "queued" | "in_progress" | "completed" | "failed" | string; progress: number };

const authHeaders = (apiKey: string) => ({ authorization: `Bearer ${apiKey}`, "content-type": "application/json" });

/** Starts a Sora video job on the user's key. Returns the job id to poll. */
export async function createVideoJob(
  apiKey: string,
  character: PortraitInput,
  model: string = DEFAULT_VIDEO_MODEL,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoJob> {
  const prompt = clipPrompt(character);
  const res = await fetchImpl(VIDEOS_URL, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ model, prompt, size: "720x1280", seconds: "4" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`video provider returned HTTP ${res.status}${/safety|moderation|content_policy/i.test(detail) ? " (the provider blocked this clip)" : ""}`);
  }
  const body = (await res.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  if (typeof body?.id !== "string") throw new Error("video provider returned no job id");
  return { id: body.id, status: typeof body.status === "string" ? body.status : "queued", prompt, model };
}

/** Polls a Sora job's status on the user's key. */
export async function pollVideoJob(apiKey: string, videoId: string, fetchImpl: typeof fetch = fetch): Promise<VideoStatus> {
  const res = await fetchImpl(`${VIDEOS_URL}/${encodeURIComponent(videoId)}`, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`video provider returned HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { status?: unknown; progress?: unknown } | null;
  return { status: typeof body?.status === "string" ? body.status : "in_progress", progress: typeof body?.progress === "number" ? body.progress : 0 };
}

/** The completed clip's thumbnail still, as a durable JPEG data URL (stored and served as the poster). */
export async function fetchVideoThumbnail(apiKey: string, videoId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${VIDEOS_URL}/${encodeURIComponent(videoId)}/content?variant=thumbnail`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`video thumbnail returned HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type")?.includes("png") ? "png" : "jpeg";
  return `data:image/${type};base64,${bytes.toString("base64")}`;
}

/** The completed clip's MP4, as a fetch Response to proxy to the viewer (bytes stay with the provider). */
export async function fetchVideoContent(apiKey: string, videoId: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return fetchImpl(`${VIDEOS_URL}/${encodeURIComponent(videoId)}/content?variant=video`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(120_000),
  });
}
