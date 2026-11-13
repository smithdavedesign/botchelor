/**
 * Simli (simli.com), the first live face renderer (docs/PRDs/digital-human.md, Tier 1): a Trinity-2 face built once from
 * a character's face-kit portrait, and a session a call opens from the browser with a five-minute token our server mints.
 * The browser sends the companion's voice (our own Aura PCM, 16 kHz) and gets lip-synced video back over Simli's
 * WebRTC; this file never sees audio or video. Only `SIMLI_API_KEY` talks to Simli, and only from here.
 *
 * Read from docs.simli.com on 2026-11-13: faces are `POST /faces/trinity/preprocess` (the photo back reframed, with a
 * `target-ratio` header) then `POST /faces/trinity` (a `face_id`; about four hours to build, builds at least ten minutes
 * apart per account) and `GET /faces/trinity/generation_status`; a session is `POST /compose/token`. Every call carries
 * `x-simli-api-key`. A face uses one of the plan's monthly generations (a failed build uses none).
 */
import { Blob as NodeBlob } from "node:buffer";

export const SIMLI_API = "https://api.simli.ai";
/** Trinity-2: the only version a new account gets. */
export const SIMLI_FACE_VERSION = "GSA_2.0";
/** The stream a call asks for: square, the smallest Simli allows, shown in a round frame of 136 px. */
export const SIMLI_STREAM_PX = 512;

type Fetch = typeof fetch;
let fetchForTests: Fetch | null = null;
export function setSimliFetchForTests(f: Fetch | null): void {
  fetchForTests = f;
}
const doFetch: Fetch = (input, init) => (fetchForTests ?? fetch)(input, init);

export class SimliError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Simli's own code where it gives one (FACE_NOT_ALLOWED, …). */
    public detail: string | null = null,
  ) {
    super(message);
  }
}

async function failure(res: Response, what: string): Promise<SimliError> {
  const text = await res.text().catch(() => "");
  let detail: string | null = null;
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    detail = typeof j.detail === "string" ? j.detail : j.detail ? JSON.stringify(j.detail).slice(0, 200) : null;
  } catch {
    detail = text ? text.slice(0, 200) : null;
  }
  return new SimliError(`Simli ${what}: ${res.status}${detail ? ` ${detail}` : ""}`, res.status, detail);
}

/** The account's generations are used up for the month (a 403 with Simli's wording). */
export const outOfFaces = (err: unknown): boolean => err instanceof SimliError && err.status === 403 && /generations left|out of/i.test(err.detail ?? "");

export type SimliFaceStatus = "not_found" | "pending" | "processing" | "completed" | "failed";

/**
 * Builds a face from one picture (JPEG, PNG or WebP under 5 MB, at least 512×512, facing the camera): preprocessed first,
 * then asked for. Returns Simli's face id, which the status call follows for the hours it takes.
 */
export async function createSimliFace(key: string, image: { bytes: Buffer; mime: string }, name: string): Promise<{ face_id: string; dispatch_after: number | null; warnings: string[] }> {
  const form = new FormData();
  form.set("image", new NodeBlob([new Uint8Array(image.bytes)], { type: image.mime }) as unknown as Blob, `face.${image.mime.split("/")[1] ?? "png"}`);
  const pre = await doFetch(`${SIMLI_API}/faces/trinity/preprocess?gsVersion=${SIMLI_FACE_VERSION}`, { method: "POST", headers: { "x-simli-api-key": key }, body: form });
  if (!pre.ok) throw await failure(pre, "preprocess");
  const ratio = pre.headers.get("target-ratio");
  const framed = Buffer.from(await pre.arrayBuffer());
  const form2 = new FormData();
  form2.set("image", new NodeBlob([new Uint8Array(framed)], { type: "image/png" }) as unknown as Blob, "face.png");
  const headers: Record<string, string> = { "x-simli-api-key": key };
  if (ratio) headers["target-ratio"] = ratio;
  const res = await doFetch(`${SIMLI_API}/faces/trinity?gsVersion=${SIMLI_FACE_VERSION}&face_name=${encodeURIComponent(name.slice(0, 60))}`, { method: "POST", headers, body: form2 });
  if (!res.ok) throw await failure(res, "create face");
  const body = (await res.json()) as { face_id?: string; dispatch_after?: number; warnings?: string[] };
  if (!body.face_id) throw new SimliError("Simli create face: no face_id in the answer", 502);
  return { face_id: body.face_id, dispatch_after: body.dispatch_after ?? null, warnings: body.warnings ?? [] };
}

