import { ImageResponse } from "next/og";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { DATE_VARIABLES, ENDING_LABELS, VARIABLE_LABELS } from "@/lib/rules";

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
  try {
    episode = await getEpisodeView(await getDb(), id, null);
  } catch {
    episode = null;
  }
  const names = episode ? `${episode.characters[0].name} × ${episode.characters[1].name}` : "Botchelor";
  const box = episode?.box_score; // present only once the finale has aired for a spectator

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 80, background: PAPER, color: INK, borderTop: `24px solid ${ACCENT}`, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 34, color: ACCENT, fontWeight: 700 }}>Botchelor · box score</div>
        <div style={{ fontSize: 64, fontWeight: 800, marginTop: 12 }}>{names}</div>
        {box ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30, gap: 18 }}>
            {DATE_VARIABLES.map((v) => (
              <div key={v} style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ width: 300, fontSize: 30, color: MUTED }}>{VARIABLE_LABELS[v]}</div>
                <div style={{ display: "flex", width: 560, height: 30, background: "#ecdde3", borderRadius: 15 }}>
                  <div style={{ display: "flex", width: `${box[v].final * 5.6}px`, height: 30, background: ACCENT, borderRadius: 15 }} />
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, width: 90 }}>{box[v].delta > 0 ? `+${box[v].delta}` : box[v].delta}</div>
              </div>
            ))}
            {episode?.ending && <div style={{ fontSize: 36, marginTop: 20, fontWeight: 700 }}>Ending: {ENDING_LABELS[episode.ending]}</div>}
          </div>
        ) : (
          <div style={{ fontSize: 40, marginTop: 40, color: MUTED }}>
            Predict how this blind date ends, for free points. The box score reveals once the finale airs.
          </div>
        )}
      </div>
    ),
    size,
  );
}
