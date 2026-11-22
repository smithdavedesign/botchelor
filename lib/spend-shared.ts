/** The spend tracker's types and month arithmetic (lib/spend.ts), safe for the admin page's client code. */
export const KINDS = ["cost", "income"] as const;
export const CATEGORIES = ["api", "infra", "other"] as const;
export const EVERY = ["once", "month", "year"] as const;
export type Kind = (typeof KINDS)[number];
export type Category = (typeof CATEGORIES)[number];
export type Every = (typeof EVERY)[number];

export const CATEGORY_LABEL: Record<Category, string> = { api: "API and models", infra: "Infrastructure", other: "Other" };

export type MoneyEntry = {
  id: string;
  kind: Kind;
  category: Category;
  provider: string;
  label: string;
  usd: number;
  every: Every;
  /** "YYYY-MM-DD". */
  starts_on: string;
  ends_on: string | null;
  note: string | null;
  seed_key: string | null;
};
export type NewEntry = Omit<MoneyEntry, "id" | "seed_key">;

/** "YYYY-MM". */
export type Month = string;
export const monthOf = (d: Date): Month => d.toISOString().slice(0, 7);
export const isMonth = (s: unknown): s is Month => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** The month n months before (negative) or after this one. */
export function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return monthOf(d);
}

/** What an entry comes to in one month: a once on its month, a month entry every month it runs, a year entry each year on its start's month. */
export function amountIn(e: Pick<MoneyEntry, "usd" | "every" | "starts_on" | "ends_on">, month: Month): number {
  const start = e.starts_on.slice(0, 7);
  const end = e.ends_on ? e.ends_on.slice(0, 7) : null;
  if (month < start || (end && month > end)) return 0;
  if (e.every === "once") return month === start ? e.usd : 0;
  if (e.every === "month") return e.usd;
  return month.slice(5) === start.slice(5) ? e.usd : 0;
}

/** A prepaid balance with fewer days left than this, at the pace it's been going down, is flagged (lib/spend.ts daysLeft). */
export const LOW_BALANCE_DAYS = 7;

/** What a low-balance flag needs from a provider's reading. */
export type BalanceFlag = { label: string; balance_usd: number | null; days_left: number | null; auto_top_up: boolean; pace_since: string | null };

/**
 * Whether a provider's balance runs out within LOW_BALANCE_DAYS at its recent pace (UX audit 2026-11-22: OpenRouter sat
 * at $3.78 with about two days left and nothing said so). One that tops itself up (auto-pay) refills, so it isn't.
 */
export const isLowBalance = (r: BalanceFlag): boolean => r.days_left !== null && r.days_left < LOW_BALANCE_DAYS && !r.auto_top_up;

/** "about 4 days", "less than a day": how long a balance lasts at its recent pace. */
export function daysLeftWords(days: number): string {
  if (days < 1) return "less than a day";
  const n = Math.floor(days);
  return `about ${n} ${n === 1 ? "day" : "days"}`;
}

/** "OpenRouter: $3.78 left, about 4 days at the pace since Nov 6." The flag's words, on /admin/spend and in the alert. */
export function lowBalanceLine(r: BalanceFlag): string {
  const name = r.label.split(" (")[0];
  const left = (r.balance_usd ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const since = r.pace_since ? ` since ${new Date(`${r.pace_since}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  return `${name}: ${left} left, ${daysLeftWords(r.days_left ?? 0)} at the pace${since}.`;
}

