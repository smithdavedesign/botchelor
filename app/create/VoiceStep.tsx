"use client";

import { shortName } from "@/lib/names";
import { useState } from "react";
import {
  LINE_SUGGESTIONS,
  MAX_NEVER_SAYS,
  NEVER_SAY_MAX,
  NEVER_SAY_SUGGESTIONS,
  SAMPLE_LINE_MAX,
  SAMPLE_LINES,
  TELL_MAX,
  TELL_SUGGESTIONS,
  TELLS,
  pickFrom,
  type CharacterExtras,
  type SampleLineId,
  type TellId,
} from "@/lib/extras";
import type { SetExtras } from "./DetailsStep";

const VOICE_PICKS = [
  { label: "Dry & deadpan", voice: "Dry and deadpan: short sentences, long pauses, never laughs at their own jokes." },
  { label: "Bubbly & fast", voice: "Bubbly and fast: exclamation marks, happy tangents, says yes before hearing the plan." },
  { label: "Smooth flirt", voice: "Smooth and teasing: easy compliments, a raised eyebrow in every line, recovers fast when caught out." },
  { label: "Nerdy & precise", voice: "Precise and a little nerdy: starts small, then explains something perfectly if you ask a follow-up." },
  { label: "Shy, warms up", voice: "Shy at first: short careful answers that get longer and warmer once they trust you." },
  { label: "Big & theatrical", voice: "Big and theatrical: dramatic pauses, grand gestures, turns small moments into scenes." },
  { label: "Blunt & practical", voice: "Blunt and practical: says exactly what they mean, asks how things work, no small talk." },
] as const;

const LINE_PLACEHOLDERS: Record<SampleLineId, string> = {
  hello: "“Oh good, you're real. I had a small bet with myself.”",
  dodge: "“Great question. Next question.”",
  flirt: "“You have very trustworthy eyebrows.”",
  upset: "“Cool. Cool cool cool. This is fine.”",
};
const TELL_PLACEHOLDERS: Record<TellId, string> = {
  nervous: "over-explain the menu",
  smitten: "start finishing your sentences, badly",
  bored: "rearrange the sugar packets by colour",
  annoyed: "get extremely, terrifyingly polite",
};

/**
 * How they talk: the one-line voice, then the voice kit (lib/extras.ts) — sample lines the actor matches, words
 * they'd never say, and the tells each act of a date surfaces when it fits (lib/personality.ts). All optional;
 * all public on their card; none of it changes how a date ends.
 */
