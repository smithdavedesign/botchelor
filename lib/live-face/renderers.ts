/**
 * The clip renderers: everything that can turn a clause of a character's voice into a short video of their face saying
 * it (docs/PRDs/digital-human.md, "Renderer compare"). One interface, so the admin compare page (lib/live-face/compare.ts)
 * can run the same line through all of them side by side, and a call can pick one:
 *
 *  - `musetalk` (ours, Runpod; lib/live-face/musetalk.ts): live, about half the clause's length to render.
 *  - fal.ai hosted models and Replicate's Wan 2.2 S2V: batch, 20 s to a few minutes a clause, the ceiling of what the
 *    mouth can look like today (OmniHuman, InfiniTalk, Sync lipsync-2, LatentSync, Kling lipsync). A still (the kit's
 *    portrait) or the kit's loop plus the audio in, a video out.
 *  - D-ID's Talks API: batch, from the portrait, on the person's own D-ID key.
 *  - Simli is a stream, not clips (lib/live-face/simli.ts); it's listed so the compare page can say so.
 *
 * A renderer never holds a key: the caller passes the one that applies (the person's Connection for that provider, or
 * the house key for an admin's compare). Costs are estimates from each provider's published per-second price, marked
 * as such; the person's own bill is the truth.
 */
import { runModel } from "../adult/replicate";
import { MUSETALK_STREAM_PX, runpodConfig, speakClip } from "./musetalk";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
/** Tests point the hosted renderers at a stand-in. */
export function setRendererFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

export type RendererProvider = "house" | "fal" | "replicate" | "did" | "simli";
export type RendererKind = "live" | "batch" | "stream";

export type RenderInput = {
  characterId: string;
  /** The kit's portrait and loop as URLs a provider can fetch (absolute), and the loop's bytes for ours. */
  portraitUrl: string | null;
  loopUrl: string | null;
  /** The clause: Aura's PCM (16-bit mono at `rate`), the same as a WAV, its length, and a URL a provider can fetch it from. */
  audio: { pcm: Buffer; wav: Buffer; rate: number; seconds: number; url: string };
  /** For ours: the character's ready bundle (lib/live-face/index.ts), or null when there is none. */
  bundleKey: string | null;
};
export type RenderContext = { apiKey: string | null; env: Env; signal?: AbortSignal };
export type RenderResult = { mp4: Buffer; ms: number; cost_usd: number | null; frames?: number; note?: string };

export type ClipRenderer = {
  id: string;
  label: string;
  kind: RendererKind;
  provider: RendererProvider;
  /** The provider's model id, as their API names it. */
  model: string;
  /** One line on what it is and what it takes. */
  about: string;
  /** What a clause costs, roughly, from the provider's published price; null when they don't publish one per second. */
  costHint: string | null;
  /** Whether the compare can run it to an MP4 (a stream can't). */
  runs: boolean;
  speak: (input: RenderInput, ctx: RenderContext) => Promise<RenderResult>;
};

export class RendererError extends Error {}

const MAX_MP4 = 60 * 1024 * 1024;

/* ----------------------------------------------------------- ours ----------------------------------------------------------- */

/** A 4090 worker's second, Runpod's list price for the ADA_24 pool (workers/live-face/README.md). */
const RUNPOD_USD_PER_SECOND = 0.022 / 60;

const musetalk: ClipRenderer = {
  id: "musetalk",
  label: "MuseTalk (ours, Runpod)",
  kind: "live",
  provider: "house",
  model: "TMElyralab/MuseTalk 1.5",
  about: "The show's own renderer: the kit's idle loop with the mouth painted per frame, on a GPU rented by the second. What calls use today.",
  costHint: "about 1.3–2.2¢ a call minute while it renders",
  runs: true,
  async speak(input, ctx) {
    const cfg = runpodConfig(ctx.env);
    if (!cfg) throw new RendererError("RUNPOD_API_KEY and LIVE_FACE_ENDPOINT aren't set");
    if (!input.bundleKey) throw new RendererError("no bundle: build the character's live face first");
    const t0 = Date.now();
    const out = await speakClip(cfg, { bundle_key: input.bundleKey, pcm: input.audio.pcm, rate: input.audio.rate, start_frame: 0 }, { signal: ctx.signal, timeoutMs: 120_000 });
    const ms = Date.now() - t0;
    return { mp4: Buffer.from(out.video_b64, "base64"), ms, cost_usd: round((out.ms?.total ?? ms) / 1000 * RUNPOD_USD_PER_SECOND), frames: out.frames, note: `${MUSETALK_STREAM_PX}px, ${out.frames} frames` };
  },
};

