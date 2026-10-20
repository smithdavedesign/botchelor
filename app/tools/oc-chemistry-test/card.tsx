import { ImageResponse } from "next/og";
import type { ChemistryResult } from "@/lib/chemistry-test";
import { ENDING_LABELS } from "@/lib/rules";

export const CHEMISTRY_CARD_SIZE = { width: 1200, height: 630 };
export const CHEMISTRY_CARD_ALT = "Botchelor's free OC chemistry test: will these two make it?";

// The site's palette (app/globals.css), as the other share cards use it.
const INK = "#241022";
const MUTED = "#6a5a6f";
const PAPER = "#fdf6f4";
const ACCENT = "#e5356b";

/**
 * The share card for a chemistry result (both names, the score and the ending) or, with no result, for the test
 * itself. Anything refused gets the test's card, so a blocked word never appears in a preview.
 */
export function chemistryCard(result: ChemistryResult | null): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: PAPER, borderTop: `24px solid ${ACCENT}`, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 700 }}>Botchelor · OC chemistry test</div>
        {result ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 48, color: MUTED, marginTop: 28 }}>{`${result.a.name} × ${result.b.name}`}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
              <div style={{ fontSize: 150, fontWeight: 800, lineHeight: 1.05 }}>{String(result.score)}</div>
              <div style={{ fontSize: 60, color: MUTED, marginLeft: 12 }}>/100</div>
            </div>
            <div style={{ fontSize: 64, fontWeight: 800, color: ACCENT, marginTop: 4 }}>{ENDING_LABELS[result.ending]}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1, marginTop: 24 }}>Will these two make it?</div>
            <div style={{ fontSize: 36, color: MUTED, marginTop: 28 }}>Two OCs in: a score out of 100, how their first date ends, and why. Free.</div>
          </div>
        )}
        <div style={{ fontSize: 28, color: MUTED, marginTop: 36 }}>Then watch a real date on Botchelor.</div>
      </div>
    ),
    CHEMISTRY_CARD_SIZE,
  );
}
