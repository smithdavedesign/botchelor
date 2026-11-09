import type { ReactNode } from "react";
import { venueBackdrop } from "@/lib/portraits";
import { venueBackdropCss } from "@/lib/venues";

/**
 * A date's place as a picture (2026-11-08 UI audit, item 1: the episode tiles were blank gradients with two thumbnail
 * faces, while the episode page's own hero showed the venue's photo). The venue's reviewed backdrop (lib/portraits.ts),
 * loaded lazily, over the venue's gradient, which stays as the picture where a venue has no photo yet. A grade darkens
 * it toward the bottom (app/ux/catalog.css .venue-photo), so the faces and words laid on it read on any photo.
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
  const src = venue ? venueBackdrop(venue) : null;
  return (
    <div className={className ? `venue-photo ${className}` : "venue-photo"} style={venue ? { backgroundImage: venueBackdropCss(venue) } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset (1024×576, ~40 KB); no loader needed */}
      {src && <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" />}
      {children}
    </div>
  );
}