/* ----------------------------------------------------------- fal.ai ----------------------------------------------------------- */

export const FAL_QUEUE = "https://queue.fal.run";

type FalQueued = { request_id: string; status_url?: string; response_url?: string };
type FalStatus = { status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED"; queue_position?: number; logs?: unknown };

/**
 * One fal.ai queue job: submit, poll its status, read its response, download the video it names. fal's own queue API
 * (https://docs.fal.ai/model-endpoints/queue): the key goes as `Authorization: Key …`.
 */
export async function falRun(apiKey: string, model: string, input: Record<string, unknown>, opts: { timeoutMs?: number; signal?: AbortSignal; everyMs?: number } = {}): Promise<{ output: Record<string, unknown>; ms: number }> {
  const headers = { Authorization: `Key ${apiKey}`, "content-type": "application/json" };
  const t0 = Date.now();
  const submitted = await doFetch(`${FAL_QUEUE}/${model}`, { method: "POST", headers, body: JSON.stringify(input), signal: opts.signal });
  if (!submitted.ok) throw new RendererError(`fal.ai ${submitted.status}: ${(await submitted.text().catch(() => "")).slice(0, 200)}`);
  const q = (await submitted.json()) as FalQueued;
  const base = `${FAL_QUEUE}/${model}/requests/${q.request_id}`;
  const deadline = t0 + (opts.timeoutMs ?? 300_000);
  for (;;) {
    if (opts.signal?.aborted) throw new RendererError("stopped");
    const st = await doFetch(`${base}/status`, { headers, signal: opts.signal });
    if (st.ok) {
      const s = (await st.json()) as FalStatus;
      if (s.status === "COMPLETED") break;
    } else if (st.status !== 404 && st.status !== 405) {
      throw new RendererError(`fal.ai status ${st.status}`);
    }
    if (Date.now() > deadline) {
      await doFetch(`${base}/cancel`, { method: "PUT", headers }).catch(() => null);
      throw new RendererError(`fal.ai took longer than ${Math.round((opts.timeoutMs ?? 300_000) / 1000)} s`);
    }
    await new Promise((ok) => setTimeout(ok, opts.everyMs ?? 2000));
  }
  const res = await doFetch(base, { headers, signal: opts.signal });
  if (!res.ok) throw new RendererError(`fal.ai result ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return { output: (await res.json()) as Record<string, unknown>, ms: Date.now() - t0 };
}

/** The video a fal.ai job answered with (`video.url`, or the first url in `video`/`output`), downloaded. */
export async function falVideo(output: Record<string, unknown>, signal?: AbortSignal): Promise<Buffer> {
  const v = output.video ?? output.output ?? null;
  const url = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? (v as { url: string }).url : null;
  if (!url) throw new RendererError("fal.ai returned no video");
  return download(url, signal);
}

function falRenderer(o: { id: string; label: string; model: string; about: string; costHint: string | null; usdPerSecond: number | null; input: (i: RenderInput) => Record<string, unknown> | null }): ClipRenderer {
  return {
    id: o.id,
    label: o.label,
    kind: "batch",
    provider: "fal",
    model: o.model,
    about: o.about,
    costHint: o.costHint,
    runs: true,
    async speak(input, ctx) {
      if (!ctx.apiKey) throw new RendererError("no fal.ai key");
      const body = o.input(input);
      if (!body) throw new RendererError("this renderer needs the kit's portrait and loop");
      const { output, ms } = await falRun(ctx.apiKey, o.model, body, { signal: ctx.signal });
      const mp4 = await falVideo(output, ctx.signal);
      return { mp4, ms, cost_usd: o.usdPerSecond === null ? null : round(input.audio.seconds * o.usdPerSecond), note: "fal.ai" };
    },
  };
}

const PROMPT = "A person talking to the camera, natural and calm, small head movements, the same framing throughout.";

const falInfinitalk = falRenderer({
  id: "fal:infinitalk",
  label: "InfiniteTalk (fal.ai)",
  model: "fal-ai/infinitalk",
  about: "Audio-driven video from the portrait, whole head and shoulders moving. 480p, frames to fit the clause.",
  costHint: "fal's per-second price for the model; see your fal bill",
  usdPerSecond: null,
  input: (i) => (i.portraitUrl ? { image_url: i.portraitUrl, audio_url: i.audio.url, prompt: PROMPT, resolution: "480p", num_frames: Math.min(721, Math.max(41, Math.round(i.audio.seconds * 25) + 1)), acceleration: "regular" } : null),
});
const falOmnihuman = falRenderer({
  id: "fal:omnihuman",
  label: "OmniHuman (fal.ai)",
  model: "fal-ai/bytedance/omnihuman",
  about: "ByteDance's OmniHuman from the portrait: the strongest whole-face realism published; slow and dear.",
  costHint: "fal's per-second price for the model; see your fal bill",
  usdPerSecond: null,
  input: (i) => (i.portraitUrl ? { image_url: i.portraitUrl, audio_url: i.audio.url } : null),
});
const falSync = falRenderer({
  id: "fal:sync-lipsync-2",
  label: "Sync lipsync-2 (fal.ai)",
  model: "fal-ai/sync-lipsync/v2",
  about: "Sync Labs' lipsync-2 over the kit's own loop: the nearest like-for-like with ours (a mouth onto our video).",
  costHint: "fal's per-second price for the model; see your fal bill",
  usdPerSecond: null,
  input: (i) => (i.loopUrl ? { video_url: i.loopUrl, audio_url: i.audio.url, model: "lipsync-2", sync_mode: "loop" } : null),
});
const falLatentsync = falRenderer({
  id: "fal:latentsync",
  label: "LatentSync (fal.ai)",
  model: "fal-ai/latentsync",
  about: "ByteDance's LatentSync over the kit's loop (diffusion lip-sync, open weights).",
  costHint: "fal's per-second price for the model; see your fal bill",
  usdPerSecond: null,
  input: (i) => (i.loopUrl ? { video_url: i.loopUrl, audio_url: i.audio.url, loop_mode: "loop" } : null),
});
const falKling = falRenderer({
  id: "fal:kling-lipsync",
  label: "Kling lipsync (fal.ai)",
  model: "fal-ai/kling-video/lipsync/audio-to-video",
  about: "Kling's lipsync over the kit's loop.",
  costHint: "fal's per-second price for the model; see your fal bill",
  usdPerSecond: null,
  input: (i) => (i.loopUrl ? { video_url: i.loopUrl, audio_url: i.audio.url } : null),
});

/* ----------------------------------------------------------- Replicate ----------------------------------------------------------- */

/** Replicate's Wan 2.2 S2V, as the After Dark reels price it (lib/adult/reels.ts): about 2¢ a second of output. */
const WAN_S2V_USD_PER_SECOND = 0.02;

const replicateWanS2v: ClipRenderer = {
  id: "replicate:wan-2.2-s2v",
  label: "Wan 2.2 S2V (Replicate)",
  kind: "batch",
  provider: "replicate",
  model: "wan-video/wan-2.2-s2v",
  about: "Speech-to-video from the portrait, the model the reels' talking shots use; a minute or more a clause.",
  costHint: "about 2¢ a second of clip on your Replicate bill",
  runs: true,
  async speak(input, ctx) {
    if (!ctx.apiKey) throw new RendererError("no Replicate key");
    if (!input.portraitUrl) throw new RendererError("this renderer needs the kit's portrait");
    const t0 = Date.now();
    const file = await runModel(ctx.apiKey, this.model, { image: input.portraitUrl, audio: input.audio.url, prompt: PROMPT }, { maxBytes: MAX_MP4, timeoutMs: 600_000, cancelAfter: "10m" });
    return { mp4: file.bytes, ms: Date.now() - t0, cost_usd: round(input.audio.seconds * WAN_S2V_USD_PER_SECOND), note: "Replicate" };
  },
};

/* ----------------------------------------------------------- D-ID ----------------------------------------------------------- */

export const DID_API = "https://api.d-id.com";

/** One D-ID Talk (https://docs.d-id.com/reference/createtalk): the key goes as `Authorization: Basic <key>`. */
export async function didTalk(apiKey: string, sourceUrl: string, audioUrl: string, opts: { timeoutMs?: number; signal?: AbortSignal; everyMs?: number } = {}): Promise<{ resultUrl: string; ms: number }> {
  const headers = { Authorization: `Basic ${apiKey}`, "content-type": "application/json", accept: "application/json" };
  const t0 = Date.now();
  const created = await doFetch(`${DID_API}/talks`, { method: "POST", headers, body: JSON.stringify({ source_url: sourceUrl, script: { type: "audio", audio_url: audioUrl }, config: { stitch: true } }), signal: opts.signal });
  if (!created.ok) throw new RendererError(`D-ID ${created.status}: ${(await created.text().catch(() => "")).slice(0, 200)}`);
  const { id } = (await created.json()) as { id: string };
  const deadline = t0 + (opts.timeoutMs ?? 300_000);
  for (;;) {
    await new Promise((ok) => setTimeout(ok, opts.everyMs ?? 2000));
    if (opts.signal?.aborted) throw new RendererError("stopped");
    const res = await doFetch(`${DID_API}/talks/${id}`, { headers, signal: opts.signal });
    if (!res.ok) throw new RendererError(`D-ID talk ${res.status}`);
    const t = (await res.json()) as { status: string; result_url?: string; error?: { description?: string } };
    if (t.status === "done" && t.result_url) return { resultUrl: t.result_url, ms: Date.now() - t0 };
    if (t.status === "error" || t.status === "rejected") throw new RendererError(`D-ID: ${t.error?.description ?? t.status}`);
    if (Date.now() > deadline) throw new RendererError("D-ID took too long");
  }
}

const didTalks: ClipRenderer = {
  id: "did:talks",
  label: "D-ID Talks",
  kind: "batch",
  provider: "did",
  model: "talks (stitch)",
  about: "D-ID's talking-head from the portrait, on your own D-ID key; half a minute a clause.",
  costHint: "D-ID credits, about 1 credit per 15 s",
  runs: true,
  async speak(input, ctx) {
    if (!ctx.apiKey) throw new RendererError("no D-ID key");
    if (!input.portraitUrl) throw new RendererError("this renderer needs the kit's portrait");
    const { resultUrl, ms } = await didTalk(ctx.apiKey, input.portraitUrl, input.audio.url, { signal: ctx.signal });
    return { mp4: await download(resultUrl, ctx.signal), ms, cost_usd: null, note: "D-ID" };
  },
};

/* ----------------------------------------------------------- Simli ----------------------------------------------------------- */

const simli: ClipRenderer = {
  id: "simli",
  label: "Simli (stream)",
  kind: "stream",
  provider: "simli",
  model: "Trinity",
  about: "A live WebRTC face (lib/live-face/simli.ts); heard on a call, not rendered to a clip here. Needs a Simli plan or key with faces.",
  costHint: "about 1¢ a minute on a Simli plan",
  runs: false,
  async speak() {
    throw new RendererError("Simli streams; it can't render a clip");
  },
};

/* ----------------------------------------------------------- the registry ----------------------------------------------------------- */

export const RENDERERS: readonly ClipRenderer[] = [musetalk, falSync, falLatentsync, falKling, falInfinitalk, falOmnihuman, replicateWanS2v, didTalks, simli];

export const rendererById = (id: string): ClipRenderer | null => RENDERERS.find((r) => r.id === id) ?? null;

/** The renderers a compare can run, in the order shown. */
export const runnableRenderers = (): ClipRenderer[] => RENDERERS.filter((r) => r.runs);

async function download(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await doFetch(url, { signal });
  if (!res.ok) throw new RendererError(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MP4) throw new RendererError("the clip is too big");
  if (!buf.length) throw new RendererError("the clip is empty");
  return buf;
}

const round = (usd: number): number => Math.round(usd * 10_000) / 10_000;
