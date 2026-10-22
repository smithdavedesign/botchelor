import { ImageResponse } from "next/og";
import { ENDING_LABELS, type Ending } from "@/lib/rules";

export const CHEMISTRY_CARD_SIZE = { width: 1200, height: 630 };

// The site's palette (app/globals.css), as the other share cards use it.
const INK = "#241022";
const MUTED = "#6a5a6f";
const PAPER = "#fdf6f4";
const ACCENT = "#e5356b";

/**
 * The share card for a chemistry test result (the pair, the score, the predicted ending) or, with no result, for the
 * test itself. A refused pair gets the test's card, so a blocked word never appears in a preview.
 */
export function chemistryCard(result: { a: string; b: string; score: number; ending: Ending } | null): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: PAPER, borderTop: `24px solid ${ACCENT}`, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 700 }}>Botchelor · OC chemistry test</div>
        {result ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 44, color: MUTED, marginTop: 28, lineHeight: 1.2 }}>{`${result.a} × ${result.b}`}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
              <div style={{ fontSize: 150, fontWeight: 800, lineHeight: 1 }}>{String(result.score)}</div>
              <div style={{ fontSize: 56, color: MUTED, marginLeft: 12 }}>/100</div>
            </div>
            <div style={{ fontSize: 56, fontWeight: 700, color: ACCENT, marginTop: 16 }}>{ENDING_LABELS[result.ending]}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.1, marginTop: 24 }}>Will these two make it?</div>
            <div style={{ fontSize: 36, color: MUTED, marginTop: 28 }}>Two OCs, three traits, a want and a dealbreaker each. A score out of 100.</div>
          </div>
        )}
        <div style={{ fontSize: 28, color: MUTED, marginTop: 40 }}>Free, for original characters. Then watch the real date.</div>
      </div>
    ),
    CHEMISTRY_CARD_SIZE,
  );
}
