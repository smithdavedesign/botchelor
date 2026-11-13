import { z } from "zod";
import { isAdmin } from "@/lib/admins";
import { track } from "@/lib/analytics";
import { getThread, COMPANION_LIMITS, companionFollowUp, liveReply, liveTurnIn } from "@/lib/companion";
import { extrasState } from "@/lib/companion-extras";
import {
  auraVoiceFor,
  chargeLiveCall,
  countLiveTurn,
  endLiveCall,
  LIVE_START_LIMITS,
  liveCall,
  liveCallsOn,
  liveMaxMinutes,
  mintSttToken,
  speakAura,
  startLiveCall,
  sttUrl,
} from "@/lib/companion-live";
import { LIVE_AUDIO_RATE, type LiveEvent } from "@/lib/companion-live-shared";
import { companionAllowance, giveBackReply, takeReply } from "@/lib/companion-plan";
import { getDb } from "@/lib/db";
import { ensureFaceKit } from "@/lib/face-kit";
import { liveFaceClips, liveFaceSession } from "@/lib/live-face";
import { speakClip } from "@/lib/live-face/musetalk";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit } from "@/lib/limits";
import { inBackground } from "@/lib/sets";
import { requestBase } from "@/lib/site";
import { companionRefusal } from "../../access";

// Streams (a turn's reply), so never cached and always on Node.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const CallId = z.string().min(1).max(64);
const Action = z.discriminatedUnion("action", [
  // Starts a call: its first minute is taken. `buy`: the price was on the button. `lang`: the browser's language.
  z.object({ action: z.literal("start"), buy: z.boolean().optional(), lang: z.string().max(35).optional() }),
  // A fresh token to open the socket again (after a pause or a dropped connection).
  z.object({ action: z.literal("token"), call_id: CallId, lang: z.string().max(35).optional() }),
  // The minutes that have started are taken (every half minute, and to buy more once the price was shown).
  z.object({ action: z.literal("tick"), call_id: CallId, buy: z.boolean().optional() }),
  // What they said: the reply comes back as a stream (text/event-stream of LiveEvent).
  z.object({ action: z.literal("turn"), call_id: CallId, text: z.string().max(2000) }),
  // The call ended: counted (never the words).
  z.object({
    action: z.literal("end"),
    call_id: CallId,
    seconds: z.number().int().min(0).max(24 * 3600).optional(),
    first_audio_ms: z.number().int().min(0).max(120_000).optional(),
    barge_ins: z.number().int().min(0).max(10_000).optional(),
    voice_off: z.boolean().optional(),
    // The live face (lib/live-face): which renderer showed it and for how many seconds, for the spend view.
    face: z.enum(["simli", "musetalk"]).optional(),
    face_seconds: z.number().int().min(0).max(24 * 3600).optional(),
  }),
]);

const LIVE_OFF = { error: "live_off", message: "Live calls aren't on right now." };

