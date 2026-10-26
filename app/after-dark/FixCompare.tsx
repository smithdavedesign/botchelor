"use client";

import { useState } from "react";

/**
 * Before and after, one over the other (Fix faces, app/after-dark/FixFaces.tsx): slide to see how much of each. A range
 * input, so keys and screen readers move it too. No filters or animations: discreet mode's blur stays as it is.
 */
export default function FixCompare({ before, after, label }: { before: string; after: string; label: string }) {
  const [at, setAt] = useState(50);
  return (
    <figure className="ad-compare">
      <div className="ad-compare-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
        <img src={after} alt={`${label}, with the faces fixed`} />
        {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
        <img src={before} alt={`${label}, as it was`} className="ad-compare-before" style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }} />
        <span className="ad-compare-line" style={{ left: `${at}%` }} aria-hidden="true" />
        <span className="ad-compare-tag before">Before</span>
        <span className="ad-compare-tag after">After</span>
      </div>
      <input type="range" min={0} max={100} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label="Before and after: slide to compare" />
    </figure>
  );
}
