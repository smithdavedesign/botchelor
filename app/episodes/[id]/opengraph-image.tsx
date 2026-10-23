import { ImageResponse } from "next/og";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { approvedPortraitDataUrl } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { DATE_VARIABLES, dateNumberOf, endingLabel, VARIABLE_LABELS } from "@/lib/rules";

export const alt = "A Botchelor episode box score";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#2a1a2e";
const MUTED = "#6b5a6e";
const PAPER = "#fff8f3";
const ACCENT = "#d6336c";

/** The box score share card (PRD "Further ideas"). Numbers only after the finale airs, so it can't leak the outcome. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let episode = null;
  let portraits: (string | null)[] = [null, null];
  try {
    const db = await getDb();
    episode = await getEpisodeView(db, id, null);
    if (episode) portraits = await Promise.all(episode.characters.map((c) => approvedPortraitDataUrl(db, c.id)));
  } catch {
    episode = null;
  }
  const names = episode ? `${episode.characters[0].name} × ${episode.characters[1].name}` : "Botchelor";
  const box = episode?.box_score; // present only once the finale has aired for a spectator

  // Satori (next/og) requires an explicit `display` on every <div> with more than one child; it is safe on
  // single-child ones too, so every div here sets it, and every text node is a single child of its div.
  // An OC's generated portrait when it has one, else the gradient tile.
  const tile = (c: { id: string; name: string; hue: number | null }, portrait: string | null) =>
    portrait ? (
      // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
      <img key={c.id} src={portrait} alt="" width={96} height={96} style={{ borderRadius: 26, objectFit: "cover" }} />
    ) : (
      <div
        key={c.id}
        style={{
          display: "flex",
          width: 96,
          height: 96,
          borderRadius: 26,
          background: avatarGradientCss(avatarPalette(c.id, c.hue)),
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 44,
          fontWeight: 800,
        }}
      >
        {initials(c.name)}
      </div>
    );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 80, background: PAPER, color: INK, borderTop: `24px solid ${ACCENT}`, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 34, color: ACCENT, fontWeight: 700 }}>Botchelor · box score</div>
        {episode && (
          <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 18 }}>
            {tile(episode.characters[0], portraits[0])}
            <div style={{ display: "flex", fontSize: 34, color: MUTED }}>×</div>
            {tile(episode.characters[1], portraits[1])}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 56, fontWeight: 800, marginTop: 14 }}>{names}</div>
        {box ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30, gap: 18 }}>
            {DATE_VARIABLES.map((v) => (
              <div key={v} style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ display: "flex", width: 300, fontSize: 30, color: MUTED }}>{VARIABLE_LABELS[v]}</div>
                <div style={{ display: "flex", width: 560, height: 30, background: "#ecdde3", borderRadius: 15 }}>
                  <div style={{ display: "flex", width: `${box[v].final * 5.6}px`, height: 30, background: ACCENT, borderRadius: 15 }} />
                </div>
                <div style={{ display: "flex", fontSize: 30, fontWeight: 700, width: 90 }}>{box[v].delta > 0 ? `+${box[v].delta}` : String(box[v].delta)}</div>
              </div>
            ))}
            {episode?.ending && (
              <div style={{ display: "flex", fontSize: 36, marginTop: 20, fontWeight: 700 }}>{`Ending: ${endingLabel(episode.ending, dateNumberOf(episode))}`}</div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 40, marginTop: 40, color: MUTED }}>
            Predict how this blind date ends, for free points. The box score reveals once the finale airs.
          </div>
        )}
      </div>
    ),
    size,
  );
}
