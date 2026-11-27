// The season's cast reveal (David, 2026-11-27: "Meet the suitors" for the Product Hunt launch): the stage cold open,
// the lead holding out a rose, each suitor on a card with their one line, everyone on the stage under "Who gets the final
// rose?", then the end card. Props come from GET /api/seasons/<slug>/cast (scripts/clips/season-promo.mjs). Every line is
// the character's own bio's first sentence.
import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, KenBurns, NEON, SANS, SERIF, Vignette, Wordmark, clamp, sceneFade, src, useLayout } from "./brand";
import { EndCard } from "./Show";

export type CastMember = { name: string; line: string; image: string | null; hue: number | null };
export type CastRevealProps = {
  /** "Season 3 · December". */
  kicker: string;
  /** The format: "The Botchelor". */
  title: string;
  /** "One lead. Five suitors. A rose ceremony every Sunday." */
  sub: string;
  lead: CastMember | null;
  suitors: CastMember[];
  /** "suitors" once the cast is picked; "auditions" before (casting's top of the vote). */
  facesAre: "suitors" | "auditions";
  /** The clock: "Starts Tuesday, December 1". */
  clock: string;
  url: string;
};

export const OPEN = 90;
export const LEAD = 135;
export const EACH = 66;
export const GROUP = 100;
export const END = 90;
export const castFrames = (p: CastRevealProps) => OPEN + (p.lead ? LEAD : 0) + Math.max(1, p.suitors.length) * EACH + GROUP + END;

