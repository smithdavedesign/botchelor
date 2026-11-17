/**
 * botchelor-images: a Cloudflare Worker that draws pictures with Workers AI inside the account's free daily allowance
 * (10,000 neurons a day, reset at 00:00 UTC).
 *
 * - **Who can call it:** Botchelor's server (lib/workers-ai.ts) and the Mac's batch scripts. Each sends the gate key,
 *   the GATE_KEY secret, which the keychain also holds. No Cloudflare API token exists for it.
 * - **What it draws:** two models only. FLUX.2 klein 4B (Apache 2.0) draws portraits and shots, from up to four
 *   reference pictures. FLUX.1 schnell draws cheap 1024×1024 squares.
 * - **The budget:**
 *   - Each call reserves its neurons first, from a daily budget kept by one Durable Object (DAILY_NEURONS, default
 *     9,000), and gets them back if the model fails.
 *   - Past the budget the Worker answers 429 "budget". Callers then use their paid path, inside its own caps, or wait
 *     for tomorrow.
 *   - The account is on Workers Paid, where use past the free allowance bills rather than fails. This budget is what
 *     keeps it free.
 * - **Neurons** are estimated from Cloudflare's price list and checked against its own count, erring high. klein bills
 *   every picture as at least 1024×1024, about 104 neurons, so the budget buys about 80 pictures a day.
 *
 * Nothing here checks the pictures. Workers AI has no safety checker, so Botchelor checks everything it keeps
 * (`checkMedia` with the explicit question, lib/adult/moderation.ts).
 *
 * Deploy steps are in README.md beside this file. This file type-checks with the repo's own tsconfig (DOM types), so the
 * Workers bindings are typed by hand below.
 */

export const MODELS = {
  klein: "@cf/black-forest-labs/flux-2-klein-4b",
  schnell: "@cf/black-forest-labs/flux-1-schnell",
} as const;
export type ModelKey = keyof typeof MODELS;

/** Cloudflare's Workers AI price list (2026-11), in neurons. */
export const PRICE = {
  kleinOutputTile: 26.05, // per 512×512 tile drawn
  kleinInputTile: 5.37, // per reference picture (each is under 512×512, so one tile at most)
  schnellTile: 4.8, // per 512×512 tile; schnell always draws 1024×1024
  schnellStep: 9.6, // per diffusion step
} as const;

/**
 * klein is billed as if it drew at least 1024×1024. Measured on 2026-11-17 against Cloudflare's own count: a 512×512
 * picture cost the same ~104 neurons as a 640×800 one.
 */
export const KLEIN_MIN_TILES = 4;

/**
 * The account is on Workers Paid, so neurons past the free 10,000 would bill rather than fail. The default leaves
 * room for the estimate being a little off.
 */
export const DEFAULT_DAILY_NEURONS = 9_000;
export const MAX_REFS = 4;
/** A reference picture under 512×512 is well under this; anything bigger was sent unshrunk. */
export const MAX_REF_BYTES = 1_500_000;
export const MAX_PROMPT = 2_048;
export const MIN_SIDE = 256;
export const MAX_SIDE = 1_536;

type AiBinding = { run(model: string, input: unknown): Promise<unknown> };
type BudgetStub = { fetch(url: string, init?: RequestInit): Promise<Response> };
type BudgetNamespace = { idFromName(name: string): unknown; get(id: unknown): BudgetStub };
export type Env = { AI: AiBinding; BUDGET: BudgetNamespace; GATE_KEY?: string; DAILY_NEURONS?: string };
type DurableStorage = { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> };
type DurableState = { storage: DurableStorage };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 512×512 tiles a picture covers, counted on a grid: the high side of Cloudflare's count. */
export function tiles(width: number, height: number): number {
  return Math.ceil(width / 512) * Math.ceil(height / 512);
}

