"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { requestJson } from "../request";
import type { OriginalityReport, SheetDraft } from "@/lib/originality";

/**
 * The review step's originality check (lib/originality.ts): a friendly "how distinct is this character" read,
 * with what to change. A nudge only — nothing here blocks creating or saving.
 */
export default function OriginalityPanel({ draft, characterId }: { draft: SheetDraft; characterId?: string }) {
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
  const tone = report.score >= 75 ? "high" : report.score >= 50 ? "mid" : "low";
  return (
    <section className={`originality originality-${tone}`} aria-live="polite">
      <p className="originality-head">
        <strong>Originality</strong> <span className="originality-score">{report.score}/100</span>
      </p>
      <div className="originality-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={report.score} aria-label="Originality">
        <span style={{ width: `${report.score}%` }} />
      </div>
      {report.similar.length > 0 && (
        <p className="small">
          Reads a lot like{" "}
          {report.similar.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link href={`/characters/${s.id}`} target="_blank">
                {s.name}
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
