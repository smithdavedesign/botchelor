import { ImageResponse } from "next/og";
import { markedImageResponse } from "@/lib/ai-mark";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { approvedPortraitDataUrl } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { getPublicCharacter } from "@/lib/game";

export const alt = "A Botchelor contestant card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#241022";
const MUTED = "#7a6a7e";
const PAPER = "#fdf6f4";
const ACCENT = "#e5356b";

/** The shareable contestant card (the Talkie-style card hook, our way): a character's public persona. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let c = null;
  let portrait: string | null = null;
  try {
    const db = await getDb();
    c = await getPublicCharacter(db, id);
    // A private character's card shows its name only (the drawn avatar, no bio).
    if (c?.private) c = { ...c, bio: "", traits: [], want: "" };
    else if (c) portrait = await approvedPortraitDataUrl(db, c.id);
  } catch {
    c = null;
  }
  const name = c?.name ?? "Botchelor";
  const palette = avatarPalette(c?.id ?? id, c?.hue ?? null);

  const card = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 70, background: PAPER, color: INK, borderTop: `24px solid ${ACCENT}`, fontFamily: "sans-serif", alignItems: "center", gap: 56 }}>
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>, not next/image
          <img src={portrait} alt="" width={300} height={300} style={{ borderRadius: 64, objectFit: "cover", flex: "0 0 auto" }} />
        ) : (
          <div style={{ display: "flex", width: 300, height: 300, borderRadius: 64, background: avatarGradientCss(palette), alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 140, fontWeight: 800, flex: "0 0 auto" }}>
            {initials(name)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: ACCENT, fontWeight: 700 }}>Botchelor · contestant</div>
          <div style={{ fontSize: 72, fontWeight: 800, marginTop: 6 }}>{name}</div>
          {c && (
            <div style={{ fontSize: 30, color: MUTED, marginTop: 8 }}>
              {`Age ${c.age}${c.house ? " · house character" : ""}`}
            </div>
          )}
          {c && (
            <div style={{ display: "flex", gap: 14, marginTop: 24, flexWrap: "wrap" }}>
              {c.traits.slice(0, 3).map((t) => (
                <div key={t} style={{ display: "flex", padding: "8px 20px", borderRadius: 999, background: "#fde4ec", color: ACCENT, fontSize: 28, fontWeight: 600 }}>
                  {t}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 26, color: MUTED, marginTop: 28 }}>Send your OC on a blind date. Then just watch.</div>
        </div>
      </div>
    ),
    size,
  );
  // A card with a generated portrait in it is marked AI-generated, in its PNG's XMP and its headers (lib/ai-mark.ts).
  return portrait ? markedImageResponse(card) : card;
}
