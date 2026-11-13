"use client";

import { ROLLOUT_FEATURES, type RolloutAudience } from "@/lib/adult/rollout";
import { afterDarkHref } from "@/lib/after-dark-host";
import { FieldNote, useSettings } from "./autosave";

/**
 * What's built but not open yet (lib/adult/rollout.ts; David, 2026-11-13: "keep it admin only but build it anyway and we
 * can switch it from admin only later"): each piece on admins only, or everyone, saved as it's changed.
 */
export default function RolloutSettings() {
  const { base, save, status } = useSettings();
  return (
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Not open yet" data-rollout>
      <p className="muted small">
        Built and live for admins, waiting to open. While a piece is on admins only, admins see it everywhere it applies, so it can be tried on
        production; switching it to everyone opens it to everyone After Dark is open to (and, for the door, to every adult where After Dark isn&apos;t
        blocked).
      </p>
      {ROLLOUT_FEATURES.map((f) => {
        const field = `rollout.${f.key}`;
        return (
          <div key={f.key} className="ad-rollout-row" data-rollout-feature={f.key}>
            <label htmlFor={`ad-rollout-${f.key}`}>
              <strong>{f.label}</strong> <FieldNote field={field} />
            </label>
            <select
              id={`ad-rollout-${f.key}`}
              value={base.rollout[f.key]}
              disabled={status[field]?.state === "saving"}
              onChange={(e) => void save(field, { rollout: { [f.key]: e.target.value as RolloutAudience } })}
            >
              <option value="admins">Admins only</option>
              <option value="everyone">Everyone</option>
            </select>
            <p className="muted small">{f.note}</p>
            {f.key === "public_door" && (
              <p className="small">
                <a href={afterDarkHref("/after-dark/subscribe?preview=visitor")}>Preview the landing as a visitor</a> ·{" "}
                <a href={afterDarkHref("/after-dark/subscribe?preview=signed-in")}>as a signed-in visitor</a>
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
