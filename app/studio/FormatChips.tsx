"use client";

import { FORMATS, ratioValue, type FormatId } from "@/lib/studio/formats";

/**
 * The shape a shoot is drawn in (native sizes, lib/studio/formats.ts), the same in both Studios: a chip per format with
 * a small outline of its shape, so a phone shows at a glance what Story or Feed means.
 */
export default function FormatChips({ value, onChange, disabled = false }: { value: FormatId; onChange: (f: FormatId) => void; disabled?: boolean }) {
  return (
    <div className="studio-formats" role="radiogroup" aria-label="Shape">
      {FORMATS.map((f) => {
        const r = ratioValue(f.ratio);
        // The outline fits a 22px box: the long side 22, the other in proportion.
        const w = r >= 1 ? 22 : Math.round(22 * r);
        const h = r >= 1 ? Math.round(22 / r) : 22;
        return (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={value === f.id}
            className={`chip studio-format${value === f.id ? " chip-on" : ""}`}
            disabled={disabled}
            title={`${f.ratio}: ${f.hint}`}
            onClick={() => onChange(f.id)}
          >
            <span className="studio-format-shape" style={{ width: w, height: h }} aria-hidden="true" />
            {f.label} <span className="muted small">{f.ratio}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A picture's shape for its tile's CSS ("9 / 16"); undefined for one drawn before native sizes (all 3:4). */
export const tileRatio = (aspect: string | null | undefined): string | undefined => (aspect && aspect !== "3:4" ? aspect.replace(":", " / ") : undefined);
