"use client";

import { useState } from "react";
import { STUDIO_OPEN_TO, type StudioConfig } from "@/lib/adult/studio-config";
import { FieldNote, UnsavedBar, blurOnEnter, useSettings } from "./autosave";

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

const SWITCHES = [
  ["pov", "POV shots"],
  ["free_redo", "A free redo for a shoot they 👎'd whole"],
  ["reference_set_everywhere", "Nights, clips and beat pictures send body references too (test first)"],
  ["identity_in_shoots", "Shoots send the identity pack's view for the angle too, when the model has room (test first)"],
] as const;

/**
 * The Studio's settings (lib/adult/studio-config.ts, docs/PRDs/studio.md section 11): who can open it, a shoot's size,
 * the highest level and the switches, each saved on its own (./autosave.tsx), then everything else as the JSON itself,
 * validated when it's saved. Its prices and every monthly cap are under Prices & caps (./PricesCaps.tsx).
 */
export default function StudioSettings() {
  const { base, save, status } = useSettings();
  const studio = base.studio;
  // What's typed in the JSON; null while it's untouched, so it follows the saved copy (a switch here used to throw
  // away a half-typed configuration, 2026-10-31 UX audit).
  const [draft, setDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const shown = draft ?? pretty(studio);
  const dirty = draft !== null && draft !== pretty(studio);
  const saving = (field: string) => status[field]?.state === "saving";
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const set = (field: string, patch: Partial<Omit<StudioConfig, "share">> | { share: Partial<StudioConfig["share"]> }) => void save(field, { studio: patch });

  async function saveJson() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(shown);
    } catch {
      return setJsonError("That isn't valid JSON.");
    }
    setJsonError(null);
    if (await save("studio.json", { studio: parsed })) setDraft(null);
  }

  return (
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Studio">
      <p className="muted small">Shoots of one character, restyles, recasts and body references (docs/PRDs/studio.md).</p>
      <label htmlFor="ad-studio-open">
        Who can open it <FieldNote field="studio.open_to" />
      </label>
      <select id="ad-studio-open" value={studio.open_to} disabled={saving("studio.open_to")} onChange={(e) => set("studio.open_to", { open_to: e.target.value as StudioConfig["open_to"] })}>
        {STUDIO_OPEN_TO.map((x) => (
          <option key={x} value={x}>
            {x === "admins" ? "Admins only" : "Everyone After Dark is open to"}
          </option>
        ))}
      </select>
      <div className="ad-settings-grid">
        <label>
          <span>
            Pictures a shoot <FieldNote field="studio.shoot_size" />
          </span>
          <input
            type="number"
            min={1}
            max={4}
            key={studio.shoot_size}
            defaultValue={studio.shoot_size}
            onBlur={(e) => num(e.target.value) !== base.studio.shoot_size && set("studio.shoot_size", { shoot_size: num(e.target.value) })}
            onKeyDown={blurOnEnter}
          />
        </label>
        <label>
          <span>
            Highest level <FieldNote field="studio.max_level" />
          </span>
          <input
            type="number"
            min={0}
            max={3}
            key={studio.max_level}
            defaultValue={studio.max_level}
            onBlur={(e) => num(e.target.value) !== base.studio.max_level && set("studio.max_level", { max_level: num(e.target.value) })}
            onKeyDown={blurOnEnter}
          />
          <small className="muted ad-hint">0 dressed … 3 explicit.</small>
        </label>
      </div>
      {SWITCHES.map(([k, label]) => (
        <label key={k} className="ad-check-row">
          <input type="checkbox" checked={studio[k]} disabled={saving(`studio.${k}`)} onChange={(e) => set(`studio.${k}`, { [k]: e.target.checked })} />{" "}
          <span>
            {label} <FieldNote field={`studio.${k}`} />
          </span>
        </label>
      ))}
      <label className="ad-check-row">
        <input type="checkbox" checked={studio.share.photos} disabled={saving("studio.share.photos")} onChange={(e) => set("studio.share.photos", { share: { photos: e.target.checked } })} />{" "}
        <span>
          Send a dressed picture as a photo in their texts <FieldNote field="studio.share.photos" />
        </span>
      </label>
      <label className="ad-check-row">
        <input
          type="checkbox"
          checked={studio.share.after_dark}
          disabled={saving("studio.share.after_dark")}
          onChange={(e) => set("studio.share.after_dark", { share: { after_dark: e.target.checked } })}
        />{" "}
        <span>
          Share in After Dark (the recipient accepts first) <FieldNote field="studio.share.after_dark" />
        </span>
      </label>
      <details className="ad-settings-section ux-fold">
        <summary>
          <h3>Everything else</h3>
          <span className="fold-status muted small">models, options switched off, own keys</span>
        </summary>
        <label htmlFor="ad-studio-json">
          The Studio&apos;s whole configuration <FieldNote field="studio.json" />
        </label>
        <textarea id="ad-studio-json" rows={18} value={shown} onChange={(e) => setDraft(e.target.value)} spellCheck={false} style={{ fontFamily: "monospace", width: "100%" }} />
        <small className="muted ad-hint">Saving checks every value; a mistake is refused with what was wrong.</small>
        {jsonError && (
          <p className="error small" role="alert">
            {jsonError}
          </p>
        )}
        {dirty && (
          <UnsavedBar
            what="the Studio's configuration"
            busy={saving("studio.json")}
            onSave={() => void saveJson()}
            onDiscard={() => {
              setDraft(null);
              setJsonError(null);
            }}
          />
        )}
      </details>
    </section>
  );
}
