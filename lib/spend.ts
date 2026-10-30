/**
 * The spend tracker (/admin/spend): what the product costs and what it earns, month by month.
 *
 * Three sources, kept apart because they mean different things:
 * - **Cash** (money_entries): bills, prepaid top-ups and one-off payments an admin enters, plus income made outside the
 *   app. A month or year entry repeats from its start until its end. KNOWN_COSTS fills in the ones docs/costs.md records.
 * - **Income from records**: paid show orders (not Stripe test-mode ones), After Dark subscription payments (adult_billing_events, refunds and
 *   chargebacks taken off) and operator passes (operator_pass_events; Stripe's event carries no amount, so each one is
 *   counted at the pass's price).
 * - **Usage the providers report** (providerReadings): the balance and spend each provider's own API gives, where it has
 *   one, kept once a day in spend_snapshots. A prepaid top-up is cash when it's paid and usage as it's spent, so usage is
 *   shown next to the cash, never added to it.
 *
 * Read with each key the app already holds (After Dark's house keys) or one set for it alone: DO_BILLING_TOKEN (a
 * read-only DigitalOcean token) and BUNNY_ACCOUNT_KEY (Bunny's account API key). Nothing here spends.
 */
import { adultKeys } from "./adult/settings";
import type { Db } from "./db";
import { loadOurIds } from "./our-traffic";
import { addMonths, amountIn, type Category, type MoneyEntry, type Month, type NewEntry } from "./spend-shared";

export * from "./spend-shared";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

/**
 * The costs docs/costs.md and docs/after-dark-hosting.md record, to fill in with one button. A date the docs don't give
 * exactly is the start of the period they cover, said so in the note. The DigitalOcean apps are the sizes in .do/app.yaml.
 * Venice isn't here: its three October receipts ($50, $25, $50) were entered from the email receipts themselves.
 */
export const KNOWN_COSTS: ReadonlyArray<NewEntry & { seed_key: string }> = [
  { seed_key: "vercel-pro", kind: "cost", category: "infra", provider: "Vercel", label: "Vercel Pro (shared with the other products)", usd: 20, every: "month", starts_on: "2026-10-13", ends_on: "2026-10-30", note: "Hobby (free) since 2026-10-30, when the show moved to DigitalOcean" },
  { seed_key: "neon-launch", kind: "cost", category: "infra", provider: "Neon", label: "Neon Launch (database)", usd: 5, every: "month", starts_on: "2026-10-20", ends_on: null, note: "Usage-billed, about $3–6 a month; correct it from Neon's invoice" },
  { seed_key: "do-show", kind: "cost", category: "infra", provider: "DigitalOcean", label: "DigitalOcean app: the show", usd: 10, every: "month", starts_on: "2026-10-30", ends_on: null, note: "apps-s-1vcpu-1gb-fixed" },
  { seed_key: "do-after-dark", kind: "cost", category: "infra", provider: "DigitalOcean", label: "DigitalOcean app: After Dark", usd: 10, every: "month", starts_on: "2026-10-30", ends_on: null, note: "apps-s-1vcpu-1gb-fixed" },
  { seed_key: "bunny", kind: "cost", category: "infra", provider: "Bunny", label: "Bunny storage and CDN (media)", usd: 1, every: "month", starts_on: "2026-10-30", ends_on: null, note: "Bunny's $1 minimum until media grows" },
  { seed_key: "hive", kind: "cost", category: "api", provider: "Hive", label: "Hive top-up (moderation)", usd: 111, every: "once", starts_on: "2026-10-13", ends_on: null, note: "Date approximate (before 2026-10-22)" },
  { seed_key: "openrouter-1", kind: "cost", category: "api", provider: "OpenRouter", label: "OpenRouter top-up", usd: 50, every: "once", starts_on: "2026-10-21", ends_on: null, note: "Shared with OpenClaw and LiteLLM/RepoHQ keys" },
  { seed_key: "mcp-listings", kind: "cost", category: "other", provider: "mcp.so + Glama", label: "MCP directory listings", usd: 20, every: "once", starts_on: "2026-10-21", ends_on: null, note: null },
];

type EntryRow = Omit<MoneyEntry, "usd" | "starts_on" | "ends_on"> & { usd: string | number; starts_on: string | Date; ends_on: string | Date | null };
const day = (d: string | Date): string => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const toEntry = (r: EntryRow): MoneyEntry => ({ ...r, usd: Number(r.usd), starts_on: day(r.starts_on), ends_on: r.ends_on ? day(r.ends_on) : null });

