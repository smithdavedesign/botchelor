/**
 * A live call's audio in the browser (docs/companions.md, P6): the microphone streamed to Deepgram over its socket (the
 * token is our route's, good for 30 seconds), and the companion's voice played as it comes. Nothing is recorded or kept:
 * the samples go out as they're heard, and their voice is played and dropped.
 */
import { deepgramHeard, pcmSamples, toPcm16, type Heard } from "@/lib/companion-live-shared";

type AudioCtor = typeof AudioContext;

function audioContextCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** What a live call needs from the browser: a microphone, Web Audio and a socket (every current browser, Firefox too). */
export function liveSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && audioContextCtor() !== null && typeof WebSocket !== "undefined";
}

/** Made from a tap, so the browser lets it play (Safari) for the rest of the call. */
export function newAudioContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  const ctx = new Ctor();
  void ctx.resume().catch(() => {});
  return ctx;
}

/** The microphone, as 16 kHz 16-bit PCM pieces (about a quarter second each), with the browser's echo cancelling on. */
export class Mic {
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];

  async start(ctx: AudioContext, onPcm: (pcm: ArrayBuffer) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const source = ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor rather than a worklet: it needs no module file and runs everywhere a call does.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => onPcm(toPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate));
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(proc);
    proc.connect(silent);
    silent.connect(ctx.destination);
    this.nodes = [source, proc, silent];
  }

  stop(): void {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    const proc = this.nodes[1] as ScriptProcessorNode | undefined;
    if (proc) proc.onaudioprocess = null;
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

/** Their voice: pieces of PCM played back to back as they come; stop() silences it at once (a barge-in). */
export class PcmPlayer {
  private next = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private waiters: (() => void)[] = [];

  constructor(private ctx: AudioContext) {}

  push(b64: string, rate: number): void {
    const samples = pcmSamples(b64);
    if (!samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime + 0.02, this.next);
    src.start(at);
    this.next = at + buffer.duration;
    this.playing.add(src);
    src.onended = () => {
      this.playing.delete(src);
      if (!this.playing.size) this.settle();
    };
  }

  get busy(): boolean {
    return this.playing.size > 0;
  }

  /** Resolves once everything pushed has been played (or stopped). */
  idle(): Promise<void> {
    if (!this.playing.size) return Promise.resolve();
    return new Promise((ok) => this.waiters.push(ok));
  }

  stop(): void {
    for (const src of this.playing) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // Not started yet, or already ended.
      }
    }
    this.playing.clear();
    this.next = 0;
    this.settle();
  }

  private settle() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((ok) => ok());
  }
}

export type Listening = { send(pcm: ArrayBuffer): void; close(): void };

/**
 * Opens Deepgram's listening socket with a short-lived token (the browser can't set headers on a socket, so it goes as
 * the "bearer" subprotocol) and reports what it hears. `closed` is called if it closes without close() (a dropped line).
 */
export function listen(url: string, token: string, on: { heard: (e: Heard) => void; closed: (code: number) => void }): Promise<Listening> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, ["bearer", token]);
    } catch (err) {
      reject(err);
      return;
    }
    ws.binaryType = "arraybuffer";
    let open = false;
    let closing = false;
    const timer = setTimeout(() => {
      if (!open) {
        closing = true;
        ws.close();
        reject(new Error("timeout"));
      }
    }, 8_000);
    ws.onopen = () => {
      open = true;
      clearTimeout(timer);
      resolve({
        send(pcm) {
          if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
        },
        close() {
          closing = true;
          try {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
            ws.close();
          } catch {
            // Already closed.
          }
        },
      });
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const heard = deepgramHeard(e.data);
      if (heard) on.heard(heard);
    };
    ws.onerror = () => {
      if (!open) {
        clearTimeout(timer);
        reject(new Error("socket"));
      }
    };
    ws.onclose = (e) => {
      if (open && !closing) on.closed(e.code);
    };
  });
}
