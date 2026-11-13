/**
 * MuseTalk on Runpod Serverless, our own live-face renderer (workers/live-face; docs/PRDs/digital-human.md, Tier 1b):
 * a character's avatar bundle is made once from their face-kit idle loop, and on a call each clause of the companion's
 * voice comes back as a short clip of the loop with the mouth saying it. Nothing streams from the browser to a vendor:
 * the server sends the clause's audio to the worker and the clip to the browser. Pay-per-second GPU, no monthly plan,
 * no vendor terms on the faces (Runpod's own terms keep it to PG: docs/PRDs/digital-human.md).
 *
 * The worker's jobs (handler.py): `prepare` (loop → bundle in the show's object store, a minute or two: asked with /run
 * and followed with /status), `speak` (audio → MP4, a second or two: /runsync), `warm` (spin a worker up). Only
 * `RUNPOD_API_KEY` (the app's key, Serverless endpoints only) talks to Runpod, and only from here.
 */
export const RUNPOD_API = "https://api.runpod.ai/v2";
/** Clips are the loop's own size (the face kit draws loops at 624²); the round frame shows them at 136 px. */
export const MUSETALK_STREAM_PX = 624;
/** A clause's clip that hasn't come back by then plays without the face (the browser falls back to Tier 0). */
export const SPEAK_TIMEOUT_MS = 12_000;

type Fetch = typeof fetch;
let fetchForTests: Fetch | null = null;
export function setRunpodFetchForTests(f: Fetch | null): void {
  fetchForTests = f;
}
const doFetch: Fetch = (input, init) => (fetchForTests ?? fetch)(input, init);

export type RunpodConfig = { key: string; endpoint: string };

/** The app's Runpod key and the live-face endpoint's id, or null when either is missing (then MuseTalk is off). */
export function runpodConfig(env: Record<string, string | undefined> = process.env): RunpodConfig | null {
  const key = env.RUNPOD_API_KEY?.trim();
  const endpoint = env.LIVE_FACE_ENDPOINT?.trim();
  return key && endpoint ? { key, endpoint } : null;
}

export class RunpodError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type RunpodJobStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
export type RunpodJob<T = unknown> = { id: string; status: RunpodJobStatus; output?: T; error?: unknown; delayTime?: number; executionTime?: number };

async function call<T>(cfg: RunpodConfig, path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await doFetch(`${RUNPOD_API}/${cfg.endpoint}/${path}`, {
    ...rest,
    method: rest.method ?? (json !== undefined ? "POST" : "GET"),
    headers: { authorization: `Bearer ${cfg.key}`, ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers as Record<string, string> | undefined) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RunpodError(`Runpod ${path}: ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

export type PrepareOutput = { bundle_key: string; frames: number; width: number; height: number; fps: number; bytes: number; ms: Record<string, number> };
export type SpeakOutput = { video_b64: string; mime: string; frames: number; next_frame: number; width: number; height: number; bytes: number; ms: Record<string, number> };

/** Asks the worker to build a character's bundle from their idle loop (MP4 bytes). Returns the job to follow. */
export async function startPrepare(cfg: RunpodConfig, input: { id: string; loop: Buffer; bbox_shift?: number }): Promise<{ job_id: string }> {
  const r = await call<RunpodJob>(cfg, "run", { json: { input: { op: "prepare", id: input.id, loop_b64: input.loop.toString("base64"), bbox_shift: input.bbox_shift ?? 0 } } });
  if (!r.id) throw new RunpodError("Runpod run: no job id", 502);
  return { job_id: r.id };
}

/** Where a job is now. A worker's own failure comes back as status FAILED with its message in `error`. */
export async function jobStatus<T = unknown>(cfg: RunpodConfig, jobId: string): Promise<RunpodJob<T>> {
  return call<RunpodJob<T>>(cfg, `status/${encodeURIComponent(jobId)}`);
}

/** The worker's reason for a failed job, as a short string. */
export function jobError(job: RunpodJob): string {
  const e = job.error ?? (job.output as { error?: unknown } | undefined)?.error;
  return (typeof e === "string" ? e : e ? JSON.stringify(e) : job.status).slice(0, 200);
}

/** Spins a worker up (and loads the models) so a call's first clause doesn't wait for it. Nothing is awaited. */
export async function warmWorker(cfg: RunpodConfig): Promise<void> {
  await call(cfg, "run", { json: { input: { op: "warm" } } }).catch(() => {});
}

/**
 * One clause of the companion's voice (our Aura PCM, 16-bit mono at `rate`) as a clip of the character saying it. The
 * worker renders from `start_frame` of the idle cycle so clause after clause continues the same motion. Waits
 * `timeoutMs` at most (the job is cancelled then), and throws on any failure: the call goes on without the face.
 */
export async function speakClip(cfg: RunpodConfig, input: { bundle_key: string; pcm: Buffer; rate: number; start_frame?: number; fps?: number }, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<SpeakOutput> {
  const timeoutMs = opts.timeoutMs ?? SPEAK_TIMEOUT_MS;
  const started = Date.now();
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const body = { input: { op: "speak", bundle_key: input.bundle_key, audio_b64: input.pcm.toString("base64"), audio_format: "pcm16", rate: input.rate, start_frame: input.start_frame ?? 0, fps: input.fps ?? 25 } };
    let job = await call<RunpodJob<SpeakOutput>>(cfg, `runsync?wait=${Math.min(90_000, timeoutMs)}`, { json: body, signal: ctl.signal });
    while (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS") {
      if (Date.now() - started > timeoutMs) {
        await call(cfg, `cancel/${encodeURIComponent(job.id)}`, { method: "POST" }).catch(() => {});
        throw new RunpodError(`Runpod speak: no clip within ${timeoutMs} ms`, 504);
      }
      await new Promise((r) => setTimeout(r, fetchForTests ? 0 : 250));
      job = await jobStatus<SpeakOutput>(cfg, job.id);
    }
    if (job.status !== "COMPLETED" || !job.output?.video_b64) throw new RunpodError(`Runpod speak: ${jobError(job)}`, 502);
    return job.output;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