export async function listEntries(db: Db): Promise<MoneyEntry[]> {
  const { rows } = await db.query<EntryRow>(
    `select id, kind, category, provider, label, usd, every, starts_on, ends_on, note, seed_key from money_entries order by starts_on desc, created_at desc`,
  );
  return rows.map(toEntry);
}

export async function addEntry(db: Db, e: NewEntry, by: string | null, seedKey: string | null = null): Promise<string | null> {
  const id = crypto.randomUUID();
  const { rows } = await db.query(
    `insert into money_entries (id, kind, category, provider, label, usd, every, starts_on, ends_on, note, seed_key, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (seed_key) do nothing returning id`,
    [id, e.kind, e.category, e.provider, e.label, e.usd, e.every, e.starts_on, e.ends_on, e.note, seedKey, by],
  );
  return rows.length ? id : null;
}

export async function deleteEntry(db: Db, id: string): Promise<boolean> {
  return (await db.query(`delete from money_entries where id = $1 returning id`, [id])).rows.length > 0;
}

/** Adds the documented costs not yet in; how many it added. */
export async function addKnownCosts(db: Db, by: string | null): Promise<number> {
  let added = 0;
  for (const { seed_key, ...e } of KNOWN_COSTS) if (await addEntry(db, e, by, seed_key)) added++;
  return added;
}

export async function knownCostsMissing(db: Db): Promise<number> {
  const { rows } = await db.query<{ seed_key: string }>(`select seed_key from money_entries where seed_key is not null`);
  const have = new Set(rows.map((r) => r.seed_key));
  return KNOWN_COSTS.filter((k) => !have.has(k.seed_key)).length;
}

/* ------------------------------------------------- income from records ------------------------------------------------- */

export type IncomeLine = { source: "orders" | "after_dark" | "operator_pass"; label: string; usd: number; count: number; ours_usd: number; note: string | null };

/** The operator pass's price, for counting its payments (Stripe's events carry no amount). */
export function operatorPassPrice(env: Env = process.env): number {
  const n = Number(env.OPERATOR_PASS_PRICE_USD?.trim());
  return Number.isFinite(n) && n > 0 ? n : 9;
}

const AD_SIGN: Record<string, number> = { initial: 1, rebill: 1, refund: -1, chargeback: -1 };

/** Income the app's own tables record for a month: the money, and how much of it came from our own accounts. */
export async function recordedIncome(db: Db, month: Month, env: Env = process.env): Promise<IncomeLine[]> {
  const from = `${month}-01`;
  const to = `${addMonths(month, 1)}-01`;
  const ours = new Set(await loadOurIds(db));
  const admins = new Set((await db.query<{ user_id: string }>(`select user_id from admins`)).rows.map((r) => r.user_id));
  const isOurs = (id: string | null) => Boolean(id && (ours.has(id) || admins.has(id)));

  const orders = (
    await db.query<{ user_id: string; amount_cents: number }>(
      `select user_id, amount_cents from orders
        where status = 'paid' and paid_at >= $1 and paid_at < $2 and coalesce(stripe_session_id, '') not like 'cs\\_test\\_%'`,
      [from, to],
    )
  ).rows;
  const ad = (
    await db.query<{ user_id: string | null; kind: string; amount: string | null }>(
      `select user_id, kind, amount from adult_billing_events
        where outcome = 'applied' and kind in ('initial', 'rebill', 'refund', 'chargeback') and received_at >= $1 and received_at < $2`,
      [from, to],
    )
  ).rows;
  const passes = (
    await db.query<{ user_id: string | null }>(
      `select user_id from operator_pass_events where outcome in ('initial', 'rebill') and received_at >= $1 and received_at < $2`,
      [from, to],
    )
  ).rows;

  const sum = <T>(rows: T[], usd: (r: T) => number, id: (r: T) => string | null) => ({
    usd: round(rows.reduce((s, r) => s + usd(r), 0)),
    ours_usd: round(rows.filter((r) => isOurs(id(r))).reduce((s, r) => s + usd(r), 0)),
    count: rows.length,
  });
  const adUsd = (r: (typeof ad)[number]) => (AD_SIGN[r.kind] ?? 0) * Math.abs(Number(r.amount) || 0);
  const price = operatorPassPrice(env);
  return [
    { source: "orders", label: "Show token packs and characters (Stripe)", ...sum(orders, (r) => r.amount_cents / 100, (r) => r.user_id), note: null },
    { source: "after_dark", label: "After Dark subscriptions", ...sum(ad, adUsd, (r) => r.user_id), note: "Refunds and chargebacks taken off; before the processor's fees" },
    { source: "operator_pass", label: "Operator passes (Stripe)", ...sum(passes, () => price, (r) => r.user_id), note: `Counted at $${price} each` },
  ];
}

