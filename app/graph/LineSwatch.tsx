import { LINE_STYLES, type StyleKey } from "@/lib/social/lenses";
import { LINE_STYLE, type StageGroup } from "./stages";

/**
 * A kind of line as the sky draws it, at chip size: a Love view's stage group (./stages.ts LINE_STYLE) or a social
 * view's kind of tie (lib/social/lenses.ts LINE_STYLES), with its colour token and dash. The legend in the chips, and
 * beside a pair's stage or ties in the side panel; `sour` draws it red, as the sky draws a tie that feels bad.
 * Decorative: the words beside it say the kind.
 */
export default function LineSwatch({ group, social, sour = false }: { group?: StageGroup; social?: StyleKey; sour?: boolean }) {
  const s = social ? LINE_STYLES[social] : LINE_STYLE[group ?? "first"];
  // A tie that feels bad draws red whatever its kind (lib/social/lenses.ts), in its own dash.
  const token = sour ? "--social-conflict" : s.token;
  const faint = "faint" in s && Boolean(s.faint);
  const arrow = "arrow" in s && Boolean(s.arrow);
  const width = 2.5;
  return (
    <svg className="constellation-line-swatch" width="28" height="10" viewBox="0 0 28 10" aria-hidden focusable="false">
      <line
        x1="3"
        y1="5"
        x2="25"
        y2="5"
        style={{ stroke: `var(${token})` }}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={s.dash.length ? s.dash.map((d) => d * width).join(" ") : undefined}
        opacity={faint ? 0.6 : 1}
      />
      {arrow && <polyline points="13,1.5 17.5,5 13,8.5" fill="none" style={{ stroke: `var(${token})` }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
