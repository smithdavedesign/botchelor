import { ImageResponse } from "next/og";
import { OG_BODY, OG_DISPLAY, OG_NIGHT, OgKicker, OgLetterbox, OgSeal, ogFontOptions } from "@/lib/og-type";
import { markedImageResponse } from "@/lib/ai-mark";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { ceremonyResult, resultHeadline, type CeremonyFace, type CeremonyResult } from "@/lib/ceremony";
import { portraitJpeg } from "@/lib/date-photo";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { shortName } from "@/lib/names";
import { siteUrl } from "@/lib/site";

const SIZE = { width: 1200, height: 630 };
/** A held ceremony never changes, so a day at the edge: one read a day per shared Sunday. */
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
const BIG = { width: 220, height: 220 };
const SMALL = { width: 96, height: 96 };

/**
 * GET /api/og/ceremony/<YYYY-MM-DD>: a held rose ceremony's result card (2026-11-28, Dave: "a shareable ceremony
 * result card"), the og:image of /watch?ceremony=<day>. The rose's winner large under a follow spot, who kept a rose
 * beside them, who went home greyed out. Only a ceremony that's been held: an upcoming Sunday is a 404, so the card
 * can't spoil anything the Botchelor card doesn't already show everyone.
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ day: string }> }) => {
  const { day } = await ctx.params;
  const db = await getDb();
  const result = await ceremonyResult(db, day);
  if (!result) return json({ error: "ceremony_not_found" }, 404);
  const star = result.last_rose;
  const others = [...result.kept.filter((f) => f.id !== star?.id).slice(0, 4), ...result.went_home];
  const [starFace, ...faces] = await Promise.all([star ? portraitJpeg(db, star.id, BIG).catch(() => null) : null, ...others.map((f) => portraitJpeg(db, f.id, SMALL).catch(() => null))]);
  const card = new ImageResponse(<ResultCard result={result} star={star} starFace={starFace} others={others} faces={faces} />, {
    ...SIZE,
    headers: { "cache-control": CACHE },
    ...(await ogFontOptions()),
  });
  return starFace || faces.some(Boolean) ? markedImageResponse(card) : card;
});

function Face({ face, src, size, home = false }: { face: CeremonyFace; src: string | null; size: number; home?: boolean }) {
  const look = { borderRadius: size / 2, opacity: home ? 0.45 : 1, filter: home ? "grayscale(1)" : "none" };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
    <img src={src} alt="" width={size} height={size} style={{ ...look, objectFit: "cover", border: `${size > 150 ? 6 : 3}px solid ${home ? OG_NIGHT.soft : OG_NIGHT.gold}` }} />
  ) : (
    <div
      style={{
        ...look,
        display: "flex",
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        background: avatarGradientCss(avatarPalette(face.id, face.hue)),
        color: "#fff",
        fontSize: size * 0.4,
        fontWeight: 800,
      }}
    >
      {initials(face.name)}
    </div>
  );
}

function ResultCard({ result, star, starFace, others, faces }: { result: CeremonyResult; star: CeremonyFace | null; starFace: string | null; others: CeremonyFace[]; faces: (string | null)[] }) {
  const headline = resultHeadline(result);
  const home = new Set(result.went_home.map((f) => f.id));
  const gone = result.went_home.map((f) => shortName(f.name));
  const sub = gone.length ? `${gone.join(" and ")} went home.` : `${shortName(result.lead.name)} kept everyone.`;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: OG_NIGHT.bg, color: OG_NIGHT.ink, fontFamily: OG_BODY, padding: "64px 72px" }}>
      <OgLetterbox />
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 0,
          width: 420,
          height: 630,
          display: "flex",
          background: "radial-gradient(ellipse 50% 60% at 50% 55%, rgba(255,236,214,0.28), transparent 70%)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 340, position: "relative" }}>
        {star ? <Face face={star} src={starFace} size={220} /> : <OgSeal size={180} />}
        {star && (
          <div style={{ display: "flex", position: "absolute", right: 22, bottom: 150 }}>
            <OgSeal size={84} rotate={12} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: 40, width: 680 }}>
        <OgKicker>{`${result.finale ? "The finale" : `Week ${result.week}`} · the rose ceremony`}</OgKicker>
        <div style={{ display: "flex", fontFamily: OG_DISPLAY, fontSize: headline.length > 26 ? 64 : 78, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1, marginTop: 18 }}>{headline}</div>
        <div style={{ display: "flex", fontSize: 32, color: OG_NIGHT.soft, marginTop: 18 }}>{sub}</div>
        {others.length > 0 && (
          <div style={{ display: "flex", marginTop: 30 }}>
            {others.map((f, i) => (
              <div key={f.id} style={{ display: "flex", marginRight: 14 }}>
                <Face face={f} src={faces[i] ?? null} size={88} home={home.has(f.id)} />
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 26, color: OG_NIGHT.soft, marginTop: 34 }}>{`${result.title} · ${new URL(siteUrl()).host}/watch`}</div>
      </div>
    </div>
  );
}
