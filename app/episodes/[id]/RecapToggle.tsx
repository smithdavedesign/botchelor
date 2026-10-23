import type { ReactNode } from "react";

export const RECAP_TOGGLE_LABEL = "Show the written recap (it gives away the ending)";
/** What the summary says once it's open (a plain <details>, so CSS swaps the two by [open]). */
export const RECAP_TOGGLE_HIDE_LABEL = "Hide the written recap";

/**
 * The written recap and every ending reveal (the scenes, twist, finale, "Ending: …", the drama answer, the box
 * score and its "why"), folded away when the date has a theater to watch it in, so the page never spoils what the
 * theater plays. Closed by default, a plain <details> (no JS). Without a transcript there's nothing to watch, so the
 * recap stays open as it always was.
 */
export default function RecapToggle({ hasTheater, children }: { hasTheater: boolean; children: ReactNode }) {
  if (!hasTheater) return <>{children}</>;
  return (
    <details className="recap-toggle">
      <summary>
        <span className="recap-toggle-show">{RECAP_TOGGLE_LABEL}</span>
        <span className="recap-toggle-hide">{RECAP_TOGGLE_HIDE_LABEL}</span>
      </summary>
      <div className="recap-toggle-body">{children}</div>
    </details>
  );
}