/** Neurons one call costs, erring high. */
export function neuronsFor(model: ModelKey, width: number, height: number, refs: number, steps: number): number {
  const n =
    model === "klein"
      ? Math.max(KLEIN_MIN_TILES, tiles(width, height)) * PRICE.kleinOutputTile + refs * PRICE.kleinInputTile
      : tiles(1024, 1024) * PRICE.schnellTile + steps * PRICE.schnellStep;
  return Math.ceil(n * 100 - 1e-6) / 100; // up to the cent, without floating-point dust (6 × 26.05 is 156.3, not 156.31)
}

/** The day Cloudflare's allowance counts in: UTC. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The daily budget from the DAILY_NEURONS var: a positive number, never above the free 10,000. */
export function dailyLimit(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : DEFAULT_DAILY_NEURONS;
}

export type Draw = {
  model: ModelKey;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed?: number;
  refs: File[];
};

function whole(v: FormDataEntryValue | null, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
}

const goodSide = (n: number) => Number.isInteger(n) && n >= MIN_SIDE && n <= MAX_SIDE && n % 16 === 0;

/** Reads and checks a draw request's form. */
export function parseDraw(form: FormData): Draw | { error: string } {
  const model = String(form.get("model") ?? "klein");
  if (model !== "klein" && model !== "schnell") return { error: "model must be klein or schnell" };
  const prompt = String(form.get("prompt") ?? "").trim();
  if (!prompt || prompt.length > MAX_PROMPT) return { error: `prompt must be 1–${MAX_PROMPT} characters` };
  const width = whole(form.get("width"), 1024);
  const height = whole(form.get("height"), 1024);
  if (!goodSide(width) || !goodSide(height)) {
    return { error: `width and height must be multiples of 16 from ${MIN_SIDE} to ${MAX_SIDE}` };
  }
  const steps = whole(form.get("steps"), 4);
  if (!(steps >= 1 && steps <= 8)) return { error: "steps must be 1–8" };
  const seed = whole(form.get("seed"), -1);
  if (!(Number.isInteger(seed) && seed >= -1 && seed <= 4_294_967_295)) return { error: "seed must be a whole number" };

  const refs: File[] = [];
  for (let i = 0; i < MAX_REFS; i++) {
    const f = form.get(`input_image_${i}`);
    if (f == null) break;
    if (typeof f === "string") return { error: `input_image_${i} must be a file` };
    if (f.size > MAX_REF_BYTES) return { error: `input_image_${i} is over ${MAX_REF_BYTES} bytes: shrink it under 512×512` };
    refs.push(f);
  }
  for (let i = refs.length + 1; i <= MAX_REFS; i++) {
    if (form.get(`input_image_${i}`) != null) return { error: "reference pictures are numbered from input_image_0 with no gaps" };
  }
  if (model === "schnell" && refs.length) return { error: "schnell takes no reference pictures" };
  return { model, prompt, width, height, steps, seed: seed >= 0 ? seed : undefined, refs };
}

