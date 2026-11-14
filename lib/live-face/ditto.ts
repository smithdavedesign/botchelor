/**
 * Ditto on Runpod Serverless, our second own live-face renderer (workers/live-face-ditto; docs/PRDs/digital-human.md,
 * "Ditto"): Ant Group's talking head on its TensorRT engines, which animates the WHOLE head from one still (turns,
 * brows, blinks, a mouth with teeth) where MuseTalk paints a mouth onto the frames of the idle loop. Same speed as
 * MuseTalk on a 4090 (a 2-s clause in about 1.3 s), same pay-per-second GPU, its own endpoint: the two images don't
 * share a CUDA base. The job API is Runpod's, the same as ./musetalk.ts; `speak` takes a still by URL (the kit's
 * portrait) and the clause's audio, and answers a clip of the still's own size.
 *
 * On a call a reply is a CHAIN of clauses (DittoChain). Ditto has no idle cycle to index (MuseTalk's `start_frame`),
 * so continuity is motion state the worker hands back with each clip and takes with the next (`state_b64`, opaque
 * here): the first clause of a reply starts at the still and eases in, each next one continues the motion, and the
 * last gets a little silence appended and eases pose and expression back to the still, so the browser hands over to
 * the kit's loop at its first frame (the portrait) with no jump. The clauses render one after another (each needs the
 * one before's state), each in about half its length, so a chain keeps ahead of its own playback; a clause whose
 * place isn't known yet (is it the reply's last?) waits a moment for the next piece or the reply's end.
 */
import { jobError, type RunpodConfig, RunpodError, runStream, runsync } from "./musetalk";

/** The env var that names Ditto's endpoint; the key is the same `RUNPOD_API_KEY`. */
export const DITTO_ENDPOINT_VAR = "LIVE_FACE_DITTO_ENDPOINT";
/** Clips are the kit portrait's own size; the round frame shows them at 136 px. */
export const DITTO_PX = 512;

/** The app's Runpod key and Ditto's endpoint id, or null when either is missing (then Ditto is off). */
export function dittoConfig(env: Record<string, string | undefined> = process.env): RunpodConfig | null {
  const key = env.RUNPOD_API_KEY?.trim();
  const endpoint = env[DITTO_ENDPOINT_VAR]?.trim();
  return key && endpoint ? { key, endpoint } : null;
}

export type DittoOutput = {
  video_b64: string;
  mime: string;
  frames: number;
  fps: number;
  width: number;
  height: number;
  bytes: number;
  registrations?: number;
  /** The chain's state for the next clause (asked with `want_state`). Opaque: the worker's own. */
  state_b64?: string;
  chain?: { in: boolean; skip: number; fade_in: number; fade_out: number; silence_ms: number; state: boolean };
  handler?: string;
  ms: Record<string, number>;
};

export type DittoSpeakInput = {
  source_url: string;
  /** The clause: our Aura PCM, 16-bit mono at `rate`. */
  pcm: Buffer;
  rate: number;
  /** Frames easing the motion in from the still (a chain's first clause) and out to it (the last). */
  fade_in?: number;
  fade_out?: number;
  /** Silence appended to the clause (the last of a chain: the lips close on it under the fade out). */
  tail_silence_ms?: number;
  /** The state the clause before answered with, to continue its motion; none starts a chain. */
  state?: string | null;
  /** Whether to answer with the state for a clause after this one. */
  want_state?: boolean;
  /** Ditto's expression bank for the clause (lib/live-face-shared.ts DITTO_EMO; the worker's default is neutral). */
  emo?: number;
  /** A pose on top of what the audio drives (the worker's `sway`, `nod`, `tilt`), for the idle and the reactions. */
  motion?: { kind: "sway" | "nod" | "tilt"; amount?: number; period_s?: number; at_s?: number };
  sampling_timesteps?: number;
};

/** The worker's handler is a generator and Runpod aggregates its outputs: a plain op's result is the first (and only) item. */
const firstOutput = <T>(output: T | T[] | undefined): T | undefined => (Array.isArray(output) ? output[0] : output);

