"use client";

import { historyDestination, historyFailureLine, historyRetryable, HISTORY_ITEM_MAX, type HistoryFailure, type HistoryItem } from "@/lib/import-history";

/** One line of the checklist: what the reader wrote, what the person made of it, and whether it comes. */
export type HistoryRow = HistoryItem & { original: string; keep: boolean; error: string | null };

/**
 * "What they bring" (lib/import-history.ts): the reader's lines as a checklist, shown in place of the form once a
 * history was read. Each line can be unticked or reworded, and says where it would go; nothing is saved until the
 * button, and Skip opens the builder with the character alone. A failed or empty reading shows here too, one press from
 * the builder, so a history never stands between someone and their import.
 *
 * Everything inside is [data-private]: the engagement beacon (app/engagement.ts) records no click or label from it.
 */
export default function HistoryReview({
  name,
  rows,
  setRows,
  dropped,
  note,
  failure,
  existingVoice,
  busy,
  error,
  onKeep,
  onSkip,
  onBack,
  onRetry,
}: {
  name: string;
  rows: HistoryRow[];
  setRows: (next: HistoryRow[]) => void;
  /** Lines the reader offered that the show's rules left out (a count). */
  dropped: number;
  /** How much of a long paste was read. */
  note: string | null;
  failure: HistoryFailure | null;
  /** The voice the card itself gave, when it gave one: keeping a voice line replaces it. */
  existingVoice: string;
  busy: boolean;
  error: string | null;
  onKeep: () => void;
  onSkip: () => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  const first = name.trim().split(/\s+/)[0] || "your character";
  const kept = rows.filter((r) => r.keep).length;
  const patch = (i: number, change: Partial<HistoryRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));

  return (
    <section className="import-history-review" data-private aria-labelledby="import-history-title">
      <h2 id="import-history-title">{failure ? `${first} is ready` : `What ${first} brings`}</h2>
      {failure ? (
        <p role="status">{historyFailureLine(failure)}</p>
      ) : (
        <p className="muted">
          Untick anything that shouldn&apos;t come, and fix any line the reader got wrong. Nothing is saved until you press the
          button, and the paste itself is never kept.
        </p>
      )}
      {note && <p className="muted small">{note}</p>}

      {rows.length > 0 && (
        <ul className="import-history-list">
          {rows.map((r, i) => (
            <li key={i} className={r.keep ? "import-history-item" : "import-history-item is-off"}>
              <label className="import-history-keep">
                <input type="checkbox" name={`history_keep_${i}`} checked={r.keep} onChange={(e) => patch(i, { keep: e.target.checked, error: null })} />
                <span className="sr-only">Keep line {i + 1}</span>
              </label>
              <div className="import-history-body">
                <textarea
                  name={`history_text_${i}`}
                  rows={2}
                  maxLength={HISTORY_ITEM_MAX}
                  value={r.text}
                  aria-label={`Line ${i + 1}`}
                  aria-invalid={r.error ? true : undefined}
                  onChange={(e) => patch(i, { text: e.target.value.replace(/\n/g, " "), error: null })}
                />
                <p className="muted small import-history-where">
                  {r.label ? `${r.label} · ` : ""}Goes to {historyDestination(r.kind, name)}
                  {r.kind === "voice" && existingVoice ? `. Keeping it replaces the voice their card gave (“${existingVoice}”)` : ""}.
                </p>
                {r.error && (
                  <p className="import-error small" role="alert">
                    {r.error}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {dropped > 0 && (
        <p className="muted small">
          {dropped === 1 ? "One more line was" : `${dropped} more lines were`} left out: the show is PG, about fictional adults, and names no real people.
        </p>
      )}
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}

      <div className="import-actions">
        <button type="button" onClick={onKeep} disabled={busy}>
          {busy ? "Reading…" : kept > 0 ? `Keep ${kept} and open the builder` : "Open the builder"}
        </button>
        {failure && historyRetryable(failure) && (
          <button type="button" className="button-ghost" onClick={onRetry} disabled={busy}>
            Try once more
          </button>
        )}
        {kept > 0 && (
          <button type="button" className="link-button" onClick={onSkip} disabled={busy}>
            Skip their history
          </button>
        )}
        <button type="button" className="link-button" onClick={onBack} disabled={busy}>
          Back to the paste
        </button>
      </div>
    </section>
  );
}
