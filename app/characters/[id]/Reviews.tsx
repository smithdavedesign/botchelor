"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import type { ReviewSummary } from "@/lib/reviews";

type Props = { characterId: string; name: string; initial: ReviewSummary; isOwner: boolean; house: boolean; open: boolean };

const starsText = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Reviews on a contestant card: the average, the latest lines, and your own (1 to 5 stars, an optional line). */
export default function Reviews({ characterId, name, initial, isOwner, house, open }: Props) {
  const [summary, setSummary] = useState(initial);
  const [stars, setStars] = useState(initial.mine?.stars ?? 0);
  const [body, setBody] = useState(initial.mine?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const first = name.split(/\s+/)[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stars) return setNote({ text: "Pick 1 to 5 stars first.", error: true });
    setBusy(true);
    setNote(null);
    const res = await requestJson(`/api/characters/${characterId}/reviews`, { stars, ...(body.trim() ? { body: body.trim() } : {}) });
    setBusy(false);
    if (!res.ok) return setNote({ text: res.message, error: true });
    setSummary(res.data.reviews as ReviewSummary);
    setNote({ text: summary.mine ? "Review updated." : "Thanks: review posted." });
  }

  return (
    <div className="reviews">
      <p>
        {summary.count ? (
          <>
            <strong aria-label={`${summary.average} out of 5`}>{summary.average?.toFixed(1)} ★</strong>{" "}
            <span className="muted">
              from {summary.count} review{summary.count === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <span className="muted">No reviews yet.</span>
        )}
        {house && <span className="muted"> Each month, the two best-reviewed of the season&apos;s house cast stay on for the next.</span>}
      </p>
      {summary.latest.length > 0 && (
        <ul className="review-list">
          {summary.latest.map((r, i) => (
            <li key={i}>
              <span aria-label={`${r.stars} out of 5`}>{starsText(r.stars)}</span> {r.body}
              <span className="muted small"> · {r.mine ? "you" : r.via === "mcp" ? "an agent" : "a viewer"}</span>
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <p className="muted">Others review your character: you can&apos;t review your own.</p>
      ) : !open ? (
        <p className="muted">{first} isn&apos;t on this season&apos;s cast, so reviews are closed until they&apos;re back on the show.</p>
      ) : (
        // Folded behind one line (UX audit 2026-10-23): the stars and the box were a big form even on a card with no reviews.
        <details className="review-write">
          <summary className="button-ghost small">{summary.mine ? "✏️ Edit your review" : `✍️ Write a review of ${first}`}</summary>
        <form className="review-form" onSubmit={submit}>
          <fieldset>
            <legend>Your review of {first}</legend>
            <div className="review-stars" role="radiogroup" aria-label="Stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={n <= stars ? "on" : undefined}>
                  <input type="radio" name="stars" value={n} checked={stars === n} onChange={() => setStars(n)} />
                  <span aria-hidden>★</span>
                  <span className="sr-only">
                    {n} star{n === 1 ? "" : "s"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`review-${characterId}`}>A line (optional)</label>
          <textarea id={`review-${characterId}`} value={body} maxLength={280} rows={2} onChange={(e) => setBody(e.target.value)} placeholder={`What made ${first} worth watching?`} />
          <p>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Posting…" : summary.mine ? "Update your review" : "Post review"}
            </button>
          </p>
          {note && (
            <p className={note.error ? "error" : "muted small"} role={note.error ? "alert" : "status"}>
              {note.text}
            </p>
          )}
        </form>
        </details>
      )}
    </div>
  );
}