/* --------------------------------------------------- the month's sums --------------------------------------------------- */

export type MonthSummary = {
  month: Month;
  costs: Record<Category, number> & { total: number };
  income: { recorded: number; entered: number; ours: number; total: number };
  /** Income less costs, our own purchases left out. */
  net: number;
};

const round = (n: number) => Math.round(n * 100) / 100;

export function summarize(month: Month, entries: MoneyEntry[], recorded: IncomeLine[]): MonthSummary {
  const costs = { api: 0, infra: 0, other: 0, total: 0 };
  let entered = 0;
  for (const e of entries) {
    const usd = amountIn(e, month);
    if (!usd) continue;
    if (e.kind === "cost") {
      costs[e.category] += usd;
      costs.total += usd;
    } else entered += usd;
  }
  const rec = recorded.reduce((s, l) => s + l.usd, 0);
  const ours = recorded.reduce((s, l) => s + l.ours_usd, 0);
  const total = rec + entered;
  return {
    month,
    costs: { api: round(costs.api), infra: round(costs.infra), other: round(costs.other), total: round(costs.total) },
    income: { recorded: round(rec), entered: round(entered), ours: round(ours), total: round(total) },
    net: round(total - ours - costs.total),
  };
}

/** Our own model spend the app logs itself: the After Dark eval runs (adult_eval_spend). */
export async function loggedUsage(db: Db, month: Month): Promise<{ eval_usd: number; eval_runs: number }> {
  const r = (
    await db.query<{ usd: number | null; runs: string | number | null }>(`select sum(usd) as usd, sum(runs) as runs from adult_eval_spend where day like $1`, [`${month}-%`])
  ).rows[0];
  return { eval_usd: round(Number(r?.usd ?? 0)), eval_runs: Number(r?.runs ?? 0) };
}

/* ----------------------------------------------- what the providers report ----------------------------------------------- */

export type ProviderId = "openrouter" | "venice" | "digitalocean" | "bunny" | "fal" | "replicate" | "hive";

export type Reading = {
  provider: ProviderId;
  label: string;
  category: Category;
  /** What the account has left (a prepaid balance), or for a billed account what it owes (negative is credit). */
  balance_usd: number | null;
  used_month_usd: number | null;
  used_total_usd: number | null;
  /** "live" read now; "no_key" nothing to read it with; "no_api" the provider has no billing API; "error" it didn't answer. */
  state: "live" | "no_key" | "no_api" | "error";
  note: string | null;
  dashboard: string;
  /** The balance 7 days ago, from spend_snapshots, to show the week's burn. */
  balance_week_ago: number | null;
};

const TIMEOUT_MS = 6_000;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

