import { ImageResponse } from "next/og";
import { OG_BODY, OG_DISPLAY, OG_NIGHT, OgKicker, OgLetterbox, ogFonts } from "@/lib/og-type";

export const SHIP_CARD_SIZE = { width: 1200, height: 630 };

/**
 * The share card for a ship page (its top ship name, big, over the pair) or, with no pair, for the generator itself.
 * A refused pair gets the generator's card, so a blocked name never appears in a preview.
 */
export async function shipCard(pair: { a: string; b: string; names: string[] } | null): Promise<ImageResponse> {
  const [top, ...rest] = pair?.names ?? [];
  const fonts = await ogFonts();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", flexDirection: "column", justifyContent: "center", padding: "70px 90px", background: OG_NIGHT.bg, color: OG_NIGHT.ink, fontFamily: OG_BODY }}>
        <OgLetterbox />
        <OgKicker>Botchelor · OC ship name generator</OgKicker>
        {pair && top ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 44, fontWeight: 500, color: OG_NIGHT.soft, marginTop: 28 }}>{`${pair.a} × ${pair.b}`}</div>
            <div style={{ fontFamily: OG_DISPLAY, fontSize: 132, fontWeight: 800, lineHeight: 1.02, marginTop: 8, letterSpacing: -2 }}>{top}</div>
            <div style={{ fontSize: 36, fontWeight: 500, color: OG_NIGHT.soft, marginTop: 24 }}>{rest.length ? `also ${rest.slice(0, 4).join(" · ")}` : " "}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: OG_DISPLAY, fontSize: 88, fontWeight: 800, lineHeight: 1.04, marginTop: 24, letterSpacing: -1 }}>Two names in. Ship names out.</div>
            <div style={{ fontSize: 36, fontWeight: 500, color: OG_NIGHT.soft, marginTop: 28 }}>Juniper × Dex makes Junipex. Free, for original characters.</div>
          </div>
        )}
        <div style={{ fontFamily: OG_DISPLAY, fontStyle: "italic", fontWeight: 600, fontSize: 30, color: OG_NIGHT.gold, marginTop: 40 }}>Then send them on a blind date.</div>
      </div>
    ),
    { ...SHIP_CARD_SIZE, ...(fonts.length ? { fonts } : {}) },
  );
}
