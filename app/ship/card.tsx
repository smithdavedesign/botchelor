import { ImageResponse } from "next/og";

export const SHIP_CARD_SIZE = { width: 1200, height: 630 };

// The site's palette (app/globals.css), as the other share cards use it.
const INK = "#241022";
const MUTED = "#6a5a6f";
const PAPER = "#fdf6f4";
const ACCENT = "#e5356b";

/**
 * The share card for a ship page (its top ship name, big, over the pair) or, with no pair, for the generator itself.
 * A refused pair gets the generator's card, so a blocked name never appears in a preview.
 */
export function shipCard(pair: { a: string; b: string; names: string[] } | null): ImageResponse {
  const [top, ...rest] = pair?.names ?? [];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: PAPER, borderTop: `24px solid ${ACCENT}`, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 700 }}>Botchelor · OC ship name generator</div>
        {pair && top ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 44, color: MUTED, marginTop: 28 }}>{`${pair.a} × ${pair.b}`}</div>
            <div style={{ fontSize: 120, fontWeight: 800, lineHeight: 1.05, marginTop: 8 }}>{top}</div>
            <div style={{ fontSize: 36, color: MUTED, marginTop: 24 }}>{rest.length ? `also ${rest.slice(0, 4).join(" · ")}` : " "}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.1, marginTop: 24 }}>Two names in. Ship names out.</div>
            <div style={{ fontSize: 36, color: MUTED, marginTop: 28 }}>Juniper × Dex makes Junipex. Free, for original characters.</div>
          </div>
        )}
        <div style={{ fontSize: 28, color: MUTED, marginTop: 40 }}>Then send them on a blind date.</div>
      </div>
    ),
    SHIP_CARD_SIZE,
  );
}
