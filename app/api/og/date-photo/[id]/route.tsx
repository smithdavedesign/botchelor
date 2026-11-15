import { ImageResponse } from "next/og";
import { AI_HEADERS, markAiImage } from "@/lib/ai-mark";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { backdropJpeg, datePhotoDay, datePhotoFacts, portraitJpeg, type DatePhotoFacts, type DatePhotoSide } from "@/lib/date-photo";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json } from "@/lib/http";
import { withResizeSlot } from "@/lib/thumbs";
import { venueBackdropCss, venueName } from "@/lib/venues";

/** 4:5, like a phone's own photos (lib/companion-shared.ts DATE_PHOTO_ASPECT): 640 wide is two pixels a point in a thread. */
const SIZE = { width: 640, height: 800 };
const PRINT = { width: 248, height: 310 };
const PAPER = "#fff8f3";
const INK = "#2a1a2e";
const MUTED = "#6b5a6e";

/**
 * A date's snapshot changes only when a portrait does, and a thread asks for it on every visit: a day in the browser,
 * a week at the CDN when everyone gets the same picture (DatePhotoFacts.shared). One that depends on who asks stays in
 * their browser.
 */
const SHARED_CACHE = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";
const PRIVATE_CACHE = "private, max-age=86400";

/**
 * GET /api/og/date-photo/<episode id>: a snapshot of the date for the character's texts (lib/date-photo.ts), a 640x800
 * picture composed on request and never stored: the place's backdrop, both of them, their names, the place and the day.
 * $0: no model draws anything.
 *
 * It never has the ending or a line of the date, whoever asks, so it is safe in a text to someone who hasn't watched
 * yet. Who may ask is the episode page's rule (datePhotoFacts): anyone for a public or unlisted date; a private date's
 * two owners and its host only; nobody else for one hidden by reports; never an After Dark date. A private character's
 * face is drawn only for its owner. Everything else is a 404.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const facts = await datePhotoFacts(db, id, authFromRequest(req)?.userId ?? null);
  if (!facts) return json({ error: "episode_not_found" }, 404);
  const [backdrop, ...faces] = await Promise.all([
    backdropJpeg(facts.venue, SIZE).catch(() => null),
    ...facts.sides.map((s) => (s.showFace ? portraitJpeg(db, s.id, PRINT).catch(() => null) : Promise.resolve(null))),
  ]);
  const card = new ImageResponse(<Snapshot facts={facts} backdrop={backdrop} faces={faces} />, SIZE);
  const png = Buffer.from(await card.arrayBuffer());
  // A photograph as a PNG is about a megabyte; as a WebP it is under a tenth of that, for a phone on mobile data.
  const webp = await toWebp(png);
  const headers = {
    "content-type": webp ? "image/webp" : "image/png",
    "cache-control": facts.shared ? SHARED_CACHE : PRIVATE_CACHE,
    // The backdrop and the faces were drawn by a model: marked in the file and the headers (lib/ai-mark.ts).
    ...AI_HEADERS,
  };
  return new Response(new Uint8Array(markAiImage(webp ?? png)), { status: 200, headers });
});

async function toWebp(png: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return await withResizeSlot(() => sharp(png).webp({ quality: 80 }).toBuffer());
  } catch {
    return null;
  }
}

// Satori (next/og) needs an explicit `display` on every <div> with more than one child, so every div sets one, and
// every text node is the only child of its div.
function Print({ side, face, tilt }: { side: DatePhotoSide; face: string | null; tilt: number }) {
  return (
    <div
      style={{
        display: "flex",
        padding: 10,
        background: "#ffffff",
        borderRadius: 10,
        boxShadow: "0 14px 32px rgba(0, 0, 0, 0.45)",
        transform: `rotate(${tilt}deg)`,
        margin: "0 -6px",
      }}
    >
      {face ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
        <img src={face} alt="" width={PRINT.width} height={PRINT.height} style={{ borderRadius: 4, objectFit: "cover" }} />
      ) : (
        <div
          style={{
            display: "flex",
            width: PRINT.width,
            height: PRINT.height,
            borderRadius: 4,
            background: avatarGradientCss(avatarPalette(side.id, side.hue)),
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 96,
            fontWeight: 800,
          }}
        >
          {initials(side.name)}
        </div>
      )}
    </div>
  );
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

function Snapshot({ facts, backdrop, faces }: { facts: DatePhotoFacts; backdrop: string | null; faces: (string | null)[] }) {
  const [a, b] = facts.sides;
  const names = `${firstNameOf(a.name)} & ${firstNameOf(b.name)}`;
  const place = facts.venue ? venueName(facts.venue) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative", background: venueBackdropCss(facts.venue), fontFamily: "sans-serif" }}>
      {backdrop && (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
        <img src={backdrop} alt="" width={SIZE.width} height={SIZE.height} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} />
      )}
      {/* The place stays readable behind them: darker towards the caption. */}
      <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: SIZE.width, height: SIZE.height, background: "linear-gradient(180deg, rgba(20, 10, 24, 0.15) 0%, rgba(20, 10, 24, 0.55) 100%)" }} />
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 36 }}>
        <Print side={a} face={faces[0] ?? null} tilt={-4} />
        <Print side={b} face={faces[1] ?? null} tilt={3} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", background: PAPER, padding: "22px 32px 26px" }}>
        <div style={{ display: "flex", fontSize: names.length > 22 ? 34 : 42, fontWeight: 800, color: INK, lineHeight: 1.1 }}>{names}</div>
        {place && <div style={{ display: "flex", fontSize: 24, color: INK, marginTop: 8, lineHeight: 1.2 }}>{place}</div>}
        <div style={{ display: "flex", fontSize: 22, color: MUTED, marginTop: 6 }}>{datePhotoDay(facts.at)}</div>
      </div>
    </div>
  );
}
