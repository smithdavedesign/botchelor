// One branded date: the cold open, the two contestants, their lines, how it ended (or "How does it end?"), the end
// card. The ad (Root.tsx AD_PROPS) and every daily branded clip (scripts/clips/branded-clip.mjs) are this one template
// with different props. Every word in a bubble is the date's own (the script picks and trims them).
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AppIcon, C, ENDING_STYLE, GRAD, Heart, KenBurns, NEON, SANS, SERIF, Vignette, clamp, sceneFade, src, useLayout, Wordmark } from "./brand";

export type Face = {
  name: string;
  /** Under the name: "House cast", "Made by an AI agent", "By Mira on Botchelor". */
  tag: string;
  /** The goal they walked in with, or a line about them. */
  about: string | null;
  portrait: string | null;
  hue: number | null;
};
export type Line = { side: "a" | "b"; text: string; at: number };
export type ShowProps = {
  faces: [Face, Face];
  backdrop: string | null;
  chip: string;
  lines: Line[];
  ending: "second_date" | "friends" | "close_friends" | "disaster" | null;
  endingLabel: string | null;
  /** "ad" and "teaser" ask "How does it end?"; "full" stamps the real ending. */
  variant: "ad" | "teaser" | "full";
  /** Where each scene starts, in frames, and the last frame. */
  t: { cast: number; date: number; verdict: number; end: number; total: number };
  audio: string | null;
  endLines: string[];
  url: string;
  small: string;
};

/* ---------- faces ---------- */
const Face: React.FC<{ face: Face; size: number; ring?: number }> = ({ face, size, ring = 0 }) =>
  face.portrait ? (
    <Img
      src={src(face.portrait)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", objectPosition: "50% 20%", border: ring ? `${ring}px solid ${C.accent}` : undefined, flexShrink: 0 }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        border: ring ? `${ring}px solid ${C.accent}` : undefined,
        background: `linear-gradient(135deg, hsl(${face.hue ?? 330} 70% 60%), hsl(${((face.hue ?? 330) + 50) % 360} 60% 38%))`,
        color: "#fff",
        fontFamily: SERIF,
        fontWeight: 800,
        fontSize: size * 0.45,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {face.name.slice(0, 1)}
    </div>
  );

/* ---------- 1. cold open ---------- */
const ColdOpen: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u } = useLayout();
  const tonight = interpolate(f, [4, 18], [0, 1], clamp);
  const pop = spring({ frame: f - 16, fps, config: { damping: 11, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, len, 6) }}>
      <KenBurns image="cast/set-stage-v3.webp" from={1.25} to={1.1} dim={0.25} />
      <Vignette />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, color: "#fff", fontSize: u * 7, opacity: tonight, transform: `translateY(${(1 - tonight) * u * 3}px)`, textShadow: "0 4px 30px rgba(0,0,0,0.6)" }}>
          Tonight, on
        </div>
        <div style={{ marginTop: u, transform: `scale(${0.6 + 0.4 * pop})`, opacity: Math.min(1, pop * 1.4) }}>
          <Wordmark size={u * 17} glow={1 + Math.sin(f / 5)} />
        </div>
        <div style={{ marginTop: u * 3, fontFamily: SANS, fontWeight: 600, letterSpacing: u * 0.5, textTransform: "uppercase", color: C.soft, fontSize: u * 3, opacity: interpolate(f, [34, 46], [0, 1], clamp) }}>
          a blind date show for AI characters
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- 2. the contestants ---------- */
const Card: React.FC<{ face: Face; delay: number; fromLeft: boolean }> = ({ face, delay, fromLeft }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, vertical } = useLayout();
  const p = spring({ frame: f - delay, fps, config: { damping: 14, stiffness: 110 } });
  const picture = face.portrait ? (
    <Img src={src(face.portrait)} style={{ width: vertical ? u * 34 : "100%", height: vertical ? u * 40 : u * 50, objectFit: "cover", objectPosition: "50% 20%" }} />
  ) : (
    <div style={{ width: vertical ? u * 34 : "100%", height: vertical ? u * 40 : u * 50, display: "flex", alignItems: "center", justifyContent: "center", background: C.soft }}>
      <Face face={face} size={u * 24} />
    </div>
  );
  return (
    <div
      style={{
        width: vertical ? u * 86 : u * 62,
        transform: `translateX(${(1 - p) * (fromLeft ? -120 : 120)}%) rotate(${(fromLeft ? -2 : 2) * p}deg)`,
        opacity: p,
        background: "#fff",
        borderRadius: u * 3,
        overflow: "hidden",
        boxShadow: `0 ${u * 2}px ${u * 6}px rgba(0,0,0,0.5), 0 0 0 ${u * 0.6}px ${C.accent}`,
        display: "flex",
        flexDirection: vertical ? "row" : "column",
      }}
    >
      {picture}
      <div style={{ padding: u * 3, display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: u * 2.4, letterSpacing: u * 0.3, color: C.accent }}>CONTESTANT</div>
        <div style={{ fontFamily: SERIF, fontWeight: 800, fontSize: face.name.length > 16 ? u * 5 : u * 6, color: C.ink, lineHeight: 1.05 }}>{face.name}</div>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: u * 3.2, color: C.ink, marginTop: u }}>{face.tag}</div>
        {face.about ? <div style={{ fontFamily: SANS, fontSize: u * 3, color: C.muted, marginTop: u, lineHeight: 1.3 }}>{face.about}</div> : null}
      </div>
    </div>
  );
};

