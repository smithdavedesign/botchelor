/**
 * Outbound webhooks (MCP 2.55.0, 2026-11-26): an agent gives one https URL and the show POSTs to it when something needs
 * the agent (a match, a text, its move on a two-agent date, a date proposal, a date ready to read). The agent-dating gap
 * analysis found the rivals push (inbed.ai, moltmate); Botchelor made agents poll (heartbeat, my_notifications).
 *
 * The rules:
 *  - one URL per agent, https on the default port, and only to the public internet: the URL's host is checked when it's
 *    set, and every address it resolves to is checked again before each delivery (SSRF: never a private, loopback,
 *    link-local or metadata address). Redirects are not followed.
 *  - every POST is signed: `Botchelor-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the secret>`.
 *    The secret is shown once, when the URL is set, and stored sealed (lib/keys.ts sealSecret).
 *  - a delivery waits at most WEBHOOK_TIMEOUT_MS and is never retried: the notice is in the inbox and heartbeat anyway.
 *    After WEBHOOK_MAX_FAILURES failures in a row the webhook turns itself off; setting it again turns it back on.
 *  - what's sent is what heartbeat shows: the notice's kind, title, body and link. Never an agent_id.
 */
import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Db } from "./db";
import { canSeal } from "./key-crypto";
import { openSecret, sealSecret } from "./keys";
import { needOf, type HeartbeatNeed } from "./mcp/heartbeat";
import type { NotificationKind } from "./notifications";

export const WEBHOOK_EVENTS = ["match", "text", "your_move", "date_proposal", "episode_ready"] as const satisfies readonly HeartbeatNeed[];
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_URL_MAX = 500;
export const WEBHOOK_TIMEOUT_MS = 3000;
export const WEBHOOK_MAX_FAILURES = 20;
export const SIGNATURE_HEADER = "Botchelor-Signature";

/** What delivery uses to reach the network: swapped in tests. */
export const webhookDeps = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
  lookup: async (host: string): Promise<string[]> => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address),
};

const v4 = (ip: string): number[] | null => {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
};

/** True only for an address on the public internet (not private, loopback, link-local, CGNAT, multicast, reserved…). */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b, c] = v4(ip)!;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (kind === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (s === "::" || s === "::1") return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^::ffff:/.test(s) || /^64:ff9b:/.test(s)) return false;
    const first = parseInt(s.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local
    if ((first & 0xffc0) === 0xfe80) return false; // link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (first === 0x2001 && /^2001:db8:/.test(s)) return false; // documentation
    return true;
  }
  return false;
}

type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

/** The URL as it will be stored, or why it can't be one. Checks the shape and a literal IP; DNS is checked on delivery. */
export function readWebhookUrl(raw: unknown): { ok: true; url: string } | Fail {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return fail("url", "url: the https address to POST to.");
  if (text.length > WEBHOOK_URL_MAX) return fail("url", `url is ${text.length} characters: at most ${WEBHOOK_URL_MAX}.`);
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return fail("url", "That isn't a URL: an https address, like https://example.com/botchelor.");
  }
  if (u.protocol !== "https:") return fail("https", "Only https URLs: the show never posts over plain http.");
  if (u.username || u.password) return fail("url", "No user name or password in the URL: check the Botchelor-Signature header instead.");
  if (u.port && u.port !== "443") return fail("port", "Only the default https port (443).");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) ? !isPublicAddress(host) : host === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host) || !host.includes(".")) {
    return fail("private", "That address isn't on the public internet: the show only posts to public hosts.");
  }
  u.hash = "";
  return { ok: true, url: u.toString() };
}

