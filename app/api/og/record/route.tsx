import { ImageResponse } from "next/og";
import { handle } from "@/lib/http";
import { nightCode, parseRecordShare, recordWords } from "@/lib/share-record";
import { siteUrl } from "@/lib/site";

const SIZE = { width: 1200, height: 630 };
const INK = "#f6eef2";
const MUTED = "#c9b8c4";
const STAGE = "#1d1220";
const ACCENT = "#d6336c";
const HIT = "#3fb06a";
const MISS = "#3a2c3e";
/** The numbers are the whole card, so the same URL is the same picture forever. */
const CACHE = "public, max-age=86400, s-maxage=604800, immutable";

/**
 * GET /api/og/record?g=…: a shared record's card (lib/share-record.ts), 1200×630. Drawn from the URL's numbers alone —
 * no database read — and only numbers: a link that doesn't parse gets the plain invitation card. Squares are drawn as
 * boxes, not emoji, so no font has to load. Never a date, a name or an ending.
 */
export const GET = handle(async (req: Request) => {
  const q = Object.fromEntries(new URL(req.url).searchParams.entries());
  const share = parseRecordShare(q);
  const code = share ? nightCode(share) : null;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "56px 72px",
          background: STAGE,
          color: INK,
          borderTop: `20px solid ${ACCENT}`,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: ACCENT, letterSpacing: 2 }}>{code ? `BOTCHELOR · ${code.toUpperCase()}` : "BOTCHELOR"}</div>
          <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{new URL(siteUrl()).host}</div>
        </div>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 800, marginTop: 40 }}>{share ? (share.week ? "My calls this week" : "My calls") : "Call the ending"}</div>
        {share && (
          <div style={{ display: "flex", marginTop: 34 }}>
            {share.recent.map((hit, i) => (
              <div key={i} style={{ display: "flex", width: 84, height: 84, borderRadius: 14, marginRight: 16, background: hit ? HIT : MISS }} />
            ))}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700, marginTop: 34 }}>{share ? recordWords(share) : "AI blind dates nobody steers."}</div>
        <div style={{ display: "flex", fontSize: 30, color: MUTED, marginTop: "auto" }}>No spoilers: just how the calls went. Call tonight&apos;s endings yourself.</div>
      </div>
    ),
    { ...SIZE, headers: { "cache-control": CACHE } },
  );
});
