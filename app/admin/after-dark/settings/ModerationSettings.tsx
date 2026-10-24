"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { AdultSettings } from "@/lib/adult/settings";
import { DEFAULT_ADMIN_CHECKER, ALT_CHECKERS, MODERATION_MODES, type AltChecker, type ModerationConfig, type ModerationMode } from "@/lib/adult/moderation-config";

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
 * and the alternatives that stand in for it, or beside it. Every check still fails closed.
 */
export default function ModerationSettings({ initial }: { initial: AdultSettings }) {
  const [m, setM] = useState<ModerationConfig>(initial.moderation);
  const [last4, setLast4] = useState({ sightengine: initial.sightengine_last4, endpoint: initial.moderation_endpoint_last4 });
  const [seKey, setSeKey] = useState("");
  const [epKey, setEpKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/settings", patch).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't save that.", error: true });
    const s = res.data.settings as AdultSettings;
    setM(s.moderation);
    setLast4({ sightengine: s.sightengine_last4, endpoint: s.moderation_endpoint_last4 });
    setSeKey("");
    setEpKey("");
    setNote({ text: "Saved." });
  }

  return (
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <h2>🛡 The checks</h2>
      <p className="muted small">
        Every picture and clip is checked before it&apos;s kept, and refused when a checker can&apos;t say plainly that everyone shown is an adult.
        Self-serve Hive allows 100 moderation requests a day, shared with the show; the alternatives have no daily cap.
      </p>
      <label htmlFor="ad-mod-mode">Who checks After Dark&apos;s pictures</label>
      <select id="ad-mod-mode" value={m.mode} disabled={busy} onChange={(e) => void save({ moderation: { mode: e.target.value } })}>
        {MODERATION_MODES.map((x) => (
          <option key={x} value={x}>
            {MODE_LABEL[x]}
          </option>
        ))}
      </select>
      <label htmlFor="ad-mod-admin">Who checks an admin&apos;s own pictures</label>
      <select id="ad-mod-admin" value={m.admin_checker ?? DEFAULT_ADMIN_CHECKER} disabled={busy} onChange={(e) => void save({ moderation: { admin_checker: e.target.value } })}>
        <option value="alt">The alternatives, not Hive (no daily cap)</option>
        <option value="same">The same as everyone&apos;s</option>
      </select>
      <label htmlFor="ad-mod-pg">Who checks the show&apos;s own pictures (place sets, look tiles, season portraits)</label>
      <select id="ad-mod-pg" value={m.pg_via} disabled={busy} onChange={(e) => void save({ moderation: { pg_via: e.target.value } })}>
        <option value="hive">Hive</option>
        <option value="alt">The alternatives (leaves Hive&apos;s 100 for After Dark)</option>
      </select>
      <fieldset className="ad-studio-group">
        <legend>The alternatives</legend>
        {ALT_CHECKERS.map((a) => (
          <label key={a} className="ad-check-row">
            <input
              type="checkbox"
              checked={m.alts.includes(a)}
              disabled={busy}
              onChange={(e) => void save({ moderation: { alts: e.target.checked ? [...m.alts, a] : m.alts.filter((x) => x !== a) } })}
            />{" "}
            <span>{ALT_LABEL[a]}</span>
          </label>
        ))}
      </fieldset>
      <div className="ad-settings-grid">
        <label>
          Alternatives that must pass
          <input type="number" min={1} max={3} defaultValue={m.min_sources} disabled={busy} onBlur={(e) => Number(e.target.value) !== m.min_sources && void save({ moderation: { min_sources: Number(e.target.value) } })} />
        </label>
        <label>
          Venice vision model
          <input defaultValue={m.vlm_model} disabled={busy} onBlur={(e) => e.target.value.trim() !== m.vlm_model && void save({ moderation: { vlm_model: e.target.value.trim() } })} />
        </label>
        <label>
          Sightengine user
          <input defaultValue={m.sightengine_user ?? ""} disabled={busy} onBlur={(e) => (e.target.value.trim() || null) !== m.sightengine_user && void save({ moderation: { sightengine_user: e.target.value.trim() || null } })} />
        </label>
        <label>
          Sightengine secret {last4.sightengine && <span className="muted small">saved, ends …{last4.sightengine}</span>}
          <input type="password" autoComplete="off" value={seKey} disabled={busy} onChange={(e) => setSeKey(e.target.value)} onBlur={() => seKey.trim() && void save({ sightengine_key: seKey.trim() })} />
        </label>
        <label>
          Sightengine: refuse above this minor probability
          <input type="number" min={0} max={1} step={0.01} defaultValue={m.sightengine_minor_max} disabled={busy} onBlur={(e) => Number(e.target.value) !== m.sightengine_minor_max && void save({ moderation: { sightengine_minor_max: Number(e.target.value) } })} />
        </label>
        <label>
          Our endpoint (https)
          <input defaultValue={m.endpoint_url ?? ""} disabled={busy} onBlur={(e) => (e.target.value.trim() || null) !== m.endpoint_url && void save({ moderation: { endpoint_url: e.target.value.trim() || null } })} />
        </label>
        <label>
          Endpoint key {last4.endpoint && <span className="muted small">saved, ends …{last4.endpoint}</span>}
          <input type="password" autoComplete="off" value={epKey} disabled={busy} onChange={(e) => setEpKey(e.target.value)} onBlur={() => epKey.trim() && void save({ moderation_endpoint_key: epKey.trim() })} />
        </label>
      </div>
      {note && (
        <p className={note.error ? "error" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </section>
  );
}
