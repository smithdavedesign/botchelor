import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { chemistryTest, paramsFrom, readChemistry, readNamePair } from "@/lib/chemistry-test";
import { ENDING_LABELS } from "@/lib/rules";
import { trueLove } from "@/lib/true-love";

const SIZE = { width: 1200, height: 630 };
// The site's palette (app/globals.css), as the other share cards use it.
const INK = "#241022";
const MUTED = "#6a5a6f";
const PAPER = "#fdf6f4";
const ACCENT = "#e5356b";
/** A card is a pure function of its address (no database, no model), so the edge can keep it for a day. */
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

type Card = { names: string; score: string; unit: string; line: string; foot: string };

/** What the address holds, as a card: two names (the quick test), two characters (the full one), or neither. */
function cardFor(search: URLSearchParams): Card | null {
  const params = paramsFrom(search);
  const names = readNamePair(params);
  if (names) {
    if (!names.ok) return null;
    return { names: `${names.a} × ${names.b}`, score: String(trueLove(names.a, names.b).score), unit: "%", line: "By the letters of TRUE LOVE", foot: "Just for fun." };
  }
  const read = readChemistry(params);
  if (!read.ok) return null;
  const { score, ending } = chemistryTest(read.a, read.b);
  return { names: `${read.a.name} × ${read.b.name}`, score: String(score), unit: "/100", line: `On paper: ${ENDING_LABELS[ending].toLowerCase()}`, foot: "For fun. On the show, the engine decides." };
}

/**
 * GET /api/og/chemistry?a_name=…: the ship compatibility test's share card (once the OC chemistry test), a 1200×630
 * PNG. Two names alone get their love-calculator score; two characters the test takes get their names, the score and
 * the ending on paper (the result page's og:image); none, or a pair the filter refuses, get the tool's own card, so a
 * refused name never appears in a preview.
 */
export function GET(req: NextRequest) {
  const card = cardFor(req.nextUrl.searchParams);
  return new ImageResponse(
    (
      // Satori (next/og) needs an explicit `display` on every <div> with more than one child.
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: PAPER, borderTop: `24px solid ${ACCENT}`, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 700 }}>Botchelor · Ship compatibility test</div>
        {card ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: card.names.length > 32 ? 44 : 60, fontWeight: 700, marginTop: 28 }}>{card.names}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 12 }}>
              <div style={{ fontSize: 150, fontWeight: 800, lineHeight: 1 }}>{card.score}</div>
              <div style={{ fontSize: 48, color: MUTED, marginLeft: 16 }}>{card.unit}</div>
            </div>
            <div style={{ fontSize: 48, marginTop: 16 }}>{card.line}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.1, marginTop: 24 }}>Will these two make it?</div>
            <div style={{ fontSize: 36, color: MUTED, marginTop: 28 }}>Two names or two whole characters in: a score out of 100, and why.</div>
          </div>
        )}
        <div style={{ fontSize: 28, color: MUTED, marginTop: 40 }}>{card ? card.foot : "Free, for OCs, fandom ships or any two names."}</div>
      </div>
    ),
    { ...SIZE, headers: { "cache-control": CACHE } },
  );
}
