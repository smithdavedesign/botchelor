import { ImageResponse } from "next/og";
import { markedImageResponse } from "@/lib/ai-mark";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { approvedPortraitDataUrl } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { getEpisodeView, type EpisodeView } from "@/lib/game";
import { handle, json } from "@/lib/http";
import { shortName } from "@/lib/names";
import { clipForCard, type Grade, gradeTone, type ReportCard, reportCardOf, seeAgainWords } from "@/lib/report-card";
import { siteUrl } from "@/lib/site";

const SIZE = { width: 1200, height: 630 };
const INK = "#2a1a2e";
const MUTED = "#6b5a6e";
const PAPER = "#fff8f3";
const RULE = "#ecdde3";
const ACCENT = "#d6336c";
/** Each grade family's ink: A green, B blue, C amber, D/F red. */
const TONE: Record<ReturnType<typeof gradeTone>, string> = { a: "#2b8a3e", b: "#1c6bb0", c: "#b8650a", f: "#c92a2a" };

/** A report card only changes if a portrait is approved after it aired: an hour at the edge, like the episode card. */
const CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * GET /api/og/report-card/<id>: a date's report card as a 1200×630 PNG (lib/report-card.ts), the report card page's
 * og:image and its "Save the picture". Drawn from what a logged-out spectator may see, so only once the finale has aired;
 * unknown, private, hidden or unaired dates are a 404, so a typed address can't spoil an ending.
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const episode = await getEpisodeView(db, id, null);
  const card = reportCardOf(episode);
  if (!episode || !card) return json({ error: "report_card_not_found" }, 404);
  const portraits = await Promise.all(episode.characters.map((c) => approvedPortraitDataUrl(db, c.id).catch(() => null)));
  const image = new ImageResponse(<Card card={card} characters={episode.characters} portraits={portraits} />, { ...SIZE, headers: { "cache-control": CACHE } });
  // A card with a generated portrait in it is marked AI-generated, in its PNG's XMP and its headers (lib/ai-mark.ts).
  return portraits.some(Boolean) ? markedImageResponse(image) : image;
});

type Character = EpisodeView["characters"][number];

// Satori (next/og) needs an explicit `display` on every <div> with more than one child, so every div sets one, and
// every text node is the only child of its div.
function Tile({ character, portrait }: { character: Character; portrait: string | null }) {
  return portrait ? (
    // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
    <img src={portrait} alt="" width={84} height={84} style={{ borderRadius: 42, objectFit: "cover" }} />
  ) : (
    <div
      style={{
        display: "flex",
        width: 84,
        height: 84,
        borderRadius: 42,
        background: avatarGradientCss(avatarPalette(character.id, character.hue)),
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 36,
        fontWeight: 800,
      }}
    >
      {initials(character.name)}
    </div>
  );
}

function Letter({ grade, size }: { grade: Grade; size: number }) {
  return <div style={{ display: "flex", fontSize: size, fontWeight: 900, color: TONE[gradeTone(grade)], lineHeight: 1 }}>{grade}</div>;
}

function Card({ card, characters, portraits }: { card: ReportCard; characters: Character[]; portraits: (string | null)[] }) {
  const names = `${card.names[0]} × ${card.names[1]}`;
  const namesSize = names.length > 40 ? 34 : names.length > 28 ? 42 : 50;
  // One line on the card under the subjects: a verdict (the first that has words), else the quote of the night.
  const said = card.verdicts.find((v) => v.line);
  const footnote = said
    ? `${shortName(said.name)}${said.kind === "see_again" && said.seeAgain ? ` (${seeAgainWords(said.seeAgain).toLowerCase()})` : ""}: “${clipForCard(said.line!)}”`
    : card.quote
      ? `Quote of the night: “${clipForCard(card.quote)}”`
      : null;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "40px 64px 40px", background: PAPER, color: INK, borderTop: `20px solid ${ACCENT}`, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: ACCENT }}>Botchelor · date report card</div>
        <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{new URL(siteUrl()).host}</div>
      </div>
      <div style={{ display: "flex", marginTop: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Tile character={characters[0]} portrait={portraits[0]} />
            <div style={{ display: "flex", fontSize: 32, color: MUTED, margin: "0 12px" }}>×</div>
            <Tile character={characters[1]} portrait={portraits[1]} />
          </div>
          <div style={{ display: "flex", fontSize: namesSize, fontWeight: 800, marginTop: 16, lineHeight: 1.1 }}>{names}</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 18 }}>
            <Letter grade={card.overall} size={128} />
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 26 }}>
              <div style={{ display: "flex", fontSize: 24, color: MUTED }}>How it ended</div>
              <div style={{ display: "flex", fontSize: 36, fontWeight: 800, maxWidth: 420 }}>{card.ending}</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 432, marginLeft: 0, borderLeft: `4px solid ${RULE}`, paddingLeft: 36 }}>
          {card.subjects.map((s) => (
            <div key={s.variable} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: `3px solid ${RULE}` }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>{s.label}</div>
                <div style={{ display: "flex", fontSize: 20, color: MUTED }}>{s.comment}</div>
              </div>
              <Letter grade={s.grade} size={56} />
            </div>
          ))}
        </div>
      </div>
      {footnote && <div style={{ display: "flex", marginTop: "auto", fontSize: 28, color: INK, fontStyle: "italic" }}>{footnote}</div>}
    </div>
  );
}
