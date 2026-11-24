// The making of Botchelor as a time-lapse (app/making-of): the site on a laptop and a phone, day by day, from the
// screenshots its pull requests committed, with the slate and the chart of pull requests per day that the page has.
// Everything comes from lib/making-of-data.json (scripts/making-of/collect.mjs) and public/making-of/*.webp.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MAKING_OF, chapterOf, dayNumber, longDay, runningTotals, stageAt, type Shot } from "../../lib/making-of";
import { AppIcon, C, SANS, SERIF, clamp, src } from "./brand";

const { frames, days, chapters, totals, first } = MAKING_OF;
const n = (x: number) => Math.round(x).toLocaleString("en-US");

/** Frames of video: the title card, each day's hold, the end card. */
export const MO = { intro: 84, hold: 17, fade: 6, outro: 120 } as const;
export const MAKING_OF_FRAMES = MO.intro + frames.length * MO.hold + MO.outro;

const NIGHT = "#0d0612";
const PINK = "#ff5e8c";
const PINK_SOFT = "#ff9cbd";
const VIOLET = "#a98bff";
const MONO = "Menlo, 'SF Mono', monospace";
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
const TOTALS = runningTotals(days);
const MAX = Math.max(...days.map((d) => d.prs));

const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1400px 700px at 88% -8%, rgba(169,139,255,0.26), transparent 62%), radial-gradient(1100px 700px at -6% 108%, rgba(255,94,140,0.24), transparent 60%), ${NIGHT}`,
    }}
  >
    <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: 0.1, mixBlendMode: "overlay" }} />
  </AbsoluteFill>
);

const Rec: React.FC<{ size: number }> = ({ size }) => {
  const f = useCurrentFrame();
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: "#ff4458", boxShadow: `0 0 ${size}px rgba(255,68,88,0.9)`, opacity: 0.55 + 0.45 * Math.cos(f / 8) }} />;
};

const Kicker: React.FC<{ size: number; children: React.ReactNode }> = ({ size, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.7, color: PINK_SOFT, fontFamily: MONO, fontSize: size, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
    <Rec size={size * 0.75} />
    {children}
  </div>
);

/** A device's screen: the shot it showed before under the new one, which fades in. */
const Screen: React.FC<{ now: Shot | null; before: Shot | null; t: number; radius: number }> = ({ now, before, t, radius }) => {
  const style: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center", borderRadius: radius };
  return (
    <>
      {before && before !== now ? <Img src={src(before.full.src)} style={style} /> : null}
      {now ? <Img src={src(now.full.src)} style={{ ...style, opacity: before && before !== now ? interpolate(t, [0, MO.fade], [0, 1], clamp) : 1 }} /> : null}
    </>
  );
};

const Stage: React.FC<{ i: number; t: number; width: number }> = ({ i, t, width }) => {
  const now = stageAt(frames, i);
  const before = i > 0 ? stageAt(frames, i - 1) : now;
  const lw = width * 0.86;
  const lh = (lw * 10) / 16;
  const pw = width * 0.2;
  return (
    <div style={{ position: "relative", width, height: lh + 40 + width * 0.06, perspective: 2000 }}>
      <div style={{ width: lw, borderRadius: 16, overflow: "hidden", background: "#1b0d24", boxShadow: "0 50px 90px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.14)", transform: "rotateY(-6deg) rotateX(1.5deg)", transformOrigin: "left center" }}>
        <div style={{ height: 40, display: "flex", alignItems: "center", gap: 9, padding: "0 16px", background: "rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.14)" }}>
          {[0, 1, 2].map((k) => (
            <span key={k} style={{ width: 13, height: 13, borderRadius: "50%", background: "rgba(255,255,255,0.22)" }} />
          ))}
          <span style={{ margin: "0 auto", padding: "3px 28px", borderRadius: 99, background: "rgba(0,0,0,0.35)", color: "rgba(255,255,255,0.64)", fontFamily: MONO, fontSize: 17 }}>botchelor.com</span>
        </div>
        <div style={{ position: "relative", height: lh }}>
          <Screen now={now.desktop} before={before.desktop} t={t} radius={0} />
        </div>
      </div>
      <div style={{ position: "absolute", right: 0, bottom: 0, width: pw, height: pw * 2.17, padding: 9, borderRadius: 36, background: "#09070b", boxShadow: "0 40px 70px -20px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.18)", transform: "rotate(2.5deg)" }}>
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 28, overflow: "hidden", background: "#1b0d24" }}>
          <Screen now={now.phone} before={before.phone} t={t} radius={0} />
          <span style={{ position: "absolute", top: 10, left: "50%", width: "30%", height: 18, borderRadius: 99, background: "#09070b", transform: "translateX(-50%)" }} />
        </div>
      </div>
    </div>
  );
};

const Slate: React.FC<{ i: number; t: number }> = ({ i, t }) => {
  const f = frames[i];
  const prevTotal = i > 0 ? TOTALS.get(frames[i - 1].day) ?? 0 : 0;
  const total = interpolate(t, [0, 9], [prevTotal, TOTALS.get(f.day) ?? 0], clamp);
  const label: React.CSSProperties = { color: "rgba(255,255,255,0.64)", fontFamily: MONO, fontSize: 17, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" };
  const value: React.CSSProperties = { color: "#fff", fontFamily: MONO, fontSize: 40, fontWeight: 700, marginTop: 4 };
  const ep = chapters.indexOf(chapterOf(f.day)) + 1;
  return (
    <div style={{ width: 560, borderRadius: 26, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", background: "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.025))", padding: "0 34px 34px" }}>
      <div style={{ height: 30, margin: "0 -34px 26px", background: "repeating-linear-gradient(-45deg, #f5e9f0 0 20px, #140a1e 20px 40px)" }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <div style={label}>Episode</div>
          <div style={value}>{ep}</div>
        </div>
        <div>
          <div style={label}>Day</div>
          <div style={value}>{dayNumber(f.day, first)}</div>
        </div>
        <div>
          <div style={label}>PR</div>
          <div style={value}>#{f.pr}</div>
        </div>
      </div>
      <div style={{ ...label, color: PINK_SOFT, marginTop: 26 }}>{longDay(f.day)}</div>
      <div style={{ color: "#fff", fontFamily: SERIF, fontWeight: 700, fontSize: 50, lineHeight: 1.12, marginTop: 8, minHeight: 112 }}>{f.caption}</div>
      <div style={{ marginTop: 26, color: "rgba(255,255,255,0.84)", fontFamily: SANS, fontSize: 24 }}>
        <div style={{ color: "#fff", fontFamily: SERIF, fontWeight: 800, fontSize: 64, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{n(total)}</div>
        pull requests merged so far
      </div>
    </div>
  );
};

const Chart: React.FC<{ i: number; t: number }> = ({ i, t }) => {
  const at = (k: number) => days.findIndex((d) => d.day === frames[Math.max(0, k)].day);
  const head = interpolate(t, [0, 9], [i > 0 ? at(i - 1) : at(0), at(i)], clamp);
  return (
    <div style={{ position: "relative", height: 120 }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 4 }}>
        {days.map((d, k) => (
          <span key={d.day} style={{ flex: 1, height: `${Math.max(3, (d.prs / MAX) * 100)}%`, borderRadius: "5px 5px 0 0", background: k <= head + 0.5 ? `linear-gradient(180deg, ${PINK_SOFT}, ${PINK})` : "rgba(255,255,255,0.2)" }} />
        ))}
      </div>
      <span style={{ position: "absolute", top: -12, bottom: -6, left: `${((head + 0.5) / days.length) * 100}%`, width: 3, background: "#fff", boxShadow: `0 0 16px ${PINK}`, transform: "translateX(-1.5px)" }} />
      <div style={{ position: "absolute", top: 132, left: 0, right: 0, height: 30 }}>
        {chapters.map((c, k) => {
          const x = (Math.max(0, days.findIndex((d) => d.day >= c.from)) / days.length) * 100;
          const on = chapterOf(frames[i].day).id === c.id;
          return (
            <span key={c.id} style={{ position: "absolute", left: `${x}%`, paddingLeft: 8, borderLeft: `2px solid ${on ? PINK : "rgba(255,255,255,0.14)"}`, color: on ? "#fff" : "rgba(255,255,255,0.6)", fontFamily: MONO, fontSize: 18, fontWeight: on ? 700 : 500, whiteSpace: "nowrap" }}>
              Ep {k + 1} · {c.title}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Main: React.FC<{ f: number }> = ({ f }) => {
  const i = Math.min(frames.length - 1, Math.floor(f / MO.hold));
  const t = f - i * MO.hold;
  const push = interpolate(f, [0, frames.length * MO.hold], [1, 1.035]);
  return (
    <AbsoluteFill style={{ padding: "64px 90px 70px" }}>
      <Kicker size={22}>The making of Botchelor</Kicker>
      <div style={{ display: "flex", alignItems: "center", gap: 70, marginTop: 34, flex: 1 }}>
        <Slate i={i} t={t} />
        <div style={{ transform: `scale(${push})`, transformOrigin: "left center" }}>
          <Stage i={i} t={t} width={1060} />
        </div>
      </div>
      <Chart i={i} t={t} />
    </AbsoluteFill>
  );
};

const Card: React.FC<{ f: number; end?: boolean }> = ({ f, end = false }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 4, fps, config: { damping: 14, stiffness: 110 } });
  const line = spring({ frame: f - 22, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 34 }}>
      <div style={{ opacity: pop }}>
        <Kicker size={26}>{end ? "Built in public" : "The making of Botchelor"}</Kicker>
      </div>
      <div style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 150, lineHeight: 0.98, letterSpacing: "-0.025em", color: "#fff", transform: `translateY(${(1 - pop) * 40}px)`, opacity: pop }}>
        {end ? (
          <>
            {n(totals.prs)} pull requests.
            <br />
            <span style={{ background: `linear-gradient(100deg, ${PINK_SOFT}, ${PINK} 45%, ${VIOLET})`, WebkitBackgroundClip: "text", color: "transparent" }}>{totals.days} days.</span>
          </>
        ) : (
          <>
            {totals.days} days,
            <br />
            <span style={{ background: `linear-gradient(100deg, ${PINK_SOFT}, ${PINK} 45%, ${VIOLET})`, WebkitBackgroundClip: "text", color: "transparent" }}>on camera.</span>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: SANS, fontSize: 34, color: "rgba(255,255,255,0.84)", opacity: line, transform: `translateY(${(1 - line) * 24}px)` }}>
        {end ? (
          <>
            <AppIcon size={52} />
            <span>
              botchelor.com<span style={{ color: PINK_SOFT }}>/making-of</span>
            </span>
          </>
        ) : (
          <span>One person, a crew of AI agents, and the screenshots they took along the way.</span>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** The time-lapse, 16:9. */
export const MakingOf: React.FC = () => {
  const f = useCurrentFrame();
  const mainEnd = MO.intro + frames.length * MO.hold;
  const introOut = interpolate(f, [MO.intro - 10, MO.intro], [1, 0], clamp);
  const mainIn = interpolate(f, [MO.intro - 10, MO.intro + 4], [0, 1], clamp);
  const mainOut = interpolate(f, [mainEnd + 6, mainEnd + 18], [1, 0], clamp);
  const outroIn = interpolate(f, [mainEnd + 10, mainEnd + 22], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.dark }}>
      <Backdrop />
      {f < MO.intro ? (
        <AbsoluteFill style={{ opacity: introOut }}>
          <Card f={f} />
        </AbsoluteFill>
      ) : null}
      {f >= MO.intro - 10 && f < mainEnd + 18 ? (
        <AbsoluteFill style={{ opacity: Math.min(mainIn, mainOut) }}>
          <Main f={Math.max(0, f - MO.intro)} />
        </AbsoluteFill>
      ) : null}
      {f >= mainEnd + 10 ? (
        <AbsoluteFill style={{ opacity: outroIn }}>
          <Card f={f - mainEnd - 10} end />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/** The share card's stage: the front door the show grew into (#1994, the neon heart), else the last frame. */
const CARD_PR = 1994;

/** The page's share card, 1200 x 630: the title beside the stage. */
export const MakingOfCard: React.FC = () => {
  const hero = frames.findIndex((f) => f.pr === CARD_PR);
  const at = hero >= 0 ? hero : frames.length - 1;
  return (
    <AbsoluteFill style={{ background: C.dark }}>
      <Backdrop />
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 56px", gap: 34 }}>
        <div style={{ width: 470, flexShrink: 0 }}>
          <Kicker size={17}>The making of Botchelor</Kicker>
          <div style={{ marginTop: 18, fontFamily: SERIF, fontWeight: 800, fontSize: 84, lineHeight: 0.98, letterSpacing: "-0.025em", color: "#fff" }}>
            {totals.days} days,
            <br />
            <span style={{ background: `linear-gradient(100deg, ${PINK_SOFT}, ${PINK} 45%, ${VIOLET})`, WebkitBackgroundClip: "text", color: "transparent" }}>on camera.</span>
          </div>
          <div style={{ marginTop: 22, fontFamily: SANS, fontSize: 25, lineHeight: 1.4, color: "rgba(255,255,255,0.84)" }}>
            {n(totals.prs)} pull requests, built by one person and a crew of AI agents.
          </div>
        </div>
        <Stage i={at} t={MO.fade} width={600} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
