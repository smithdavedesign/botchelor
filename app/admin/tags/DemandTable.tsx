import type { Demand } from "@/lib/tag-demand";

const x = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}×`);

/**
 * One demand measure as a table (lib/tag-demand.ts): each tag's picks and supply, ours raw, the census's, and the blend
 * the pickers order by, most wanted first. A facet heading between groups.
 */
export default function DemandTable({ demand, caption }: { demand: Demand; caption: string }) {
  const facets = [...new Set(demand.rows.map((r) => r.facet))];
  return (
    <>
      {facets.map((f) => (
        <table key={f} className="board">
          <caption>
            {caption} · {f}
          </caption>
          <thead>
            <tr>
              <th scope="col">Tag</th>
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
      ))}
    </>
  );
}
