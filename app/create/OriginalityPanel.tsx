"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { requestJson } from "../request";
import CharacterName from "../CharacterName";
import type { OriginalityReport, SheetDraft } from "@/lib/originality";

/**
 * The originality check (lib/originality.ts) as tips: characters this one reads like, and what to change. A nudge only:
 * nothing here blocks creating or saving. No score (David, 2026-11-20: a grade put people off making a character; the
 * score is our metadata, characters.originality_score). Shown on review for a second character on, on an edit, and on
 * a character's page once it has been on a date; never while someone makes their first. `quiet`: nothing at all when
 * there's nothing to change (the character page), rather than "nobody is quite like them".
 */
export default function OriginalityPanel({ draft, characterId, quiet = false, title = "Make them stand out" }: { draft: SheetDraft; characterId?: string; quiet?: boolean; title?: string }) {
  const [report, setReport] = useState<OriginalityReport | null>(null);
  const key = JSON.stringify(draft);

  useEffect(() => {
    let live = true;
    requestJson("/api/characters/originality", { ...draft, ...(characterId ? { character_id: characterId } : {}) })
      .then(({ ok, data }) => {
        if (live && ok) setReport(data as unknown as OriginalityReport);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, characterId]);

  if (!report) return null;
  if (quiet && report.tips.length === 0 && report.similar.length === 0) return null;
  return (
    <section className="originality" aria-live="polite" data-originality>
      <p className="originality-head">
        <strong>{title}</strong>
      </p>
      {report.similar.length > 0 && (
        <p className="small">
          Reads a lot like{" "}
          {report.similar.filter((s, i, all) => all.findIndex((o) => o.name === s.name) === i).map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              {/* A new tab, so the wizard (and an unsaved edit) stays where it was. */}
              <Link href={`/characters/${s.id}`} target="_blank">
                <CharacterName character={s} link={false} size={20} />
              </Link>
            </span>
          ))}
          .
        </p>
      )}
      {report.tips.length > 0 ? (
        <ul className="list small">
          {report.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Nobody else on the show is quite like them.</p>
      )}
      <p className="muted small">Just a nudge: it never changes how a date ends, and nobody else sees it.</p>
    </section>
  );
}