/** Runs the model and returns its picture as base64, or null when it answered without one. */
export async function runModel(ai: AiBinding, d: Draw): Promise<string | null> {
  let out: unknown;
  if (d.model === "schnell") {
    out = await ai.run(MODELS.schnell, { prompt: d.prompt, steps: d.steps });
  } else {
    const form = new FormData();
    form.append("prompt", d.prompt);
    form.append("width", String(d.width));
    form.append("height", String(d.height));
    if (d.seed !== undefined) form.append("seed", String(d.seed));
    d.refs.forEach((f, i) => form.append(`input_image_${i}`, f));
    // FormData doesn't expose its boundary: a Response serializes it and writes the content type with the boundary.
    const encoded = new Response(form);
    out = await ai.run(MODELS.klein, {
      multipart: { body: encoded.body, contentType: encoded.headers.get("content-type") ?? "multipart/form-data" },
    });
  }
  const image = (out as { image?: unknown } | null)?.image;
  return typeof image === "string" && image.length > 0 ? image : null;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** The caller sent the gate key. Compared as hashes, in constant time. No GATE_KEY set means closed to everyone. */
export async function authorized(request: Request, key: string | undefined): Promise<boolean> {
  if (!key) return false;
  const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  const [a, b] = await Promise.all([sha256(got), sha256(key)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

type Count = { day: string; used: number };

/**
 * The day's count, in one Durable Object. It handles one request at a time, so two draws can't both take the last
 * neurons. A new UTC day starts from zero.
 */
export class DailyBudget {
  constructor(private readonly state: DurableState) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const day = utcDay(Date.now());
    const saved = await this.state.storage.get<Count>("count");
    let used = saved && saved.day === day ? saved.used : 0;
    if (request.method === "POST" && (path === "/reserve" || path === "/refund" || path === "/raise")) {
      const body = (await request.json().catch(() => ({}))) as { neurons?: unknown; limit?: unknown; day?: unknown };
      const neurons = Number(body.neurons);
      if (!(neurons > 0)) return json({ ok: false, error: "neurons" }, 400);
      if (path === "/reserve") {
        const limit = Number(body.limit);
        if (!(used + neurons <= limit)) return json({ ok: false, day, used, limit });
        used = round2(used + neurons);
      } else if (path === "/raise") {
        used = round2(Math.max(used, neurons)); // only ever up: Cloudflare's own count can't make room
      } else if (body.day === day) {
        used = round2(Math.max(0, used - neurons)); // a refund from yesterday has nothing left to give back
      }
      await this.state.storage.put<Count>("count", { day, used });
    }
    return json({ ok: true, day, used });
  }
}

async function budgetCall(env: Env, path: string, body?: unknown): Promise<{ ok: boolean; day: string; used: number }> {
  const stub = env.BUDGET.get(env.BUDGET.idFromName("daily"));
  const res = await stub.fetch(
    `https://budget${path}`,
    body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) },
  );
  return (await res.json()) as { ok: boolean; day: string; used: number };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env.GATE_KEY))) return json({ error: "unauthorized" }, 401);
    const limit = dailyLimit(env.DAILY_NEURONS);
    const path = new URL(request.url).pathname;

    if (path === "/budget" && (request.method === "GET" || request.method === "POST")) {
      let b: { day: string; used: number };
      if (request.method === "POST") {
        // Raise the day's count to Cloudflare's own figure (its analytics), when that's higher. Never lowers it.
        const atLeast = Number(((await request.json().catch(() => ({}))) as { atLeast?: unknown }).atLeast);
        if (!(atLeast > 0)) return json({ error: "bad_request", detail: 'send {"atLeast": neurons}' }, 400);
        b = await budgetCall(env, "/raise", { neurons: atLeast });
      } else {
        b = await budgetCall(env, "/usage");
      }
      return json({ day: b.day, used: b.used, limit, left: round2(Math.max(0, limit - b.used)) });
    }
    if (request.method !== "POST" || path !== "/draw") return json({ error: "not_found" }, 404);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "bad_request", detail: "send multipart/form-data" }, 400);
    }
    const draw = parseDraw(form);
    if ("error" in draw) return json({ error: "bad_request", detail: draw.error }, 400);

    const neurons = neuronsFor(draw.model, draw.width, draw.height, draw.refs.length, draw.steps);
    const reserved = await budgetCall(env, "/reserve", { neurons, limit });
    if (!reserved.ok) return json({ error: "budget", day: reserved.day, used: reserved.used, limit, neurons }, 429);

    let failure = "the model answered without a picture";
    try {
      const image = await runModel(env.AI, draw);
      if (image) return json({ image, model: MODELS[draw.model], neurons, day: reserved.day, used: reserved.used, limit });
    } catch (e) {
      failure = String((e as Error)?.message ?? e).slice(0, 300);
    }
    await budgetCall(env, "/refund", { neurons, day: reserved.day }).catch(() => undefined);
    // Cloudflare's own stop at the free allowance (error 4006) means the estimate ran low: say so plainly.
    const allowance = /4006|daily free allocation/i.test(failure);
    return json({ error: allowance ? "allowance" : "model_failed", detail: failure }, allowance ? 429 : 502);
  },
};