function speakInput(input: DittoSpeakInput): Record<string, unknown> {
  return {
    op: "speak",
    source_url: input.source_url,
    audio_b64: input.pcm.toString("base64"),
    audio_format: "pcm16",
    rate: input.rate,
    ...(input.fade_in ? { fade_in: input.fade_in } : {}),
    ...(input.fade_out ? { fade_out: input.fade_out } : {}),
    ...(input.tail_silence_ms ? { tail_silence_ms: input.tail_silence_ms } : {}),
    ...(input.state ? { state_b64: input.state } : {}),
    ...(input.want_state ? { want_state: true } : {}),
    ...(input.emo !== undefined ? { emo: input.emo } : {}),
    ...(input.motion ? { motion: input.motion } : {}),
    ...(input.sampling_timesteps !== undefined ? { sampling_timesteps: input.sampling_timesteps } : {}),
  };
}

export type DittoStreamStart = { frames: number; fps: number; width: number; height: number; handler?: string };
export type DittoStreamEnd = { frames: number; pieces: number; bytes: number; first_piece_ms: number | null; ms: Record<string, number>; handler?: string };

/**
 * One clause streamed (workers/live-face-ditto speak_stream): `start` with the clip's shape, the chain's `state` the
 * moment the motion step is done (before the frames), then the pieces of a fragmented MP4 with the voice in it as the
 * renderer writes frames, then `end`. Throws on any failure or past `timeoutMs`.
 */
