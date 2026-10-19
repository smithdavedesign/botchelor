"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import type { AdultSettings } from "@/lib/adult/settings";

/** The switch, the models and the provider keys. A key field left empty keeps the saved key. */
export default function SettingsForm({ initial }: { initial: AdultSettings }) {
  const [s, setS] = useState(initial);
  const [orKey, setOrKey] = useState("");
  const [falKey, setFalKey] = useState("");
  const [hiveMod, setHiveMod] = useState("");
  const [hiveDemo, setHiveDemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/settings", patch).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't save that.", error: true });
    setS(res.data.settings as AdultSettings);
    setOrKey("");
    setFalKey("");
    setHiveMod("");
    setHiveDemo("");
    setNote({ text: "Saved." });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save({
      text_model: s.text_model,
      image_model: s.image_model,
      video_model: s.video_model,
      ...(orKey.trim() ? { openrouter_key: orKey.trim() } : {}),
      ...(falKey.trim() ? { fal_key: falKey.trim() } : {}),
      ...(hiveMod.trim() ? { hive_mod_key: hiveMod.trim() } : {}),
      ...(hiveDemo.trim() ? { hive_demo_key: hiveDemo.trim() } : {}),
    });
  }

  return (
    <form className="card after-dark-settings" onSubmit={onSubmit}>
      <h2>On the site</h2>
      <p>
        <label className="fact-private">
          <input type="checkbox" id="ad-enabled" checked={s.enabled} disabled={busy} onChange={(e) => void save({ enabled: e.target.checked })} /> After dark is{" "}
          {s.enabled ? "on" : "off"} {s.enabled && !s.openrouter_last4 && <span className="muted small">(it opens once an OpenRouter key is saved)</span>}
        </label>
      </p>
      <h3>Text: OpenRouter</h3>
      <label htmlFor="ad-or-key">OpenRouter key {s.openrouter_last4 && <span className="muted small">saved, ends …{s.openrouter_last4}</span>}</label>
      <input id="ad-or-key" type="password" autoComplete="off" value={orKey} onChange={(e) => setOrKey(e.target.value)} placeholder="sk-or-…" />
      <label htmlFor="ad-text-model">Model</label>
      <input id="ad-text-model" value={s.text_model} onChange={(e) => setS({ ...s, text_model: e.target.value })} />
      <h3>Pictures and clips: fal.ai</h3>
      <label htmlFor="ad-fal-key">fal.ai key {s.fal_last4 && <span className="muted small">saved, ends …{s.fal_last4}</span>}</label>
      <input id="ad-fal-key" type="password" autoComplete="off" value={falKey} onChange={(e) => setFalKey(e.target.value)} placeholder="key id:secret" />
      <label htmlFor="ad-image-model">Picture model</label>
      <input id="ad-image-model" value={s.image_model} onChange={(e) => setS({ ...s, image_model: e.target.value })} />
      <label htmlFor="ad-video-model">Clip model</label>
      <input id="ad-video-model" value={s.video_model} onChange={(e) => setS({ ...s, video_model: e.target.value })} />
      <h3>The output check: Hive</h3>
      <p className="muted small">
        Every picture and clip is checked after it&apos;s made and discarded if a child is present or any face reads as under 18 (or there&apos;s no
        face to check). Pictures stay off until both keys are saved. Hive gives each project its own key.
        {s.hive_mod_last4 && s.hive_demo_last4 ? " Both are saved: pictures are on." : ""}
      </p>
      <label htmlFor="ad-hive-mod">Hive visual moderation key {s.hive_mod_last4 && <span className="muted small">saved, ends …{s.hive_mod_last4}</span>}</label>
      <input id="ad-hive-mod" type="password" autoComplete="off" value={hiveMod} onChange={(e) => setHiveMod(e.target.value)} />
      <label htmlFor="ad-hive-demo">Hive demographics key {s.hive_demo_last4 && <span className="muted small">saved, ends …{s.hive_demo_last4}</span>}</label>
      <input id="ad-hive-demo" type="password" autoComplete="off" value={hiveDemo} onChange={(e) => setHiveDemo(e.target.value)} />
      <p>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>{" "}
        {s.openrouter_last4 && (
          <button type="button" className="button-ghost" disabled={busy} onClick={() => void save({ openrouter_key: "" })}>
            Remove the OpenRouter key
          </button>
        )}{" "}
        {s.fal_last4 && (
          <button type="button" className="button-ghost" disabled={busy} onClick={() => void save({ fal_key: "" })}>
            Remove the fal.ai key
          </button>
        )}
      </p>
      {note && (
        <p className={note.error ? "error" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </form>
  );
}
