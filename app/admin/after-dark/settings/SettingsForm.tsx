"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import type { AdultSettings } from "@/lib/adult/settings";

/** A number field's value: a number, or null when it's empty (the setting's default, or none). */
const numberOrNull = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The switch, the models and the provider keys. A key field left empty keeps the saved key. */
export default function SettingsForm({ initial }: { initial: AdultSettings }) {
  const [s, setS] = useState(initial);
  // The sampling fields as typed, so one can be emptied (back to its default) and retyped.
  const samplingOf = (x: AdultSettings) => ({
    temperature: String(x.text_temperature),
    frequency: String(x.frequency_penalty),
    presence: String(x.presence_penalty),
    repetition: x.repetition_penalty === null ? "" : String(x.repetition_penalty),
  });
  const [sampling, setSampling] = useState(() => samplingOf(initial));
  const [orKey, setOrKey] = useState("");
  const [falKey, setFalKey] = useState("");
  const [hiveKey, setHiveKey] = useState("");
  const [veniceKey, setVeniceKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/settings", patch).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't save that.", error: true });
    setS(res.data.settings as AdultSettings);
    setSampling(samplingOf(res.data.settings as AdultSettings));
    setOrKey("");
    setFalKey("");
    setHiveKey("");
    setVeniceKey("");
    setNote({ text: "Saved." });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save({
      text_model: s.text_model,
      // Empty is null: the default (or, for the repetition penalty, none).
      text_temperature: numberOrNull(sampling.temperature),
      frequency_penalty: numberOrNull(sampling.frequency),
      presence_penalty: numberOrNull(sampling.presence),
      repetition_penalty: numberOrNull(sampling.repetition),
      prompt_version: s.prompt_version,
      image_model: s.image_model,
      image_base: s.image_base,
      video_model: s.video_model,
      ...(orKey.trim() ? { openrouter_key: orKey.trim() } : {}),
      ...(falKey.trim() ? { fal_key: falKey.trim() } : {}),
      ...(hiveKey.trim() ? { hive_key: hiveKey.trim() } : {}),
      ...(veniceKey.trim() ? { venice_key: veniceKey.trim() } : {}),
      image_provider: s.image_provider,
      venice_image_model: s.venice_image_model,
      reel_model: s.reel_model,
      reel_shots: s.reel_shots,
      reel_tokens: s.reel_tokens,
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
      <p className="muted small">
        How the scene writer samples. The penalties only see the reply being written, so they thin out a word said three times in one go; empty
        puts a field back to its default.
      </p>
      <label htmlFor="ad-temperature">Temperature (0 to 2; 0.8 by default)</label>
      <input id="ad-temperature" type="number" min={0} max={2} step={0.05} value={sampling.temperature} onChange={(e) => setSampling({ ...sampling, temperature: e.target.value })} />
      <label htmlFor="ad-frequency-penalty">Frequency penalty (-2 to 2; 0.3 by default)</label>
      <input id="ad-frequency-penalty" type="number" min={-2} max={2} step={0.05} value={sampling.frequency} onChange={(e) => setSampling({ ...sampling, frequency: e.target.value })} />
      <label htmlFor="ad-presence-penalty">Presence penalty (-2 to 2; 0.3 by default)</label>
      <input id="ad-presence-penalty" type="number" min={-2} max={2} step={0.05} value={sampling.presence} onChange={(e) => setSampling({ ...sampling, presence: e.target.value })} />
      <label htmlFor="ad-repetition-penalty">Repetition penalty (open models only; 1 is off, empty sends none)</label>
      <input id="ad-repetition-penalty" type="number" min={0} max={2} step={0.05} value={sampling.repetition} onChange={(e) => setSampling({ ...sampling, repetition: e.target.value })} />
      <label htmlFor="ad-prompt-version">Scene prompt</label>
      <select id="ad-prompt-version" value={s.prompt_version} onChange={(e) => setS({ ...s, prompt_version: e.target.value === "v1" ? "v1" : "v2" })}>
        <option value="v2">v2: their own voice, and the facts they remember</option>
        <option value="v1">v1: the prompt before 2026-10-21</option>
      </select>
      <h3>Pictures and clips: fal.ai</h3>
      <label htmlFor="ad-fal-key">fal.ai key {s.fal_last4 && <span className="muted small">saved, ends …{s.fal_last4}</span>}</label>
      <input id="ad-fal-key" type="password" autoComplete="off" value={falKey} onChange={(e) => setFalKey(e.target.value)} placeholder="key id:secret" />
      <label htmlFor="ad-image-model">Picture model</label>
      <input id="ad-image-model" value={s.image_model} onChange={(e) => setS({ ...s, image_model: e.target.value })} />
      <label htmlFor="ad-image-base">Base model (for fal-ai/lora, a Hugging Face id)</label>
      <input id="ad-image-base" value={s.image_base} onChange={(e) => setS({ ...s, image_base: e.target.value })} />
      <label htmlFor="ad-video-model">Clip model</label>
      <input id="ad-video-model" value={s.video_model} onChange={(e) => setS({ ...s, video_model: e.target.value })} />
      <h3>Explicit pictures: Venice</h3>
      <p className="muted small">
        fal.ai&apos;s rules ban explicit pictures, so they&apos;re made on Venice (safe mode off). Clips still run on fal, from fal pictures only.
      </p>
      <label htmlFor="ad-image-provider">Make pictures on</label>
      <select
        id="ad-image-provider"
        value={s.image_provider}
        onChange={(e) => setS({ ...s, image_provider: e.target.value === "venice" ? "venice" : "fal" })}
      >
        <option value="venice">Venice</option>
        <option value="fal">fal.ai (nothing explicit)</option>
      </select>
      <label htmlFor="ad-venice-key">Venice key {s.venice_last4 && <span className="muted small">saved, ends …{s.venice_last4}</span>}</label>
      <input id="ad-venice-key" type="password" autoComplete="off" value={veniceKey} onChange={(e) => setVeniceKey(e.target.value)} />
      <label htmlFor="ad-venice-model">Venice picture model</label>
      <input id="ad-venice-model" value={s.venice_image_model} onChange={(e) => setS({ ...s, venice_image_model: e.target.value })} />
      <h3>Video of the night: Venice</h3>
      <p className="muted small">
        A short film of a whole night: the strongest lines, each a shot of the speaker saying it in their own stock voice. A Wan 2.6 or 2.5 model
        lip-syncs to that voice; any other model is given the line to speak itself.
      </p>
      <label htmlFor="ad-reel-model">Video model</label>
      <input id="ad-reel-model" value={s.reel_model} onChange={(e) => setS({ ...s, reel_model: e.target.value })} />
      <label htmlFor="ad-reel-shots">Shots per video (about 5 seconds each)</label>
      <input id="ad-reel-shots" type="number" min={2} max={12} value={s.reel_shots} onChange={(e) => setS({ ...s, reel_shots: Number(e.target.value) || 6 })} />
      <label htmlFor="ad-reel-tokens">Price in bought tokens (admins don&apos;t pay)</label>
      <input id="ad-reel-tokens" type="number" min={0} max={500} value={s.reel_tokens} onChange={(e) => setS({ ...s, reel_tokens: Number(e.target.value) || 0 })} />
      <h3>The output check: Hive</h3>
      <p className="muted small">
        Every picture and clip is checked after it&apos;s made and discarded if Hive&apos;s moderation sees a child, or its vision model
        can&apos;t say plainly that everyone shown is an adult. Pictures stay off until the key is saved: a secret key from Hive&apos;s Service
        API Keys page (V3).
        {s.hive_last4 ? " It's saved: pictures are on." : ""}
      </p>
      <label htmlFor="ad-hive-key">Hive secret key {s.hive_last4 && <span className="muted small">saved, ends …{s.hive_last4}</span>}</label>
      <input id="ad-hive-key" type="password" autoComplete="off" value={hiveKey} onChange={(e) => setHiveKey(e.target.value)} />
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
