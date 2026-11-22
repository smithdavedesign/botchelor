import { STAGE_LABELS, STAGE_LINES, type Stage } from "@/lib/relationship-stages";

/** Up the ladder first, then the other ways two people can stand. */
const ORDER: readonly Stage[] = [
  "just_met",
  "sparks",
  "dating",
  "going_steady",
  "official",
  "moved_in",
  "engaged",
  "married",
  "casual",
  "friends",
  "didnt_click",
  "exes",
  "broke_up",
  "back_together",
  "divorced",
  "bad_blood",
];

/**
 * What a couple's badge means, folded under a list of couples (the 2026-11-22 audit: Sparks, Dating, Going steady,
 * Official and Keeping it casual had no legend anywhere). Each badge with the line a couple's own page shows under it
 * (lib/relationship-stages.ts STAGE_LINES), so the two never disagree.
 */
export default function StageLegend() {
  return (
    <details className="ux-fold stage-legend">
      <summary className="small">What the badges mean</summary>
      <ul className="stage-legend-list small">
        {ORDER.map((s) => (
          <li key={s}>
            <strong>{STAGE_LABELS[s]}</strong> <span className="muted">{STAGE_LINES[s]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
