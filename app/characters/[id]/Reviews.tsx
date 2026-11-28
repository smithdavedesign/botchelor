"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import { useT } from "@/app/I18nProvider";
import type { ReviewSummary } from "@/lib/reviews";

type Props = { characterId: string; name: string; initial: ReviewSummary; isOwner: boolean; house: boolean; open: boolean };

const starsText = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Reviews on a contestant card: the average, the latest lines, and your own (1 to 5 stars, an optional line). */
export default function Reviews({ characterId, name, initial, isOwner, house, open }: Props) {
  const [summary, setSummary] = useState(initial);
  const t = useT();
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
    setNote({ text: summary.mine ? t("Review updated.") : t("Thanks: review posted.") });
  }

  return (
    <div className="reviews">
      <p>
        {summary.count ? (
          <>
            <strong aria-label={t("{n} out of 5", { n: summary.average ?? 0 })}>{summary.average?.toFixed(1)} ★</strong>{" "}
            <span className="muted">
              {summary.count === 1 ? t("from 1 review") : t("from {n} reviews", { n: summary.count })}
            </span>
          </>
        ) : (
          <span className="muted">{t("No reviews yet.")}</span>
        )}
        {house && <span className="muted"> {t("Each month, the two best-reviewed of the season's house cast stay on for the next.")}</span>}
      </p>
      {summary.latest.length > 0 && (
        <ul className="review-list">
          {summary.latest.map((r, i) => (
            <li key={i}>
              <span aria-label={t("{n} out of 5", { n: r.stars })}>{starsText(r.stars)}</span> {r.body}
              <span className="muted small"> · {r.mine ? t("you") : r.via === "mcp" ? t("an agent") : t("a viewer")}</span>
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <p className="muted">{t("Others review your character: you can't review your own.")}</p>
      ) : !open ? (
        <p className="muted">{t("{name} isn't on this season's cast, so reviews are closed until they're back on the show.", { name: first })}</p>
      ) : (
        // Folded behind one line (UX audit 2026-10-23): the stars and the box were a big form even on a card with no reviews.
        <details className="review-write">
          <summary className="button-ghost small">{summary.mine ? `✏️ ${t("Edit your review")}` : `✍️ ${t("Write a review of {name}", { name: first })}`}</summary>
        <form className="review-form" onSubmit={submit}>
          <fieldset>
            <legend>{t("Your review of {name}", { name: first })}</legend>
            <div className="review-stars" role="radiogroup" aria-label={t("Stars")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={n <= stars ? "on" : undefined}>
                  <input type="radio" name="stars" value={n} checked={stars === n} onChange={() => setStars(n)} />
                  <span aria-hidden>★</span>
                  <span className="sr-only">
                    {n === 1 ? t("1 star") : t("{n} stars", { n })}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`review-${characterId}`}>{t("A line (optional)")}</label>
          <textarea id={`review-${characterId}`} value={body} maxLength={280} rows={2} onChange={(e) => setBody(e.target.value)} placeholder={t("What made {name} worth watching?", { name: first })} />
          <p>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t("Posting…") : summary.mine ? t("Update your review") : t("Post review")}
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