/**
 * A live call (docs/companions.md, P6; lib/companion-live.ts): start one (the first minute, a token for the browser's
 * socket to Deepgram), a fresh token, a tick (the minutes that have started), a turn (what they said in; the reply
 * streamed out, each checked piece with its voice), and the end. Accounts only, and only while live calls are on.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  if (!sess.authenticated) return json({ error: "sign_in", message: "Live calls come with a free account. Sign in to call." }, 401, sess);
  const admin = await isAdmin(db, sess.userId);
  if (!liveCallsOn(process.env, { admin, guest: false })) return json(LIVE_OFF, 404, sess);
  const input = parseBody(Action, await readJson(req), "invalid_request");
  const extras = () => extrasState(db, sess.userId);

  if (input.action === "start") {
    const view = await getThread(db, sess.userId, id);
    if (!view.ok) {
      const { ok: _ok, status, ...body } = view;
      return json(body, status, sess);
    }
    if (view.view.paused || view.view.scene) return json({ error: "not_now", message: "A call can't start here right now." }, 409, sess);
    if (await overLimit(db, "companion_live", sess.userId, LIVE_START_LIMITS)) {
      return json({ error: "rate_limited", message: "That's a lot of calls for now. Take a breather and come back in a bit." }, 429, sess);
    }
    const started = await startLiveCall(db, sess.userId, view.view.id, { buy: input.buy === true });
    if (!started.ok) {
      const { ok: _ok, status, ...body } = started;
      return json({ ...body, extras: await extras() }, status, sess);
    }
    const token = await mintSttToken();
    if (!token) {
      // Deepgram's down or refused the key: nothing's charged, and the call goes the free way (taking turns).
      await endLiveCall(db, { ...started.call, started_at: new Date().toISOString() });
      return json({ error: "live_down", message: "Live calls aren't working right now." }, 503, sess);
    }
    track("companion_call", { stage: "start", live: true });
    const base = requestBase(req);
    // Their face for the call (lib/face-kit.ts), drawn once if they have none: the call doesn't wait for it.
    inBackground(() => ensureFaceKit(db, view.view.character.id, base));
    // A live face (lib/live-face), when it's on for this person and the character has one: a token to open the stream.
    const face = await liveFaceSession(db, view.view.character.id, base, { admin }, { maxSeconds: liveMaxMinutes(process.env) * 60 });
    return json({ call: { id: started.call.id, minutes: started.call.minutes }, stt: { url: sttUrl(process.env, input.lang), ...token }, face, extras: await extras() }, 200, sess);
  }

  const call = await liveCall(db, sess.userId, input.call_id, id);
  if (!call) return json({ error: "not_found", message: "Not found." }, 404, sess);

  if (input.action === "end") {
    const done = await endLiveCall(db, call);
    if (input.face && input.face_seconds) {
      await db.query(`update companion_live_calls set face_provider = $2, face_seconds = greatest(face_seconds, $3) where id = $1`, [call.id, input.face, input.face_seconds]).catch(() => {});
    }
    track("companion_call", {
      stage: "end",
      live: true,
      seconds: input.seconds,
      turns: call.turns,
      minutes: done.minutes,
      first_audio_ms: input.first_audio_ms,
      barge_ins: input.barge_ins,
      voice_off: input.voice_off || undefined,
      refunded: done.refunded || undefined,
      face: input.face,
      face_seconds: input.face && input.face_seconds ? input.face_seconds : undefined,
    });
    return json({ minutes: done.minutes, refunded: done.refunded, extras: await extras() }, 200, sess);
  }

  const charged = await chargeLiveCall(db, call, { buy: input.action === "tick" && input.buy === true });
  if (!charged.ok) {
    const { ok: _ok, status, ...body } = charged;
    return json({ ...body, extras: await extras() }, status, sess);
  }

  if (input.action === "tick") return json({ minutes: charged.minutes, extras: await extras() }, 200, sess);

  if (input.action === "token") {
    const token = await mintSttToken();
    if (!token) return json({ error: "live_down", message: "Live calls aren't working right now." }, 503, sess);
    const view = await getThread(db, sess.userId, id);
    const face = view.ok ? await liveFaceSession(db, view.view.character.id, requestBase(req), { admin }, { maxSeconds: liveMaxMinutes(process.env) * 60 }) : null;
    return json({ stt: { url: sttUrl(process.env, input.lang), ...token }, face, minutes: charged.minutes }, 200, sess);
  }

  // A turn: the same limits, count and checks as a message said on a call (send with `call`), then the reply streamed.
  if (await overLimit(db, "companion", sess.userId, COMPANION_LIMITS)) {
    return json({ error: "rate_limited", message: "That's a lot of talking for now. Take a breather and come back in a bit." }, 429, sess);
  }
  const ticket = await takeReply(db, sess.userId, new Date(), process.env);
  if (!ticket.ok) return json({ error: ticket.error, message: ticket.message, allowance: ticket.allowance }, ticket.status, sess);
  const took = await liveTurnIn(db, sess.userId, id, input.text);
  if (!took.ok) {
    await giveBackReply(db, sess.userId, ticket);
    const { ok: _ok, status, ...body } = took;
    return json(body, status, sess);
  }
  const voice = auraVoiceFor(took.turn.character);
  // A live face that comes as clips (lib/live-face/musetalk.ts), when it's on for this person and the character's is ready.
  const clips = await liveFaceClips(db, took.turn.character.id, requestBase(req), { admin });
  const stop = new AbortController();
  req.signal?.addEventListener("abort", () => stop.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: LiveEvent) => {
        if (stop.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          stop.abort(); // the browser has gone
        }
      };
      // Their voice: one piece at a time, in order, while the model writes the next ones.
      const queue: { i: number; text: string }[] = [];
      const waiting: { wake: (() => void) | null } = { wake: null };
      let written = false;
      let voiceOn = true;
      let chars = 0;
      // Each voiced piece as a clip of the face saying it, one after another so the idle motion carries on from piece
      // to piece (start_frame); the browser holds the piece's voice for it and plays the voice alone if it fails.
      let cursor = 0;
      let clipChain: Promise<void> = Promise.resolve();
      const clipFor = (i: number, pcm: Buffer) => {
        if (!clips || !pcm.length) return;
        clipChain = clipChain.then(async () => {
          if (stop.signal.aborted) return;
          try {
            const out = await speakClip(clips.runpod, { bundle_key: clips.bundle_key, pcm, rate: LIVE_AUDIO_RATE, start_frame: cursor }, { signal: stop.signal });
            cursor = out.next_frame;
            send({ type: "video", i, mp4: out.video_b64, frames: out.frames });
          } catch (err) {
            if (!stop.signal.aborted) console.error(`[companion-live] clip ${i}: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`);
            send({ type: "video_fail", i });
          }
        });
      };
      const voicing = (async () => {
        for (;;) {
          while (!queue.length) {
            if (written || stop.signal.aborted) return;
            await new Promise<void>((ok) => (waiting.wake = ok));
            waiting.wake = null;
          }
          const piece = queue.shift()!;
          if (!voiceOn || stop.signal.aborted) continue;
          try {
            const body = await speakAura(piece.text, voice, { signal: stop.signal });
            chars += piece.text.length;
            const heard: Buffer[] = [];
            await pump(body, (pcm) => {
              if (clips) heard.push(Buffer.from(pcm, "base64"));
              send({ type: "audio", i: piece.i, pcm, rate: LIVE_AUDIO_RATE });
            });
            send({ type: "audio_end", i: piece.i });
            clipFor(piece.i, Buffer.concat(heard));
          } catch (err) {
            if (stop.signal.aborted) return;
            voiceOn = false;
            console.error(`[companion-live] voice failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`);
            send({ type: "voice_off", message: "their voice dropped out" });
          }
        }
      })();
      let n = 0;
      const r = await liveReply(db, took.turn, {
        say: (text) => {
          const i = n++;
          send({ type: "say", i, text });
          queue.push({ i, text });
          waiting.wake?.();
        },
        signal: stop.signal,
      }).catch((err: unknown): Awaited<ReturnType<typeof liveReply>> => {
        console.error(`[companion-live] reply failed: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`);
        return { ok: false, status: 500, error: "internal_error", message: "That didn't work. Try again in a moment." };
      });
      written = true;
      waiting.wake?.();
      await voicing;
      await clipChain;
      if (!r.ok || !r.id) await giveBackReply(db, sess.userId, ticket);
      if (r.ok) {
        await countLiveTurn(db, call.id, chars);
        const allowance = await companionAllowance(db, sess.userId);
        send({ type: "done", id: r.id, text: r.text, left: allowance.unlimited ? null : allowance.left });
        inBackground(() => companionFollowUp(db, id));
      } else {
        send({ type: "fail", status: r.status, error: r.error, message: r.message });
      }
      try {
        controller.close();
      } catch {
        // Already closed (the browser went).
      }
    },
    cancel() {
      stop.abort();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
});

/** Aura's audio as it comes, in base64 pieces of whole samples (an odd byte waits for the next chunk), at least 0.1 s each after the first. */
async function pump(body: ReadableStream<Uint8Array>, out: (pcm: string) => void): Promise<void> {
  const reader = body.getReader();
  let held = Buffer.alloc(0);
  let first = true;
  const MIN = LIVE_AUDIO_RATE / 5; // bytes: 0.1 s of 16-bit samples
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value?.length) held = Buffer.concat([held, Buffer.from(value)]);
      const ready = held.length - (held.length % 2);
      if (ready > 0 && (first || ready >= MIN || done)) {
        out(held.subarray(0, ready).toString("base64"));
        held = held.subarray(ready);
        first = false;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