const Portrait: React.FC<{ m: CastMember; w: number; h: number; round?: boolean; ring?: string }> = ({ m, w, h, round = false, ring = C.accent }) => {
  const { u } = useLayout();
  const style: React.CSSProperties = { width: w, height: h, borderRadius: round ? "50%" : u * 2.5, border: `${u * 0.6}px solid ${ring}`, flexShrink: 0, boxShadow: `0 ${u}px ${u * 5}px rgba(0,0,0,0.55)` };
  return m.image ? (
    <Img src={src(m.image)} style={{ ...style, objectFit: "cover", objectPosition: "50% 20%" }} />
  ) : (
    <div
      style={{
        ...style,
        background: `linear-gradient(135deg, hsl(${m.hue ?? 330} 70% 60%), hsl(${((m.hue ?? 330) + 50) % 360} 60% 38%))`,
        color: "#fff",
        fontFamily: SERIF,
        fontWeight: 800,
        fontSize: Math.min(w, h) * 0.42,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {m.name.slice(0, 1)}
    </div>
  );
};

/* ---------- 1. cold open ---------- */
const Open: React.FC<{ p: CastRevealProps; len: number }> = ({ p, len }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u } = useLayout();
  const pop = spring({ frame: f - 22, fps, config: { damping: 11, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, len, 6) }}>
      <KenBurns image="cast/set-stage-v3.webp" from={1.25} to={1.08} dim={0.3} />
      <Vignette />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${u * 5}px` }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, letterSpacing: u * 0.6, textTransform: "uppercase", color: C.soft, fontSize: u * 3.2, opacity: interpolate(f, [2, 14], [0, 1], clamp) }}>{p.kicker}</div>
        <div style={{ marginTop: u * 1.5, fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, color: "#fff", fontSize: u * 6, opacity: interpolate(f, [8, 20], [0, 1], clamp) }}>on</div>
        <div style={{ marginTop: u, transform: `scale(${0.6 + 0.4 * pop})`, opacity: Math.min(1, pop * 1.4) }}>
          <Wordmark size={u * 15} glow={1 + Math.sin(f / 5)} />
        </div>
        <div
          style={{
            marginTop: u * 3,
            fontFamily: SERIF,
            fontWeight: 800,
            fontSize: u * 9,
            lineHeight: 1.05,
            background: NEON,
            WebkitBackgroundClip: "text",
            color: "transparent",
            opacity: interpolate(f, [40, 52], [0, 1], clamp),
            transform: `translateY(${interpolate(f, [40, 52], [u * 3, 0], clamp)}px)`,
          }}
        >
          {p.title}
        </div>
        <div style={{ marginTop: u * 2.5, fontFamily: SANS, fontWeight: 600, color: "#fff", fontSize: u * 3.4, opacity: interpolate(f, [56, 68], [0, 1], clamp), textShadow: "0 4px 20px rgba(0,0,0,0.7)" }}>{p.sub}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- 2. the lead ---------- */
const Lead: React.FC<{ m: CastMember; len: number }> = ({ m, len }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, vertical } = useLayout();
  const p = spring({ frame: f - 6, fps, config: { damping: 14, stiffness: 90 } });
  const words = interpolate(f, [30, 44], [0, 1], clamp);
  const w = vertical ? u * 70 : u * 44;
  const h = w * 1.25;
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, len, 8) }}>
      <KenBurns image="cast/set-stage-v3.webp" from={1.1} to={1.2} dim={0.55} blur={6} />
      <Vignette />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: vertical ? "column" : "row", gap: u * 5, padding: u * 5 }}>
        <div style={{ transform: `scale(${0.7 + 0.3 * p}) rotate(${(1 - p) * -4}deg)`, opacity: p }}>
          <Portrait m={m} w={w} h={h} ring={C.gold} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: vertical ? "center" : "flex-start", textAlign: vertical ? "center" : "left", maxWidth: vertical ? u * 86 : u * 80, opacity: words, transform: `translateY(${(1 - words) * u * 3}px)` }}>
          <div style={{ fontFamily: SANS, fontWeight: 800, letterSpacing: u * 0.6, color: C.gold, fontSize: u * 3.4 }}>🌹 THE LEAD</div>
          <div style={{ fontFamily: SERIF, fontWeight: 800, color: "#fff", fontSize: m.name.length > 16 ? u * 8 : u * 10, lineHeight: 1.02, marginTop: u }}>{m.name}</div>
          {m.line ? <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, color: C.soft, fontSize: u * 3.8, lineHeight: 1.3, marginTop: u * 2 }}>{m.line}</div> : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- 3. each suitor ---------- */
const Suitor: React.FC<{ m: CastMember; n: number; of: number; label: string; len: number }> = ({ m, n, of, label, len }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, vertical } = useLayout();
  const from = n % 2 === 0 ? -1 : 1;
  const p = spring({ frame: f, fps, config: { damping: 15, stiffness: 140 } });
  const size = vertical ? u * 52 : u * 40;
  return (
    <AbsoluteFill style={{ opacity: interpolate(f, [len - 6, len], [1, 0], clamp) }}>
      <KenBurns image="cast/set-stage-v3.webp" from={1.15} to={1.2} dim={0.6} blur={8} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: vertical ? "column" : "row", gap: u * 4, padding: u * 5, transform: `translateX(${(1 - p) * from * 110}%)` }}>
        <Portrait m={m} w={size} h={size} round />
        <div style={{ display: "flex", flexDirection: "column", alignItems: vertical ? "center" : "flex-start", textAlign: vertical ? "center" : "left", maxWidth: vertical ? u * 86 : u * 90 }}>
          <div style={{ fontFamily: SANS, fontWeight: 800, letterSpacing: u * 0.5, color: C.accent, fontSize: u * 3 }}>
            {label} {n + 1} OF {of}
          </div>
          <div style={{ fontFamily: SERIF, fontWeight: 800, color: "#fff", fontSize: m.name.length > 16 ? u * 7 : u * 9, lineHeight: 1.05, marginTop: u * 0.8 }}>{m.name}</div>
          {m.line ? <div style={{ fontFamily: SANS, fontWeight: 400, color: C.soft, fontSize: u * 3.4, lineHeight: 1.35, marginTop: u * 1.6 }}>{m.line}</div> : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- 4. everyone on the stage ---------- */
const Group: React.FC<{ p: CastRevealProps; len: number }> = ({ p, len }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, vertical } = useLayout();
  const size = vertical ? u * 20 : u * 17;
  const ask = interpolate(f, [34, 46], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, len, 8) }}>
      <KenBurns image="cast/set-elimination-v3.webp" from={1} to={1.1} dim={0.35} />
      <Vignette />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: u * 4, gap: u * 4 }}>
        {p.lead ? (
          <div style={{ transform: `scale(${spring({ frame: f, fps, config: { damping: 14 } })})` }}>
            <Portrait m={p.lead} w={size * 1.4} h={size * 1.4} round ring={C.gold} />
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: u * 2.5, maxWidth: vertical ? u * 92 : u * 170 }}>
          {p.suitors.map((m, i) => {
            const s = spring({ frame: f - 6 - i * 4, fps, config: { damping: 13 } });
            return (
              <div key={m.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${s})` }}>
                <Portrait m={m} w={size} h={size} round />
                <div style={{ fontFamily: SANS, fontWeight: 600, color: "#fff", fontSize: u * 2.6, marginTop: u }}>{m.name.split(" ")[0]}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: SERIF, fontWeight: 800, color: "#fff", fontSize: u * 7.5, textAlign: "center", opacity: ask, textShadow: "0 4px 30px rgba(0,0,0,0.8)" }}>Who gets the final rose?</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const CastReveal: React.FC<CastRevealProps> = (p) => {
  const label = p.facesAre === "suitors" ? "SUITOR" : "TOP OF CASTING";
  const suitorsAt = OPEN + (p.lead ? LEAD : 0);
  const groupAt = suitorsAt + Math.max(1, p.suitors.length) * EACH;
  return (
    <AbsoluteFill style={{ background: C.dark }}>
      <Sequence from={0} durationInFrames={OPEN}>
        <Open p={p} len={OPEN} />
      </Sequence>
      {p.lead ? (
        <Sequence from={OPEN} durationInFrames={LEAD}>
          <Lead m={p.lead} len={LEAD} />
        </Sequence>
      ) : null}
      {p.suitors.map((m, i) => (
        <Sequence key={m.name} from={suitorsAt + i * EACH} durationInFrames={EACH}>
          <Suitor m={m} n={i} of={p.suitors.length} label={label} len={EACH} />
        </Sequence>
      ))}
      <Sequence from={groupAt} durationInFrames={GROUP}>
        <Group p={p} len={GROUP} />
      </Sequence>
      <Sequence from={groupAt + GROUP} durationInFrames={END}>
        <EndCard lines={[p.title + ".", p.clock + "."]} url={p.url} small="Vote who goes home · call every date · free" footer="AI-generated characters. Original adults only." />
      </Sequence>
    </AbsoluteFill>
  );
};

/** Props for the studio preview: the house cast, with lines in their own style. The script passes the real season's. */
export const CAST_PREVIEW: CastRevealProps = {
  kicker: "Season 3 · December",
  title: "The Botchelor",
  sub: "One lead. Five suitors. A rose ceremony every Sunday.",
  lead: { name: "Juniper Vale", line: "Talks to the gulls. The gulls have not talked back yet.", image: "cast/house-juniper-v5.webp", hue: 200 },
  suitors: [
    { name: "Nell Abiodun", line: "Gives the full tour to empty rooms. Word-perfect.", image: "cast/house-nell-v5.webp", hue: 225 },
    { name: "Dex", line: "A suitor with a story.", image: "cast/house-dex-v5.webp", hue: 20 },
    { name: "Boaz", line: "A suitor with a story.", image: "cast/house-boaz-v5.webp", hue: 120 },
  ],
  facesAre: "suitors",
  clock: "Starts Tuesday, December 1",
  url: "botchelor.com/december",
};

