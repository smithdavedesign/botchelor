"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { AdultSettings } from "@/lib/adult/settings";
import { STUDIO_OPEN_TO, type StudioConfig } from "@/lib/adult/studio-config";
import { USAGE_KINDS, type UsageKind } from "@/lib/adult/usage";

const CAP_LABEL: Record<UsageKind, string> = {
  writes: "Scene steps",
  pictures: "Scene pictures",
  clips: "Clips",
  voice_lines: "Voiced lines",
  monologues: "Two sides of a night",
  studio: "Studio pictures (our models)",
  studio_byok: "Studio pictures (their own key)",
  upscales: "Upscales",
};

/**
 * The Studio's settings (lib/adult/studio-config.ts, docs/PRDs/studio.md section 11) and every monthly cap
 * (lib/adult/usage.ts): the common ones as fields, everything else as the JSON itself, validated when it's saved.
 */
export default function StudioSettings({ initial }: { initial: AdultSettings }) {
  const [studio, setStudio] = useState<StudioConfig>(initial.studio);
  const [caps, setCaps] = useState(initial.caps);
  const [json, setJson] = useState(() => JSON.stringify(initial.studio, null, 2));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/settings", patch).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't save that.", error: true });
    const s = res.data.settings as AdultSettings;
    setStudio(s.studio);
    setCaps(s.caps);
    setJson(JSON.stringify(s.studio, null, 2));
    setNote({ text: "Saved." });
  }

  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const price = (k: Exclude<keyof StudioConfig["prices"], "shoot" | "pair">): number => studio.prices[k];

  return (
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <h2>🎨 Studio</h2>
      <p className="muted small">
        Shoots of one character, restyles, recasts and body references (docs/PRDs/studio.md). Prices are in bought tokens (5 for $4); a shoot
        makes {studio.shoot_size} pictures.
      </p>
      <label htmlFor="ad-studio-open">Who can open it</label>
      <select id="ad-studio-open" value={studio.open_to} disabled={busy} onChange={(e) => void save({ studio: { open_to: e.target.value } })}>
        {STUDIO_OPEN_TO.map((x) => (
          <option key={x} value={x}>
            {x === "admins" ? "Admins only" : "Everyone After Dark is open to"}
          </option>
        ))}
      </select>
      <div className="ad-settings-grid">
        {(
          [
            ["Shoot, standard", studio.prices.shoot.standard, (n: number) => ({ prices: { shoot: { ...studio.prices.shoot, standard: n } } })],
            ["Shoot, pro", studio.prices.shoot.pro, (n: number) => ({ prices: { shoot: { ...studio.prices.shoot, pro: n } } })],
            ["Restyle", price("restyle"), (n: number) => ({ prices: { restyle: n } })],
            ["Recast", price("recast"), (n: number) => ({ prices: { recast: n } })],
            ["Body reference", price("body"), (n: number) => ({ prices: { body: n } })],
            ["More like this", price("variations"), (n: number) => ({ prices: { variations: n } })],
            ["Upscale", price("upscale"), (n: number) => ({ prices: { upscale: n } })],
            ["Animate 5 s", price("animate_5"), (n: number) => ({ prices: { animate_5: n } })],
            ["Animate 10 s", price("animate_10"), (n: number) => ({ prices: { animate_10: n } })],
            ["On their own key", price("own_key"), (n: number) => ({ prices: { own_key: n } })],
          ] as const
        ).map(([label, value, patch]) => (
          <label key={label}>
            {label} (tokens)
            <input type="number" min={0} max={100} defaultValue={value} disabled={busy} onBlur={(e) => num(e.target.value) !== value && void save({ studio: patch(num(e.target.value)) })} />
          </label>
        ))}
        <label>
          Pictures a shoot
          <input type="number" min={1} max={4} defaultValue={studio.shoot_size} disabled={busy} onBlur={(e) => num(e.target.value) !== studio.shoot_size && void save({ studio: { shoot_size: num(e.target.value) } })} />
        </label>
        <label>
          Highest level (0 dressed … 3 explicit)
          <input type="number" min={0} max={3} defaultValue={studio.max_level} disabled={busy} onBlur={(e) => num(e.target.value) !== studio.max_level && void save({ studio: { max_level: num(e.target.value) } })} />
        </label>
      </div>
      {(
        [
          ["pov", "POV shots"],
          ["free_redo", "A free redo for a shoot they 👎'd whole"],
          ["reference_set_everywhere", "Nights, clips and beat pictures send body references too (test first)"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="ad-check-row">
          <input type="checkbox" checked={studio[k]} disabled={busy} onChange={(e) => void save({ studio: { [k]: e.target.checked } })} /> <span>{label}</span>
        </label>
      ))}
      <label className="ad-check-row">
        <input type="checkbox" checked={studio.share.photos} disabled={busy} onChange={(e) => void save({ studio: { share: { photos: e.target.checked } } })} />{" "}
        <span>Send a dressed picture as a photo in their texts</span>
      </label>
      <label className="ad-check-row">
        <input type="checkbox" checked={studio.share.after_dark} disabled={busy} onChange={(e) => void save({ studio: { share: { after_dark: e.target.checked } } })} />{" "}
        <span>Share in After Dark (the recipient accepts first)</span>
      </label>
      <details className="ad-settings-section">
        <summary>
          <h3>Everything else (models, options switched off, own keys)</h3>
        </summary>
        <p className="muted small">The Studio&apos;s whole configuration. Saving checks every value; a mistake is refused with what was wrong.</p>
        <textarea aria-label="Studio configuration (JSON)" rows={18} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} style={{ fontFamily: "monospace", width: "100%" }} />
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(json);
            } catch {
              return setNote({ text: "That isn't valid JSON.", error: true });
            }
            void save({ studio: parsed });
          }}
        >
          Save the configuration
        </button>
      </details>

      <h2>Monthly caps, per person</h2>
      <p className="muted small">What each person can make a month (admins are never capped). The tokens protect the margin; these protect the checker and storage.</p>
      <div className="ad-settings-grid">
        {USAGE_KINDS.map((k) => (
          <label key={k}>
            {CAP_LABEL[k]}
            <input type="number" min={0} defaultValue={caps[k]} disabled={busy} onBlur={(e) => num(e.target.value) !== caps[k] && void save({ caps: { [k]: num(e.target.value) } })} />
          </label>
        ))}
      </div>
      {note && (
        <p className={note.error ? "error" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </section>
  );
}