async function getJson(doFetch: Fetch, url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  const res = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const base = (provider: ProviderId, label: string, category: Category, dashboard: string): Reading => ({
  provider, label, category, dashboard, balance_usd: null, used_month_usd: null, used_total_usd: null, state: "no_key", note: null, balance_week_ago: null,
});

/** Reads one provider; never throws. */
async function readOne(r: Reading, key: string | null, read: (key: string) => Promise<Partial<Reading>>): Promise<Reading> {
  if (!key) return r;
  try {
    return { ...r, ...(await read(key)), state: "live" };
  } catch (err) {
    return { ...r, state: "error", note: `Didn't answer: ${err instanceof Error ? err.message.slice(0, 80) : "unknown error"}` };
  }
}

/** Every provider's balance and spend, read live where it can be, and today's snapshot kept. */
export async function providerReadings(db: Db, env: Env = process.env, doFetch: Fetch = fetch, now: Date = new Date()): Promise<Reading[]> {
  const keys = await adultKeys(db, env).catch(() => null);
  const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
  const readings = await Promise.all([
    readOne(base("openrouter", "OpenRouter (After Dark's writer)", "api", "https://openrouter.ai/settings/credits"), keys?.openrouter ?? null, async (k) => {
      const d = ((await getJson(doFetch, "https://openrouter.ai/api/v1/key", bearer(k)))?.data ?? {}) as Record<string, unknown>;
      const left = num(d.limit_remaining);
      return {
        used_total_usd: num(d.usage),
        used_month_usd: num(d.usage_monthly),
        balance_usd: left,
        note: left === null ? "This key's spend; the account's balance is on OpenRouter (shared with OpenClaw and LiteLLM)" : "Left under this key's limit",
      };
    }),
    readOne(base("venice", "Venice (pictures, video, checks)", "api", "https://venice.ai/settings/api"), keys?.venice ?? null, async (k) => {
      const d = ((await getJson(doFetch, "https://api.venice.ai/api/v1/api_keys/rate_limits", bearer(k)))?.data ?? {}) as Record<string, unknown>;
      const b = (d.balances ?? {}) as Record<string, unknown>;
      return { balance_usd: num(b.USD), note: "Auto-pay tops it up under $10, so a rise is a top-up" };
    }),
    readOne(base("digitalocean", "DigitalOcean (hosting)", "infra", "https://cloud.digitalocean.com/account/billing"), env.DO_BILLING_TOKEN?.trim() || null, async (k) => {
      const d = (await getJson(doFetch, "https://api.digitalocean.com/v2/customers/my/balance", bearer(k))) ?? {};
      return { used_month_usd: num(d.month_to_date_usage), balance_usd: num(d.month_to_date_balance), note: "Balance is what's owed this month so far" };
    }),
    readOne(base("bunny", "Bunny (media storage and CDN)", "infra", "https://dash.bunny.net/account/billing"), env.BUNNY_ACCOUNT_KEY?.trim() || null, async (k) => {
      const d = (await getJson(doFetch, "https://api.bunny.net/billing", { AccessKey: k, accept: "application/json" })) ?? {};
      return { balance_usd: num(d.Balance), used_month_usd: num(d.ThisMonthCharges) };
    }),
    Promise.resolve({ ...base("fal", "fal.ai (show portraits, tiles, sets)", "api", "https://fal.ai/dashboard/billing"), state: "no_api" as const }),
    Promise.resolve({ ...base("replicate", "Replicate (fallback pictures)", "api", "https://replicate.com/account/billing"), state: "no_api" as const }),
    Promise.resolve({ ...base("hive", "Hive (moderation)", "api", "https://thehive.ai/"), state: "no_api" as const }),
  ]);

  const today = now.toISOString().slice(0, 10);
  for (const r of readings) {
    if (r.state !== "live") continue;
    await db
      .query(
        `insert into spend_snapshots (day, provider, balance_usd, used_total_usd, used_month_usd, read_at) values ($1, $2, $3, $4, $5, $6)
         on conflict (day, provider) do update set balance_usd = excluded.balance_usd, used_total_usd = excluded.used_total_usd,
           used_month_usd = excluded.used_month_usd, read_at = excluded.read_at`,
        [today, r.provider, r.balance_usd, r.used_total_usd, r.used_month_usd, now.toISOString()],
      )
      .catch(() => {});
  }
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { rows } = await db.query<{ provider: string; balance_usd: number | null }>(
    `select distinct on (provider) provider, balance_usd from spend_snapshots where day <= $1 and balance_usd is not null order by provider, day desc`,
    [weekAgo],
  );
  const past = new Map(rows.map((r) => [r.provider, r.balance_usd]));
  return readings.map((r) => ({ ...r, balance_week_ago: past.get(r.provider) ?? null }));
}

/* ------------------------------------------------------ the page's data ------------------------------------------------------ */

export type SpendView = {
  month: Month;
  summary: MonthSummary;
  income: IncomeLine[];
  /** The entries that count in this month, with what each comes to. */
  month_entries: Array<MoneyEntry & { in_month: number }>;
  entries: MoneyEntry[];
  history: MonthSummary[];
  usage: { eval_usd: number; eval_runs: number };
  readings: Reading[];
  known_missing: number;
};

export const HISTORY_MONTHS = 6;

export async function spendView(db: Db, month: Month, env: Env = process.env, doFetch: Fetch = fetch, now: Date = new Date()): Promise<SpendView> {
  const entries = await listEntries(db);
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(month, i - HISTORY_MONTHS + 1));
  const history = await Promise.all(months.map(async (m) => summarize(m, entries, await recordedIncome(db, m, env))));
  const income = await recordedIncome(db, month, env);
  return {
    month,
    summary: summarize(month, entries, income),
    income,
    month_entries: entries.map((e) => ({ ...e, in_month: amountIn(e, month) })).filter((e) => e.in_month > 0),
    entries,
    history,
    usage: await loggedUsage(db, month),
    readings: await providerReadings(db, env, doFetch, now),
    known_missing: await knownCostsMissing(db),
  };
}
