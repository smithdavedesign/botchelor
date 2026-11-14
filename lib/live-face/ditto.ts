/**
 * Ditto on Runpod Serverless, our second own live-face renderer (workers/live-face-ditto; docs/PRDs/digital-human.md,
 * "Ditto"): Ant Group's talking head on its TensorRT engines, which animates the WHOLE head from one still (turns,
 * brows, blinks, a mouth with teeth) where MuseTalk paints a mouth onto the frames of the idle loop. Same speed as
 * MuseTalk on a 4090 (a 2-s clause in about 1.3 s), same pay-per-second GPU, its own endpoint: the two images don't
 * share a CUDA base. The job API is Runpod's, the same as ./musetalk.ts; `speak` takes a still by URL (the kit's
 * portrait, or a frame of its loop) and the clause's audio, and answers a clip of the still's own size.
 *
 * Today the compare page runs it (lib/live-face/renderers.ts, `ditto`). Calls keep MuseTalk until Ditto's continuity
 * between clauses is built: it has no idle cycle to index, so a run of clauses carries motion state, not a frame.
 */
import { jobError, type RunpodConfig, RunpodError, runsync } from "./musetalk";

/** The env var that names Ditto's endpoint; the key is the same `RUNPOD_API_KEY`. */
export const DITTO_ENDPOINT_VAR = "LIVE_FACE_DITTO_ENDPOINT";

/** The app's Runpod key and Ditto's endpoint id, or null when either is missing (then Ditto is off). */
export function dittoConfig(env: Record<string, string | undefined> = process.env): RunpodConfig | null {
  const key = env.RUNPOD_API_KEY?.trim();
  const endpoint = env[DITTO_ENDPOINT_VAR]?.trim();
  return key && endpoint ? { key, endpoint } : null;
}

export type DittoOutput = { video_b64: string; mime: string; frames: number; fps: number; width: number; height: number; bytes: number; registrations?: number; ms: Record<string, number> };

/**
 * One clause (our Aura PCM, 16-bit mono at `rate`) as a clip of the still saying it. `fade_in`/`fade_out` (frames)
 * ease the motion at the clip's ends. Throws on any failure or past `timeoutMs` (the job is cancelled then).
 */
export async function speakDitto(cfg: RunpodConfig, input: { source_url: string; pcm: Buffer; rate: number; fade_in?: number; fade_out?: number; sampling_timesteps?: number }, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DittoOutput> {
  const job = await runsync<DittoOutput>(
    cfg,
    {
      op: "speak",
      source_url: input.source_url,
      audio_b64: input.pcm.toString("base64"),
      audio_format: "pcm16",
      rate: input.rate,
      ...(input.fade_in !== undefined ? { fade_in: input.fade_in } : {}),
      ...(input.fade_out !== undefined ? { fade_out: input.fade_out } : {}),
      ...(input.sampling_timesteps !== undefined ? { sampling_timesteps: input.sampling_timesteps } : {}),
    },
    { ...opts, what: "ditto speak" },
  );
  if (job.status !== "COMPLETED" || !job.output?.video_b64) throw new RunpodError(`Runpod ditto: ${jobError(job)}`, 502);
  return job.output;
}
