import { keyMetrics, type QualityRun } from "@/lib/quality-runs";
import type { Metric, MetricDef, RealUse as RealUseData, RealWindow } from "@/lib/real-metrics";

const SECTIONS: { key: MetricDef["section"]; title: string }[] = [
  { key: "people", title: "People" },
  { key: "agents", title: "Agents (MCP)" },
  { key: "dates", title: "Dates" },
  { key: "money", title: "Money" },
  { key: "engagement", title: "Engagement" },
  { key: "feedback", title: "Line votes" },
];

const KIND_LABEL: Record<QualityRun["kind"], string> = { golden: "Golden A/B", after_dark_observer: "After Dark observer" };

const pct = (num: number, den: number) => `${Math.round((num / den) * 100)}%`;
const num1 = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One number as the page shows it: rates and medians over fewer than minN people or agents say so instead. */
function show(m: Metric, minN: number): { text: string; muted?: boolean; title?: string } {
  switch (m.kind) {
    case "count":
      return { text: String(m.value) };
    case "usd":
      return { text: `$${(m.cents / 100).toFixed(2)}` };
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

/** "Real use": what real people and real agents did, last 7 and 30 days side by side, next to the simulated runs. */
export default function RealUse({ data }: { data: RealUseData }) {
  const short = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const longest = data.windows[data.windows.length - 1];
  return (
    <>
      <h2>Real use</h2>
      <p className="muted small">
        From the database, our own traffic left out everywhere: admin accounts and agents linked to them, the loop&apos;s house-run bots and
        arena crowd, our checks (<em>ours</em> below), the deleted owner, the show&apos;s own watch-party dates, and anything they made ({longest.ours_left_out} of our own
        identities were active in the last {longest.days} days). Rates over fewer than {data.min_n} people or agents say &ldquo;n too
        small&rdquo;. Days are UTC. As of {short(data.generated_at)}.
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
        <div>
          <h3>Simulated visitors, for comparison</h3>
          {data.sims.length === 0 ? (
            <p className="muted small">
              No loop runs posted yet. The loop posts each run&apos;s averages with <code>scripts/loop/post-ratings.mjs</code>.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="board">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Commit</th>
                    <th className="num">Overall</th>
                    <th className="num">MCP</th>
                    <th className="num">Visitors</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sims.map((r) => (
                    <tr key={r.run}>
                      <td className="when small" title={r.at}>
                        {short(r.at)}
                      </td>
                      <td>{r.sha ? <code>{r.sha.slice(0, 7)}</code> : "—"}</td>
                      <td className="num">{num1(r.overall_avg)}</td>
                      <td className="num">{num1(r.mcp_avg)}</td>
                      <td className="num">{r.visitors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Each run&apos;s average visitor rating out of 10, overall and for the MCP tools; the last 10 runs.</p>
        </div>
        <div>
          <h3>Quality runs</h3>
          {(data.quality ?? []).length === 0 ? (
            <p className="muted small">
              None posted yet. <code>scripts/eval/golden.mjs --post</code> sends a golden A/B, and{" "}
              <code>scripts/eval/observer-nightly.mjs</code> the nightly After Dark observer.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="board">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Run</th>
                    <th>Key numbers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.quality.map((r) => (
                    <tr key={r.id}>
                      <td className="when small" title={r.at}>
                        {short(r.at)}
                      </td>
                      <td className="wrap">
                        <strong>{KIND_LABEL[r.kind] ?? r.kind}</strong>
                        <div className="muted small">
                          {r.label}
                          {r.sha ? (
                            <>
                              {" "}
                              · <code>{r.sha.slice(0, 7)}</code>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="wrap small">
                        {keyMetrics(r).map((m, i) => (
                          <span key={m.label}>
                            {i > 0 ? " · " : ""}
                            {m.label} <strong className={m.bad ? "error" : undefined}>{m.value}</strong>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">
            The golden set: the same fixed cases on two configs, a local model picking the better of each pair twice with the order
            swapped (B&apos;s win rate, the sign test&apos;s p, the gate). The observer: what its checks flag on After Dark pairs that changed
            in the last day. The last 10 runs.
          </p>
        </div>
      </div>
    </>
  );
}
