/**
 * Bans and suspensions (2026-11-22 audit: short of deleting things one at a time there was no way to stop an account, an
 * agent or an address). An admin bans (no end) or suspends (until a time) one of:
 *  - an account: any identity's id, signed in or not, as the session names it (lib/http.ts authFromRequest), its agents'
 *    calls on its behalf included;
 *  - an agent: an MCP agent's id (its credential over MCP: lib/mcp/dispatcher.ts refuses its calls);
 *  - an address: its visitor key (lib/limits.ts addressKey: a keyed hash, the IPv6 /64), so no address is stored.
 * What it stops: every change made through the API (handle(): anything but GET, HEAD and OPTIONS) and every MCP call.
 * Watching and reading stay open. Never stopped: the admins' own tools (so a mistaken address ban can be lifted from the
 * same browser), signing out, the payment webhooks, the jobs and the health check.
 *
 * Each process keeps the live bans in memory, loaded with getDb (lib/db.ts) at most once a minute, as session versions
 * are (lib/session-versions.ts), and changed at once when this process bans or lifts one: checking a request reads no
 * database.
 */
import { normaliseHandle } from "./auth";
import type { Db } from "./db";
import { authFromRequest } from "./http";
import { addressKey, visitorKey } from "./limits";

export const BAN_KINDS = ["account", "agent", "address"] as const;
export type BanKind = (typeof BAN_KINDS)[number];
/** How long a process trusts the bans it loaded. */
export const BANS_FRESH_MS = 60_000;

type State = { live: Map<string, number | null>; loadedAt: number; loaded: boolean };
// On globalThis, so every copy of this module a bundle makes (pages, routes) reads the same bans.
const KEY = Symbol.for("botchelor.bans");
const state = ((globalThis as Record<symbol, unknown>)[KEY] ??= { live: new Map(), loadedAt: 0, loaded: false }) as State;
const keyOf = (kind: BanKind, target: string) => `${kind}:${target}`;

export const bansLoaded = (): boolean => state.loaded;

/** Loads the live bans, unless this process loaded them in the last minute. */
export async function refreshBans(db: Db, now = Date.now()): Promise<void> {
  if (now - state.loadedAt < BANS_FRESH_MS) return;
  state.loadedAt = now;
  const { rows } = await db.query<{ kind: BanKind; target: string; until: string | Date | null }>(
    "select kind, target, until from bans where until is null or until > now()",
  );
  state.live = new Map(rows.map((r) => [keyOf(r.kind, r.target), r.until === null ? null : new Date(r.until).getTime()]));
  state.loaded = true;
}

/** The live ban on one target, with its end (null: none), or null. */
export function liveBan(kind: BanKind, target: string | null | undefined, now = Date.now()): { until: number | null } | null {
  if (!target) return null;
  const until = state.live.get(keyOf(kind, target));
  if (until === undefined) return null;
  return until === null || until > now ? { until } : null;
}

export type Suspension = { error: "suspended"; message: string; until: string | null };

export const suspension = (until: number | null): Suspension => ({
  error: "suspended",
  message: until === null ? "This can't be done from here any more." : `This can't be done from here until ${new Date(until).toUTCString()}.`,
  until: until === null ? null : new Date(until).toISOString(),
});

