// A 6-second bumper: the wordmark, one stamp, the address. For pre-rolls, story frames and the end of other videos.
import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, ENDING_STYLE, GRAD, KenBurns, SANS, Vignette, Wordmark, clamp, useLayout } from "./brand";

export const BUMPER_FRAMES = 180;

const Slam: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u } = useLayout();
  const p = spring({ frame: f, fps, config: { damping: 9, stiffness: 260, mass: 0.6 } });
  const words = ["SECOND DATE", "JUST FRIENDS", "DISASTER"] as const;
  const keys = ["second_date", "friends", "disaster"] as const;
  const i = Math.min(2, Math.floor(f / 14));
  const s = ENDING_STYLE[keys[i]];
  return (
    <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: u * 9, color: s.color, border: `${u}px solid ${s.color}`, borderRadius: u * 2, padding: `${u}px ${u * 3.5}px`, transform: `rotate(${s.rot}deg) scale(${interpolate(p, [0, 1], [2.4, 1])})`, background: "rgba(20,10,30,0.55)", textShadow: `0 0 ${u * 2}px ${s.color}`, whiteSpace: "nowrap" }}>
      {words[i]}
    </div>
  );
};

export const Bumper: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u } = useLayout();
  const pop = spring({ frame: f - 4, fps, config: { damping: 11, stiffness: 120 } });
  const url = spring({ frame: f - 100, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: C.dark }}>
      <KenBurns image="cast/set-stage-v3.webp" from={1.25} to={1.1} dim={0.4} />
      <Vignette />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: u * 5 }}>
        <div style={{ transform: `scale(${0.6 + 0.4 * pop})`, opacity: Math.min(1, pop * 1.4) }}>
          <Wordmark size={u * 16} glow={1 + Math.sin(f / 5)} />
        </div>
        <div style={{ height: u * 16, display: "flex", alignItems: "center" }}>
          <Sequence from={36} durationInFrames={BUMPER_FRAMES - 36} layout="none">
            <Slam />
          </Sequence>
        </div>
        <div style={{ background: GRAD, color: "#fff", fontFamily: SANS, fontWeight: 800, fontSize: u * 5, padding: `${u * 2}px ${u * 6}px`, borderRadius: 999, transform: `scale(${url})`, opacity: interpolate(f, [100, 104], [0, 1], clamp) }}>
          botchelor.com
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
