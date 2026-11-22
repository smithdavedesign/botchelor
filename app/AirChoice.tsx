"use client";

/**
 * Where a date goes once it's filmed, said before the date is spent (2026-11-22 audit): on the show for anyone to watch
 * by default (David's call: dates air), or private with one tick. Until now only the builder's review said so, in small
 * print. Ticked, the booking sends `visibility: "private"` (app/api/episodes: a private date never airs and stays out of
 * every public count); either way its host can change it later on the date's own page.
 */
export default function AirChoice({ keepPrivate, onChange, disabled = false }: { keepPrivate: boolean; onChange: (keep: boolean) => void; disabled?: boolean }) {
  return (
    <div className="air-choice" data-air={keepPrivate ? "private" : "public"}>
      <p className="small air-choice-note" aria-live="polite">
        {keepPrivate ? "🔒 Private: only you can watch it, and it stays off the air." : "📺 It airs on the show: anyone can watch it."}
      </p>
      <label className="check small air-choice-toggle">
        <input type="checkbox" checked={keepPrivate} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-track="date-keep-private" />
        Keep it private
      </label>
    </div>
  );
}