/** Where a ban never reaches: the admins' tools, signing out, webhooks, jobs and the health check. */
const NEVER = [/^\/api\/admin\//, /^\/api\/auth\/logout$/, /^\/api\/webhooks\//, /^\/api\/jobs\//, /^\/api\/health$/];

/** Why this request may change nothing (a live ban on its identity or its address), or null. Reads no database. */
export function banOn(req: Request, now = Date.now()): Suspension | null {
  if (state.live.size === 0) return null;
  if (NEVER.some((re) => re.test(new URL(req.url).pathname))) return null;
  const id = authFromRequest(req)?.userId ?? null;
  const ban = liveBan("account", id, now) ?? liveBan("agent", id, now) ?? liveBan("address", visitorKey(req.headers), now);
  return ban ? suspension(ban.until) : null;
}

/** The live ban on an MCP caller: the agent it acts as (an account's id too), or its address. */
export function agentBan(agentId: string | null | undefined, address: string | null | undefined, now = Date.now()): Suspension | null {
  const ban = liveBan("agent", agentId, now) ?? liveBan("account", agentId, now) ?? liveBan("address", address, now);
  return ban ? suspension(ban.until) : null;
}

export type BanRow = { kind: BanKind; target: string; label: string | null; until: string | null; reason: string | null; banned_by: string; created_at: string; live: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_KEY = /^[0-9a-f]{32}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/**
 * What an admin typed, as the target it names: an account by @handle or id, an agent by id, an address as an IP (kept
 * only as its key) or as a key already. The label is what the list shows (the handle; for an address, nothing).
 */
export async function resolveTarget(db: Db, kind: BanKind, typed: string): Promise<{ target: string; label: string | null } | { error: string }> {
  const raw = typed.trim();
  if (kind === "address") {
    if (HEX_KEY.test(raw)) return { target: raw, label: null };
    if (IPV4.test(raw) || (raw.includes(":") && IPV6.test(raw))) return { target: addressKey(raw), label: null };
    return { error: "That isn't an address: an IPv4 or IPv6 address, or a visitor key (32 hex characters)." };
  }
  if (UUID.test(raw)) {
    const handle = (await db.query<{ handle: string | null }>("select handle_display as handle from accounts where user_id = $1", [raw.toLowerCase()])).rows[0]?.handle ?? null;
    return { target: raw.toLowerCase(), label: handle ? `@${handle}` : null };
  }
  if (kind === "agent") return { error: "An agent is named by its id (a UUID)." };
  const handle = normaliseHandle(raw.replace(/^@/, ""));
  const row = handle ? (await db.query<{ user_id: string; handle: string }>("select user_id, handle_display as handle from accounts where handle = $1", [handle])).rows[0] : undefined;
  return row ? { target: row.user_id, label: `@${row.handle}` } : { error: "No account has that handle." };
}

/** Bans (until null) or suspends one target, replacing any ban it had; this process stops it at once. */
export async function banTarget(db: Db, input: { kind: BanKind; target: string; until: Date | null; reason: string | null; by: string }): Promise<void> {
  await db.query(
    `insert into bans (kind, target, until, reason, banned_by) values ($1, $2, $3, $4, $5)
     on conflict (kind, target) do update set until = excluded.until, reason = excluded.reason, banned_by = excluded.banned_by, created_at = now()`,
    [input.kind, input.target, input.until?.toISOString() ?? null, input.reason, input.by],
  );
  state.live.set(keyOf(input.kind, input.target), input.until?.getTime() ?? null);
}

/** Lifts a ban; whether there was one. */
export async function liftBan(db: Db, kind: BanKind, target: string): Promise<boolean> {
  const { rows } = await db.query("delete from bans where kind = $1 and target = $2 returning target", [kind, target]);
  state.live.delete(keyOf(kind, target));
  return rows.length > 0;
}

/** The bans for the admin's list: live ones first, then those that ended in the last 30 days. */
export async function listBans(db: Db): Promise<BanRow[]> {
  const { rows } = await db.query<{ kind: BanKind; target: string; label: string | null; until: string | Date | null; reason: string | null; banned_by: string; created_at: string | Date; live: boolean }>(
    `select b.kind, b.target, (select '@' || a.handle_display from accounts a where a.user_id = b.target and b.kind <> 'address') as label,
            b.until, b.reason, b.banned_by, b.created_at, (b.until is null or b.until > now()) as live
       from bans b
      where b.until is null or b.until > now() - interval '30 days'
      order by (b.until is null or b.until > now()) desc, b.created_at desc
      limit 200`,
  );
  const iso = (v: string | Date) => new Date(v).toISOString();
  return rows.map((r) => ({ ...r, until: r.until === null ? null : iso(r.until), created_at: iso(r.created_at) }));
}

/** Tests: forget what this process loaded. */
export function resetBansForTests(): void {
  state.live = new Map();
  state.loadedAt = 0;
  state.loaded = false;
}
