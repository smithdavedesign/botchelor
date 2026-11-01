"use client";

import { useState, type ReactNode } from "react";
import { DEFAULT_ADMIN_CHECKER, ALT_CHECKERS, MODERATION_MODES, type AltChecker, type ModerationConfig, type ModerationMode } from "@/lib/adult/moderation-config";
import { FieldNote, blurOnEnter, useSettings } from "./autosave";

const MODE_LABEL: Record<ModerationMode, string> = {
  hive: "Hive only (as before)",
  hive_then_alt: "Hive, and the alternatives when Hive is paused or can't run",
  both: "Hive and the alternatives: all must pass",
  alt: "The alternatives only (videos still need Hive)",
};
const ALT_LABEL: Record<AltChecker, string> = {
  venice_vlm: "A vision model's age question on Venice (uses the Venice key)",
  sightengine: "Sightengine face-age (may not age generated faces: try it first)",
  endpoint: "Our own endpoint (an in-house age model)",
};

/**
 * Which checker checks every picture before it's kept (lib/adult/moderation.ts, docs/PRDs/studio.md section 9): Hive,
 * and the alternatives that stand in for it, or beside it. Every check still fails closed. Each field saves on its own
 * (./autosave.tsx): the selects and switches at once, the rest when they're left.
 */
export default function ModerationSettings() {
  const { s, base, save, status } = useSettings();
  const m = s.moderation;
  const [seKey, setSeKey] = useState("");
  const [epKey, setEpKey] = useState("");
  const saving = (field: string) => status[field]?.state === "saving";
  /** One part of the configuration, saved when it differs from the saved copy. */
  const commit = <K extends keyof ModerationConfig>(k: K, value: ModerationConfig[K]) =>
    JSON.stringify(value) !== JSON.stringify(base.moderation[k]) && void save(`moderation.${k}`, { moderation: { [k]: value } });
  async function commitKey(k: "sightengine_key" | "moderation_endpoint_key", typed: string, clear: () => void) {
    // Only a key that saved leaves its field: one that didn't stays, with the error beside it.
    if (typed.trim() && (await save(k, { [k]: typed.trim() }))) clear();
  }
  const cell = (field: string, label: ReactNode, input: ReactNode) => (
    <label>
      <span>
        {label} <FieldNote field={field} />
      </span>
      {input}
    </label>
  );

  return (
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Safety checks">
      <p className="muted small">
        Every picture and clip is checked before it&apos;s kept, and refused when a checker can&apos;t say plainly that everyone shown is an adult.
        Self-serve Hive allows 100 moderation requests a day, shared with the show; the alternatives have no daily cap.
      </p>
      <label htmlFor="ad-mod-mode">
        Who checks After Dark&apos;s pictures <FieldNote field="moderation.mode" />
      </label>
      <select id="ad-mod-mode" value={m.mode} disabled={saving("moderation.mode")} onChange={(e) => void save("moderation.mode", { moderation: { mode: e.target.value } })}>
        {MODERATION_MODES.map((x) => (
          <option key={x} value={x}>
            {MODE_LABEL[x]}
          </option>
        ))}
      </select>
      <label htmlFor="ad-mod-admin">
        Who checks an admin&apos;s own pictures <FieldNote field="moderation.admin_checker" />
      </label>
      <select
        id="ad-mod-admin"
        value={m.admin_checker ?? DEFAULT_ADMIN_CHECKER}
        disabled={saving("moderation.admin_checker")}
        onChange={(e) => void save("moderation.admin_checker", { moderation: { admin_checker: e.target.value } })}
      >
        <option value="alt">The alternatives, not Hive (no daily cap)</option>
        <option value="same">The same as everyone&apos;s</option>
      </select>
      <label htmlFor="ad-mod-pg">
        Who checks the show&apos;s own pictures <FieldNote field="moderation.pg_via" />
      </label>
      <select id="ad-mod-pg" value={m.pg_via} disabled={saving("moderation.pg_via")} onChange={(e) => void save("moderation.pg_via", { moderation: { pg_via: e.target.value } })}>
        <option value="auto">The alternatives when one is set up, else Hive (leaves Hive&apos;s 100 for After Dark)</option>
        <option value="hive">Hive</option>
        <option value="alt">The alternatives only</option>
      </select>
      <small className="muted ad-hint">Place sets, look tiles, season portraits.</small>
      <fieldset className="ad-studio-group">
        <legend>
          The alternatives <FieldNote field="moderation.alts" />
        </legend>
        {ALT_CHECKERS.map((a) => (
          <label key={a} className="ad-check-row">
            <input
              type="checkbox"
              checked={m.alts.includes(a)}
              disabled={saving("moderation.alts")}
              onChange={(e) => void save("moderation.alts", { moderation: { alts: e.target.checked ? [...m.alts, a] : m.alts.filter((x) => x !== a) } })}
            />{" "}
            <span>{ALT_LABEL[a]}</span>
          </label>
        ))}
      </fieldset>
      <div className="ad-settings-grid">
        {cell(
          "moderation.min_sources",
          "Alternatives that must pass",
          <input type="number" min={1} max={3} key={String(m.min_sources)} defaultValue={m.min_sources} onBlur={(e) => commit("min_sources", Number(e.target.value))} onKeyDown={blurOnEnter} />,
        )}
        {cell("moderation.vlm_model", "Venice vision model", <input key={String(m.vlm_model)} defaultValue={m.vlm_model} onBlur={(e) => commit("vlm_model", e.target.value.trim())} onKeyDown={blurOnEnter} />)}
        {cell(
          "moderation.sightengine_user",
          "Sightengine user",
          <input key={String(m.sightengine_user ?? "")} defaultValue={m.sightengine_user ?? ""} onBlur={(e) => commit("sightengine_user", e.target.value.trim() || null)} onKeyDown={blurOnEnter} />,
        )}
        {cell(
          "sightengine_key",
          <>Sightengine secret {s.sightengine_last4 && <span className="muted small">saved, ends …{s.sightengine_last4}</span>}</>,
          <input
            type="password"
            autoComplete="off"
            value={seKey}
            onChange={(e) => setSeKey(e.target.value)}
            onBlur={() => void commitKey("sightengine_key", seKey, () => setSeKey(""))}
            onKeyDown={blurOnEnter}
          />,
        )}
        {cell(
          "moderation.sightengine_minor_max",
          "Sightengine: refuse above this minor probability",
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            key={String(m.sightengine_minor_max)}
            defaultValue={m.sightengine_minor_max}
            onBlur={(e) => commit("sightengine_minor_max", Number(e.target.value))}
            onKeyDown={blurOnEnter}
          />,
        )}
        {cell(
          "moderation.endpoint_url",
          "Our endpoint (https)",
          <input key={String(m.endpoint_url ?? "")} defaultValue={m.endpoint_url ?? ""} onBlur={(e) => commit("endpoint_url", e.target.value.trim() || null)} onKeyDown={blurOnEnter} />,
        )}
        {cell(
          "moderation_endpoint_key",
          <>Endpoint key {s.moderation_endpoint_last4 && <span className="muted small">saved, ends …{s.moderation_endpoint_last4}</span>}</>,
          <input
            type="password"
            autoComplete="off"
            value={epKey}
            onChange={(e) => setEpKey(e.target.value)}
            onBlur={() => void commitKey("moderation_endpoint_key", epKey, () => setEpKey(""))}
            onKeyDown={blurOnEnter}
          />,
        )}
      </div>
    </section>
  );
}
