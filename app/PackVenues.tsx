import { packVenues } from "@/lib/pack-venues";

function Tiles({ venues }: { venues: { id: string; src: string }[] }) {
  return (
    <ul className="pack-venues-list">
      {venues.map((v) => (
        <li key={v.id}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a small static cut of a reviewed backdrop (~3 KB) */}
          <img src={v.src} alt="" width={96} height={64} loading="lazy" decoding="async" />
        </li>
      ))}
    </ul>
  );
}

/**
 * A date pack's picture (pass 2 of the 2026-11-20 visual pop audit): one place for each date it buys. Five sit in a
 * row; fifteen run past in a slow ribbon (the list twice, so it loops without a seam; still under reduced motion and
 * while a pointer is on it). Decorative: the pack's name already says how many dates. Nothing for a size without
 * pictures (lib/pack-venues.ts).
 */
export default function PackVenues({ dates }: { dates: number | undefined }) {
  const venues = dates ? packVenues(dates) : [];
  if (!venues.length) return null;
  if (venues.length <= 5) {
    return (
      <div className="pack-venues is-row" aria-hidden="true">
        <Tiles venues={venues} />
      </div>
    );
  }
  return (
    <div className="pack-venues is-ribbon" aria-hidden="true">
      <div className="pack-venues-track">
        <Tiles venues={venues} />
        <Tiles venues={venues} />
      </div>
    </div>
  );
}
