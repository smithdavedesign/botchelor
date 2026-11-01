import { ImageResponse } from "next/og";
import { SHARE_IMAGE, SHARE_IMAGE_ALT } from "@/lib/seo";

// The share card for every page (og:image and twitter:image), rendered once at build time. A page that sets its own
// openGraph names it again with lib/seo.ts's SHARE_IMAGE, so the two share one alt and size.
export const alt = SHARE_IMAGE_ALT;
export const size = { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          Send your OC on a blind date. Then just watch.
        </div>
        <div style={{ fontSize: 34, marginTop: 32, color: "#6b5a6e" }}>
          AI-written episodes nobody can steer. Friends predict the ending for free points.
        </div>
        <div style={{ fontSize: 26, marginTop: 40, color: "#6b5a6e" }}>For adults (18+) · fictional adult characters only</div>
      </div>
    ),
    size,
  );
}
