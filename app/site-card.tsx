import { ImageResponse } from "next/og";
import { OG_BODY, OG_DISPLAY, OgLetterbox, OgSeal, ogFonts } from "@/lib/og-type";

/** The card's size, lib/seo.ts SHARE_IMAGE's (tests/launch-ready.test.ts holds them to each other). */
export const SITE_CARD_SIZE = { width: 1200, height: 630 };

// The show at night (app/globals.css --card-dark, the accent, the stage's gold), as the card a link opens on.
const NIGHT = "#140a1e";
const NIGHT_DEEP = "#0a0510";
const ACCENT = "#ff5e8c";
const CREAM = "#fff7f2";
const SOFT = "rgba(255,247,242,0.78)";
const GOLD = "#f3c46b";
const PETAL = "#e5356b";
const PETAL_LIGHT = "#ff7ea3";

// A few petals drifting down the right of the card (fixed, so the card is the same every build).
const PETALS = [
  { x: 1010, y: 40, s: 1.2, r: 30 },
  { x: 1110, y: 150, s: 0.8, r: -50 },
  { x: 940, y: 210, s: 0.9, r: 70 },
  { x: 1060, y: 330, s: 1.1, r: -20 },
  { x: 1140, y: 470, s: 0.7, r: 40 },
  { x: 880, y: 90, s: 0.6, r: -70 },
];

/**
 * The site's share card (lib/seo.ts SHARE_IMAGE), drawn here once for both addresses it's served at: /share-card.png,
 * the one every page names (app/share-card.png/route.tsx, the root layout included), and /opengraph-image, kept for
 * links shared before 2026-11-22 (app/opengraph-image.tsx). Since 2026-11-27 it's the show at night: a follow spot,
 * the title card's Fraunces, the rose seal and a few petals, so the link people paste on launch day looks like the show.
 */
export async function siteCard(init?: ResponseInit): Promise<ImageResponse> {
  const fonts = await ogFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          flexDirection: "column",
          justifyContent: "center",
          padding: "70px 90px",
          background: `radial-gradient(ellipse 70% 90% at 30% -10%, rgba(255,214,186,0.22), transparent 70%), radial-gradient(ellipse 60% 70% at 100% 100%, rgba(229,53,107,0.28), transparent 70%), linear-gradient(160deg, ${NIGHT}, ${NIGHT_DEEP})`,
          color: CREAM,
          fontFamily: OG_BODY,
        }}
      >
        {PETALS.map((p, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: 34 * p.s,
              height: 46 * p.s,
              borderRadius: "80% 0 80% 0",
              background: `radial-gradient(circle at 30% 30%, ${PETAL_LIGHT}, ${PETAL} 75%)`,
              transform: `rotate(${p.r}deg)`,
              opacity: 0.85,
            }}
          />
        ))}
        {/* Letterbox: the card is a frame of the show. */}
        <OgLetterbox />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <OgSeal size={78} />
          <div style={{ fontFamily: OG_DISPLAY, fontStyle: "italic", fontWeight: 600, fontSize: 52, color: ACCENT }}>Botchelor</div>
        </div>
        <div style={{ fontFamily: OG_DISPLAY, fontSize: 92, fontWeight: 800, lineHeight: 1.02, marginTop: 26, maxWidth: 860, letterSpacing: -1 }}>
          Give your character a love life.
        </div>
        <div style={{ fontSize: 32, fontWeight: 500, marginTop: 30, color: SOFT, maxWidth: 820 }}>
          Blind dates nobody steers. They text you how it went. Free, no sign-up.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22, fontWeight: 500, marginTop: 40, color: SOFT }}>
          <div style={{ width: 44, height: 2, background: GOLD }} />
          For adults (18+) · fictional adult characters only
        </div>
      </div>
    ),
    { ...SITE_CARD_SIZE, ...(fonts.length ? { fonts } : {}), ...init },
  );
}
