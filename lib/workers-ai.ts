/**
 * Free pictures from the botchelor-images Worker (workers/cf-images). It draws with Cloudflare Workers AI inside the
 * account's free daily allowance (docs/PRDs/styles-and-storylines.md, phase 1).
 *
 * - **On and off:** it's on when the show app has WORKERS_AI_URL and WORKERS_AI_KEY. WORKERS_AI=0 turns it off. Off, every
 *   call answers "off" and callers use their paid path, as before.
 * - **Budget:** the Worker keeps the day's budget. Past it, a call answers "budget" and callers fall back the same way.
 * - **Checks:** Workers AI has no safety checker of its own. Whatever it draws for the show must be checked with
 *   `checkMedia(db, picture, "pg_image", { unfiltered: true })`. That adds a question about nudity and sexual content,
 *   whichever checker runs (lib/adult/moderation.ts).
 * - **No spend:** a draw never costs money. The free allowance is the only thing it uses.
 */
import sharp from "sharp";

export type WorkersAiModel = "klein" | "schnell";

export type WorkersAiDraw = {
  prompt: string;
  /** Multiples of 16 from 256 to 1536. schnell always draws 1024×1024. */
  width: number;
  height: number;
  /** klein (FLUX.2 klein 4B) by default: portraits and shots, from reference pictures. */
  model?: WorkersAiModel;
  /** klein's reference pictures, up to four, in the order the prompt names them ("image 0" …). Shrunk here to fit. */
  refs?: (Buffer | Uint8Array)[];
  seed?: number;
  /** schnell only, 1–8. */
  steps?: number;
};

export type WorkersAiPicture = {
  ok: true;
  bytes: Buffer;
  base64: string;
  mime: string;
  model: string;
  /** What this picture used of the day's budget, and the day so far. */
  neurons: number;
  used: number;
  limit: number;
};
export type WorkersAiMiss = { ok: false; reason: "off" | "budget" | "failed"; detail: string };

type Env = Record<string, string | undefined>;

/** Workers AI takes reference pictures under 512×512. */
export const REF_MAX_SIDE = 511;
export const MAX_REFS = 4;
const TIMEOUT_MS = 90_000;

/** Where the Worker is and its gate key, or null when it's off. */
export function workersAiConfig(env: Env = process.env): { url: string; key: string } | null {
  if (env.WORKERS_AI === "0") return null;
  const url = env.WORKERS_AI_URL?.trim().replace(/\/+$/, "");
  const key = env.WORKERS_AI_KEY?.trim();
  return url && key && url.startsWith("https://") ? { url, key } : null;
}

/** A reference picture made to fit Workers AI: inside 511×511 (never enlarged), upright, as a JPEG. */
export async function shrinkRef(input: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(REF_MAX_SIDE, REF_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** A picture's type, from its first bytes. */
export function sniffMime(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

type DrawAnswer = {
  image?: unknown;
  model?: unknown;
  neurons?: unknown;
  used?: unknown;
  limit?: unknown;
  error?: unknown;
  detail?: unknown;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Draws one picture. Never throws: a miss says why ("off", "budget" or "failed"), and the caller falls back to its paid
 * path or tries again tomorrow. `fetchImpl` is injectable for tests.
 */
export async function drawWithWorkersAi(
  input: WorkersAiDraw,
  opts: { env?: Env; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<WorkersAiPicture | WorkersAiMiss> {
  const cfg = workersAiConfig(opts.env);
  if (!cfg) return { ok: false, reason: "off", detail: "Workers AI isn't set up (WORKERS_AI_URL and WORKERS_AI_KEY)" };
  const refs = input.refs ?? [];
  if (refs.length > MAX_REFS) return { ok: false, reason: "failed", detail: `at most ${MAX_REFS} reference pictures` };

  const form = new FormData();
  form.append("model", input.model ?? "klein");
  form.append("prompt", input.prompt);
  form.append("width", String(input.width));
  form.append("height", String(input.height));
  if (input.seed !== undefined) form.append("seed", String(input.seed));
  if (input.steps !== undefined) form.append("steps", String(input.steps));
  try {
    for (const [i, r] of refs.entries()) {
      form.append(`input_image_${i}`, new Blob([new Uint8Array(await shrinkRef(r))], { type: "image/jpeg" }), `ref${i}.jpg`);
    }
  } catch {
    return { ok: false, reason: "failed", detail: "a reference picture couldn't be read" };
  }

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${cfg.url}/draw`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.key}` },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Workers AI couldn't be reached (${err instanceof Error ? err.message.slice(0, 120) : "error"})` };
  }
  const body = (await res.json().catch(() => null)) as DrawAnswer | null;
  const said = typeof body?.detail === "string" ? `: ${body.detail.slice(0, 200)}` : "";
  // 429 is the Worker's budget or Cloudflare's own stop at the free allowance: either way, nothing more today.
  if (res.status === 429) return { ok: false, reason: "budget", detail: `the free pictures are used up for today (${String(body?.error ?? "budget")})` };
  if (!res.ok || typeof body?.image !== "string") return { ok: false, reason: "failed", detail: `Workers AI answered ${res.status}${said}` };

  const bytes = Buffer.from(body.image, "base64");
  const mime = sniffMime(bytes);
  if (!mime) return { ok: false, reason: "failed", detail: "Workers AI sent something that isn't a picture" };
  return {
    ok: true,
    bytes,
    base64: body.image,
    mime,
    model: typeof body.model === "string" ? body.model : "",
    neurons: num(body.neurons),
    used: num(body.used),
    limit: num(body.limit),
  };
}

/** The day's budget as the Worker counts it, or null when it's off or can't be reached. */
export async function workersAiBudget(
  opts: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<{ day: string; used: number; limit: number; left: number } | null> {
  const cfg = workersAiConfig(opts.env);
  if (!cfg) return null;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${cfg.url}/budget`, {
      headers: { authorization: `Bearer ${cfg.key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as { day?: unknown; used?: unknown; limit?: unknown; left?: unknown };
    return typeof b.day === "string" ? { day: b.day, used: num(b.used), limit: num(b.limit), left: num(b.left) } : null;
  } catch {
    return null;
  }
}
