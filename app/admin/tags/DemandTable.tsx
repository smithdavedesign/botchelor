import type { Demand, FacetSources } from "@/lib/tag-demand";

const x = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}×`);

/**
 * One demand measure as a table (lib/tag-demand.ts): each tag's picks and supply, ours raw, the census's, and the blend
 * the pickers order by, most wanted first. A facet heading between groups. A facet that isn't a tag (art style, lineup)
 * also shows where its picks came from, one column per source. Each table scrolls on its own on a phone.
 */
export default function DemandTable({
  demand,
  caption,
  item = "Tag",
  sources,
}: {
  demand: Demand;
  caption: string;
  /** What a row is ("Tag", "Style", "Pronouns"). */
  item?: string;
  /** Picks per source per row, and each source's column heading. */
  sources?: { by: FacetSources; labels: Record<string, string> };
}) {
  const facets = [...new Set(demand.rows.map((r) => r.facet))];
  const cols = sources ? Object.keys(sources.labels) : [];
  return (
    <>
      {facets.map((f) => (
        <div key={f} className="table-scroll" tabIndex={0} role="region" aria-label={`${caption} · ${f}`}>
          <table className="board">
            <caption>
              {caption} · {f}
            </caption>
            <thead>
              <tr>
                <th scope="col">{item}</th>
                {cols.map((k) => (
                  <th key={k} scope="col">
                    {sources?.labels[k]}
                  </th>
                ))}
                <th scope="col">Picks</th>
                <th scope="col">On offer</th>
                <th scope="col">Ours</th>
                <th scope="col">Census</th>
                <th scope="col">Blended</th>
              </tr>
            </thead>
            <tbody>
              {demand.rows
                .filter((r) => r.facet === f)
                .sort((a, b) => b.blended - a.blended)
                .map((r) => (
                  <tr key={r.tag}>
                    <th scope="row">
                      {r.icon} {r.label}
                    </th>
                    {cols.map((k) => (
                      <td key={k}>{sources?.by[r.tag]?.[k] ?? 0}</td>
                    ))}
                    <td>{r.picks}</td>
                    <td>{r.supply}</td>
                    <td>{x(r.raw)}</td>
                    <td>{x(r.census)}</td>
                    <td>
                      <strong>{x(r.blended)}</strong>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
