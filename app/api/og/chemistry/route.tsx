import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { chemistryTest, paramsFrom, readChemistry } from "@/lib/chemistry-test";
import { ENDING_LABELS } from "@/lib/rules";

const SIZE = { width: 1200, height: 630 };
// The site's palette (app/globals.css), as the other share cards use it.
const INK = "#241022";
const MUTED = "#6a5a6f";
const PAPER = "#fdf6f4";
const ACCENT = "#e5356b";
/** A card is a pure function of its address (no database, no model), so the edge can keep it for a day. */
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/**
 * GET /api/og/chemistry?a_name=…: the OC chemistry test's share card, a 1200×630 PNG. With two characters the test
 * takes, it's their names, the score and the predicted ending (the result page's og:image); with none, or a pair the
 * filter refuses, it's the tool's own card, so a refused name never appears in a preview.
 */
export function GET(req: NextRequest) {
  const read = readChemistry(paramsFrom(req.nextUrl.searchParams));
  const pair = read.ok ? { names: `${read.a.name} × ${read.b.name}`, ...chemistryTest(read.a, read.b) } : null;
  return new ImageResponse(
    (
      // Satori (next/og) needs an explicit `display` on every <div> with more than one child.
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: PAPER, borderTop: `24px solid ${ACCENT}`, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 700 }}>Botchelor · OC chemistry test</div>
        {pair ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: pair.names.length > 32 ? 44 : 60, fontWeight: 700, marginTop: 28 }}>{pair.names}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 12 }}>
              <div style={{ fontSize: 150, fontWeight: 800, lineHeight: 1 }}>{String(pair.score)}</div>
              <div style={{ fontSize: 48, color: MUTED, marginLeft: 16 }}>/100</div>
            </div>
            <div style={{ fontSize: 48, marginTop: 16 }}>{`Predicted ending: ${ENDING_LABELS[pair.ending].toLowerCase()}`}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.1, marginTop: 24 }}>Will these two make it?</div>
            <div style={{ fontSize: 36, color: MUTED, marginTop: 28 }}>Two OCs in: a chemistry score, how their first date ends, and why.</div>
          </div>
        )}
        <div style={{ fontSize: 28, color: MUTED, marginTop: 40 }}>{pair ? "Then watch the real date." : "Free, for original characters."}</div>
      </div>
    ),
    { ...SIZE, headers: { "cache-control": CACHE } },
  );
}
