import { ImageResponse } from "next/og";
import { handle } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import { readStepInShare } from "@/lib/step-in-share";
import { STEP_IN_SHARE_WORDS } from "@/lib/step-in-shared";

const SIZE = { width: 1200, height: 630 };
const INK = "#f6eef2";
const MUTED = "#c9b8c4";
const STAGE = "#1d1220";
const ACCENT = "#d6336c";
/** The link is the whole card, so the same URL is the same picture forever. */
const CACHE = "public, max-age=86400, s-maxage=604800, immutable";

/**
 * GET /api/og/step-in?with=…&n=…&got=…&t=…&k=…: a shared step-in verdict's card (lib/step-in-share.ts), 1200×630. Drawn
 * from the link alone, no database read, and only when the show signed it: anything else gets the plain invitation.
 * The cast member's first name and one of three fixed sentences; never the person, their lines or the date.
 */
export const GET = handle(async (req: Request) => {
  const share = readStepInShare(Object.fromEntries(new URL(req.url).searchParams.entries()));
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
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: ACCENT, letterSpacing: 2 }}>BOTCHELOR · STEP INTO THE DATE</div>
          <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{new URL(siteUrl()).host}</div>
        </div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 800, marginTop: 70, lineHeight: 1.1 }}>{share ? STEP_IN_SHARE_WORDS[share.got].card(share.name) : "Go on the date yourself"}</div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, marginTop: 34, color: MUTED }}>
          {share ? `I typed my side. ${share.name} is an AI character on a show.` : "You type your side. The cast answers in character."}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: MUTED, marginTop: "auto" }}>{share ? `Your turn: step into a date with ${share.name}.` : "The show decides how it ends. Free to try."}</div>
      </div>
    ),
    { ...SIZE, headers: { "cache-control": CACHE } },
  );
});
