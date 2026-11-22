import HomeClip from "@/app/HomeClip";
import { PROMO } from "@/lib/promo-videos";

/**
 * The show's own ad in the home clip's phone (app/HomeClip.tsx, lib/promo-videos.ts PROMO.homeLoop): what home plays to a
 * stranger when nothing has aired to show, here for a page's title band (app/SetHero.tsx). Static, so the pages that carry
 * it (the switching landings, /import, /press) stay as cacheable as they were. Same rules: poster first, muted, looping,
 * never sound, a still for reduced motion and Save-Data.
 */
export default function ShowClip({
  track,
  // Not "Tonight": it's the same ad every day (2026-11-22 audit).
  kicker = "From the show",
  watchHref = "/watch",
  watchLabel = "Watch episodes",
}: {
  /** The data-track prefix of its play and watch buttons, the page's own ("press-clip" sends press-clip-watch). */
  track: string;
  kicker?: string;
  watchHref?: string;
  watchLabel?: string;
}) {
  const v = PROMO.homeLoop;
  return (
    <HomeClip
      loopSrc={v.src}
      posterSrc={v.poster}
      width={v.width}
      height={v.height}
      watchHref={watchHref}
      caption="Juniper Vale × Nell Abiodun · How does it end?"
      kicker={kicker}
      watchLabel={watchLabel}
      track={track}
    />
  );
}
