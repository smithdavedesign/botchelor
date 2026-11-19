// The show's look, from app/globals.css and public/icon.svg, for every video in this folder.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/800.css";
import "@fontsource/fraunces/600-italic.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/800.css";

export const C = {
  ink: "#241022",
  paper: "#fdf6f4",
  accent: "#e5356b",
  rose: "#d6336c",
  violet: "#7c3aed",
  soft: "#fde4ec",
  muted: "#6a5a6f",
  dark: "#140a1e",
  gold: "#e0a100",
  bad: "#dc2626",
  ok: "#16a34a",
  lilac: "#cbb8d4",
};
export const GRAD = `linear-gradient(120deg, ${C.rose}, ${C.violet})`;
export const NEON = `linear-gradient(120deg, #ff8fb4, ${C.accent} 40%, #b18cff)`;
export const SERIF = "Fraunces, Georgia, serif";
export const SANS = "Inter, system-ui, sans-serif";
export const HEART =
  "M16 25.5c-0.5 0-1-0.2-1.4-0.5C10.9 21.9 7 18.6 7 14.3 7 11.4 9.2 9.2 12 9.2c1.6 0 3.1 0.8 4 2 0.9-1.2 2.4-2 4-2 2.8 0 5 2.2 5 5.1 0 4.3-3.9 7.6-7.6 10.7-0.4 0.3-0.9 0.5-1.4 0.5z";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Fade a scene in over its first `d` frames and out over its last `d`. */
export const sceneFade = (f: number, len: number, d = 8) => interpolate(f, [0, d, len - d, len], [0, 1, 1, 0], clamp);

/** 1% of the short side, so type scales across 9:16 and 16:9; and which way up the frame is. */
export const useLayout = () => {
  const { width, height } = useVideoConfig();
  return { width, height, vertical: height > width, u: Math.min(width, height) / 100 };
};

/** A picture from the site's public/ folder ("cast/x.webp" or "/cast/x.webp") or a full URL. */
export const src = (s: string) => (/^https?:\/\//.test(s) ? s : staticFile(s.replace(/^\//, "")));

export const KenBurns: React.FC<{ image: string | null; from?: number; to?: number; dim?: number; blur?: number }> = ({
  image,
  from = 1.05,
  to = 1.18,
  dim = 0.45,
  blur = 0,
}) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = interpolate(f, [0, durationInFrames], [from, to]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: `radial-gradient(circle at 50% 30%, #3a1640, ${C.dark} 75%)` }}>
      {image ? (
        <Img
          src={src(image)}
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${s})`, filter: blur ? `blur(${blur}px)` : undefined }}
        />
      ) : null}
      <AbsoluteFill style={{ background: `rgba(20,10,30,${dim})` }} />
    </AbsoluteFill>
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(10,4,16,0.75) 100%)" }} />
);

export const Heart: React.FC<{ size: number; fill?: string }> = ({ size, fill = C.accent }) => (
  <svg width={size} height={size} viewBox="7 9 18 17">
    <path d={HEART} fill={fill} />
  </svg>
);

export const AppIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <defs>
      <linearGradient id="bz-icon" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#d6336c" />
        <stop offset="1" stopColor="#7c3aed" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="url(#bz-icon)" />
    <path d={HEART} fill="#fff" />
  </svg>
);

/** The wordmark in neon, as the cold open shows it. */
export const Wordmark: React.FC<{ size: number; glow?: number }> = ({ size, glow = 1 }) => (
  <div
    style={{
      fontFamily: SERIF,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 1,
      background: NEON,
      WebkitBackgroundClip: "text",
      color: "transparent",
      filter: `drop-shadow(0 0 ${size * 0.06 * glow}px rgba(229,53,107,0.85))`,
    }}
  >
    Botchelor
  </div>
);

/** How each ending looks on its stamp. */
export const ENDING_STYLE: Record<string, { color: string; rot: number }> = {
  second_date: { color: C.accent, rot: -8 },
  friends: { color: C.gold, rot: 5 },
  close_friends: { color: C.gold, rot: 5 },
  disaster: { color: C.bad, rot: -4 },
};
