import { ImageResponse } from "next/og";
import { OG_BODY, OG_DISPLAY, OG_NIGHT, OgKicker, OgLetterbox, ogFontOptions } from "@/lib/og-type";
import { markedImageResponse } from "@/lib/ai-mark";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { portraitJpeg } from "@/lib/date-photo";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { handle, json } from "@/lib/http";
import { shortName } from "@/lib/names";
import { siteUrl } from "@/lib/site";
import { venueName } from "@/lib/venues";
import type { CharacterRef } from "@/lib/game";

const SIZE = { width: 1200, height: 630 };
/** An aired line never changes: an hour at the edge, a day stale. */
const CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";
const FACE = { width: 300, height: 400 };
/** The caption's longest: a longer line is cut at a word, the way a subtitle would be. */
const MAX_CAPTION = 190;

function momentCaption(line: string): string {
  const t = line.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_CAPTION) return t;
  const cut = t.slice(0, MAX_CAPTION);
  return `${cut.slice(0, Math.max(80, cut.lastIndexOf(" ")))}…`;
}

/**
 * GET /api/og/moment/<episode>/<line>: one line of a date as a share card (2026-11-28, Dave's "do 1-6", item 5), the
 * og:image of /episodes/<id>?moment=<line> that the theater's 📸 shares. Both of them on either side under the night's
 * light, the line between them as the subtitle, who said it. Only a public date that has aired (what a logged-out
 * viewer may read, getEpisodeView with no viewer): anything else, or a line it doesn't have, is a 404.
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string; line: string }> }) => {
  const { id, line } = await ctx.params;
  const i = /^\d{1,4}$/.test(line) ? Number(line) : -1;
  const db = await getDb();
  const episode = await getEpisodeView(db, id, null);
  const turn = episode && !episode.hidden && episode.revealed && episode.visibility === "public" ? episode.transcript?.[i] : undefined;
  if (!episode || !turn) return json({ error: "moment_not_found" }, 404);
  const faces = await Promise.all(episode.characters.map((c) => portraitJpeg(db, c.id, FACE).catch(() => null)));
  const speaker = turn.side === "a" ? 0 : 1;
  const card = new ImageResponse(
    <MomentCard characters={episode.characters} faces={faces} speaker={speaker} caption={momentCaption(turn.dialogue || turn.action)} place={typeof episode.venue === "string" ? venueName(episode.venue) : null} />,
    { ...SIZE, headers: { "cache-control": CACHE }, ...(await ogFontOptions()) },
  );
  return faces.some(Boolean) ? markedImageResponse(card) : card;
});

function Figure({ c, src, lit, side }: { c: CharacterRef; src: string | null; lit: boolean; side: "left" | "right" }) {
  const look = { width: FACE.width, height: FACE.height, opacity: lit ? 1 : 0.55, borderRadius: 28 };
  return (
    <div style={{ display: "flex", position: "absolute", bottom: 40, [side]: 40, flexDirection: "column", alignItems: "center" }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>
        <img src={src} alt="" width={FACE.width} height={FACE.height} style={{ ...look, objectFit: "cover", border: `4px solid ${lit ? OG_NIGHT.gold : OG_NIGHT.soft}` }} />
      ) : (
        <div style={{ ...look, display: "flex", alignItems: "center", justifyContent: "center", background: avatarGradientCss(avatarPalette(c.id, c.hue)), color: "#fff", fontSize: 110, fontWeight: 800 }}>
          {initials(c.name)}
        </div>
      )}
      <div style={{ display: "flex", marginTop: 10, fontSize: 26, fontWeight: 700, color: lit ? OG_NIGHT.ink : OG_NIGHT.soft }}>{shortName(c.name) || c.name}</div>
    </div>
  );
}

function MomentCard({ characters, faces, speaker, caption, place }: { characters: [CharacterRef, CharacterRef]; faces: (string | null)[]; speaker: 0 | 1; caption: string; place: string | null }) {
  const [a, b] = characters;
  const who = characters[speaker];
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: OG_NIGHT.bg, color: OG_NIGHT.ink, fontFamily: OG_BODY }}>
      <div
        style={{
          position: "absolute",
          left: speaker === 0 ? 0 : 600,
          top: 0,
          width: 600,
          height: 630,
          display: "flex",
          background: "radial-gradient(ellipse 60% 70% at 50% 60%, rgba(255,236,214,0.22), transparent 70%)",
        }}
      />
      <OgLetterbox />
      <Figure c={a} src={faces[0] ?? null} lit={speaker === 0} side="left" />
      <Figure c={b} src={faces[1] ?? null} lit={speaker === 1} side="right" />
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 370, top: 70, width: 460, alignItems: "center", textAlign: "center" }}>
        <OgKicker>{place ? `${shortName(a.name)} × ${shortName(b.name)} · ${place}` : `${shortName(a.name)} × ${shortName(b.name)}`}</OgKicker>
      </div>
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 360, top: 150, width: 480, height: 360, justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ display: "flex", fontFamily: OG_DISPLAY, fontSize: caption.length > 120 ? 34 : caption.length > 60 ? 42 : 52, fontWeight: 700, lineHeight: 1.18 }}>{`“${caption}”`}</div>
        <div style={{ display: "flex", marginTop: 22, fontSize: 24, color: OG_NIGHT.gold }}>{`— ${shortName(who.name) || who.name}`}</div>
      </div>
      <div style={{ display: "flex", position: "absolute", left: 0, right: 0, bottom: 46, justifyContent: "center", fontSize: 22, color: OG_NIGHT.soft }}>{`${new URL(siteUrl()).host} · watch the date`}</div>
    </div>
  );
}
