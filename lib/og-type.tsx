import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The show's type on its share cards (2026-11-27, the finish pass carried to link previews): Fraunces, the title-card
 * cut (SOFT 100, WONK 1), for headlines, and Inter for everything else, so a link pasted into a chat looks like the site
 * it opens. next/og reads only TTF/OTF, so the files are in assets/fonts (its README), not the WOFF2 that next/font serves.
 *
 * Read once per process. A failed read gives no fonts, so the card still draws in next/og's default face instead of
 * failing the image.
 */
export const OG_DISPLAY = "Fraunces";
export const OG_BODY = "Inter";

type OgFont = {
  name: string;
  data: Buffer;
  weight: 500 | 600 | 800;
  style: "normal" | "italic";
};

const FILES: readonly {
  file: string;
  name: string;
  weight: OgFont["weight"];
  style: OgFont["style"];
}[] = [
  { file: "Inter-Medium.ttf", name: OG_BODY, weight: 500, style: "normal" },
  { file: "Inter-ExtraBold.ttf", name: OG_BODY, weight: 800, style: "normal" },
  {
    file: "Fraunces-SoftBlack.ttf",
    name: OG_DISPLAY,
    weight: 800,
    style: "normal",
  },
  {
    file: "Fraunces-SoftSemiBoldItalic.ttf",
    name: OG_DISPLAY,
    weight: 600,
    style: "italic",
  },
];

let loaded: Promise<OgFont[]> | null = null;

export function ogFonts(): Promise<OgFont[]> {
  loaded ??= Promise.all(
    FILES.map((f) =>
      readFile(join(process.cwd(), "assets", "fonts", f.file)).then((data) => ({
        name: f.name,
        data,
        weight: f.weight,
        style: f.style,
      })),
    ),
  ).catch(() => {
    // Not kept: the next card tries again.
    loaded = null;
    return [];
  });
  return loaded;
}

/** The seal's colours on a card (app/RoseSeal.tsx draws it on the page from CSS tokens, which a card doesn't have). */
const WAX = "#b5123f";
const WAX_LIGHT = "#e5356b";
const ROSE = "#ffd6e2";

/** The show's rose seal for a share card: the same drawing as app/RoseSeal.tsx, in plain colours. */
export function OgSeal({
  size = 96,
  rotate = -8,
}: {
  size?: number;
  rotate?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <path
        d="M32 3c4 0 6 2.5 9.5 3.4 3.6.9 6.8-.4 9.4 2.4 2.5 2.7 1.6 6 2.9 9.3 1.3 3.3 4.2 5.6 4.2 9.9s-2.6 6.3-3.4 9.9c-.8 3.6.6 6.9-2 9.6-2.7 2.8-6.1 1.9-9.5 3.2-3.3 1.3-5.3 4.3-9.6 4.3-4.2 0-6.3-2.9-9.6-4.2-3.4-1.3-6.8-.3-9.5-3.1-2.6-2.7-1.3-6-2.1-9.6C5.5 36.6 3 34.4 3 30.2s2.8-6.6 4.1-9.9c1.3-3.3.4-6.7 3-9.4 2.6-2.8 5.9-1.6 9.5-2.5C23.1 7.5 28 3 32 3Z"
        fill={WAX}
      />
      <circle
        cx="32"
        cy="31"
        r="20"
        fill="none"
        stroke={WAX_LIGHT}
        strokeWidth="2.2"
      />
      <circle cx="32" cy="31" r="16.5" fill={WAX_LIGHT} opacity="0.35" />
      <g
        fill="none"
        stroke={ROSE}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 23.5c-3.4 0-5.8 2.6-5.8 5.6 0 3.3 2.7 5.6 5.8 5.6s5.8-2.3 5.8-5.6" />
        <path d="M37.8 29.1c0-2.4-1.9-4.2-4.2-4.2-2 0-3.6 1.5-3.6 3.4 0 1.7 1.3 2.9 2.9 2.9 1.4 0 2.4-1 2.4-2.2" />
        <path d="M32 34.7v8.3" />
        <path d="M32 39.5c-1.6-2.4-4.2-3-6.4-2.4 1 2.5 3.6 3.6 6.4 2.4Z" />
        <path d="M32 38c1.6-2.4 4.2-3 6.4-2.4-1 2.5-3.6 3.6-6.4 2.4Z" />
      </g>
    </svg>
  );
}

/** The night palette the show's share cards use since 2026-11-27 (app/site-card.tsx). */
export const OG_NIGHT = {
  bg: "radial-gradient(ellipse 70% 90% at 30% -10%, rgba(255,214,186,0.22), transparent 70%), radial-gradient(ellipse 60% 70% at 100% 100%, rgba(229,53,107,0.3), transparent 70%), linear-gradient(160deg, #140a1e, #0a0510)",
  ink: "#fff7f2",
  soft: "rgba(255,247,242,0.78)",
  accent: "#ff5e8c",
  gold: "#f3c46b",
  bar: "#050208",
} as const;

/** The two letterbox bars that make a card a frame of the show. */
export function OgLetterbox() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 22,
          background: OG_NIGHT.bar,
        }}
      />
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 22,
          background: OG_NIGHT.bar,
        }}
      />
    </div>
  );
}

/** The card's header: the seal and a kicker in the show's italic. */
export function OgKicker({ children }: { children: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <OgSeal size={60} />
      <div
        style={{
          fontFamily: OG_DISPLAY,
          fontStyle: "italic",
          fontWeight: 600,
          fontSize: 36,
          color: OG_NIGHT.accent,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** `fonts` for an ImageResponse's options, or nothing when they couldn't be read (next/og then uses its own face). */
export async function ogFontOptions(): Promise<{ fonts?: OgFont[] }> {
  const fonts = await ogFonts();
  return fonts.length ? { fonts } : {};
}
