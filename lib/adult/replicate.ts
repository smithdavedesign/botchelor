/**
 * A small client for Replicate's HTTP API (api.replicate.com/v1): After Dark's backup media provider (David,
 * 2026-10-22), while Venice is asked to confirm in writing that explicit output is allowed under its terms (§10.9(c)).
 * Replicate's terms (updated 2026-04-01) bar "non-consensual nudity or illegal pornographic content" (§2.7(d)(v)), and
 * its models take `disable_safety_checker`. Every file it returns still passes our Hive check (lib/adult/check.ts)
 * before it's stored: turning Replicate's own checker off never turns ours off.
 *
 *  - A prediction runs an official model by its name (`owner/name`: POST /models/{owner}/{name}/predictions), or any
 *    model by a version (`owner/name:<64-hex id>`, or the bare id: POST /predictions).
 *  - `Prefer: wait=n` holds the request up to n seconds (60 at most) for the result; past that it comes back still
 *    `starting` or `processing`, to be polled (GET /predictions/{id}).
 *  - `Cancel-After` stops a prediction still running (and billing) once nobody's waiting for it.
 *  - Outputs are URLs on replicate.delivery, deleted with the prediction's inputs an hour after it's made: they're
 *    downloaded at once, and only from Replicate's own hosts.
 */

import { logRequest } from "./request-log";

export const REPLICATE = "https://api.replicate.com/v1";

export type PredictionStatus = "starting" | "processing" | "succeeded" | "failed" | "canceled";
export type Prediction = { id: string; status: PredictionStatus; output?: unknown; error?: unknown };
export type ReplicateFile = { bytes: Buffer; mime: string };

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setReplicateFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);
let pauseScale = 1;
/** Tests poll with no pause between asks. */
export function setReplicatePausesForTests(on: boolean): void {
  pauseScale = on ? 1 : 0;
}
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms * pauseScale));

/**
 * A refusal or a failure on Replicate's side, with the HTTP status when there was one ("Replicate 402: …"), how long it
 * asked us to wait (Retry-After), and whether it was our own patience running out (`timeout`): what
 * lib/adult/fallback.ts reads to decide whether Venice should try instead.
 */
export class ReplicateError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs: number | null = null,
    readonly timeout = false,
  ) {
    super(message);
  }
}

/** A Retry-After header (seconds, or an HTTP date) in milliseconds; null when there's none or it can't be read. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  const v = header?.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

const VERSION_ID = /^[0-9a-f]{64}$/;
/** A model as a setting holds it: `owner/name`, optionally with `:` and a version id, or a bare version id. */
export const MODEL_ID = /^(?:[\w.-]+\/[\w.-]+(?::[0-9a-f]{64})?|[0-9a-f]{64})$/;

/** Where a prediction for `model` is created, and its body. */
export function predictionRequest(model: string, input: Record<string, unknown>): { url: string; body: Record<string, unknown> } {
  const m = model.trim();
  if (!MODEL_ID.test(m)) throw new ReplicateError(`"${m.slice(0, 80)}" isn't a Replicate model (owner/name, or owner/name:version)`);
  if (VERSION_ID.test(m)) return { url: `${REPLICATE}/predictions`, body: { version: m, input } };
  const [name, version] = m.split(":");
  if (version) return { url: `${REPLICATE}/predictions`, body: { version, input } };
  const [owner, model_name] = name.split("/");
  return { url: `${REPLICATE}/models/${owner}/${model_name}/predictions`, body: { input } };
}

/** What a refusal says: Replicate answers problems as JSON ({ title, detail }), else as text. */
async function why(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { detail?: unknown; title?: unknown };
    const said = typeof j.detail === "string" ? j.detail : typeof j.title === "string" ? j.title : "";
    if (said) return said.slice(0, 200);
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200);
}

async function call(token: string, url: string, method: "GET" | "POST", body?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
  if (method === "POST" && body !== undefined) logRequest(url, body);
  const res = await doFetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new ReplicateError(`Replicate ${res.status}: ${await why(res)}`, res.status, retryAfterMs(res.headers.get("retry-after")));
  return res.json();
}

function asPrediction(v: unknown): Prediction {
  const p = v as Partial<Prediction> | null;
  if (!p || typeof p.id !== "string" || typeof p.status !== "string") throw new ReplicateError("Replicate returned no prediction");
  return p as Prediction;
}

/**
 * Starts a prediction. `wait` (seconds, 1 to 60) asks Replicate to hold the reply until it's done; `cancelAfter` ("5m",
 * "30m") stops it if it's still running then.
 */
export async function createPrediction(
  token: string,
  model: string,
  input: Record<string, unknown>,
  opts: { wait?: number; cancelAfter?: string } = {},
): Promise<Prediction> {
  const { url, body } = predictionRequest(model, input);
  const headers: Record<string, string> = {};
  if (opts.wait) headers.prefer = `wait=${Math.max(1, Math.min(60, Math.round(opts.wait)))}`;
  if (opts.cancelAfter) headers["cancel-after"] = opts.cancelAfter;
  return asPrediction(await call(token, url, "POST", body, headers));
}

