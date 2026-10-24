"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CharacterName from "@/app/CharacterName";

type Who = { id: string; name: string };
type Pair = { a: Who; b: Who; lines: number; path: string };

const first = (n: string) => n.split(/\s+/)[0];

/** One pair already under way: both faces and names as one link to its scene, the lines badge outside its underline. */
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

/** A face to pick: on (picked) or not. */
function Face({ c, on, onPick }: { c: Who; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`ad-cast-chip${on ? " on" : ""}`} aria-pressed={on} title={c.name} onClick={onPick}>
      <CharacterName character={c} label={first(c.name)} link={false} size={26} />
    </button>
  );
}

/**
 * The hub's scenes. The pairs under way are listed under Continue. A new pair is picked by faces, not a list (David,
 * 2026-10-24: the long list of every pair): everyone's face; pick one and only those they can pair with show; pick the
 * second and the way in shows. Start over clears either pick and brings every face back.
 *
 * data-first-scene: the first pair's scene, for the screenshot scripts (they open a scene without picking).
 */
export default function PairPicker({ pairs }: { pairs: Pair[] }) {
  const [one, setOne] = useState<string | null>(null);
  const [two, setTwo] = useState<string | null>(null);
  const going = pairs.filter((p) => p.lines > 0);
  // Everyone in a pair, once each, by name.
  const cast = useMemo(() => {
    const seen = new Map<string, Who>();
    for (const p of pairs) for (const c of [p.a, p.b]) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [pairs]);
  const pairOf = (x: string, y: string) => pairs.find((p) => (p.a.id === x && p.b.id === y) || (p.a.id === y && p.b.id === x)) ?? null;
  const picked = cast.find((c) => c.id === one) ?? null;
  // Those the first pick can pair with: everyone they have a pair with.
  const partners = picked ? cast.filter((c) => c.id !== picked.id && pairOf(picked.id, c.id)) : [];
  const second = partners.find((c) => c.id === two) ?? null;
  const chosen = picked && second ? pairOf(picked.id, second.id) : null;
  const startOver = () => {
    setOne(null);
    setTwo(null);
  };

  return (
    <div className="ad-pair-picker" data-first-scene={pairs[0]?.path ?? ""}>
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
      {cast.length > 0 && (
        <>
          <h3 className="ad-hub-sub">{going.length ? "Start a new pair" : "Pick a pair"}</h3>
          {!picked ? (
            <>
              <p className="muted small">Pick someone, then who they&apos;re with.</p>
              <div className="ad-cast-chips" role="group" aria-label="Pick the first of the two">
                {cast.map((c) => (
                  <Face key={c.id} c={c} on={false} onPick={() => setOne(c.id)} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="ad-pair-picked">
                <Face c={picked} on onPick={startOver} />
                <span className="ad-pair-x" aria-hidden="true">
                  ×
                </span>
                {second ? <Face c={second} on onPick={() => setTwo(null)} /> : <span className="muted small">who?</span>}
                <button type="button" className="link-button" onClick={startOver}>
                  Start over
                </button>
              </div>
              {!second && (
                <div className="ad-cast-chips" role="group" aria-label={`Pick who ${first(picked.name)} is with`}>
                  {partners.map((c) => (
                    <Face key={c.id} c={c} on={false} onPick={() => setTwo(c.id)} />
                  ))}
                </div>
              )}
              {chosen && (
                <p className="ad-pair-go">
                  <Link className="button primary" href={chosen.path}>
                    {chosen.lines > 0 ? "Continue" : "Start"} {first(chosen.a.name)} × {first(chosen.b.name)}
                  </Link>
                  {chosen.lines > 0 && <span className="badge">{chosen.lines} lines</span>}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
