"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The whole portrait, not a small copy: those are square crops (app/api/assets/[id]/route.ts) and would cut the figure
 * off at the chest. A served asset drops the CDN's .webp and its ?w=; a house file (/cast/…) is already the right size.
 */
export function fullPortrait(portrait: string | null | undefined): string | null {
  if (!portrait) return null;
  const path = portrait.split("?")[0];
  return path.startsWith("/api/assets/") ? path.replace(/\.webp$/, "") : path;
}

/**
 * The character standing beside a one-to-one scene, as joi.com's chat stands its character on the right
 * (docs/audits/2026-11-20-joi-teardown.md): their portrait with the background taken out (lib/cutout.ts) when the
 * server has one to offer, else the portrait itself with its edges faded into the night. Where it stands (beside the
 * text on a wide screen, behind it on a phone) is the page's CSS; this is only the picture.
 *
 * The portrait is the show's own PG one (`portraitPathSql`), so it's marked .avatar: After Dark's discreet blur leaves
 * the show's portraits alone (app/after-dark/discreet.css). Decorative: the scene names the character in words.
 * A cutout that doesn't load falls back to the portrait, and a portrait that doesn't load takes the figure away,
 * including a failure that happened before the page came alive (checked once on mount, when onError can't have run).
 */
export default function CharacterFigure({ portrait, cutout, className = "" }: { portrait: string | null; cutout: string | null; className?: string }) {
  const [cutFailed, setCutFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const cut = Boolean(cutout) && !cutFailed;
  const src = cut ? cutout : fullPortrait(portrait);
  const failed = () => (cut ? setCutFailed(true) : setGone(true));

  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) failed();
    // Only for the picture shown at mount and after each switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  if (!src || gone) return null;
  return (
    <div className={`character-figure ${className}`.trim()} data-figure={cut ? "cutout" : "portrait"} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- a served portrait or Cloudflare's cutout, already sized */}
      <img ref={img} key={src} className="avatar character-figure-img" src={src} alt="" decoding="async" onError={failed} />
    </div>
  );
}
