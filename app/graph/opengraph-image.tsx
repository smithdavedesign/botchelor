import { ImageResponse } from "next/og";

// The Constellation's share card: a hand-placed night sky in the brand palette (OG images use raw hex, like the root card).
export const alt = "The Constellation: every Botchelor character and who they've dated, as one living social graph.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STARS = [
  { x: 320, y: 220, r: 26, c: "#e5356b" },
  { x: 520, y: 330, r: 34, c: "#7a36c9" },
  { x: 720, y: 210, r: 22, c: "#ff5e8c" },
  { x: 880, y: 360, r: 28, c: "#a98bff" },
  { x: 420, y: 470, r: 18, c: "#ff5e8c" },
  { x: 1020, y: 180, r: 14, c: "#7a36c9" },
  { x: 180, y: 400, r: 14, c: "#a98bff" },
];
const LINES: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 3],
  [3, 5],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "70px",
          background: "#0e0712",
          color: "#f5e9f0",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <svg width="1200" height="630" style={{ position: "absolute", top: 0, left: 0 }}>
          {LINES.map(([a, b], i) => (
            <line key={i} x1={STARS[a].x} y1={STARS[a].y} x2={STARS[b].x} y2={STARS[b].y} stroke="#7a36c9" strokeOpacity={0.55} strokeWidth={4} />
          ))}
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.c} />
          ))}
        </svg>
        <div style={{ fontSize: 38, color: "#ff5e8c", fontWeight: 700 }}>Botchelor</div>
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.08, marginTop: 16 }}>The Constellation</div>
        <div style={{ fontSize: 32, marginTop: 20, color: "#b49fbd" }}>
          Every character, every date, one living social graph. Who&apos;s dating, who sparked, who&apos;s still in orbit.
        </div>
      </div>
    ),
    size,
  );
}
