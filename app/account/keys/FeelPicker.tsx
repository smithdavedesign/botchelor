"use client";

import { useId } from "react";
import { BOUNDS, PRESET_IDS, PRESETS, TAKES_PENALTIES, type Feel, type PresetId } from "@/lib/connections-shared";

/** The feel step's value: a preset, or Advanced's numbers (null: the preset's). */
export type FeelValue = { preset: PresetId; temperature: number | null; frequency_penalty: number | null; presence_penalty: number | null };

/** A stored feel as the step's value: "custom" shows as Lively with its numbers open under Advanced. */
export function feelValue(feel: Feel | null): FeelValue {
  return {
    preset: feel?.preset && feel.preset !== "custom" ? feel.preset : "lively",
    temperature: feel?.temperature ?? null,
    frequency_penalty: feel?.frequency_penalty ?? null,
    presence_penalty: feel?.presence_penalty ?? null,
  };
}

/** A number field's value: blank is null (the preset's); anything else a number, kept inside its bounds by the field. */
const toNumber = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/**
 * How Dates & texts sounds (docs/PRDs/connections.md, M2), the way SillyTavern and JanitorAI do it: a named preset instead of
 * raw numbers (Steady, Lively, Wild), and the raw temperature and penalties under Advanced, inside safe bounds. The server
 * clamps them again. Penalties only show for providers whose APIs take them.
 */
export default function FeelPicker({ provider, value, onChange }: { provider: string; value: FeelValue; onChange: (v: FeelValue) => void }) {
  const ids = useId();
  const preset = PRESETS[value.preset];
  const maxT = provider === "anthropic" ? 1 : BOUNDS.temperature.max;
  const penalties = TAKES_PENALTIES.includes(provider);
  const custom = value.temperature !== null || value.frequency_penalty !== null || value.presence_penalty !== null;

  return (
    <div className="feel-picker">
      <div className="feel-presets" role="radiogroup" aria-label="Feel">
        {PRESET_IDS.map((id) => (
          <label key={id} className={`feel-preset${value.preset === id && !custom ? " is-picked" : ""}`}>
            <input
              type="radio"
              name={`${ids}-preset`}
              value={id}
              checked={value.preset === id && !custom}
              onChange={() => onChange({ preset: id, temperature: null, frequency_penalty: null, presence_penalty: null })}
            />
            <span>
              <strong>{PRESETS[id].label}</strong>
              {id === "lively" ? <span className="chip model-tag tag-recommended">Default</span> : null}
              <span className="muted small">{PRESETS[id].blurb}</span>
            </span>
          </label>
        ))}
      </div>
      <details className="feel-advanced" open={custom}>
        <summary>Advanced</summary>
        <p className="muted small">
          Leave a box blank to use {preset.label}&apos;s value. Temperature is how adventurous each line is (0 to {maxT}); the penalties (0 to 1) make
          repeating a word or an idea less likely.
          {!penalties ? " This provider doesn't take penalties, so only the temperature is sent." : ""}
        </p>
        <div className="feel-numbers">
          <label>
            <span>Temperature</span>
            <input
              type="number"
              inputMode="decimal"
              min={BOUNDS.temperature.min}
              max={maxT}
              step={0.05}
              value={value.temperature ?? ""}
              placeholder={String(Math.min(maxT, preset.temperature))}
              onChange={(e) => onChange({ ...value, temperature: toNumber(e.target.value) })}
            />
          </label>
          {penalties && (
            <>
              <label>
                <span>Frequency penalty</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={BOUNDS.penalty.min}
                  max={BOUNDS.penalty.max}
                  step={0.05}
                  value={value.frequency_penalty ?? ""}
                  placeholder={String(preset.frequency_penalty)}
                  onChange={(e) => onChange({ ...value, frequency_penalty: toNumber(e.target.value) })}
                />
              </label>
              <label>
                <span>Presence penalty</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={BOUNDS.penalty.min}
                  max={BOUNDS.penalty.max}
                  step={0.05}
                  value={value.presence_penalty ?? ""}
                  placeholder={String(preset.presence_penalty)}
                  onChange={(e) => onChange({ ...value, presence_penalty: toNumber(e.target.value) })}
                />
              </label>
            </>
          )}
        </div>
        {custom && (
          <button type="button" className="link-button" onClick={() => onChange({ ...value, temperature: null, frequency_penalty: null, presence_penalty: null })}>
            Back to {preset.label}
          </button>
        )}
      </details>
    </div>
  );
}
