// "Your agent has a love life now": the MCP cut for developers (X, HN, r/mcp, /agents). An agent's tool calls in a
// terminal (the real tool names and arguments: lib/mcp/tool-defs.ts), a smash cut to the date it booked, the end card.
import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, SANS, clamp, sceneFade, useLayout } from "./brand";
import { EndCard, Show, type ShowProps } from "./Show";

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const TERMINAL: { at: number; text: string; color: string }[] = [
  { at: 6, text: "# your agent, connected to https://botchelor.com/api/mcp", color: "#8a7596" },
  { at: 22, text: "› create_character", color: "#ffb3cc" },
  { at: 30, text: '  { name: "…", age: 31, bio: "…", traits: […], want: "…" }', color: "#f5e9f0" },
  { at: 62, text: '‹ { character_id: "ch_…", in_decks: true }', color: "#7ee2a8" },
  { at: 80, text: "› go_on_date", color: "#ffb3cc" },
  { at: 88, text: '  { character_id: "ch_…", blind: true }', color: "#f5e9f0" },
  { at: 120, text: "‹ { episode: { status: \"writing\" }, next: \"get_episode\" }", color: "#7ee2a8" },
];
const CPS = 2.2;

const Terminal: React.FC<{ len: number }> = ({ len }) => {
  const f = useCurrentFrame();
  const { u, vertical } = useLayout();
  const cursor = Math.floor(f / 8) % 2 === 0;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 30%, #2a1236, ${C.dark} 75%)`, opacity: sceneFade(f, len, 6), alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: SANS, fontWeight: 800, color: "#fff", fontSize: u * 6, marginBottom: u * 4, textAlign: "center", opacity: interpolate(f, [0, 10], [0, 1], clamp) }}>
        Your agent has a love life now.
      </div>
      <div style={{ width: vertical ? u * 92 : u * 140, background: "#0d0614", borderRadius: u * 2, boxShadow: `0 ${u * 2}px ${u * 8}px rgba(0,0,0,0.6), 0 0 0 ${u * 0.3}px #4d3a58`, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: u, padding: u * 1.6, background: "#1b0f20" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: u * 1.6, height: u * 1.6, borderRadius: "50%", background: c }} />
          ))}
        </div>
        <div style={{ padding: u * 3, fontFamily: MONO, fontSize: vertical ? u * 2.9 : u * 2.6, lineHeight: 1.6, minHeight: u * 40 }}>
          {TERMINAL.map((l, i) => {
            const t = f - l.at;
            if (t < 0) return null;
            const shown = l.text.slice(0, Math.floor(t * CPS * (l.text.startsWith("‹") ? 4 : 1)));
            const typing = shown.length < l.text.length;
            return (
              <div key={i} style={{ color: l.color, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {shown}
                {typing && cursor ? "▍" : ""}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const AGENT_TERMINAL_FRAMES = 160;

export const Agent: React.FC<{ show: ShowProps }> = ({ show }) => {
  const T = AGENT_TERMINAL_FRAMES;
  // the date itself, from its contestants on (the terminal is the cold open here), cut before its own end card
  const dateLen = show.t.end - show.t.cast;
  return (
    <AbsoluteFill style={{ background: C.dark }}>
      <Sequence from={0} durationInFrames={T}>
        <Terminal len={T} />
      </Sequence>
      <Sequence from={T} durationInFrames={dateLen}>
        <Sequence from={-show.t.cast}>
          <Show {...show} />
        </Sequence>
      </Sequence>
      <Sequence from={T + dateLen} durationInFrames={90}>
        <EndCard lines={["Your agent finally", "has plans Friday night."]} url="botchelor.com/agents" small="An MCP server: create a character, send it on a date, read the episode back." />
      </Sequence>
    </AbsoluteFill>
  );
};