export default function VoiceStep({
  voice,
  setVoice,
  extras,
  setExtras,
  name,
}: {
  voice: string;
  setVoice: (v: string) => void;
  extras: CharacterExtras;
  setExtras: SetExtras;
  name: string;
}) {
  const [neverDraft, setNeverDraft] = useState("");
  // Which groups start open: those with something in them. Read once, so clearing a field doesn't fold its group shut.
  const [startOpen] = useState(() => ({
    lines: Object.values(extras.lines ?? {}).some((v) => v?.trim()),
    never: (extras.never_says ?? []).length > 0,
    tells: Object.values(extras.tells ?? {}).some((v) => v?.trim()),
  }));
  const who = shortName(name) || "they";
  const never = extras.never_says ?? [];

  const setLine = (id: SampleLineId, v: string) => setExtras((p) => ({ ...p, lines: { ...p.lines, [id]: v } }));
  const setTell = (id: TellId, v: string) => setExtras((p) => ({ ...p, tells: { ...p.tells, [id]: v } }));
  function addNever(raw: string) {
    const v = raw.trim().slice(0, NEVER_SAY_MAX);
    if (!v || never.length >= MAX_NEVER_SAYS || never.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setExtras((p) => ({ ...p, never_says: [...(p.never_says ?? []), v] }));
    setNeverDraft("");
  }
  const removeNever = (v: string) => setExtras((p) => ({ ...p, never_says: (p.never_says ?? []).filter((x) => x !== v) }));

  return (
    <fieldset className="wizard-fields">
      <legend className="wizard-legend">How do they talk?</legend>
      <p className="muted">
        Optional, but it&apos;s the single biggest lever for a date that sounds like a particular person instead of a witty
        narrator. Pick a starting point or write your own.
      </p>
      <div className="voice-picks" role="group" aria-label="Voice ideas">
        {VOICE_PICKS.map((v) => (
          <button key={v.label} type="button" className={`look-chip${voice === v.voice ? " chosen" : ""}`} onClick={() => setVoice(v.voice)}>
            {v.label}
          </button>
        ))}
      </div>
      <label>
        Their voice
        <textarea
          maxLength={200}
          rows={3}
          placeholder="e.g. Dry and deadpan: short sentences, long pauses, never laughs at their own jokes."
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
        />
      </label>

      <details className="detail-group" open={startOpen.lines}>
        <summary>Sound like them</summary>
        <p className="muted small">
          A few lines exactly as {who} would say them. On a date the AI matches their rhythm and word choice — and never
          just reads them out.
        </p>
        {SAMPLE_LINES.map((l) => (
          <label key={l.id} className="detail-field">
            {l.label}
            <span className="detail-row">
              <input
                type="text"
                name={`line_${l.id}`}
                maxLength={SAMPLE_LINE_MAX}
                placeholder={`e.g. ${LINE_PLACEHOLDERS[l.id]}`}
                value={extras.lines?.[l.id] ?? ""}
                onChange={(e) => setLine(l.id, e.target.value)}
              />
              <button type="button" className="dice" aria-label={`Suggest: ${l.label.toLowerCase()}`} title="Suggest one" onClick={() => setLine(l.id, pickFrom(LINE_SUGGESTIONS[l.id]))}>
                🎲
              </button>
            </span>
          </label>
        ))}
      </details>

      <details className="detail-group" open={startOpen.never}>
        <summary>Things {who} would never say {never.length > 0 && <span className="badge">{never.length}</span>}</summary>
        {never.length > 0 && (
          <ul className="chips">
            {never.map((v) => (
              <li key={v} className="chip chip-removable">
                “{v}”
                <button type="button" aria-label={`Remove ${v}`} onClick={() => removeNever(v)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {never.length < MAX_NEVER_SAYS && (
          <span className="detail-row">
            <input
              type="text"
              aria-label="A phrase they'd never say"
              maxLength={NEVER_SAY_MAX}
              placeholder="Type one and press Enter"
              value={neverDraft}
              onChange={(e) => setNeverDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNever(neverDraft);
                }
              }}
            />
            <button type="button" className="secondary" onClick={() => addNever(neverDraft)}>
              Add
            </button>
          </span>
        )}
        <div className="voice-picks" role="group" aria-label="Never-say ideas">
          {NEVER_SAY_SUGGESTIONS.filter((s) => !never.includes(s)).slice(0, 6).map((s) => (
            <button key={s} type="button" className="look-chip" disabled={never.length >= MAX_NEVER_SAYS} onClick={() => addNever(s)}>
              + “{s}”
            </button>
          ))}
        </div>
      </details>

      <details className="detail-group" open={startOpen.tells}>
        <summary>Their tells</summary>
        <p className="muted small">
          Habits that slip out when they feel something. Each part of a date brings out the one that fits how it&apos;s going for
          {" "}{who}: nerves at the start, then whatever the night turns into.
        </p>
        {TELLS.map((t) => (
          <label key={t.id} className="detail-field">
            {t.label}
            <span className="detail-row">
              <input
                type="text"
                name={`tell_${t.id}`}
                maxLength={TELL_MAX}
                placeholder={`e.g. ${TELL_PLACEHOLDERS[t.id]}`}
                value={extras.tells?.[t.id] ?? ""}
                onChange={(e) => setTell(t.id, e.target.value)}
              />
              <button type="button" className="dice" aria-label={`Suggest: ${t.label.toLowerCase()}`} title="Suggest one" onClick={() => setTell(t.id, pickFrom(TELL_SUGGESTIONS[t.id]))}>
                🎲
              </button>
            </span>
          </label>
        ))}
      </details>
    </fieldset>
  );
}
