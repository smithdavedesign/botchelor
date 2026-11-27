import { ImageResponse } from "next/og";
import { OG_BODY, OG_DISPLAY, OG_NIGHT, OgLetterbox, ogFontOptions } from "@/lib/og-type";
import { markedImageResponse, SHARE_CARD_CACHE } from "@/lib/ai-mark";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { approvedPortraitDataUrl } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { getPublicCharacter } from "@/lib/game";
import { loadCharacterMemory, type MilestoneId } from "@/lib/memory";
import { seasonLabel } from "@/lib/season-window";

export const dynamic = "force-dynamic";

const INK = OG_NIGHT.ink;
const MUTED = OG_NIGHT.soft;
const PAPER = OG_NIGHT.bg;
const ACCENT = OG_NIGHT.accent;

/** Milestones that say nothing about how the date ended, so the card may name who it was with. */
const NEUTRAL: ReadonlySet<MilestoneId> = new Set(["first_date", "rematch", "five_dates", "ten_dates", "twenty_five_dates"]);

const FORMATS = { og: { width: 1200, height: 630 }, story: { width: 1080, height: 1920 } } as const;

/**
 * A character's big moment as a card to post (David, 2026-11-27: "moment cards for creators"): one milestone from
 * their aired story (lib/memory.ts findMilestones, the chips on their page), their face, the season, and the
 * show's name. ?m=<milestone id>, ?format=og (1200×630, the default) or story (1080×1920). Public, like the
 * milestone chips it's drawn from: a private character, a milestone they haven't reached, or one from a date that
 * isn't public is a 404. A creator posting their character's moment is the show's cheapest marketing.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "story" ? "story" : "og";
  const db = await getDb();
  const c = await getPublicCharacter(db, id);
  if (!c || c.private) return new Response("Not found", { status: 404 });
  const m = (await loadCharacterMemory(db, id))?.milestones?.find((x) => x.id === url.searchParams.get("m"));
  if (!m) return new Response("Not found", { status: 404 });
  // Only a public date's moment, and the other side's name only when they're public too.
  const { rows } = await db.query<{ other: string | null }>(
    `select o.name as other from episodes e
       left join characters o on o.id = case when e.character_a = $2 then e.character_b else e.character_a end and o.visibility = 'public'
      where e.id = $1 and e.visibility = 'public' and $2 in (e.character_a, e.character_b)`,
    [m.episode_id, id],
  );
  if (!rows.length) return new Response("Not found", { status: 404 });
  const other = rows[0].other ? { name: rows[0].other } : null;
  const portrait = await approvedPortraitDataUrl(db, id);

  // The label's emoji stays off the card: next/og would fetch emoji art from a CDN at render time.
  const title = m.label.replace(/^\S+\s+/, "");
  const withWho = NEUTRAL.has(m.id) && other ? `with ${other.name}` : null;
  const { width, height } = FORMATS[format];
  const tall = format === "story";
  const face = tall ? 560 : 320;
  const palette = avatarPalette(c.id, c.hue ?? null);

  const card = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: tall ? "column" : "row", alignItems: "center", justifyContent: "center", gap: tall ? 60 : 64, padding: tall ? 90 : 70, background: PAPER, color: INK, position: "relative", fontFamily: OG_BODY }}>
        <OgLetterbox />
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
          <img src={portrait} alt="" width={face} height={face} style={{ borderRadius: 72, objectFit: "cover", border: `10px solid ${ACCENT}`, flex: "0 0 auto" }} />
        ) : (
          <div style={{ display: "flex", width: face, height: face, borderRadius: 72, background: avatarGradientCss(palette), alignItems: "center", justifyContent: "center", color: "#fff", fontSize: face / 2.2, fontWeight: 800, flex: "0 0 auto" }}>
            {initials(c.name)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: tall ? "center" : "flex-start", textAlign: tall ? "center" : "left", maxWidth: tall ? 900 : 700 }}>
          <div style={{ display: "flex", fontSize: tall ? 40 : 30, color: ACCENT, fontWeight: 700, letterSpacing: 2 }}>{`BOTCHELOR · ${seasonLabel(m.season).toUpperCase()}`}</div>
          <div style={{ display: "flex", marginTop: 26, padding: "8px 22px", borderRadius: 999, background: "rgba(255,94,140,0.16)", color: ACCENT, fontSize: tall ? 34 : 24, fontWeight: 700, letterSpacing: 3 }}>A MOMENT</div>
          <div style={{ display: "flex", fontFamily: OG_DISPLAY, fontSize: tall ? 84 : 60, fontWeight: 800, marginTop: 8, lineHeight: 1.1 }}>{title}</div>
          <div style={{ display: "flex", fontSize: tall ? 52 : 38, color: MUTED, marginTop: 18 }}>{withWho ? `${c.name}, ${withWho}` : c.name}</div>
          <div style={{ display: "flex", fontSize: tall ? 36 : 26, color: MUTED, marginTop: tall ? 60 : 30 }}>AI characters on blind dates nobody steers · botchelor.com</div>
        </div>
      </div>
    ),
    { width, height, headers: SHARE_CARD_CACHE, ...(await ogFontOptions()) },
  );
  return portrait ? markedImageResponse(card) : card;
}
