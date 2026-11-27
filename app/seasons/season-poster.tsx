/**
 * The season's poster (David, 2026-11-27: "a season poster" for the Product Hunt launch and the December page's link
 * preview): the show's stage behind, the lead holding out a rose (their show kit's rose shot, else their portrait) and
 * the suitors in a row, or before the 1st, the top of casting's board. Drawn by next/og, so every picture goes in as a
 * small JPEG (lib/date-photo.ts: the rasterizer draws a WebP as nothing). A face with no picture is its gradient tile.
 *
 * Three sizes from one layout: `og` (1200×630, the link preview), `ph` (1270×760, a Product Hunt gallery image) and
 * `story` (1080×1920, a phone story). Served at /seasons/<slug>/opengraph-image and /seasons/<slug>/poster.png?format=.
 * Words stay English: a share card is read by whoever the link reaches, and a crawler sends no language.
 */
import "server-only";
import { ImageResponse } from "next/og";
import { markedImageResponse, SHARE_CARD_CACHE } from "@/lib/ai-mark";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { castJpeg, portraitJpeg, smallJpeg } from "@/lib/date-photo";
import type { Db } from "@/lib/db";
import { shortName } from "@/lib/names";
import { liveSeasonFormat, loadSeasonPoster, type PosterFace, type SeasonPosterData } from "@/lib/season-page";
import { seasonRef } from "@/lib/season-ref";
import { showSetPath } from "@/lib/show-sets";
import { shotFile, shotsFor } from "@/lib/show-shots";

export const POSTER_FORMATS = {
  og: { width: 1200, height: 630 },
  ph: { width: 1270, height: 760 },
  story: { width: 1080, height: 1920 },
} as const;
export type PosterFormat = keyof typeof POSTER_FORMATS;

export const posterFormatOf = (v: string | null | undefined): PosterFormat => (v === "ph" || v === "story" ? v : "og");

const PINK = "#ff4f8b";
const GOLD = "#f3c46b";
const WHITE = "#fff7f2";
const SOFT = "rgba(255,247,242,0.78)";

type Pictured = { face: PosterFace; src: string | null };

/** The lead's rose shot as a JPEG, when their show kit has one ready (lib/show-shots.ts). */
async function roseJpeg(db: Db, characterId: string, size: { width: number; height: number }): Promise<string | null> {
  const all: Record<string, Partial<Record<string, string>>> = await shotsFor(db, [characterId]).catch(() => ({}));
  const urls = all[characterId];
  const id = urls?.rose ? decodeURIComponent(urls.rose.replace(/^\/api\/shots\//, "").replace(/\.webp$/, "")) : null;
  const file = id ? await shotFile(db, id).catch(() => null) : null;
  return file ? smallJpeg(file.bytes, size) : null;
}

function Tile({ face, src, size, radius, ring }: { face: PosterFace; src: string | null; size: number; radius: number; ring: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
    <img src={src} alt="" width={size} height={size} style={{ borderRadius: radius, objectFit: "cover", border: `4px solid ${ring}` }} />
  ) : (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: radius,
        border: `4px solid ${ring}`,
        background: avatarGradientCss(avatarPalette(face.id, face.hue)),
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: Math.round(size * 0.4),
        fontWeight: 800,
      }}
    >
      {initials(face.name)}
    </div>
  );
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);

