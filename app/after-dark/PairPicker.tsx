"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CharacterName from "@/app/CharacterName";
import type { CastPair } from "@/lib/adult/scenes";

type Who = { id: string; name: string; photo?: string | null };
type Pair = CastPair;

const first = (n: string) => n.split(/\s+/)[0];

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * One night under way, as a card to pick up again (the audit, 2026-10-29): both faces (the ones kept for this viewer, so
 * behind the privacy blur when it's on), the night's last line, its chapter and when it was played.
 */
function PairRow({ p, now }: { p: Pair; now: number | null }) {
  // "6 min ago" only once in the browser: the server's clock and the browser's differ, and React won't hydrate a mismatch.
  const meta = [p.chapter && p.chapter > 1 ? `Chapter ${p.chapter}` : "", p.lines > 0 ? `${p.lines} lines` : "", now ? ago(p.updated_at, now) : ""].filter(Boolean).join(" · ");
  return (
    <li className="card ad-pair">
      <Link href={p.path} className="ad-pair-link">
        <span className="ad-pair-faces" aria-hidden="true">
          <CharacterName character={p.a} label="" link={false} size={40} />
          <CharacterName character={p.b} label="" link={false} size={40} />
        </span>
        <span className="ad-pair-body">
          <span className="ad-pair-names">
            <strong>{first(p.a.name)}</strong>
            <span className="ad-pair-x" aria-hidden="true">
              {" "}×{" "}
            </span>
            <span className="sr-only"> and </span>
            <strong>{first(p.b.name)}</strong>
          </span>
          {p.last && (
            <span className="ad-pair-last muted small">
              {p.last.who}: “{p.last.text}”
            </span>
          )}
          {meta && <span className="ad-pair-meta muted small">{meta}</span>}
          {/* #1132: one of the two has left the cast since; the pair stays theirs, and says which month it's from. */}
          {p.earlier && (
            <span className="ad-pair-earlier muted small" data-earlier-cast="true">
              🗓 {p.earlier}
            </span>
          )}
        </span>
      </Link>
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
 * second and the way in shows. Start over clears either pick and brings every face back. A pair kept from an earlier
 * cast (#1132) is only under Continue: who left the cast isn't a face to start a new pair with.
 *
 * data-first-scene: the first pair's scene, for the screenshot scripts (they open a scene without picking).
 */
export default function PairPicker({ pairs }: { pairs: Pair[] }) {
  const [one, setOne] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const [two, setTwo] = useState<string | null>(null);
  // Under way (lines, or a chapter filed, or kept from an earlier cast), the latest played first.
  const going = pairs.filter((p) => p.earlier || p.lines > 0 || (p.chapter ?? 1) > 1).sort((x, y) => (y.updated_at ?? "").localeCompare(x.updated_at ?? ""));
  // The pairs a new one is picked from: this season's (a kept pair is under Continue only).
  const open = useMemo(() => pairs.filter((p) => !p.earlier), [pairs]);
  // Everyone in a pair, once each, by name.
  const cast = useMemo(() => {
    const seen = new Map<string, Who>();
    for (const p of open) for (const c of [p.a, p.b]) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [open]);
  const pairOf = (x: string, y: string) => open.find((p) => (p.a.id === x && p.b.id === y) || (p.a.id === y && p.b.id === x)) ?? null;
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
              <PairRow key={p.path} p={p} now={now} />
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
                    {chosen.lines > 0 || (chosen.chapter ?? 1) > 1 ? "Continue" : "Start"} {first(chosen.a.name)} × {first(chosen.b.name)}
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
