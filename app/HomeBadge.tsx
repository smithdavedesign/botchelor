"use client";

import { useState } from "react";

/**
 * A directory's badge on the home page (LaunchNest, Toolradar): their image, from their own site. If that site is slow
 * or down the link disappears instead of leaving a broken-image box on the home page (the 2026-11-27 UX pass, before
 * Product Hunt). Their listings check for the embed, so the markup stays theirs: a link around a plain img.
 */
export default function HomeBadge({ href, src, alt, width, height }: { href: string; src: string; alt: string; width: number; height: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a href={href} target="_blank" rel="noopener">
      {/* eslint-disable-next-line @next/next/no-img-element -- a third-party badge, served by the directory itself */}
      <img src={src} alt={alt} width={width} height={height} loading="lazy" onError={() => setFailed(true)} />
    </a>
  );
}
