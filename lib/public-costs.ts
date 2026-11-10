import type { Db } from "./db";
import { listEntries } from "./spend";
import { addMonths, amountIn, type Category, type MoneyEntry, type Month, monthOf } from "./spend-shared";

/**
 * What running Botchelor has cost, for the public /costs page (David, 2026-11-10: "add a section below or another page
 * for cost, I value transparency"). It reads the same ledger as /admin/spend (money_entries), costs only: no income, no
 * balances, and never an entry's own note (notes are for the admin). Amounts are grouped by provider, so a label written
 * for the admin isn't published either.
 */
export type PublicMonth = {
  month: Month;
  total: number;
  byCategory: Record<Category, number>;
  byProvider: { provider: string; usd: number }[];
};
export type PublicCosts = { months: PublicMonth[]; sinceStart: number; firstMonth: Month | null };

const round = (n: number) => Math.round(n * 100) / 100;

function monthOfCosts(costs: MoneyEntry[], month: Month): PublicMonth {
  const byCategory: Record<Category, number> = { api: 0, infra: 0, other: 0 };
  const byProvider = new Map<string, number>();
  let total = 0;
  for (const e of costs) {
    const usd = amountIn(e, month);
    if (!usd) continue;
    byCategory[e.category] += usd;
    byProvider.set(e.provider, (byProvider.get(e.provider) ?? 0) + usd);
    total += usd;
  }
  return {
    month,
    total: round(total),
    byCategory: { api: round(byCategory.api), infra: round(byCategory.infra), other: round(byCategory.other) },
    byProvider: [...byProvider].map(([provider, usd]) => ({ provider, usd: round(usd) })).sort((a, b) => b.usd - a.usd || a.provider.localeCompare(b.provider)),
  };
}

/** The last `count` months of costs (newest first, never before the first entry) and the total since the first one. */
export function publicCostsFrom(entries: MoneyEntry[], now: Date = new Date(), count = 6): PublicCosts {
  const costs = entries.filter((e) => e.kind === "cost");
  if (!costs.length) return { months: [], sinceStart: 0, firstMonth: null };
  const firstMonth = costs.map((e) => e.starts_on.slice(0, 7)).sort()[0];
  const current = monthOf(now);
  const months: PublicMonth[] = [];
  for (let m = current, i = 0; i < count && m >= firstMonth; m = addMonths(m, -1), i++) months.push(monthOfCosts(costs, m));
  let sinceStart = 0;
  for (let m = firstMonth; m <= current; m = addMonths(m, 1)) sinceStart += monthOfCosts(costs, m).total;
  return { months, sinceStart: round(sinceStart), firstMonth };
}

export async function publicCosts(db: Db, now: Date = new Date()): Promise<PublicCosts> {
  return publicCostsFrom(await listEntries(db), now);
}
