"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ShareButton from "@/app/ShareButton";
import { okJson } from "@/lib/ok-json";
import { REACTIONS, REACTION_KINDS, lineTag, type LineTallies, type ReactionKind } from "@/lib/line-reactions";
import { botOf, heckles, type Heckle } from "@/lib/peanut-gallery";
import type { Turn } from "@/lib/conversation";

type Float = { id: number; emoji: string; x: number; mine: boolean };

const SENT_KEY = (episodeId: string) => `bz-react:${episodeId}`;

function readSent(episodeId: string): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SENT_KEY(episodeId)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function keepSent(episodeId: string, sent: Set<string>) {
  try {
    window.localStorage.setItem(SENT_KEY(episodeId), JSON.stringify([...sent].slice(-400)));
  } catch {
    /* private window: this visit only */
  }
}

/**
 * The theater's crowd (2026-11-28, Dave's "do 1-6", item 4), over the stage while a date replays:
 *  - 😍 😬 💀 to tap on the line on screen: it floats up the stage and counts (lib/line-reactions.ts), one of each per line;
 *  - everyone's taps come back on the same lines for the next viewer, with "12 viewers cringed here" once enough did;
 *  - the peanut gallery: the show's bots heckling from the back row (lib/peanut-gallery.ts), each with a Bot tag, and
 *    never counted as viewers;
 *  - 📸 to share the line on screen as a moment card (app/api/og/moment).
 * `on` false hides the bots and the floats (the 🍿 switch); the buttons stay.
 */
export default function Crowd({ episodeId, transcript, shown, names, on, moments }: { episodeId: string; transcript: Turn[]; shown: number; names: [string, string]; on: boolean; moments: boolean }) {
  const [tallies, setTallies] = useState<LineTallies>({});
  const [floats, setFloats] = useState<Float[]>([]);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const nextId = useRef(1);
  useEffect(() => {
    setSent(readSent(episodeId));
    let live = true;
    fetch(`/api/episodes/${encodeURIComponent(episodeId)}/reactions`, { cache: "no-store" })
      .then(okJson)
      .then((r: { lines?: LineTallies } | null) => {
        if (live && r?.lines) setTallies(r.lines);
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [episodeId]);

  const gallery = useMemo(() => heckles(transcript, names, episodeId), [transcript, names, episodeId]);
  const line = shown - 1;
  const visible: Heckle[] = useMemo(() => gallery.filter((h) => h.line <= line).slice(-3), [gallery, line]);

  const float = (emoji: string, mine: boolean, n = 1) => {
    const add: Float[] = [];
    for (let i = 0; i < n; i++) add.push({ id: nextId.current++, emoji, x: 8 + Math.random() * 74, mine });
    setFloats((f) => [...f.slice(-24), ...add]);
    const ids = new Set(add.map((x) => x.id));
    window.setTimeout(() => setFloats((f) => f.filter((x) => !ids.has(x.id))), 3200);
  };

  // The crowd comes back: as each line plays, the taps viewers left on it float up again (a few, never a flood).
  const replayed = useRef(-1);
  useEffect(() => {
    if (!on || line < 0 || line === replayed.current) return;
    replayed.current = line;
    const t = tallies[line];
    if (!t) return;
    for (const k of REACTION_KINDS) {
      const n = Math.min(4, t[k] ?? 0);
      if (n > 0) float(REACTIONS[k].emoji, false, n);
    }
  }, [line, on, tallies]);

  const react = (kind: ReactionKind) => {
    if (line < 0) return;
    float(REACTIONS[kind].emoji, true, 3);
    const key = `${line}:${kind}`;
    if (sent.has(key)) return;
    const next = new Set(sent).add(key);
    setSent(next);
    keepSent(episodeId, next);
    setTallies((all) => ({ ...all, [line]: { ...all[line], [kind]: (all[line]?.[kind] ?? 0) + 1 } }));
    void fetch(`/api/episodes/${encodeURIComponent(episodeId)}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ line_index: line, kind }),
    }).catch(() => null);
  };

  const tag = line >= 0 ? lineTag(tallies[line]) : null;

  return (
    <div className="crowd" data-crowd={on ? "on" : "off"}>
      {on && (
        <div className="crowd-floats" aria-hidden="true">
          {floats.map((f) => (
            <span key={f.id} className={`crowd-float${f.mine ? " is-mine" : ""}`} style={{ left: `${f.x}%` }}>
              {f.emoji}
            </span>
          ))}
        </div>
      )}
      {on && tag && (
        <p key={line} className="crowd-tag">
          {REACTIONS[tag.kind].emoji} {tag.text}
        </p>
      )}
      {on && visible.length > 0 && (
        <ol className="crowd-gallery" aria-label="The peanut gallery: the show's bots, joking along" aria-live="polite">
          {visible.map((h) => {
            const bot = botOf(h.bot);
            return (
              <li key={h.id} className="crowd-heckle" data-reply={h.replyTo ? "" : undefined}>
                <span className="crowd-heckle-face" aria-hidden="true">
                  {bot.icon}
                </span>
                <span className="crowd-heckle-body">
                  <span className="crowd-heckle-who">
                    {bot.name} <span className="crowd-bot-tag" title="One of the show's bots: its remarks are written by the show, not by a viewer">Bot</span>
                  </span>
                  <span className="crowd-heckle-text">{h.text}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="crowd-buttons" role="group" aria-label="React to this line">
        {REACTION_KINDS.map((k) => (
          <button key={k} type="button" className="crowd-button" onClick={() => react(k)} disabled={line < 0} aria-label={REACTIONS[k].label} title={REACTIONS[k].label} data-track={`crowd-${k}`}>
            <span aria-hidden="true">{REACTIONS[k].emoji}</span>
          </button>
        ))}
        {moments && line >= 0 && (
          <span className="crowd-moment">
            <ShareButton path={`/episodes/${encodeURIComponent(episodeId)}?moment=${line}`} title={`${names[0]} × ${names[1]} on Botchelor`} label="📸" track="moment-card" />
          </span>
        )}
      </div>
    </div>
  );
}
