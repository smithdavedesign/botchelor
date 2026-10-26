"use client";

import type { Eyes, FramingBadge, MenuAct } from "@/lib/adult/acts";

/** How a framing has done (lib/adult/framing.ts), as the chip says it: ★ works well, or Experimental. */
export function FramingMark({ badge }: { badge: FramingBadge | undefined }) {
  if (badge === "works") return <span className="ad-framing-works" title="Comes out well">★</span>;
  if (badge === "experimental") return <span className="ad-framing-experimental" title="Often comes out wrong: worth a try, but expect a redraw">Experimental</span>;
  return null;
}

/** An act's mark on its chip: ★ when any view of it works well, Experimental when both in frame doesn't and nothing does. */
export const actMark = (a: MenuAct): FramingBadge => (a.badge === "works" || a.views?.some((v) => v.badge === "works") ? "works" : a.badge === "experimental" ? "experimental" : null);

/**
 * The view an act opens on: first person when one of its views works well and both in frame doesn't (2026-10-26: "POV
 * shots" come out better than the two of them for some acts), else both in frame.
 */
export function openingView(a: MenuAct): { eyes: Eyes | null; swapped: boolean } {
  const best = a.badge === "works" ? null : a.views?.find((v) => v.badge === "works");
  return best ? { eyes: best.eyes, swapped: best.swapped } : { eyes: null, swapped: false };
}

/**
 * Whose view (David, 2026-10-26: "generating people together is way harder than POV shots"): both of them in frame, or
 * seen through one of their eyes, each with how it comes out. Only when the act has a first-person view.
 */
export function ViewChips({ act, eyes, onPick }: { act: MenuAct; eyes: Eyes | null; onPick: (eyes: Eyes | null, swapped: boolean) => void }) {
  if (!act.views?.length) return null;
  return (
    <div className="ad-chip-row" role="radiogroup" aria-label="Whose view">
      <button type="button" role="radio" aria-checked={eyes === null} className={`ad-chip${eyes === null ? " on" : ""}`} onClick={() => onPick(null, false)}>
        👥 Both in frame
        <FramingMark badge={act.badge} />
      </button>
      {act.views.map((v) => (
        <button key={v.eyes} type="button" role="radio" aria-checked={eyes === v.eyes} className={`ad-chip${eyes === v.eyes ? " on" : ""}`} onClick={() => onPick(v.eyes, v.swapped)}>
          👁 {v.label}
          <FramingMark badge={v.badge} />
        </button>
      ))}
    </div>
  );
}

