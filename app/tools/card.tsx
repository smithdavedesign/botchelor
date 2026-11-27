import { ImageResponse } from "next/og";
import { OG_BODY, OG_DISPLAY, OG_NIGHT, OgKicker, OgLetterbox, ogFonts } from "@/lib/og-type";

export const TOOL_CARD_SIZE = { width: 1200, height: 630 };

/** A free tool's share card: whose tool it is, a big line, and a muted line under it. */
export async function toolCard({ kicker, headline, sub }: { kicker: string; headline: string; sub: string }): Promise<ImageResponse> {
  const fonts = await ogFonts();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", flexDirection: "column", justifyContent: "center", padding: "70px 90px", background: OG_NIGHT.bg, color: OG_NIGHT.ink, fontFamily: OG_BODY }}>
        <OgLetterbox />
        <OgKicker>{`Botchelor · ${kicker}`}</OgKicker>
        <div style={{ fontFamily: OG_DISPLAY, fontSize: 84, fontWeight: 800, lineHeight: 1.04, marginTop: 24, letterSpacing: -1 }}>{headline}</div>
        <div style={{ fontSize: 34, fontWeight: 500, color: OG_NIGHT.soft, marginTop: 28 }}>{sub}</div>
      </div>
    ),
    { ...TOOL_CARD_SIZE, ...(fonts.length ? { fonts } : {}) },
  );
}
