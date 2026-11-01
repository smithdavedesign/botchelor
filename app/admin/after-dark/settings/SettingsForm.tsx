"use client";

import { useState, type ReactNode } from "react";
import type { HiveState } from "@/lib/adult/hive-limit";
import type { AdultSettings, VoiceModel } from "@/lib/adult/settings";
import { Field, FieldNote, Fold, blurOnEnter, useSettings } from "./autosave";
import WriterSettings from "./WriterSettings";

/** A number field's value: a number, or null when it's empty (the setting's default, or none). */
const numberOrNull = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Each sampling field as typed, and the setting it saves to. */
const SAMPLING_KEYS = { temperature: "text_temperature", frequency: "frequency_penalty", presence: "presence_penalty", repetition: "repetition_penalty" } as const;
type SamplingField = keyof typeof SAMPLING_KEYS;

/** The sampling fields as typed, so one can be emptied (back to its default) and retyped. */
const samplingOf = (x: AdultSettings): Record<SamplingField, string> => ({
  temperature: String(x.text_temperature),
  frequency: String(x.frequency_penalty),
  presence: String(x.presence_penalty),
  repetition: x.repetition_penalty === null ? "" : String(x.repetition_penalty),
});

/** A model id's last part, for a fold's summary ("deepseek/deepseek-chat-v3.1" → "deepseek-chat-v3.1"). */
const short = (model: string) => model.split("/").pop() || model;
const keyState = (last4: string | null | undefined) => (last4 ? `key …${last4}` : "no key");

/** The provider keys: typed here, saved when the field is left, cleared once saved. */
type KeyName = "openrouter_key" | "fal_key" | "hive_key" | "venice_key" | "replicate_key";
type TextKey = { [K in keyof AdultSettings]: AdultSettings[K] extends string ? K : never }[keyof AdultSettings];

/**
 * Models & keys: each provider in a closed fold whose summary says where it stands, and the writer. Every field saves
 * on its own (./autosave.tsx). A key field left empty keeps the saved key. `hive`: the safety check's breaker
 * (lib/adult/hive-limit.ts), shown by the Hive key.
 */