/** Where a face's build stands. `not_found` once Simli has forgotten the job (a day after it finished) or never had it. */
export async function simliFaceStatus(key: string, faceId: string): Promise<{ status: SimliFaceStatus; queue_position: number }> {
  const res = await doFetch(`${SIMLI_API}/faces/trinity/generation_status?face_id=${encodeURIComponent(faceId)}`, { headers: { "x-simli-api-key": key } });
  if (!res.ok) throw await failure(res, "face status");
  const body = (await res.json()) as { status?: string; queue_position?: number; generations?: { face_id: string; status: string; queue_position?: number }[] };
  const mine = body.generations?.find((g) => g.face_id === faceId);
  const status = (mine?.status ?? body.status ?? "not_found") as SimliFaceStatus;
  return { status, queue_position: mine?.queue_position ?? body.queue_position ?? -1 };
}

/** The account's faces (ready ones Simli lists; a face still building isn't here yet). */
export async function listSimliFaces(key: string): Promise<{ id: string; name: string; simli_version: number; is_deleted: boolean }[]> {
  const res = await doFetch(`${SIMLI_API}/faces`, { headers: { "x-simli-api-key": key } });
  if (!res.ok) throw await failure(res, "list faces");
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as { id: string; name: string; simli_version: number; is_deleted: boolean }[]) : [];
}

export async function deleteSimliFace(key: string, faceId: string): Promise<void> {
  const res = await doFetch(`${SIMLI_API}/faces/trinity/${encodeURIComponent(faceId)}`, { method: "DELETE", headers: { "x-simli-api-key": key } });
  if (!res.ok && res.status !== 404) throw await failure(res, "delete face");
}

export type SimliSession = { token: string; warnings: string[] };

/**
 * A session's token for the browser: five minutes to open it, then up to `maxSeconds` on the line and `idleSeconds` of
 * quiet. Square at SIMLI_STREAM_PX, the avatar centred, our own audio in (PCM16), silence filled in by Simli between
 * our pieces so the face keeps moving. `background`: one of the account's uploaded backgrounds, or the face's own.
 */
export async function mintSimliSession(key: string, faceId: string, opts: { maxSeconds?: number; idleSeconds?: number; background?: string | null } = {}): Promise<SimliSession> {
  const res = await doFetch(`${SIMLI_API}/compose/token`, {
    method: "POST",
    headers: { "x-simli-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      faceId,
      apiVersion: "v2",
      handleSilence: true,
      maxSessionLength: Math.max(60, Math.min(4 * 3600, Math.round(opts.maxSeconds ?? 3600))),
      maxIdleTime: Math.max(30, Math.min(3600, Math.round(opts.idleSeconds ?? 300))),
      audioInputFormat: "pcm16",
      streaming_width: SIMLI_STREAM_PX,
      streaming_height: SIMLI_STREAM_PX,
      avatar_position_x: 0.5,
      avatar_position_y: 1,
      ...(opts.background ? { background_id: opts.background } : {}),
    }),
  });
  if (!res.ok) throw await failure(res, "session");
  const body = (await res.json()) as { session_token?: string; warnings?: string[] };
  if (!body.session_token || body.session_token === "FAIL TOKEN") throw new SimliError("Simli session: no token", 502);
  return { token: body.session_token, warnings: body.warnings ?? [] };
}