export async function getPrediction(token: string, id: string): Promise<Prediction> {
  return asPrediction(await call(token, `${REPLICATE}/predictions/${encodeURIComponent(id)}`, "GET"));
}

/** Stops a prediction still running. Best effort: never throws. */
export async function cancelPrediction(token: string, id: string): Promise<void> {
  await call(token, `${REPLICATE}/predictions/${encodeURIComponent(id)}/cancel`, "POST").catch(() => {});
}

export const isDone = (p: Pick<Prediction, "status">): boolean => p.status === "succeeded" || p.status === "failed" || p.status === "canceled";

/** Asks again every `everyMs` until the prediction is done; past `timeoutMs` it's cancelled, and that's an error. */
export async function settle(token: string, p: Prediction, timeoutMs: number, everyMs = 2000): Promise<Prediction> {
  let cur = p;
  for (let asked = 0; !isDone(cur); asked++) {
    if (asked * everyMs >= timeoutMs) {
      await cancelPrediction(token, cur.id);
      throw new ReplicateError(`Replicate took longer than ${Math.round(timeoutMs / 1000)} s`, undefined, null, true);
    }
    await pause(everyMs);
    cur = await getPrediction(token, cur.id);
  }
  return cur;
}

/** A finished prediction's files, as URLs: a model answers one, or a list. */
export function outputUrls(output: unknown): string[] {
  return (Array.isArray(output) ? output : [output]).flatMap((o) =>
    typeof o === "string" ? [o] : o && typeof o === "object" && typeof (o as { url?: unknown }).url === "string" ? [(o as { url: string }).url] : [],
  );
}

/** Why a done prediction has nothing to download: it failed, was stopped, or Replicate has deleted what it made. */
export function noOutput(p: Prediction): string | null {
  if (p.status === "failed") return `Replicate: ${String(p.error ?? "the model failed").slice(0, 160)}`;
  if (p.status === "canceled") return "Replicate: it was cancelled";
  return outputUrls(p.output).length ? null : "Replicate no longer has it (it deletes what a model made an hour after)";
}

const EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", wav: "audio/wav", mp3: "audio/mpeg" };
/** One name for one format: replicate.delivery serves Kokoro's WAV as audio/x-wav (the live run, 2026-10-23). */
const SAME_TYPE: Record<string, string> = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav" };
const DELIVERY = /(^|\.)replicate\.delivery$/;

/**
 * One output's bytes, fetched at once (Replicate deletes it within the hour), and only from Replicate itself: its file
 * hosts (replicate.delivery), its API (with our token), or a data: URI in the reply.
 */
export async function downloadOutput(url: string, token: string, maxBytes: number): Promise<ReplicateFile> {
  const sized = (bytes: Buffer, mime: string): ReplicateFile => {
    if (!bytes.length) throw new ReplicateError("Replicate's file was empty");
    if (bytes.length > maxBytes) throw new ReplicateError("Replicate's file was too large");
    return { bytes, mime };
  };
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/);
    if (!m) throw new ReplicateError("Replicate returned an unreadable file");
    const base64 = /;base64/i.test(m[2]);
    return sized(base64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3])), m[1] || "application/octet-stream");
  }
  let at: URL;
  try {
    at = new URL(url);
  } catch {
    throw new ReplicateError("Replicate returned no file");
  }
  const api = at.hostname === "api.replicate.com";
  if (at.protocol !== "https:" || (!api && !DELIVERY.test(at.hostname))) throw new ReplicateError(`Replicate's file is on a host we don't fetch from (${at.hostname})`);
  const res = await doFetch(at.toString(), api ? { headers: { authorization: `Bearer ${token}` } } : {});
  if (!res.ok) throw new ReplicateError(`Replicate's file couldn't be downloaded (${res.status})`, res.status);
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new ReplicateError("Replicate's file was too large");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const byName = EXT[at.pathname.split(".").pop()?.toLowerCase() ?? ""];
  const mime = type && type !== "application/octet-stream" && type !== "binary/octet-stream" ? type : (byName ?? "application/octet-stream");
  return sized(Buffer.from(await res.arrayBuffer()), SAME_TYPE[mime] ?? mime);
}

/**
 * Runs a model and downloads what it made: Replicate holds the reply up to `wait` seconds, then it's asked again until
 * `timeoutMs` has gone by (and stopped if it hasn't finished), and the first file is downloaded at once.
 */
export async function runModel(
  token: string,
  model: string,
  input: Record<string, unknown>,
  opts: { maxBytes: number; wait?: number; timeoutMs?: number; cancelAfter?: string },
): Promise<ReplicateFile> {
  const created = await createPrediction(token, model, input, { wait: opts.wait ?? 60, cancelAfter: opts.cancelAfter ?? "5m" });
  const done = await settle(token, created, opts.timeoutMs ?? 90_000);
  const missing = noOutput(done);
  if (missing) throw new ReplicateError(missing);
  return downloadOutput(outputUrls(done.output)[0], token, opts.maxBytes);
}