export default function SettingsForm({ hive = null }: { hive?: HiveState | null }) {
  const { s, base, edit, save, status } = useSettings();
  const [sampling, setSampling] = useState(() => samplingOf(base));
  const [keys, setKeys] = useState<Record<KeyName, string>>({ openrouter_key: "", fal_key: "", hive_key: "", venice_key: "", replicate_key: "" });

  /** Saves one setting if it differs from the saved copy. */
  function commit<K extends keyof AdultSettings>(k: K, value: unknown = s[k]) {
    if (JSON.stringify(value) !== JSON.stringify(base[k])) void save(k, { [k]: value });
  }
  /** A select: in the form and saved at once; back to the saved value if it didn't save (the error says why). */
  async function change<K extends keyof AdultSettings>(k: K, value: AdultSettings[K]) {
    const was = base[k];
    edit({ [k]: value } as Partial<AdultSettings>);
    if (!(await save(k, { [k]: value }))) edit({ [k]: was } as Partial<AdultSettings>);
  }
  async function commitSampling(f: SamplingField) {
    const k = SAMPLING_KEYS[f];
    const typed = sampling[f];
    // Empty is null: the default (or, for the repetition penalty, none).
    if (numberOrNull(typed) === base[k]) return;
    const saved = await save(k, { [k]: numberOrNull(typed) });
    // The saved value back in the field (an emptied one shows its default), unless it was retyped meanwhile.
    if (saved) setSampling((cur) => (cur[f] === typed ? { ...cur, [f]: samplingOf(saved)[f] } : cur));
  }
  async function commitKey(k: KeyName) {
    const typed = keys[k].trim();
    // A key typed and not saved (an error) stays in its field.
    if (typed && (await save(k, { [k]: typed }))) setKeys((cur) => (cur[k].trim() === typed ? { ...cur, [k]: "" } : cur));
  }
  const keyInput = (k: KeyName, id: string, placeholder?: string) => (
    <input
      id={id}
      type="password"
      autoComplete="off"
      value={keys[k]}
      onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
      onBlur={() => void commitKey(k)}
      onKeyDown={blurOnEnter}
      placeholder={placeholder}
    />
  );
  const removeKey = (k: KeyName, label: string) => (
    <p className="ad-settings-actions">
      <button type="button" className="button-ghost small" disabled={status[k]?.state === "saving"} onClick={() => void save(k, { [k]: "" })}>
        {label}
      </button>
    </p>
  );
  const text = (k: TextKey, id: string, placeholder?: string) => (
    <input id={id} value={s[k]} onChange={(e) => edit({ [k]: e.target.value })} onBlur={() => commit(k)} onKeyDown={blurOnEnter} placeholder={placeholder} />
  );
  const samplingInput = (f: SamplingField, id: string, min: number) => (
    <input
      id={id}
      type="number"
      min={min}
      max={2}
      step={0.05}
      value={sampling[f]}
      onChange={(e) => setSampling({ ...sampling, [f]: e.target.value })}
      onBlur={() => void commitSampling(f)}
      onKeyDown={blurOnEnter}
    />
  );
  const check = (k: "auto_scene_pictures" | "beat_pictures" | "draw_ahead" | "place_sounds" | "media_fallback", id: string, words: ReactNode, hint: ReactNode) => (
    <label className="ad-check-row">
      <input type="checkbox" id={id} checked={s[k]} disabled={status[k]?.state === "saving"} onChange={(e) => void save(k, { [k]: e.target.checked })} />
      <span>
        {words} <FieldNote field={k} />
        <small className="muted ad-hint">{hint}</small>
      </span>
    </label>
  );

  return (
    // One column, as wide as the card: a select sizes itself to its longest option, which pushed the phone layout
    // wider than the screen.
    <section className="card after-dark-settings" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Models and keys">
      <Fold title="Text: OpenRouter" state={`${keyState(s.openrouter_last4)} · ${short(s.text_model)}`}>
        <Field id="ad-or-key" field="openrouter_key" label="OpenRouter key" hint={s.openrouter_last4 ? `Saved, ends …${s.openrouter_last4}. Type a new one to replace it.` : undefined}>
          {keyInput("openrouter_key", "ad-or-key", "sk-or-…")}
        </Field>
        {s.openrouter_last4 && removeKey("openrouter_key", "Remove the OpenRouter key")}
        <Field id="ad-text-model" field="text_model" label="Model" hint="Recaps, memory, facts and clip directions. The scenes themselves are written by the writer.">
          {text("text_model", "ad-text-model")}
        </Field>
        <p className="muted small">
          How the scene writer samples. The penalties only see the reply being written, so they thin out a word said three times in one go; empty
          puts a field back to its default.
        </p>
        <Field id="ad-temperature" field="text_temperature" label="Temperature" hint="0 to 2; 0.8 by default.">
          {samplingInput("temperature", "ad-temperature", 0)}
        </Field>
        <Field id="ad-frequency-penalty" field="frequency_penalty" label="Frequency penalty" hint="-2 to 2; 0.3 by default.">
          {samplingInput("frequency", "ad-frequency-penalty", -2)}
        </Field>
        <Field id="ad-presence-penalty" field="presence_penalty" label="Presence penalty" hint="-2 to 2; 0.3 by default.">
          {samplingInput("presence", "ad-presence-penalty", -2)}
        </Field>
        <Field id="ad-repetition-penalty" field="repetition_penalty" label="Repetition penalty" hint="Open models only; 1 is off, empty sends none.">
          {samplingInput("repetition", "ad-repetition-penalty", 0)}
        </Field>
        <Field id="ad-prompt-version" field="prompt_version" label="Scene prompt">
          <select id="ad-prompt-version" value={s.prompt_version} onChange={(e) => void change("prompt_version", e.target.value === "v1" ? "v1" : "v2")}>
            <option value="v2">v2: their own voice, and the facts they remember</option>
            <option value="v1">v1: the prompt before 2026-10-21</option>
          </select>
        </Field>
      </Fold>
      <WriterSettings />
      <Fold title="Pictures and clips: fal.ai" state={`${keyState(s.fal_last4)} · ${short(s.image_model)}`}>
        <Field id="ad-fal-key" field="fal_key" label="fal.ai key" hint={s.fal_last4 ? `Saved, ends …${s.fal_last4}.` : undefined}>
          {keyInput("fal_key", "ad-fal-key", "key id:secret")}
        </Field>
        {s.fal_last4 && removeKey("fal_key", "Remove the fal.ai key")}
        <Field id="ad-image-model" field="image_model" label="Picture model">
          {text("image_model", "ad-image-model")}
        </Field>
        <Field id="ad-image-base" field="image_base" label="Base model" hint="For fal-ai/lora, a Hugging Face id.">
          {text("image_base", "ad-image-base")}
        </Field>
        <Field id="ad-video-model" field="video_model" label="Clip model">
          {text("video_model", "ad-video-model")}
        </Field>
      </Fold>
      <Fold
        title="Explicit pictures: Venice"
        state={`${s.image_provider === "venice" ? "makes the pictures" : "off: pictures on fal"} · ${keyState(s.venice_last4)} · ${short(s.venice_image_model)}`}
      >
        <p className="muted small">fal.ai&apos;s rules ban explicit pictures, so they&apos;re made on Venice (safe mode off). Clips still run on fal, from fal pictures only.</p>
        <Field id="ad-image-provider" field="image_provider" label="Make pictures on">
          <select id="ad-image-provider" value={s.image_provider} onChange={(e) => void change("image_provider", e.target.value === "venice" ? "venice" : "fal")}>
            <option value="venice">Venice (or Replicate, if switched below)</option>
            <option value="fal">fal.ai (nothing explicit)</option>
          </select>
        </Field>
        <Field id="ad-venice-key" field="venice_key" label="Venice key" hint={s.venice_last4 ? `Saved, ends …${s.venice_last4}.` : undefined}>
          {keyInput("venice_key", "ad-venice-key")}
        </Field>
        <Field id="ad-venice-model" field="venice_image_model" label="Venice picture model">
          {text("venice_image_model", "ad-venice-model")}
        </Field>
        {check(
          "auto_scene_pictures",
          "ad-auto-pictures",
          "A picture of the two of them each time a chapter starts, and each time they go somewhere new",
          "One per chapter and place, about 1.5¢ each with its checks.",
        )}
        {check(
          "beat_pictures",
          "ad-beat-pictures",
          "A picture of each moment that matters: undressing, sex, each new position, the climax, the afterglow",
          "Offered as the theater plays, drawn when the chapter closes if never asked for; at most 6 a chapter, about 5¢ each with its checks, one Hive check each.",
        )}
        {check(
          "draw_ahead",
          "ad-draw-ahead",
          <>Offer Draw ahead in the theater&apos;s ⋯: a viewer who turns it on has each moment drawn as soon as it&apos;s written, so its picture is on the stage when its line comes</>,
          "Paid by the chapter (the price is under Prices & caps), taken before its first moment is drawn ahead and given back if none is; skips agreeing on the picture first, Redraw stays; a rewind past one wastes it.",
        )}
      </Fold>
      <Fold title="Video of the night: Venice" state={`${short(s.reel_model)} · ${s.reel_shots} shots`}>
        <p className="muted small">
          A short film of a whole night: the strongest lines, each a shot of the two of them together, started from a picture of both made from
          their portraits in the night&apos;s place. Wan 3.0 (the default) says each line itself. A Wan 2.5–2.7 model lip-syncs their stock voice
          instead, but to whichever face is clearest, often the wrong one with two people in the shot. Its price is under Prices &amp; caps.
        </p>
        <Field id="ad-reel-model" field="reel_model" label="Video model">
          {text("reel_model", "ad-reel-model")}
        </Field>
        <Field id="ad-reel-shots" field="reel_shots" label="Shots per video" hint="About 5 seconds each.">
          <input
            id="ad-reel-shots"
            type="number"
            min={2}
            max={12}
            value={s.reel_shots}
            onChange={(e) => edit({ reel_shots: Number(e.target.value) || 6 })}
            onBlur={() => commit("reel_shots")}
            onKeyDown={blurOnEnter}
          />
        </Field>
      </Fold>
      <Fold title="Voices, living faces and places' sound: Venice" state={`${s.voice_model} · place sounds ${s.place_sounds ? "on" : "off"}`}>
        <p className="muted small">
          The voice the theater speaks each line in, a stock one per character by their pronouns (docs/PRDs/theater-immersion.md). Orpheus
          laughs, sighs and gasps where a line&apos;s action does. A line already voiced in one model is kept; another model voices it again.
        </p>
        <Field id="ad-voice-model" field="voice_model" label="Voice model">
          <select id="ad-voice-model" value={s.voice_model} onChange={(e) => void change("voice_model", e.target.value as VoiceModel)}>
            {/* Timed 2026-10-29, one line each. Chatterbox HD (24 s a line) can't keep up with the theater, so it isn't offered. */}
            <option value="kokoro">Kokoro: plain, 1 to 2 s a line, about 0.04¢</option>
            <option value="inworld">Inworld 1.5 Max: warmer, about 3 s a line, about 0.13¢</option>
            <option value="orpheus">Orpheus: acts, laughs and sighs, 4 s a line once warm (minutes cold: a night&apos;s first lines may play silent), about 0.6¢</option>
            {s.voice_model === "chatterbox" && <option value="chatterbox">Chatterbox HD: too slow for the theater (24 s a line)</option>}
          </select>
        </Field>
        <Field id="ad-presence-loop-model" field="presence_loop_model" label="Living portrait model" hint="A 5-second loop of each face, made once, from ✨ Bring them to life in the theater.">
          {text("presence_loop_model", "ad-presence-loop-model")}
        </Field>
        {check(
          "place_sounds",
          "ad-place-sounds",
          "The sound of each place under the voices while 🔈 is on: a quiet loop made once per place and shared",
          "About 5¢ a new place, at most 20 new places a day.",
        )}
        <Field
          id="ad-talk-model"
          field="talk_model"
          label="Talking moments' model"
          hint="🗣 in the theater: one face saying a line in its voice; it takes audio in. wan-2.6-flash-image-to-video: 28¢, about 2.5 min; wan-2-7-image-to-video: 55¢, about 1 min. Priced like a clip on demand."
        >
          {text("talk_model", "ad-talk-model")}
        </Field>
        <Field id="ad-place-sound-model" field="place_sound_model" label="Place sound model" hint="Venice's, one that loops.">
          {text("place_sound_model", "ad-place-sound-model")}
        </Field>
      </Fold>
      <Fold
        title="The backup: Replicate"
        state={`${s.media_provider === "replicate" ? "makes the media" : "standing by"} · ${s.replicate_last4 ? `key …${s.replicate_last4}` : s.replicate_from_env ? "key from the server" : "no key"} · fallback ${s.media_fallback ? "on" : "off"}`}
      >
        <p className="muted small">
          Replicate can make After Dark&apos;s media instead of Venice: its pictures, each shot&apos;s keyframe of the two of them, the videos
          (Wan 2.2, which is silent) and each line in their stock voice (Kokoro, played with the shot). Its own safety checker is off; the
          output check below still checks every picture and video before it&apos;s kept.
        </p>
        <Field id="ad-media-provider" field="media_provider" label="Make pictures and videos on">
          <select id="ad-media-provider" value={s.media_provider} onChange={(e) => void change("media_provider", e.target.value === "replicate" ? "replicate" : "venice")}>
            <option value="venice">Venice</option>
            <option value="replicate">Replicate (the backup)</option>
          </select>
        </Field>
        {check(
          "media_fallback",
          "ad-media-fallback",
          "When that one is rate limited, out of credit or down, make it on the other one",
          "If its key is set; a video already being made stays where it started; a picture on Replicate costs about twice Venice's.",
        )}
        <Field
          id="ad-replicate-key"
          field="replicate_key"
          label="Replicate API token"
          hint={
            s.replicate_last4
              ? `Saved, ends …${s.replicate_last4}.`
              : s.replicate_from_env
                ? "From the server's environment (REPLICATE_API_TOKEN); one saved here is used instead."
                : "None yet."
          }
        >
          {keyInput("replicate_key", "ad-replicate-key", "r8_…")}
        </Field>
        {s.replicate_last4 && removeKey("replicate_key", "Remove the saved Replicate token")}
        <Field id="ad-replicate-picture" field="replicate_picture_model" label="Picture model">
          {text("replicate_picture_model", "ad-replicate-picture")}
        </Field>
        <Field id="ad-replicate-keyframe" field="replicate_keyframe_model" label="Keyframe model" hint="The two of them in one picture.">
          {text("replicate_keyframe_model", "ad-replicate-keyframe")}
        </Field>
        <Field id="ad-replicate-video" field="replicate_video_model" label="Video model">
          {text("replicate_video_model", "ad-replicate-video")}
        </Field>
        <Field id="ad-replicate-voice" field="replicate_voice_model" label="Voice model">
          {text("replicate_voice_model", "ad-replicate-voice")}
        </Field>
        <Field id="ad-replicate-lora" field="replicate_video_lora" label="Video LoRA" hint="Optional: a .safetensors URL for both of Wan's transformers, or two, high noise then low.">
          <input
            id="ad-replicate-lora"
            value={s.replicate_video_lora ?? ""}
            onChange={(e) => edit({ replicate_video_lora: e.target.value })}
            onBlur={() => commit("replicate_video_lora", s.replicate_video_lora ?? "")}
            onKeyDown={blurOnEnter}
            placeholder="https://huggingface.co/…/high_noise.safetensors https://…/low_noise.safetensors"
          />
        </Field>
      </Fold>
      <Fold
        title="The output check: Hive"
        state={
          <>
            {s.hive_last4 ? `key …${s.hive_last4}` : "no key: pictures off"}
            {hive && hive.state !== "ok" && (
              <span className={hive.state === "paused" ? "error" : undefined}>
                {" "}
                · {hive.state === "paused" ? `paused until ${hive.until ? hive.until.slice(11, 16) : "?"} UTC` : hive.state === "failing" ? "failing" : "probing next"}
              </span>
            )}
          </>
        }
      >
        <p className="muted small">
          Every picture and clip is checked after it&apos;s made and discarded if Hive&apos;s moderation sees a child, or its vision model
          can&apos;t say plainly that everyone shown is an adult. Pictures stay off until the key is saved: a secret key from Hive&apos;s Service
          API Keys page (V3).
          {s.hive_last4 ? " It's saved: pictures are on." : ""}
        </p>
        <Field id="ad-hive-key" field="hive_key" label="Hive secret key" hint={s.hive_last4 ? `Saved, ends …${s.hive_last4}.` : undefined}>
          {keyInput("hive_key", "ad-hive-key")}
        </Field>
        {hive && (
          <p className={hive.state === "paused" ? "error small" : "muted small"} role="status" data-hive-state={hive.state}>
            <strong>Hive right now:</strong> {hive.summary}
            {hive.state === "paused" ? " Nothing is drawn (or paid for) while it's paused, and the scene page says until when." : ""}
          </p>
        )}
      </Fold>
    </section>
  );
}
