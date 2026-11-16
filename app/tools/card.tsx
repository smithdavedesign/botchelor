import { ImageResponse } from "next/og";

export const TOOL_CARD_SIZE = { width: 1200, height: 630 };

// The site's palette (app/globals.css), as the ship card (app/ship/card.tsx) uses it.
const INK = "#241022";
const MUTED = "#6a5a6f";
const PAPER = "#fdf6f4";
const ACCENT = "#e5356b";

/** A free tool's share card: whose tool it is, a big line, and a muted line under it. */
export function toolCard({ kicker, headline, sub }: { kicker: string; headline: string; sub: string }): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: PAPER, borderTop: `24px solid ${ACCENT}`, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 700 }}>{`Botchelor · ${kicker}`}</div>
        <div style={{ fontSize: 80, fontWeight: 800, lineHeight: 1.1, marginTop: 24 }}>{headline}</div>
        <div style={{ fontSize: 36, color: MUTED, marginTop: 28 }}>{sub}</div>
      </div>
    ),
    TOOL_CARD_SIZE,
  );
}
