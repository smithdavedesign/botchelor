import type { ReactNode } from "react";
import { venueBackdrop } from "@/lib/portraits";
import { venueBackdropCss } from "@/lib/venues";
import { showSetPath } from "@/lib/show-sets";

/**
 * A date's place as a picture (2026-11-08 UI audit, item 1: the episode tiles were blank gradients with two thumbnail
 * faces, while the episode page's own hero showed the venue's photo). The venue's reviewed backdrop (lib/portraits.ts),
 * loaded lazily, over the venue's gradient, which stays as the picture where a venue has no photo yet. A grade darkens
 * it toward the bottom (app/ux/catalog.css .venue-photo), so the faces and words laid on it read on any photo.
 *
 * A venue with no photo yet stands in front of the show's blind-date booth (lib/show-sets.ts), toned by the venue's own
 * gradient (app/ux/design-pass.css), so a shelf of them reads as a TV set, each in its own colour, not a row of blank
 * gradients (2026-11-28 design review, item 5).
 */
export default function VenuePhoto({
  venue,
  className,
  eager = false,
  children,
}: {
  venue: string | null | undefined;
  className?: string;
  /** The first screen's picture (the lead date): fetched at once rather than when it scrolls near. */
  eager?: boolean;
  children?: ReactNode;
}) {
  const photo = venue ? venueBackdrop(venue) : null;
  const src = photo ?? (venue ? showSetPath("booth") : null);
  return (
    <div className={className ? `venue-photo ${className}` : "venue-photo"} style={venue ? { backgroundImage: venueBackdropCss(venue) } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset (1024×576, ~40 KB); no loader needed */}
      {src && <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" data-set={photo ? undefined : "booth"} />}
      {children}
    </div>
  );
}
