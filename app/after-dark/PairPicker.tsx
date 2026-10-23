"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CharacterName from "@/app/CharacterName";

type Pair = { a: { id: string; name: string }; b: { id: string; name: string }; lines: number; path: string };

/** How many new pairs show before "Show all": a screenful, not the whole cast squared. */
const FIRST = 8;

const first = (n: string) => n.split(/\s+/)[0];

/** One pair: both faces and names as one link to its scene, the × and the lines badge outside the link's underline. */
function PairRow({ p }: { p: Pair }) {
  return (
    <li className="card ad-pair">
      <Link href={p.path} className="ad-pair-link">
        <CharacterName character={p.a} link={false} strong />
        <span className="ad-pair-x" aria-hidden="true">
          ×
        </span>
        <span className="sr-only"> and </span>
        <CharacterName character={p.b} link={false} strong />
      </Link>
      {p.lines > 0 && <span className="badge">{p.lines} lines</span>}
    </li>
  );
}

/**
 * The hub's scenes (UX audit 2026-10-23: every cast pair was one 10,000px list): the pairs that already have lines under
 * Continue, all of them, then a new pair picked by its first character (a face each), or the first few with the rest
 * behind "Show all". The first `li.card a` on the page is always a scene (scripts/e2e-after-dark.mjs opens it).
 */
export default function PairPicker({ pairs }: { pairs: Pair[] }) {
  const [who, setWho] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const going = pairs.filter((p) => p.lines > 0);
  const fresh = pairs.filter((p) => p.lines === 0);
  // Everyone in a pair, once each, by name.
  const cast = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const p of pairs) for (const c of [p.a, p.b]) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [pairs]);
  const picked = cast.find((c) => c.id === who) ?? null;
  // A picked character's pairs, all of them (the ones with lines keep their badge); else the new pairs, a few at a time.
  const shown = picked ? pairs.filter((p) => p.a.id === picked.id || p.b.id === picked.id) : all ? fresh : fresh.slice(0, FIRST);

  return (
    <>
      {going.length > 0 && (
        <>
          <h3 className="ad-hub-sub">Continue</h3>
          <ul className="list ad-pairs">
            {going.map((p) => (
              <PairRow key={p.path} p={p} />
            ))}
          </ul>
        </>
      )}
      {fresh.length > 0 && (
        <>
          <h3 className="ad-hub-sub">{going.length ? "Start a new pair" : "Pick a pair"}</h3>
          <div className="ad-cast-chips" role="group" aria-label="Pick one of them to see their pairs">
            {cast.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`ad-cast-chip${who === c.id ? " on" : ""}`}
                aria-pressed={who === c.id}
                title={c.name}
                onClick={() => setWho(who === c.id ? null : c.id)}
              >
                <CharacterName character={c} label={first(c.name)} link={false} size={26} />
              </button>
            ))}
          </div>
          {picked && (
            <p className="muted small">
              Everyone with <CharacterName character={picked} link={false} size={18} />.{" "}
              <button type="button" className="link-button" onClick={() => setWho(null)}>
                Clear
              </button>
            </p>
          )}
          <ul className="list ad-pairs">
            {shown.map((p) => (
              <PairRow key={p.path} p={p} />
            ))}
          </ul>
          {!picked && fresh.length > FIRST && (
            <p>
              <button type="button" className="button-ghost small" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : `Show all ${fresh.length} pairs`}
              </button>
            </p>
          )}
        </>
      )}
    </>
  );
}
