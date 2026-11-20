import { LINE_STYLE, type StageGroup } from "./stages";

/**
 * A kind of pair's line as the sky draws it (./stages.ts LINE_STYLE: its colour token and dash), at chip size: the
 * legend in the stage chips, and beside a pair's stage in the side panel. Decorative: the words beside it say the kind.
 */
export default function LineSwatch({ group }: { group: StageGroup }) {
  const s = LINE_STYLE[group];
  const width = 2.5;
  return (
    <svg className="constellation-line-swatch" width="28" height="10" viewBox="0 0 28 10" aria-hidden focusable="false">
      <line
        x1="3"
        y1="5"
        x2="25"
        y2="5"
        style={{ stroke: `var(${s.token})` }}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={s.dash.length ? s.dash.map((d) => d * width).join(" ") : undefined}
        opacity={s.faint ? 0.6 : 1}
      />
    </svg>
  );
}