export async function speakDittoStream(cfg: RunpodConfig, input: DittoSpeakInput, on: { start?: (info: DittoStreamStart) => void; state?: (state: string) => void; frag: (i: number, bytes: Buffer) => void }, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DittoStreamEnd> {
  let end: DittoStreamEnd | null = null;
  let error: string | null = null;
  const job = await runStream(
    cfg,
    { ...speakInput(input), stream: true },
    (output) => {
      const o = output as { kind?: string; error?: string } & Record<string, unknown>;
      if (!o || typeof o !== "object") return;
      if (o.error) error = String(o.error);
      else if (o.kind === "start") on.start?.(o as unknown as DittoStreamStart);
      else if (o.kind === "state" && typeof o.state_b64 === "string") on.state?.(o.state_b64);
      else if (o.kind === "frag" && typeof o.b64 === "string") on.frag(Number(o.i ?? 0), Buffer.from(o.b64, "base64"));
      else if (o.kind === "end") end = o as unknown as DittoStreamEnd;
    },
    { ...opts, what: "ditto stream" },
  );
  if (error) throw new RunpodError(`Runpod ditto: ${error}`, 502);
  if (job.status !== "COMPLETED" || !end) throw new RunpodError(`Runpod ditto: ${jobError(job)}`, 502);
  return end;
}

/** One clause as a clip of the still saying it. Throws on any failure or past `timeoutMs` (the job is cancelled then). */
export async function speakDitto(cfg: RunpodConfig, input: DittoSpeakInput, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DittoOutput> {
  const job = await runsync<DittoOutput | DittoOutput[]>(
    cfg,
    {
      op: "speak",
      source_url: input.source_url,
      audio_b64: input.pcm.toString("base64"),
      audio_format: "pcm16",
      rate: input.rate,
      ...(input.fade_in ? { fade_in: input.fade_in } : {}),
      ...(input.fade_out ? { fade_out: input.fade_out } : {}),
      ...(input.tail_silence_ms ? { tail_silence_ms: input.tail_silence_ms } : {}),
      ...(input.state ? { state_b64: input.state } : {}),
      ...(input.want_state ? { want_state: true } : {}),
      ...(input.emo !== undefined ? { emo: input.emo } : {}),
      ...(input.motion ? { motion: input.motion } : {}),
      ...(input.sampling_timesteps !== undefined ? { sampling_timesteps: input.sampling_timesteps } : {}),
    },
    { ...opts, what: "ditto speak" },
  );
  const out = firstOutput(job.output);
  if (job.status !== "COMPLETED" || !out?.video_b64) throw new RunpodError(`Runpod ditto: ${jobError(job)}`, 502);
  return out;
}

/* ------------------------------------------------------------- the chain ------------------------------------------------------------- */

/** A chain's first clause eases in from the still over this many frames (240 ms). */
export const CHAIN_FADE_IN = 6;
/** Its last clause: the silence appended (the lips close on it) and the frames over which pose and expression return to the still. */
export const CHAIN_TAIL_SILENCE_MS = 400;
export const CHAIN_FADE_OUT = 13;
/** A clause whose place isn't known yet (nothing after it named, the reply not ended) waits this long before rendering as not the last. */
export const CHAIN_DECIDE_MS = 2500;
/** A clause's clip not back in this long breaks the chain there: that piece plays plain and the next starts from the still. */
export const CHAIN_SPEAK_TIMEOUT_MS = 20_000;

export type ChainClip = { i: number; mp4: string; frames: number; last: boolean; ms: number; handler?: string; emo?: number };
export type ChainHandlers = {
  /** Whole clips (the browser plays MP4s): one per clause. */
  clip?: (c: ChainClip) => void;
  /** Streamed clauses (the browser plays fragments through MediaSource): the clip's shape, its pieces as they render, its end. When `frag` is set the chain streams. */
  start?: (i: number, info: DittoStreamStart) => void;
  frag?: (i: number, seq: number, bytes: Buffer) => void;
  end?: (i: number, info: DittoStreamEnd & { last: boolean }) => void;
  fail: (i: number, err: unknown) => void;
};

/**
 * A reply's clauses rendered by Ditto in order, each continuing the motion of the one before. The route feeds it:
 * `expect(i)` when the reply names piece i (so a clause knows one comes after it), `add(i, pcm)` when piece i's voice
 * is in, `finish()` when nothing more will come; `done()` resolves when every clause added has a clip or failed. A
 * failure breaks the chain at that clause (`fail`); the next starts a chain again from the still. Streamed (handlers
 * with `frag`), the next clause's job is queued the moment this one's state arrives, while its frames still render.
 */
export class DittoChain {
  private pending: { i: number; pcm: Buffer; emo?: number }[] = [];
  private state: string | null = null;
  private fresh = true;
  private announced = 0;
  private finished = false;
  private running = false;
  private decide: ReturnType<typeof setTimeout> | null = null;
  private jobs: Promise<void>[] = [];
  private waiters: (() => void)[] = [];
  private abandoned = false;
  /** How many clauses ran and how many broke the chain. */
  readonly stats = { clips: 0, failed: 0 };

  constructor(
    private readonly cfg: RunpodConfig,
    private readonly sourceUrl: string,
    private readonly rate: number,
    private readonly on: ChainHandlers,
    private readonly opts: { signal?: AbortSignal; decideMs?: number; timeoutMs?: number } = {},
  ) {}

  /** Whether clauses stream (fragments) rather than come as whole clips. */
  get streams(): boolean {
    return typeof this.on.frag === "function";
  }

  /** The reply has named piece i (its text; the voice may still be coming): the clause before it isn't the last. */
  expect(i: number): void {
    this.announced = Math.max(this.announced, i + 1);
    this.drain();
  }

  /** Piece i's voice is in; `emo` is the expression bank it's spoken in (lib/live-face-shared.ts emoFor). */
  add(i: number, pcm: Buffer, opts: { emo?: number } = {}): void {
    if (!pcm.length) return;
    if (this.abandoned) {
      // The reply's first clause failed (a cold worker, say): the browser went plain for the whole reply at its
      // hold, so the rest would render for nothing. Said so at once instead.
      this.on.fail(i, new Error("the reply's first clause failed"));
      return;
    }
    this.pending.push({ i, pcm, emo: opts.emo });
    this.pending.sort((a, b) => a.i - b.i);
    this.drain();
  }

  /** No more pieces will come: the one waiting is the last and gets the fade out. */
  finish(): void {
    this.finished = true;
    this.drain();
  }

  /** Resolves once every clause added has been rendered or has failed (call after finish()), or at once when stopped. */
  async done(): Promise<void> {
    while (!this.opts.signal?.aborted && (this.pending.length || this.running)) {
      await new Promise<void>((ok) => this.waiters.push(ok));
    }
    await Promise.allSettled(this.jobs);
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((ok) => ok());
  }

  private drain(): void {
    if (this.opts.signal?.aborted) {
      this.pending = [];
      if (this.decide) clearTimeout(this.decide);
      this.decide = null;
      this.wake();
      return;
    }
    if (this.running || !this.pending.length) return;
    const head = this.pending[0];
    const last = this.finished && this.pending.length === 1;
    const later = !last && (this.pending.length > 1 || this.announced > head.i + 1);
    if (!last && !later) {
      // Whether this is the reply's last clause isn't known yet: wait for the next piece or the end, a while.
      if (!this.decide) {
        this.decide = setTimeout(() => {
          this.decide = null;
          if (!this.running && this.pending[0] === head) this.render(head, false);
        }, this.opts.decideMs ?? CHAIN_DECIDE_MS);
      }
      return;
    }
    if (this.decide) clearTimeout(this.decide);
    this.decide = null;
    this.render(head, last);
  }

  private render(c: { i: number; pcm: Buffer; emo?: number }, last: boolean): void {
    this.pending.shift();
    this.running = true;
    const first = this.fresh;
    const state = this.state;
    const input: DittoSpeakInput = { source_url: this.sourceUrl, pcm: c.pcm, rate: this.rate, state, want_state: !last, fade_in: first ? CHAIN_FADE_IN : 0, fade_out: last ? CHAIN_FADE_OUT : 0, tail_silence_ms: last ? CHAIN_TAIL_SILENCE_MS : 0, ...(c.emo !== undefined ? { emo: c.emo } : {}) };
    const jobOpts = { signal: this.opts.signal, timeoutMs: this.opts.timeoutMs ?? CHAIN_SPEAK_TIMEOUT_MS };
    // The next clause may start once this one's state is known: with a whole clip that's when the clip is back; streamed, the moment the motion step is done.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.running = false;
      this.drain();
      this.wake();
    };
    const job = (async () => {
      const t0 = Date.now();
      try {
        if (this.streams) {
          let gotState = false;
          const end = await speakDittoStream(
            this.cfg,
            input,
            {
              start: (info) => this.on.start?.(c.i, info),
              state: (s) => {
                gotState = true;
                this.state = last ? null : s;
                this.fresh = last;
                release();
              },
              frag: (seq, bytes) => this.on.frag!(c.i, seq, bytes),
            },
            jobOpts,
          );
          if (!gotState) {
            this.state = null;
            this.fresh = true;
          }
          this.stats.clips++;
          this.on.end?.(c.i, { ...end, last });
        } else {
          const out = await speakDitto(this.cfg, input, jobOpts);
          this.state = last ? null : (out.state_b64 ?? null);
          // No state back (an older worker, or the last): the next clause starts a chain again.
          this.fresh = last || !out.state_b64;
          this.stats.clips++;
          this.on.clip?.({ i: c.i, mp4: out.video_b64, frames: out.frames, last, ms: Date.now() - t0, handler: out.handler, emo: c.emo });
        }
      } catch (err) {
        this.state = null;
        this.fresh = true;
        this.stats.failed++;
        this.on.fail(c.i, err);
        if (this.stats.clips === 0) {
          // Nothing of this reply has shown yet, so nothing of it will: the clauses waiting are let go.
          this.abandoned = true;
          const rest = this.pending.splice(0);
          for (const p of rest) this.on.fail(p.i, new Error("the reply's first clause failed"));
        }
      } finally {
        release();
      }
    })();
    this.jobs.push(job);
  }
}