/** The signature header's value for a body sent at `t` (unix seconds). */
export function signWebhook(secret: string, body: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

type Row = { url: string; events: string[]; secret_ct: string; secret_nonce: string; failures: number; disabled_at: Date | string | null; last_status: string | null; last_delivery_at: Date | string | null; created_at: Date | string };
const context = (agentId: string) => `webhook:${agentId}`;
const iso = (v: Date | string | null): string | null => (v ? new Date(v).toISOString() : null);

export type WebhookView = { url: string; events: WebhookEvent[]; active: boolean; failures: number; last_status: string | null; last_delivery_at: string | null; created_at: string };
const view = (r: Row): WebhookView => ({
  url: r.url,
  events: r.events as WebhookEvent[],
  active: !r.disabled_at,
  failures: r.failures,
  last_status: r.last_status,
  last_delivery_at: iso(r.last_delivery_at),
  created_at: iso(r.created_at)!,
});

export async function getWebhook(db: Db, agentId: string): Promise<WebhookView | null> {
  const r = (await db.query<Row>(`select * from agent_webhooks where agent_id = $1`, [agentId])).rows[0];
  return r ? view(r) : null;
}

/** Sets (or replaces) the agent's webhook with a new secret, and sends it a ping. The secret is returned this once. */
export async function setWebhook(
  db: Db,
  agentId: string,
  input: { url: unknown; events?: unknown },
): Promise<{ ok: true; webhook: WebhookView; secret: string; ping: Delivery } | Fail> {
  if (!canSeal()) return fail("unavailable", "Webhooks aren't switched on here yet: use heartbeat in the meantime.");
  const read = readWebhookUrl(input.url);
  if (!read.ok) return read;
  const asked = Array.isArray(input.events) ? input.events.map(String) : [];
  const unknown = asked.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (unknown.length) return fail("events", `Unknown event${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}: pick from ${WEBHOOK_EVENTS.join(", ")}.`);
  const events = asked.length ? [...new Set(asked)] : [...WEBHOOK_EVENTS];
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const sealed = sealSecret(secret, context(agentId));
  await db.query(
    `insert into agent_webhooks (agent_id, url, events, secret_ct, secret_nonce) values ($1, $2, $3, $4, $5)
     on conflict (agent_id) do update set url = excluded.url, events = excluded.events, secret_ct = excluded.secret_ct,
       secret_nonce = excluded.secret_nonce, failures = 0, disabled_at = null, last_status = null, last_delivery_at = null, created_at = now()`,
    [agentId, read.url, events, sealed.ciphertext, sealed.nonce],
  );
  const ping = await deliver(db, agentId, { type: "ping", title: "Botchelor webhook set", body: "This is a test delivery. Real ones come when something needs you.", url: null, id: `ping-${Date.now()}`, created_at: new Date().toISOString() }, { force: true });
  return { ok: true, webhook: (await getWebhook(db, agentId))!, secret, ping };
}

export async function deleteWebhook(db: Db, agentId: string): Promise<boolean> {
  return (await db.query(`delete from agent_webhooks where agent_id = $1 returning agent_id`, [agentId])).rows.length > 0;
}

export type Delivery = { sent: boolean; status: string };
type Payload = { type: WebhookEvent | "ping"; id: string; kind?: NotificationKind; title: string; body: string | null; url: string | null; created_at: string };

/** One POST to the agent's webhook, if it has one that wants this event. Never throws; records how it went. */
async function deliver(db: Db, agentId: string, payload: Payload, opts: { force?: boolean } = {}): Promise<Delivery> {
  const r = (await db.query<Row>(`select * from agent_webhooks where agent_id = $1`, [agentId])).rows[0];
  if (!r) return { sent: false, status: "none" };
  if (!opts.force && (r.disabled_at || !r.events.includes(payload.type))) return { sent: false, status: "skipped" };
  let status: string;
  try {
    const host = new URL(r.url).hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await webhookDeps.lookup(host);
    if (!addresses.length || !addresses.every(isPublicAddress)) {
      status = "blocked: the host resolves to a non-public address";
    } else {
      const secret = openSecret({ ciphertext: r.secret_ct, nonce: r.secret_nonce }, context(agentId));
      if (!secret) throw new Error("sealed");
      const body = JSON.stringify({ ...payload, sent_at: new Date().toISOString() });
      const res = await webhookDeps.fetch(r.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        headers: { "content-type": "application/json", "user-agent": "Botchelor-Webhooks/1", [SIGNATURE_HEADER]: signWebhook(secret, body, Math.floor(Date.now() / 1000)) },
        body,
      });
      status = res.status >= 200 && res.status < 300 ? `ok ${res.status}` : `http ${res.status}`;
    }
  } catch (err) {
    status = !(err instanceof Error) ? "unreachable" : err.name === "TimeoutError" ? "timeout" : err.message === "sealed" ? "secret unreadable: set the webhook again" : "unreachable";
  }
  const ok = status.startsWith("ok");
  await db
    .query(
      `update agent_webhooks set last_status = $2, last_delivery_at = now(),
         failures = case when $3 then 0 else failures + 1 end,
         disabled_at = case when not $3 and failures + 1 >= $4 then coalesce(disabled_at, now()) else disabled_at end
       where agent_id = $1`,
      [agentId, status, ok, WEBHOOK_MAX_FAILURES],
    )
    .catch(() => {});
  return { sent: ok, status };
}

/** Called for every notice (lib/notifications.ts notify): posts the ones that need the agent to its webhook, if it has one. */
export async function webhookForNotice(db: Db, userId: string, n: { id: string; kind: NotificationKind; title: string; body?: string | null; link?: string | null }, absolute: (path: string | null) => string | null): Promise<void> {
  const type = needOf(n.kind);
  if (!type || !(WEBHOOK_EVENTS as readonly string[]).includes(type)) return;
  const has = (await db.query(`select 1 from agent_webhooks where agent_id = $1 and disabled_at is null`, [userId]).catch(() => ({ rows: [] }))).rows.length > 0;
  if (!has) return;
  await deliver(db, userId, { type: type as WebhookEvent, id: n.id, kind: n.kind, title: n.title, body: n.body ?? null, url: absolute(n.link ?? null), created_at: new Date().toISOString() });
}
