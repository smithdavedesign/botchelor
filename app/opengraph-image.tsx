import { ImageResponse } from "next/og";

// The share card for every page (og:image and twitter:image), rendered once at build time.
export const alt = "Botchelor: a blind-date show for original characters. Friends predict the ending, for free points.";
export const size = { width: 1200, height: 630 };
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