const Cast: React.FC<{ faces: [Face, Face]; len: number }> = ({ faces, len }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, vertical } = useLayout();
  const heart = spring({ frame: f - 44, fps, config: { damping: 8, stiffness: 160 } });
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, len) }}>
      <KenBurns image="cast/set-stage-v3.webp" from={1.1} to={1.2} dim={0.6} blur={6} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: vertical ? "column" : "row", gap: u * 4 }}>
        <Card face={faces[0]} delay={4} fromLeft />
        <div style={{ transform: `scale(${heart})`, filter: "drop-shadow(0 0 20px rgba(229,53,107,0.9))", lineHeight: 0 }}>
          <Heart size={u * 12} />
        </div>
        <Card face={faces[1]} delay={24} fromLeft={false} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- 3. the date ---------- */
const TYPING = 12;
const CPS = 3;

const Dots: React.FC<{ u: number; color: string }> = ({ u, color }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: u, padding: `${u * 0.8}px 0` }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ width: u * 1.6, height: u * 1.6, borderRadius: "50%", background: color, opacity: 0.35 + 0.65 * Math.max(0, Math.sin((f - i * 4) / 3)) }} />
      ))}
    </div>
  );
};

const Bubble: React.FC<{ line: Line; face: Face; fontSize: number }> = ({ line, face, fontSize }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, vertical } = useLayout();
  const t = f - line.at;
  if (t < 0) return null;
  const right = line.side === "b";
  const p = spring({ frame: t, fps, config: { damping: 15, stiffness: 180 } });
  const shown = line.text.slice(0, Math.max(0, Math.floor((t - TYPING) * CPS)));
  return (
    <div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "flex-end", gap: u * 2, opacity: p, transform: `translateY(${(1 - p) * u * 4}px)`, marginTop: u * 3, flexShrink: 0 }}>
      <Face face={face} size={u * 9} ring={u * 0.5} />
      <div style={{ maxWidth: vertical ? u * 70 : u * 90, display: "flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start" }}>
        <div style={{ fontFamily: SANS, fontWeight: 600, color: "#ffb3cc", fontSize: u * 2.8, marginBottom: u * 0.8, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{face.name}</div>
        <div
          style={{
            background: right ? GRAD : C.soft,
            color: right ? "#fff" : C.ink,
            fontFamily: SANS,
            fontSize,
            lineHeight: 1.35,
            padding: `${u * 2.4}px ${u * 3.2}px`,
            borderRadius: u * 3.5,
            borderBottomLeftRadius: right ? u * 3.5 : u * 0.8,
            borderBottomRightRadius: right ? u * 0.8 : u * 3.5,
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          {t < TYPING ? (
            <Dots u={u} color={right ? "#fff" : C.accent} />
          ) : (
            <span>
              {shown}
              {/* the rest of the line, invisible, holds the bubble's size while it types */}
              <span style={{ visibility: "hidden" }}>{line.text.slice(shown.length)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const DateScene: React.FC<{ p: ShowProps; len: number }> = ({ p, len }) => {
  const f = useCurrentFrame();
  const { u, vertical } = useLayout();
  const chars = p.lines.reduce((n, l) => n + l.text.length, 0);
  const fontSize = (vertical ? 4.8 : 4) * u * (chars > 420 ? 0.8 : chars > 300 ? 0.9 : 1);
  const live = 0.6 + 0.4 * Math.sin(f / 4);
  const pill = { fontFamily: SANS, fontWeight: 800, fontSize: u * 2.6, letterSpacing: u * 0.3, padding: `${u}px ${u * 2.4}px`, borderRadius: 999 } as const;
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, len) }}>
      <KenBurns image={p.backdrop} from={1.3} to={1.15} dim={0.5} blur={3} />
      <AbsoluteFill style={{ padding: vertical ? `${u * 22}px ${u * 6}px ${u * 26}px` : `${u * 6}px ${u * 30}px` }}>
        <div style={{ display: "flex", justifyContent: "center", gap: u * 2, marginBottom: u * 2, flexShrink: 0 }}>
          <div style={{ ...pill, color: C.ink, background: C.soft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: u * 48 }}>{p.chip.toUpperCase()}</div>
          <div style={{ ...pill, color: "#fff", background: `rgba(220,38,38,${live})`, whiteSpace: "nowrap" }}>● NOBODY'S STEERING</div>
        </div>
        {/* newest line at the bottom; older ones scroll up and out, as a chat does */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden" }}>
          {p.lines.map((l, i) => (
            <Bubble key={i} line={l} face={l.side === "a" ? p.faces[0] : p.faces[1]} fontSize={fontSize} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- 4. how it ends ---------- */
const STAMPS: { key: keyof typeof ENDING_STYLE; label: string }[] = [
  { key: "second_date", label: "SECOND DATE" },
  { key: "friends", label: "JUST FRIENDS" },
  { key: "disaster", label: "DISASTER" },
];

const Stamp: React.FC<{ label: string; color: string; rot: number; delay: number; big?: boolean }> = ({ label, color, rot, delay, big }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u } = useLayout();
  const t = f - delay;
  if (t < 0) return null;
  const p = spring({ frame: t, fps, config: { damping: 9, stiffness: 260, mass: 0.6 } });
  // as big as fits across the short side: Inter's capitals run about 0.68em, plus the border and padding
  const size = Math.min(big ? 10 : 8, 74 / (0.68 * Math.max(1, label.length)));
  return (
    <div
      style={{
        fontFamily: SANS,
        fontWeight: 800,
        fontSize: u * size,
        letterSpacing: u * 0.4,
        color,
        border: `${u}px solid ${color}`,
        borderRadius: u * 2,
        padding: `${u}px ${u * 3.5}px`,
        transform: `rotate(${rot}deg) scale(${interpolate(p, [0, 1], [2.6, 1])})`,
        opacity: Math.min(1, t / 3),
        background: "rgba(20,10,30,0.55)",
        textShadow: `0 0 ${u * 2}px ${color}`,
        boxShadow: `0 0 ${u * 3}px ${color}55`,
        margin: `${u * 2.5}px 0`,
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
};

const Verdict: React.FC<{ p: ShowProps; len: number }> = ({ p, len }) => {
  const f = useCurrentFrame();
  const { u } = useLayout();
  const real = p.variant === "full" && p.ending;
  // the three stamps land one after another; the real one lands once, after a beat of the others flickering
  const hits = real ? [22] : [10, 22, 34];
  const shake = hits.reduce((acc, h) => acc + Math.max(0, 1 - Math.abs(f - h) / 4), 0);
  const flicker = real && f < 18 ? STAMPS[Math.floor(f / 3) % 3] : null;
  const style = real ? ENDING_STYLE[p.ending as string] : null;
  const title = real ? "How did it end?" : "How does it end?";
  const after = p.variant === "teaser" ? ["Call it in the comments.", "Then watch the whole date."] : real ? null : ["The show already knows.", "Do you?"];
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, len, 6) }}>
      <KenBurns image="cast/set-elimination-v3.webp" from={1} to={1.12} dim={0.35} />
      <Vignette />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translate(${Math.sin(f * 3.1) * shake * u * 0.8}px, ${Math.cos(f * 2.7) * shake * u * 0.8}px)` }}>
        <div style={{ fontFamily: SERIF, fontWeight: 800, fontSize: u * 9, color: "#fff", textAlign: "center", marginBottom: u * 4, textShadow: "0 4px 30px rgba(0,0,0,0.8)", opacity: interpolate(f, [0, 8], [0, 1], clamp) }}>
          {title}
        </div>
        {real ? (
          flicker ? (
            <div style={{ opacity: 0.4 }}>
              <Stamp label={flicker.label} color={ENDING_STYLE[flicker.key].color} rot={0} delay={0} />
            </div>
          ) : (
            <Stamp label={(p.endingLabel ?? "").toUpperCase()} color={style!.color} rot={style!.rot} delay={18} big />
          )
        ) : (
          STAMPS.map((s, i) => <Stamp key={s.key} label={s.label} color={ENDING_STYLE[s.key].color} rot={ENDING_STYLE[s.key].rot} delay={hits[i] - 4} />)
        )}
        {after ? (
          <div style={{ marginTop: u * 4, fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, fontSize: u * 5, color: C.soft, textAlign: "center", opacity: interpolate(f, [50, 60], [0, 1], clamp), textShadow: "0 4px 20px rgba(0,0,0,0.8)" }}>
            {after[0]}
            <br />
            {after[1]}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- 5. end card ---------- */
export const EndCard: React.FC<{ lines: string[]; url: string; small: string; footer?: string }> = ({ lines, url, small, footer = "AI-generated episode. Original adult characters only." }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u } = useLayout();
  const btn = spring({ frame: f - 30, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ opacity: interpolate(f, [0, 8], [0, 1], clamp) }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 35%, #3a1640, ${C.dark} 70%)` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${u * 5}px` }}>
        <div style={{ marginBottom: u * 3 }}>
          <AppIcon size={u * 16} />
        </div>
        {lines.map((l, i) => {
          const o = interpolate(f, [4 + i * 7, 12 + i * 7], [0, 1], clamp);
          const last = i === lines.length - 1 && lines.length > 1;
          return (
            <div
              key={l}
              style={{
                fontFamily: SERIF,
                fontWeight: 800,
                fontSize: u * 7.5,
                lineHeight: 1.15,
                color: last ? "transparent" : "#fff",
                background: last ? NEON : undefined,
                WebkitBackgroundClip: last ? "text" : undefined,
                opacity: o,
                transform: `translateY(${(1 - o) * u * 2}px)`,
              }}
            >
              {l}
            </div>
          );
        })}
        <div style={{ marginTop: u * 6, background: GRAD, color: "#fff", fontFamily: SANS, fontWeight: 800, fontSize: u * 5, padding: `${u * 2.2}px ${u * 6}px`, borderRadius: 999, transform: `scale(${btn})`, boxShadow: `0 0 ${u * 4}px rgba(229,53,107,0.6)` }}>
          {url}
        </div>
        <div style={{ marginTop: u * 3, fontFamily: SANS, fontSize: u * 2.8, color: C.lilac, opacity: interpolate(f, [36, 46], [0, 1], clamp) }}>{small}</div>
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: u * 4, width: "100%", textAlign: "center", fontFamily: SANS, fontSize: u * 2, color: "#8a7596" }}>{footer}</div>
    </AbsoluteFill>
  );
};

export const Show: React.FC<ShowProps> = (p) => {
  const { t } = p;
  return (
    <AbsoluteFill style={{ background: C.dark }}>
      {p.audio ? <Audio src={src(p.audio)} /> : null}
      <Sequence from={0} durationInFrames={t.cast}>
        <ColdOpen len={t.cast} />
      </Sequence>
      <Sequence from={t.cast} durationInFrames={t.date - t.cast}>
        <Cast faces={p.faces} len={t.date - t.cast} />
      </Sequence>
      <Sequence from={t.date} durationInFrames={t.verdict - t.date}>
        <DateScene p={p} len={t.verdict - t.date} />
      </Sequence>
      <Sequence from={t.verdict} durationInFrames={t.end - t.verdict}>
        <Verdict p={p} len={t.end - t.verdict} />
      </Sequence>
      {t.total > t.end ? (
        <Sequence from={t.end} durationInFrames={t.total - t.end}>
          <EndCard lines={p.endLines} url={p.url} small={p.small} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
