import { ImageResponse } from "next/og";

/** The card's size, lib/seo.ts SHARE_IMAGE's (tests/launch-ready.test.ts holds them to each other). */
export const SITE_CARD_SIZE = { width: 1200, height: 630 };

/**
 * The site's share card (lib/seo.ts SHARE_IMAGE), drawn here once for both addresses it's served at: /share-card.png,
 * the one every page names (app/share-card.png/route.tsx, the root layout included), and /opengraph-image, kept for
 * links shared before 2026-11-22 (app/opengraph-image.tsx).
 */
export function siteCard(init?: ResponseInit): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          // The site's palette (app/globals.css): paper, ink, accent, muted.
          background: "#fff8f3",
          borderTop: "24px solid #d6336c",
          color: "#2a1a2e",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 40, color: "#d6336c", fontWeight: 700 }}>Botchelor</div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.1, marginTop: 24 }}>
          Give your character a love life.
        </div>
        <div style={{ fontSize: 34, marginTop: 32, color: "#6b5a6e" }}>
          Blind dates nobody steers. They text you how it went. Free, no sign-up.
        </div>
        <div style={{ fontSize: 26, marginTop: 40, color: "#6b5a6e" }}>For adults (18+) · fictional adult characters only</div>
      </div>
    ),
    { ...SITE_CARD_SIZE, ...init },
  );
}
