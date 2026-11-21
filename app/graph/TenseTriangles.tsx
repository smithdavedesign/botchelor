"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { closedSeasons } from "@/lib/season-ref";
import { evidenceLinks } from "@/lib/social/evidence";
import { TIE_KINDS } from "@/lib/social/kinds";
import { kindPairWords, styleOf } from "@/lib/social/lenses";
// Types only: lib/social/tense.ts reads the database, and this runs in the browser.
import type { TenseHook, TenseSide, TenseSky } from "@/lib/social/tense";
import LineSwatch from "./LineSwatch";

type Names = Record<string, string>;

/** A name, linked to their world. */
function Who({ id, names }: { id: string; names: Names }) {
  return (
    <Link href={`/graph/world/${encodeURIComponent(id)}`} className="tense-name">
      {names[id] ?? "someone"}
    </Link>
  );
}

/** "Cal", "Cal and Dee", "Cal, Dee and Eve", "Cal, Dee, Eve, Fay and 3 more": each name linked. */
function Thirds({ ids, more, names }: { ids: readonly string[]; more: number; names: Names }) {
  const parts = ids.map((id) => <Who key={id} id={id} names={names} />);
  const all: ReactNode[] = more > 0 ? [...parts, <span key="more">{more} more</span>] : parts;
  return (
    <>
      {all.map((p, i) => (
        <span key={i}>
          {i === 0 ? "" : i === all.length - 1 ? " and " : ", "}
          {p}
        </span>
      ))}
    </>
  );
}

/** A sour side: its line's swatch, the two (on a three-way hook, where the card doesn't already say), what's between
 * them and what made it. */
function Side({ s, named, names, seasons }: { s: TenseSide; named: boolean; names: Names; seasons: ReadonlySet<string> }) {
  const kind = s.kinds[0];
  const def = kind ? TIE_KINDS[kind] : null;
  const links = evidenceLinks(s.evidence, { limit: 2, closedSeasons: seasons });
  return (
    <li className="tense-side">
      {kind && def && <LineSwatch social={styleOf(kind, def.layer, s.sign)} sour={s.sign < 0} />}
      <span className="tense-side-body">
        {named && (
          <span>
            <Who id={s.a} names={names} /> × <Who id={s.b} names={names} />
          </span>
        )}
        <span className="muted">{s.kinds.map(kindPairWords).join(" · ") || "at odds"}</span>
        {links.map((e) =>
          e.href ? (
            <Link key={e.href} href={e.href} className="tap-link">
              {e.label}
            </Link>
          ) : (
            <span key={`${e.label}:${e.at}`} className="muted">
              {e.label}
            </span>
          ),
        )}
      </span>
    </li>
  );
}

function Hook({ h, names, seasons }: { h: TenseHook; names: Names; seasons: ReadonlySet<string> }) {
  // Two who both dated the same people is the show's own kind of triangle, so it says so.
  const both = h.warm.length && h.warm.every((k) => k === "dated") ? "both dated" : "both are close to";
  return (
    <li className="card tense-triangle">
      <p className="tense-hook">
        {h.shape === "three" ? (
          <>
            <Who id={h.a} names={names} />, <Who id={h.b} names={names} /> and <Who id={h.about[0]} names={names} /> are all at odds.
          </>
        ) : (
          <>
            <Who id={h.a} names={names} /> and <Who id={h.b} names={names} /> are at odds, and {both} <Thirds ids={h.about} more={h.more} names={names} />.
          </>
        )}
      </p>
      <ul className="list tense-sides small">
        {h.sides.map((s) => (
          <Side key={`${s.a}~${s.b}`} s={s} named={h.shape === "three"} names={names} seasons={seasons} />
        ))}
      </ul>
    </li>
  );
}

/**
 * Tense triangles (docs/PRDs/social-network.md section 9, Phase 3): the public network's unbalanced triangles under the
 * Constellation, as story hooks. Fetched from /api/graph/tense when the section nears the screen, so it adds nothing to
 * /graph's first load; each name links to their world and each side to what made it.
 */
export default function TenseTriangles() {
  const ref = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const [got, setGot] = useState<TenseSky | null | "error" | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    fetch("/api/graph/tense")
      .then((r) => (r.ok ? (r.json() as Promise<TenseSky>) : null))
      .catch(() => "error" as const)
      .then((data) => {
        if (live) setGot(data);
      });
    return () => {
      live = false;
    };
  }, [near]);
  const seasons = new Set(closedSeasons().map((s) => s.id));
  return (
    <section ref={ref} className="constellation-tense" aria-labelledby="tense-title">
      <h2 id="tense-title">Tense triangles</h2>
      <p className="muted small">
        Where the network can&apos;t stay as it is: two at odds who are both close to someone, or three all at odds. Something has to give. From the public record only.
      </p>
      {got === undefined ? (
        <p className="muted small">Loading…</p>
      ) : got === "error" ? (
        <p className="muted small">The triangles didn&apos;t load. Try again in a minute.</p>
      ) : !got || !got.hooks.length ? (
        <p className="muted small">No tense triangles yet. One appears when two characters at odds share a friend, a relative or a coworker.</p>
      ) : (
        <>
          <p className="small">
            <strong>{got.unbalanced}</strong> of {got.unbalanced + got.balanced} triangles are tense.{got.groups > got.hooks.length ? " The ones that moved most recently:" : ""}
          </p>
          <ol className="list tense-list">
            {got.hooks.map((h) => (
              <Hook key={h.key} h={h} names={got.names} seasons={seasons} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
