"use client";

import { venueBackdrop } from "@/lib/portraits";
import { venue, venueBackdropCss, type VenueId } from "@/lib/venues";

/**
 * Where to play a scene: the show's places (lib/venues.ts), each on its own backdrop, the one you're at marked. Any
 * stage that lets the person pick a place uses it (companions first).
 */
export default function PlacePicker({
  places,
  current,
  onPick,
  onClose,
  busy,
  title = "Where are you two?",
}: {
  places: readonly VenueId[];
  current: VenueId | null;
  onPick: (place: VenueId) => void;
  onClose: () => void;
  busy: boolean;
  title?: string;
}) {
  return (
    <section className="place-picker" aria-label={title}>
      <header className="place-picker-head">
        <h2>{title}</h2>
        <button type="button" className="button-ghost small" onClick={onClose}>
          Cancel
        </button>
      </header>
      <ul className="place-grid">
        {places.map((id) => {
          const photo = venueBackdrop(id);
          return (
            <li key={id}>
              <button
                type="button"
                className={`place-tile${current === id ? " on" : ""}`}
                style={{ background: venueBackdropCss(id) }}
                onClick={() => onPick(id)}
                disabled={busy || current === id}
                aria-pressed={current === id}
                data-place={id}
              >
                {photo && <img src={photo} alt="" loading="lazy" decoding="async" />}
                <span>{venue(id).name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
