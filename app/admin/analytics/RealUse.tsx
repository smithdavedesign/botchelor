import type { Metric, MetricDef, RealUse as RealUseData, RealWindow } from "@/lib/real-metrics";

/* No money section: the analytics page shows no revenue, prices or purchases (the owner's rule; Stripe is the record). */
const SECTIONS: { key: MetricDef["section"]; title: string }[] = [
  { key: "people", title: "People" },
  { key: "agents", title: "Agents (MCP)" },
  { key: "dates", title: "Dates" },
  { key: "engagement", title: "Engagement" },
  { key: "feedback", title: "Line votes" },
];

/** What a person did with a character (lib/character-return.ts), in the table's words. */
const ACT_LABEL = { watch: "watched a date end", message: "messaged them", book: "booked a date", advice: "left advice" } as const;

const pct = (num: number, den: number) => `${Math.round((num / den) * 100)}%`;
const num1 = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One number as the page shows it: rates and medians over fewer than minN people or agents say so instead. */
function show(m: Metric, minN: number): { text: string; muted?: boolean; title?: string } {
  switch (m.kind) {
    case "count":
      return { text: String(m.value) };
    case "na":
      return { text: m.why, muted: true };
    case "share":
      if (m.den === 0) return { text: "none yet", muted: true };
      if (m.den < minN) return { text: `n too small (${m.num}/${m.den})`, muted: true, title: `Fewer than ${minN}: ${pct(m.num, m.den)}` };
      return { text: `${pct(m.num, m.den)} (${m.num}/${m.den})` };
    case "per":
      if (m.den === 0) return { text: "none yet", muted: true };
      if (m.den < minN) return { text: `n too small (${m.num}/${m.den})`, muted: true };
      return { text: (m.num / m.den).toFixed(2) };
    case "quantiles":
      if (m.n === 0) return { text: "none yet", muted: true };
      if (m.n < minN) return { text: `n too small (n=${m.n})`, muted: true, title: `median ${num1(m.median)}, p75 ${num1(m.p75)}` };
      return { text: `median ${num1(m.median)} · p75 ${num1(m.p75)}` };
  }
}

const metricOf = (w: RealWindow, d: MetricDef): Metric => (w[d.section] as Record<string, Metric>)[d.key];

/**
 * "Real use": what real people and real agents did, last 7 and 30 days side by side, with its own fixed windows and
 * definitions (lib/real-metrics.ts). The simulated visitors' ratings and the quality runs are on the Quality tab.
 */
export default function RealUse({ data }: { data: RealUseData }) {
  const short = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const longest = data.windows[data.windows.length - 1];
  return (
    <>
      <h2>Real use, last 7 and 30 days</h2>
      <p className="muted small">
        Fixed windows that ignore the filters above, with their own definitions (return rates, multi-day agents, dates per agent). From
        the database, our own traffic left out everywhere: admin accounts and agents linked to them, the loop&apos;s house-run bots and
        arena crowd, our checks, the deleted owner, the show&apos;s own watch-party dates, and anything they made ({longest.ours_left_out} of
        our own identities were active in the last {longest.days} days). Rates over fewer than {data.min_n} people or agents say &ldquo;n
        too small&rdquo;. Days are UTC. As of {short(data.generated_at)}.
      </p>
      <div className="analytics-grid">
        {SECTIONS.map((s) => (
          <div key={s.key}>
            <h3>{s.title}</h3>
            <div className="table-scroll">
              <table className="board">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {data.windows.map((w) => (
                      <th key={w.days} className="num">
                        {w.days} days
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.defs
                    .filter((d) => d.section === s.key)
                    .map((d) => (
                      <tr key={d.key}>
                        <td className="wrap">
                          <strong>{d.label}</strong>
                          <div className="muted small">{d.definition}</div>
                        </td>
                        {data.windows.map((w) => {
                          const v = show(metricOf(w, d), data.min_n);
                          return (
                            <td key={w.days} className={`num${v.muted ? " muted small" : ""}`} title={v.title}>
                              {v.text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <h3>Who came back for their character, last {longest.days} days</h3>
      <p className="muted small">
        The people behind &ldquo;Came back for their character&rdquo;, newest first. Read these one by one while the numbers are small: a
        share over a handful of people is a direction, not proof.
      </p>
      {data.returns.length === 0 ? (
        <p className="muted small">Nobody new has watched their character&apos;s date to its ending or messaged a character yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="board">
            <thead>
              <tr>
                <th>Person</th>
                <th>Character</th>
                <th>Came from</th>
                <th>First</th>
                <th>Came back</th>
              </tr>
            </thead>
            <tbody>
              {data.returns.map((r) => (
                <tr key={`${r.user}:${r.first_at}`}>
                  <td title={r.user}>{r.user.slice(0, 8)}</td>
                  <td>{r.name ?? r.character.slice(0, 8)}</td>
                  <td>{r.source ?? "—"}</td>
                  <td>
                    {short(r.first_at)} · {ACT_LABEL[r.first_kind]}
                  </td>
                  <td className={r.returned_at ? undefined : "muted small"}>
                    {r.returned_at && r.returned_kind ? `${short(r.returned_at)} · ${ACT_LABEL[r.returned_kind]}` : r.pending ? "first day is today" : "not within 7 days"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
