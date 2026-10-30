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

