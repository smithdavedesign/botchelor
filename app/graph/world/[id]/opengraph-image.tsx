import { ImageResponse } from "next/og";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { SHARE_CARD_CACHE } from "@/lib/ai-mark";
import { cachedWorld } from "@/lib/social/cache";
import { socialLensesOn } from "@/lib/social/lens-sky";
import { RINGS, type Ring } from "@/lib/social/types";

// "X's world" share card: the character's initials in the middle of their rings, how many sit on each, and who they're
// at odds with on a red arc. Drawn, never a portrait (the card stays cheap and needs no image pipeline). OG images use
// raw hex, like the Constellation's own card.
export const alt = "A Botchelor character's world: who they're close to, who they're at odds with, where they belong";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0e0712";
const INK = "#f5e9f0";
const MUTED = "#b49fbd";
const RING = "#43304f";
const ACCENT = "#ff5e8c";
const RED = "#e66767";
const DOT: Record<Ring, string> = { inner: "#ff5e8c", close: "#a98bff", friends: "#3987e5", acquaintances: "#7d6b88" };
const R: Record<Ring, number> = { inner: 70, close: 120, friends: 170, acquaintances: 215 };
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = socialLensesOn() && ID.test(id) ? await cachedWorld(id, null).catch(() => null) : null;
  const name = w?.centre.name ?? "Botchelor";
  const palette = avatarPalette(w?.centre.id ?? id, w?.centre.private ? null : (w?.centre.hue ?? null));
  const counts = Object.fromEntries(RINGS.map((r) => [r, w && !w.centre.private ? w.rings[r].length : 0])) as Record<Ring, number>;
  const odds = w && !w.centre.private ? new Set(w.ties.filter((t) => t.status === "active" && t.valence < 0).map((t) => t.to_person ?? (t.from === id ? t.to : t.from))).size : 0;
  const cx = 300;
  const cy = 315;
  // A dot for each, up to 24 a ring, evenly round it.
  const dots = RINGS.flatMap((ring) => {
    const n = Math.min(counts[ring], 24);
    return Array.from({ length: n }, (_, i) => {
      const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
      return { ring, x: cx + R[ring] * Math.cos(a), y: cy + R[ring] * Math.sin(a) };
    });
  });
  const total = RINGS.reduce((s, r) => s + counts[r], 0);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: BG, color: INK, fontFamily: "sans-serif", position: "relative" }}>
        <svg width="600" height="630" style={{ position: "absolute", top: 0, left: 0 }}>
          {RINGS.map((ring) => (
            <circle key={ring} cx={cx} cy={cy} r={R[ring]} fill="none" stroke={RING} strokeWidth={2} strokeDasharray="4 8" />
          ))}
          {odds > 0 && <path d={`M ${cx + R.acquaintances * Math.cos(Math.PI / 3)} ${cy + R.acquaintances * Math.sin(Math.PI / 3)} A ${R.acquaintances} ${R.acquaintances} 0 0 1 ${cx + R.acquaintances * Math.cos((2 * Math.PI) / 3)} ${cy + R.acquaintances * Math.sin((2 * Math.PI) / 3)}`} fill="none" stroke={RED} strokeWidth={14} strokeOpacity={0.45} strokeLinecap="round" />}
          {dots.map((d, i) => (
            <line key={`l${i}`} x1={cx} y1={cy} x2={d.x} y2={d.y} stroke={DOT[d.ring]} strokeOpacity={0.35} strokeWidth={2} />
          ))}
          {dots.map((d, i) => (
            <circle key={`d${i}`} cx={d.x} cy={d.y} r={d.ring === "inner" ? 16 : d.ring === "close" ? 12 : d.ring === "friends" ? 9 : 6} fill={DOT[d.ring]} />
          ))}
        </svg>
        <div style={{ position: "absolute", left: cx - 48, top: cy - 48, width: 96, height: 96, borderRadius: 48, display: "flex", alignItems: "center", justifyContent: "center", background: avatarGradientCss(palette), color: "#fff", fontSize: 40, fontWeight: 800 }}>
          {w?.centre.private ? "🔒" : initials(name)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: 600, paddingRight: 70, width: 600 }}>
          <div style={{ fontSize: 32, color: ACCENT, fontWeight: 700 }}>Botchelor · their world</div>
          <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.08, marginTop: 12 }}>{`${name}'s world`}</div>
          <div style={{ fontSize: 30, color: MUTED, marginTop: 20 }}>
            {w?.centre.private
              ? "Private: their creator keeps them to themselves."
              : `${total} ${total === 1 ? "person" : "people"} · ${counts.inner} in the inner circle${odds ? ` · at odds with ${odds}` : ""}`}
          </div>
        </div>
      </div>
    ),
    { ...size, headers: SHARE_CARD_CACHE },
  );
}
