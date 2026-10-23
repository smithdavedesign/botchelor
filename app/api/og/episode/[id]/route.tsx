import { ImageResponse } from "next/og";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { approvedPortraitDataUrl } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { SHARE_QUESTION } from "@/lib/episode-share";
import { getEpisodeView, type EpisodeView } from "@/lib/game";
import { handle, json } from "@/lib/http";
import { dateNumberOf, endingLabel, ENDINGS, POINTS_PER_CORRECT_PICK } from "@/lib/rules";
import { siteUrl } from "@/lib/site";
import { venueName } from "@/lib/venues";

const SIZE = { width: 1200, height: 630 };
const INK = "#2a1a2e";
const MUTED = "#6b5a6e";
const PAPER = "#fff8f3";
const ACCENT = "#d6336c";

/**
 * One shared link is unfurled many times (every Discord channel and Reddit view of it), and the card reads the episode
 * and two portraits from Postgres. An hour at the edge keeps that to about one read an hour per episode. The card only
 * changes when the finale airs (its last line) or a portrait is approved.
 */
const CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * GET /api/og/episode/<id>: the episode's share card, a 1200×630 PNG that asks "How does it end?" with the three
 * endings as a poll (GROWTH.md, 2026-10-21). The episode page's og:image and twitter:image point here.
 *
 * It's drawn from what a logged-out spectator may see (getEpisodeView with no viewer), so it never has the ending before
 * the finale airs, and it never names a creator: the characters are the headline. It doesn't mark the ending after the
 * finale either, since a preview is for people who haven't watched. Unknown, private and hidden (reported) episodes
 * are a 404, so nobody can unfurl one.
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const episode = await getEpisodeView(db, id, null);
  if (!episode || episode.hidden) return json({ error: "episode_not_found" }, 404);
  // An OC's approved portrait when it has one, else the gradient tile (a failed read just means the tile).
  const portraits = await Promise.all(episode.characters.map((c) => approvedPortraitDataUrl(db, c.id).catch(() => null)));
  return new ImageResponse(<EpisodeCard episode={episode} portraits={portraits} />, { ...SIZE, headers: { "cache-control": CACHE } });
});

type Character = EpisodeView["characters"][number];

// Satori (next/og) needs an explicit `display` on every <div> with more than one child, so every div sets one, and
// every text node is the only child of its div.
function Tile({ character, portrait }: { character: Character; portrait: string | null }) {
  return portrait ? (
    // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
    <img src={portrait} alt="" width={104} height={104} style={{ borderRadius: 28, objectFit: "cover" }} />
  ) : (
    <div
      style={{
        display: "flex",
        width: 104,
        height: 104,
        borderRadius: 28,
        background: avatarGradientCss(avatarPalette(character.id, character.hue)),
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 46,
        fontWeight: 800,
      }}
    >
      {initials(character.name)}
    </div>
  );
}

function EpisodeCard({ episode, portraits }: { episode: EpisodeView; portraits: (string | null)[] }) {
  const [a, b] = episode.characters;
  const names = `${a.name} × ${b.name}`;
  const namesSize = names.length > 44 ? 38 : names.length > 30 ? 46 : 56;
  const footer = episode.revealed
    ? "The finale has aired. Make your guess, then watch how it went."
    : `Pick one before the finale airs: a right guess earns ${POINTS_PER_CORRECT_PICK} points.`;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "48px 72px 52px",
        background: PAPER,
        color: INK,
        borderTop: `20px solid ${ACCENT}`,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: ACCENT }}>Botchelor · an AI blind date</div>
        <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{new URL(siteUrl()).host}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 30 }}>
        <Tile character={a} portrait={portraits[0]} />
        <div style={{ display: "flex", fontSize: 38, color: MUTED, margin: "0 16px" }}>×</div>
        <Tile character={b} portrait={portraits[1]} />
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 28, width: 680 }}>
          <div style={{ display: "flex", fontSize: namesSize, fontWeight: 800, lineHeight: 1.1 }}>{names}</div>
          {episode.venue && <div style={{ display: "flex", fontSize: 28, color: MUTED, marginTop: 8 }}>{venueName(episode.venue)}</div>}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 76, fontWeight: 800, marginTop: 36, letterSpacing: -1 }}>{SHARE_QUESTION}</div>
      <div style={{ display: "flex", marginTop: 22 }}>
        {ENDINGS.map((ending) => (
          <div
            key={ending}
            style={{
              display: "flex",
              alignItems: "center",
              marginRight: 18,
              padding: "14px 30px 14px 22px",
              border: `4px solid ${ACCENT}`,
              borderRadius: 999,
              background: "#ffffff",
            }}
          >
            <div style={{ display: "flex", width: 28, height: 28, borderRadius: 14, border: `4px solid ${ACCENT}`, marginRight: 14 }} />
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{endingLabel(ending, dateNumberOf(episode))}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto", fontSize: 30, color: MUTED }}>{footer}</div>
    </div>
  );
}
