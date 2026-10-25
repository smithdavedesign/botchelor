import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "../db";

/**
 * What was sent to make a picture, a clip or a reel's shot (David, 2026-10-24: "see what the prompt and payload was, so
 * we can track why it fails"). A provider call (Venice, fal, Replicate) logs its JSON body into the log that's open, and
 * the code that keeps the media stores the log on its row (adult_images.request), shown to admins on a click of the
 * item's title (app/after-dark/MediaRequest.tsx). Never the key: only the address and the body are logged, and a body is
 * cleaned first (cleanBody): a signed link's signature goes, a picture's bytes become their size, a long string is cut.
 */
export type LoggedRequest = { at: string; body: unknown };

const store = new AsyncLocalStorage<LoggedRequest[]>();

/** The most of one string kept, and of one log: past it, the rest is cut. */
const STRING_MAX = 6000;
const LOG_MAX = 8;

/** A body as kept: no signature, no picture bytes, nothing endless. */
export function cleanBody(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return cleanString(v);
  if (depth > 8 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => cleanBody(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, cleanBody(x, depth + 1)]));
}

const kb = (chars: number) => `${Math.max(1, Math.round((chars * 3) / 4 / 1024))} KB`;

function cleanString(s: string): string {
  const data = /^data:([^;,]+)[^,]*,/.exec(s);
  if (data) return `<${data[1]} data, ${kb(s.length - data[0].length)}>`;
  if (s.length > 1000 && /^[A-Za-z0-9+/=\s]+$/.test(s)) return `<base64, ${kb(s.length)}>`;
  const unsigned = s.replace(/([?&](?:sig|signature|token|X-Amz-Signature)=)[^&\s"]+/gi, "$1…");
  return unsigned.length > STRING_MAX ? `${unsigned.slice(0, STRING_MAX)}… (${unsigned.length} characters)` : unsigned;
}

/** A provider call's request, into the log that's open (none open: nothing). The address loses its query. */
export function logRequest(at: string, body: unknown): void {
  const log = store.getStore();
  if (!log || log.length >= LOG_MAX) return;
  log.push({ at: at.split("?")[0], body: cleanBody(body) });
}

/** Runs `fn` with a log of its own open: what it sent comes back with its value (on a throw, the log is lost with it). */
export async function withRequestLog<T>(fn: () => Promise<T>): Promise<{ value: T; requests: LoggedRequest[] }> {
  const requests: LoggedRequest[] = [];
  const value = await store.run(requests, fn);
  return { value, requests };
}

/** The log open here, as the row keeps it (adult_images.request): null when none is open or nothing was sent. */
export function currentRequests(): string | null {
  const log = store.getStore();
  return log?.length ? JSON.stringify(log) : null;
}

/** A log as the row keeps it: null when nothing was sent. */
export const requestJson = (requests: readonly LoggedRequest[] | null | undefined): string | null => (requests?.length ? JSON.stringify(requests) : null);

/** What made one media item, for the admins' look (app/api/admin/after-dark/media/[id]/request): null when there's none. */
export type MediaRequest = {
  id: string;
  kind: string;
  status: string;
  model: string | null;
  provider: string | null;
  fell_back: boolean;
  created_at: string;
  prompt: string | null;
  /** Null: made before requests were kept (2026-10-24), or by a path that doesn't keep one. */
  request: LoggedRequest[] | null;
  source_image: string | null;
  /** A Studio item's shoot: its kind, what was chosen, and its error (lib/adult/studio.ts). */
  shoot: { id: string; kind: string; choices: Record<string, unknown>; error: string | null } | null;
};

export async function mediaRequest(db: Db, id: string): Promise<MediaRequest | null> {
  const r = (
    await db.query<{
      id: string; kind: string; status: string; model: string | null; provider: string | null; fell_back: boolean | null; created_at: string | Date;
      prompt: string | null; request: LoggedRequest[] | null; source_image: string | null;
      shoot_id: string | null; shoot_kind: string | null; choices: Record<string, unknown> | null; shoot_error: string | null;
    }>(
      `select i.id, i.kind, i.status, i.model, i.provider, i.fell_back, i.created_at, i.prompt, i.request, i.source_image,
              s.id as shoot_id, s.kind as shoot_kind, s.choices, s.error as shoot_error
         from adult_images i left join adult_studio_shoots s on s.id = i.shoot_id
        where i.id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) return null;
  // The shoot's own copy of a clip's request is the item's request already.
  const { request: _sent, ...choices } = r.choices ?? {};
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    model: r.model,
    provider: r.provider,
    fell_back: r.fell_back === true,
    created_at: new Date(r.created_at).toISOString(),
    prompt: r.prompt,
    request: r.request ?? null,
    source_image: r.source_image,
    shoot: r.shoot_id ? { id: r.shoot_id, kind: r.shoot_kind ?? "", choices, error: r.shoot_error } : null,
  };
}
