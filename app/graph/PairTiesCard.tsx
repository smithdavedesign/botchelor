import { Fragment } from "react";
import Link from "next/link";
import { evidenceLink, evidenceLinks, type EvidenceLink } from "@/lib/social/evidence";
import { pairDate, pairHistory, pairRows, sharedWords } from "@/lib/social/pair-words";
import type { PairTies } from "@/lib/social/types";
import LineSwatch from "./LineSwatch";

type Props = {
  pair: PairTies;
  /** The seasons whose pages are up (lib/season-ref.ts closedSeasons): a season's evidence links only to those. */
  closedSeasons: ReadonlySet<string>;
  /** Where the dating is already told (Love's panel, the couple page): leave the "dated on the show" row out. */
  skipDated?: boolean;
  /** The card's title level: a section of a page (h2) or of a panel (h3). */
  level?: 2 | 3;
  /** Classes beside its own: the couple page frames it as a card. */
  className?: string;
};

/** "22 Nov": the day a piece of evidence is from, for telling two of a kind apart. */
const dayMonth = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Evidence({ links }: { links: EvidenceLink[] }) {
  if (!links.length) return null;
  // Two links with the same words read as a stutter, "the scene the scene" (the 2026-11-22 audit): each says its day,
  // and a dot sits between them.
  const twice = new Set(links.map((e) => e.label).filter((label, i, all) => all.indexOf(label) !== i));
  const words = (e: EvidenceLink) => (twice.has(e.label) ? `${e.label}, ${dayMonth(e.at)}` : e.label);
  return (
    <span className="pair-ties-links">
      {links.map((e, i) => (
        <Fragment key={e.href ?? `${e.label}:${e.at}`}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {e.href ? (
            <Link href={e.href} className="tap-link">
              {words(e)}
            </Link>
          ) : (
            <span className="muted">{words(e)}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Everything between two characters (docs/PRDs/social-network.md section 9's pair panel; lib/social/read.ts pairTies):
 * each tie across the layers, still on or over, with what made it (the date, the scene, the night), the places they
 * share, and their history under a fold. No state, so a server page (the couple page) and the Constellation's panels
 * (app/graph/PairTiesPanel.tsx fetches it) draw it alike. Nothing when there's nothing beyond what the caller tells.
 */
export default function PairTiesCard({ pair, closedSeasons, skipDated = false, level = 3, className }: Props) {
  const rows = pairRows(pair).filter((r) => !(skipDated && r.kind === "dated"));
  const shared = sharedWords(pair.shared);
  if (!rows.length && !shared.length) return null;
  const moments = pairHistory(pair).filter((m) => !(skipDated && m.kind === "dated"));
  const Title = level === 2 ? "h2" : "h3";
  const titleId = `between-${pair.a.id}-${pair.b.id}`;
  return (
    <section className={className ? `pair-ties ${className}` : "pair-ties"} aria-labelledby={titleId}>
      <Title className="pair-ties-title" id={titleId}>
        Everything between them
      </Title>
      {rows.length > 0 && (
        <ul className="list pair-ties-list small">
          {rows.map((r) => (
            <li key={r.id} className={r.over ? "pair-tie is-over" : "pair-tie"}>
              <LineSwatch social={r.style} sour={r.sour} />
              {/* What it is, then when and what made it: the second part wraps under the first as one piece. */}
              <span className="pair-tie-body">
                <span className="pair-tie-words">{r.words}</span>
                <span className="pair-tie-meta">
                  {r.when && <span className="muted">{r.over ? `${r.when} (over)` : r.when}</span>}
                  <Evidence links={evidenceLinks(r.evidence, { limit: 2, closedSeasons })} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {shared.length > 0 && <p className="small pair-ties-shared">{shared.join(" · ")}</p>}
      {moments.length > 0 && (
        <details className="ux-fold pair-ties-history">
          <summary className="small">
            Their history <span className="muted">({moments.length})</span>
          </summary>
          <ol className="list small">
            {moments.map((m, i) => {
              const link = m.ref ? evidenceLink(m.ref, m.at, { closedSeasons }) : null;
              return (
                <li key={`${m.at}:${i}`}>
                  <span className="muted">{pairDate(m.at)}</span> <LineSwatch social={m.style} /> {m.words} <span className="muted">· {m.tag}</span>
                  {link && (
                    <>
                      {" "}
                      <Evidence links={[link]} />
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
