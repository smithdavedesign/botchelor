import type { ReactNode } from "react";

export const SHOW_SPOILER_LABEL = "How it went for you (gives away the ending)";

/**
 * The show stays unspoiled (lib/show-spoilers.ts; David, 2026-11-28): on a date with the show's own cast, the parts of
 * the page that give the ending away to its owner or a predictor (the afterglow's verdict, "You picked …") fold behind
 * a tap while there's a theater to watch it in, like the written recap (./RecapToggle.tsx). A plain <details>, no JS.
 * Anything else renders as it always did.
 */
export default function ShowSpoilerFold({ fold, children }: { fold: boolean; children: ReactNode }) {
  if (!fold) return <>{children}</>;
  return (
    <details className="recap-toggle" data-show-spoiler>
      <summary>
        <span>{SHOW_SPOILER_LABEL}</span>
      </summary>
      <div className="recap-toggle-body">{children}</div>
    </details>
  );
}
