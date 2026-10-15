"use client";

import type { SoulSignals } from "@/lib/engine";
import { describeTemperament, TEMPERAMENT_AXES } from "@/lib/temperament";

export type TemperamentSource = "set" | "soul" | "sheet";

const SOURCE_NOTE: Record<TemperamentSource, string> = {
  set: "Set by you (or trained from a look or image).",
  soul: "Read from their soul's words. Move a slider to set it yourself.",
  sheet: "Read from their traits and voice — change those and it follows. Move a slider to set it yourself.",
};

/**
 * The temperament the engine decides their dates with (lib/temperament.ts): four private dials. They start where
 * the character's own words put them, and moving one sets them explicitly. Private, like the soul.
 */
export default function TemperamentSliders({
  value,
  source,
  onChange,
  onReset,
}: {
  value: SoulSignals;
  source: TemperamentSource;
  onChange: (next: SoulSignals) => void;
  onReset: (() => void) | null;
}) {
  return (
    <fieldset className="temperament">
      <legend className="wizard-legend">Temperament</legend>
      <p className="muted small">
        How the engine reads them on a date — it changes how dates tend to go, never one particular ending. Private: nobody
        else sees it. Right now: <strong>{describeTemperament(value)}</strong>.
      </p>
      {TEMPERAMENT_AXES.map((a) => (
        <label key={a.key} className="temperament-row">
          <span className="temperament-label">{a.label}</span>
          <span className="temperament-end muted small">{a.low}</span>
          <input
            type="range"
            name={`temperament_${a.key}`}
            min={0}
            max={100}
            step={5}
            value={Math.round(value[a.key] * 100)}
            aria-valuetext={`${Math.round(value[a.key] * 100)} of 100`}
            onChange={(e) => onChange({ ...value, [a.key]: Number(e.target.value) / 100 })}
          />
          <span className="temperament-end muted small">{a.high}</span>
        </label>
      ))}
      <p className="muted small">
        {SOURCE_NOTE[source]}{" "}
        {onReset && (
          <button type="button" className="link-button" onClick={onReset}>
            Let their words decide again
          </button>
        )}
      </p>
    </fieldset>
  );
}
