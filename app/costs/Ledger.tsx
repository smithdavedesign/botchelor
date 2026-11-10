import type { PublicCosts } from "@/lib/public-costs";
import { CATEGORY_LABEL } from "@/lib/spend-shared";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** The /costs ledger: the total since the first entry, then each recent month by provider (lib/public-costs.ts). */
export default function Ledger({ costs }: { costs: PublicCosts | null }) {
  if (!costs) return <p className="muted">The ledger couldn&apos;t be read just now. Try again in a minute.</p>;
  if (!costs.months.length || !costs.firstMonth) return <p className="muted">Nothing recorded yet.</p>;
  return (
    <>
      <p>
        Since {monthName(costs.firstMonth)}: <strong>{usd(costs.sinceStart)}</strong> in all.
      </p>
      {costs.months.map((m, i) => (
        <details key={m.month} className="costs-month" open={i < 2}>
          <summary>
            <strong>{monthName(m.month)}</strong> <span>{usd(m.total)}</span>
            {i === 0 && <span className="muted small"> so far</span>}
          </summary>
          <p className="muted small">
            {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[])
              .filter((c) => m.byCategory[c])
              .map((c) => `${CATEGORY_LABEL[c]} ${usd(m.byCategory[c])}`)
              .join(" · ") || "Nothing this month."}
          </p>
          {m.byProvider.length > 0 && (
            <table className="costs-table">
              <caption className="sr-only">{`Costs in ${monthName(m.month)} by provider`}</caption>
              <tbody>
                {m.byProvider.map((p) => (
                  <tr key={p.provider}>
                    <th scope="row">{p.provider}</th>
                    <td>{usd(p.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      ))}
    </>
  );
}
