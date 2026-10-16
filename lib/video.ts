/**
 * Intro clips on the player's own Google key: Veo 3.1 Lite through the Gemini API (2026-10-16). OpenAI shut down
 * Sora 2 (the model clips used to run on) on 2026-09-24; Veo 3.1 Lite is the cheapest moderated replacement —
 * $0.05 a second at 720p on the player's Google bill (a 4-second clip ≈ $0.20), native audio, and Google's own
 * safety filters on what it generates. It's $0 to us: the player's key pays Google.
 *
 * The flow (https://ai.google.dev/gemini-api/docs/veo): start with predictLongRunning, poll the operation every
 * few seconds, then download the MP4. Google keeps a generated video for only two days, so the bytes are stored
 * with us (as a data URL in the asset ledger, served with byte ranges by /api/assets/[id]/video).
 *
 * Safety: the prompt is built only from the character's already content-filtered sheet, and the starting frame is
 * its approved (provider-moderated) portrait when it has one, so the clip looks like their card. Veo's filters run
 * on top; a blocked clip comes back with no video and isn't charged by Google.
 */
import type { PortraitInput } from "./image";

export const VEO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const VEO_MODEL = "veo-3.1-lite-generate-preview";
export const CLIP_SECONDS = 4;
export const CLIP_PROMPT_VERSION_VEO = "clip-veo-v1";
/** What a clip costs the player at Google, for the UI (Veo 3.1 Lite, 720p, list price). */
export const CLIP_PROVIDER_COST_USD = 0.05 * CLIP_SECONDS;

/** The clip prompt, from filtered sheet fields only; written to animate the portrait when there is one. */
export function veoClipPrompt(c: PortraitInput, fromPortrait: boolean): string {
  const who = c.pronouns ? ` (${c.pronouns})` : "";
  const look = c.appearance ? ` They look like: ${c.appearance}.` : "";
  const lead = fromPortrait
    ? `Bring this illustrated portrait to life as a short intro for a dating-show contestant: `
    : `A short, tasteful, non-photorealistic animated introduction of a fictional adult dating-show contestant: `;
  return (
    `${lead}${c.name}${who}, an adult around ${Math.max(18, c.age)}, described as ${c.traits.join(", ")}.${look} ` +
    `They look at the camera, smile and give a small friendly wave; gentle camera push-in; warm studio light. ` +
    `Keep the same illustrated style. No text, no captions, no watermark, fully clothed, suitable for all audiences.`
  );
}

const headers = (apiKey: string) => ({ "x-goog-api-key": apiKey, "content-type": "application/json" });

/** Google's own reason for a refusal, short and safe to show (key-shaped text scrubbed). */
async function googleReason(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let message = "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === "string") message = parsed.error.message;
  } catch {
    /* not JSON */
  }
  return message.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 240);
}

export class VideoError extends Error {
  override name = "VideoError";
}

export type VeoStart = { operation: string; prompt: string; model: string };

/**
 * Starts a Veo job on the player's key. `portrait` (a PNG/JPEG/WebP data URL) is the starting frame when the
 * character has one. Returns the operation name to poll.
 */
export async function startVeoClip(
  apiKey: string,
  character: PortraitInput,
  portrait: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<VeoStart> {
  const image = portrait ? /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(portrait) : null;
  const prompt = veoClipPrompt(character, Boolean(image));
  const instance: Record<string, unknown> = { prompt };
  // The predict endpoint takes the image as bytesBase64Encoded; it answers 400 "`inlineData` isn't supported by this
  // model" to the inlineData shape in Google's docs (checked against the live API, 2026-10-16). durationSeconds is a
  // number (4–8), whatever the docs' strings say.
  if (image) instance.image = { bytesBase64Encoded: image[2], mimeType: image[1] };
  const res = await fetchImpl(`${VEO_BASE_URL}/models/${VEO_MODEL}:predictLongRunning`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: "9:16", durationSeconds: CLIP_SECONDS, resolution: "720p" } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const reason = await googleReason(res);
    throw new VideoError(`Google couldn't start the clip (HTTP ${res.status})${reason ? `: ${reason}` : "."}`);
  }
  const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
  if (typeof body?.name !== "string") throw new VideoError("Google returned no job to follow.");
  return { operation: body.name, prompt, model: VEO_MODEL };
}

export type VeoState = { status: "rendering" } | { status: "done"; videoUri: string } | { status: "failed"; reason: string };

/** Polls a Veo operation on the player's key. */
export async function pollVeoClip(apiKey: string, operation: string, fetchImpl: typeof fetch = fetch): Promise<VeoState> {
  // Only the operation name Google gave us (models/…/operations/…): never an arbitrary path.
  if (!/^models\/[\w.-]+\/operations\/[\w-]+$/.test(operation)) return { status: "failed", reason: "Unknown clip job." };
  const res = await fetchImpl(`${VEO_BASE_URL}/${operation}`, { headers: headers(apiKey), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) return { status: "rendering" }; // a blip: poll again
    return { status: "failed", reason: (await googleReason(res)) || `Google answered HTTP ${res.status}.` };
  }
  const body = (await res.json().catch(() => null)) as {
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
  } | null;
  if (!body?.done) return { status: "rendering" };
  if (body.error) return { status: "failed", reason: String(body.error.message ?? "Google couldn't make this clip.").slice(0, 240) };
  const gen = body.response?.generateVideoResponse;
  const uri = gen?.generatedSamples?.[0]?.video?.uri;
  if (typeof uri === "string" && uri.startsWith("https://")) return { status: "done", videoUri: uri };
  const filtered = gen?.raiMediaFilteredReasons?.join(" ").slice(0, 200);
  return { status: "failed", reason: filtered ? `Google's safety filters blocked this clip (${filtered}).` : "Google's safety filters blocked this clip." };
}

/** The largest clip we keep (a 4-second 720p clip is ~1–3 MB); also under a serverless response limit. */
export const MAX_CLIP_BYTES = 4 * 1024 * 1024;

/** Downloads the finished MP4 (Google keeps it two days) as a data URL to store. Only Google's own hosts. */
export async function downloadVeoClip(apiKey: string, videoUri: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const host = new URL(videoUri).hostname;
  if (!/(^|\.)googleapis\.com$|(^|\.)googleusercontent\.com$/.test(host)) throw new VideoError("Unexpected video host.");
  const res = await fetchImpl(videoUri, { headers: { "x-goog-api-key": apiKey }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new VideoError(`Couldn't download the clip (HTTP ${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_CLIP_BYTES) throw new VideoError("The clip came back empty or too large.");
  return `data:video/mp4;base64,${bytes.toString("base64")}`;
}