/** "Starts Tuesday, December 1", "Night 5 of 31 · 26 days to the finale", or how the season ended. */
function clockLine(d: SeasonPosterData): string {
  if (d.phase === "preseason") {
    const day = new Date(`${d.season.id}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    return `Starts ${day}`;
  }
  const a = d.arc;
  if (!a) return `On now`;
  const left = a.to === "finale" ? (a.left === 0 ? "the final rose tonight" : `${a.left} ${a.left === 1 ? "day" : "days"} to the final rose`) : "the final rose is given";
  return `Night ${a.night} of ${a.nights} · ${left}`;
}

function Lead({ d, lead, w, h }: { d: SeasonPosterData; lead: Pictured | null; w: number; h: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: w }}>
      <div style={{ display: "flex", width: w, height: h, borderRadius: 28, border: `5px solid ${GOLD}`, overflow: "hidden", background: "rgba(20,8,24,0.6)", alignItems: "center", justifyContent: "center" }}>
        {lead?.src ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
          <img src={lead.src} alt="" width={w} height={h} style={{ objectFit: "cover" }} />
        ) : lead ? (
          <div style={{ display: "flex", width: w, height: h, background: avatarGradientCss(avatarPalette(lead.face.id, lead.face.hue)), alignItems: "center", justifyContent: "center", color: "#fff", fontSize: Math.round(w * 0.35), fontWeight: 800 }}>
            {initials(lead.face.name)}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: SOFT, fontSize: Math.round(w * 0.09), textAlign: "center", padding: 24 }}>
            <div style={{ display: "flex" }}>The lead is named</div>
            <div style={{ display: "flex" }}>{`when ${d.month} starts`}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", marginTop: 14, fontSize: Math.round(w * 0.06), color: GOLD, letterSpacing: 4, fontWeight: 700 }}>THE LEAD</div>
      {lead && <div style={{ display: "flex", fontSize: Math.round(w * 0.11), color: WHITE, fontWeight: 800 }}>{lead.face.name}</div>}
    </div>
  );
}

function Suitors({ d, faces, size, gap, center = false }: { d: SeasonPosterData; faces: Pictured[]; size: number; gap: number; center?: boolean }) {
  if (!faces.length) return null;
  const label = d.facesAre === "suitors" ? `THE ${faces.length === 1 ? "SUITOR" : "SUITORS"}` : "CASTING · TOP OF THE VOTE";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: center ? "center" : "flex-start" }}>
      <div style={{ display: "flex", fontSize: Math.max(18, Math.round(size * 0.24)), color: PINK, letterSpacing: 3, fontWeight: 700, marginBottom: 12 }}>{label}</div>
      <div style={{ display: "flex", gap }}>
        {faces.map((p) => (
          <div key={p.face.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: size + 16 }}>
            <Tile face={p.face} src={p.src} size={size} radius={size / 2} ring={PINK} />
            <div style={{ display: "flex", marginTop: 8, fontSize: Math.max(16, Math.round(size * 0.22)), color: WHITE, fontWeight: 600 }}>{shortName(p.face.name) || p.face.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The words: the season's code, the format's title, its promise and its clock. */
function Words({ d, title, sub, clock, scale, center = false }: { d: { number: number; month: string }; title: string; sub: string; clock: string | null; scale: number; center?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: center ? "center" : "flex-start", textAlign: center ? "center" : "left" }}>
      <div style={{ display: "flex", fontSize: Math.round(26 * scale), color: PINK, letterSpacing: 5, fontWeight: 700 }}>{`SEASON ${d.number} · ${d.month.toUpperCase()}`}</div>
      <div style={{ display: "flex", fontSize: Math.round(92 * scale), color: WHITE, fontWeight: 800, lineHeight: 1.02, marginTop: 6 }}>{title}</div>
      <div style={{ display: "flex", fontSize: Math.round(30 * scale), color: SOFT, marginTop: Math.round(14 * scale), lineHeight: 1.3 }}>{sub}</div>
      {clock && (
        <div style={{ display: "flex", marginTop: Math.round(22 * scale) }}>
          <div style={{ display: "flex", padding: `${Math.round(10 * scale)}px ${Math.round(22 * scale)}px`, borderRadius: 999, background: PINK, color: "#fff", fontSize: Math.round(26 * scale), fontWeight: 700 }}>{clock}</div>
        </div>
      )}
    </div>
  );
}

function Frame({ bg, width, height, children }: { bg: string | null; width: number; height: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", width, height, position: "relative", background: "#140818", fontFamily: "sans-serif" }}>
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
        <img src={bg} alt="" width={width} height={height} style={{ position: "absolute", top: 0, left: 0, width, height, objectFit: "cover" }} />
      )}
      <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width, height, background: "linear-gradient(180deg, rgba(14,8,20,0.45) 0%, rgba(14,8,20,0.88) 100%)" }} />
      {children}
    </div>
  );
}

/** The poster for a season (its id), in one of the three formats. Never throws: a season it can't read gets its title. */
export async function seasonPoster(db: Db, seasonId: string, format: PosterFormat, now: Date = new Date()): Promise<Response> {
  const size = POSTER_FORMATS[format];
  const ref = seasonRef(seasonId);
  const live = await liveSeasonFormat(db, seasonId, now).catch(() => null);
  const d = live ? await loadSeasonPoster(db, seasonId, live.phase, live.def, now).catch(() => null) : null;
  const tall = format === "story";
  const leadSize = tall ? { width: 640, height: 800 } : { width: Math.round(size.height * 0.5), height: Math.round(size.height * 0.625) };
  const faceSize = tall ? 150 : Math.round(size.height * 0.135);
  const [bg, leadSrc, faceSrcs] = await Promise.all([
    castJpeg(showSetPath("stage"), size).catch(() => null),
    d?.lead ? roseJpeg(db, d.lead.id, leadSize).then((r) => r ?? portraitJpeg(db, d.lead!.id, leadSize)).catch(() => null) : Promise.resolve(null),
    Promise.all((d?.faces ?? []).slice(0, 6).map((f) => portraitJpeg(db, f.id, { width: faceSize * 2, height: faceSize * 2 }).catch(() => null))),
  ]);
  const lead: Pictured | null = d?.lead ? { face: { id: d.lead.id, name: d.lead.name, hue: d.lead.hue, portrait: d.lead.portrait, house: d.lead.house }, src: leadSrc } : null;
  const faces: Pictured[] = (d?.faces ?? []).slice(0, 6).map((face, i) => ({ face, src: faceSrcs[i] ?? null }));
  const pictured = Boolean(bg || leadSrc || faceSrcs.some(Boolean));

  const title = d?.def.title ?? `Season ${ref.number}`;
  const sub = d ? (d.def.slug === "botchelor" ? `One lead. ${countWord(d.places)} suitors. A rose ceremony every Sunday.` : d.def.pitch) : `${ref.label} on Botchelor: AI characters on blind dates nobody steers.`;
  const words = { number: ref.number, month: d?.month ?? ref.label };
  const clock = d ? clockLine(d) : null;
  const site = `botchelor.com${ref.path}`;

  const body = tall ? (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: size.width, height: size.height, padding: "120px 80px 100px", justifyContent: "space-between", position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <Words d={words} title={title} sub={sub} clock={clock} scale={1.35} center />
      </div>
      {d && <Lead d={d} lead={lead} w={leadSize.width} h={leadSize.height} />}
      {d && <Suitors d={d} faces={faces.slice(0, 5)} size={faceSize} gap={18} center />}
      <div style={{ display: "flex", fontSize: 34, color: SOFT }}>{site}</div>
    </div>
  ) : (
    <div style={{ display: "flex", width: size.width, height: size.height, padding: Math.round(size.height * 0.08), justifyContent: "space-between", alignItems: "center", position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", maxWidth: size.width - leadSize.width - Math.round(size.height * 0.24) }}>
        <Words d={words} title={title} sub={sub} clock={clock} scale={size.height / 700} />
        {d && <Suitors d={d} faces={faces.slice(0, 5)} size={faceSize} gap={10} />}
        <div style={{ display: "flex", fontSize: Math.round(size.height * 0.036), color: SOFT }}>{site}</div>
      </div>
      {d && <Lead d={d} lead={lead} w={leadSize.width} h={leadSize.height} />}
    </div>
  );

  const card = new ImageResponse(
    (
      <Frame bg={bg} width={size.width} height={size.height}>
        {body}
      </Frame>
    ),
    { ...size, headers: SHARE_CARD_CACHE },
  );
  // The stage and the faces are drawn pictures: marked AI-generated, in the PNG's XMP and its headers (lib/ai-mark.ts).
  return pictured ? markedImageResponse(card) : card;
}
