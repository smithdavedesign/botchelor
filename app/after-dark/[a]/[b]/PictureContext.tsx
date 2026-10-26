"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { PictureEdit, PictureFields } from "@/lib/adult/beats";

/** The limits the server holds them to (lib/adult/beats.ts PICTURE_FIELD_MAX, SCENE_CUSTOM_MAX): a server module, so not imported. */
const FIELD_MAX = 300;
const EXTRA_MAX = 400;

const LABELS: { key: keyof PictureFields; label: string; hint: string }[] = [
  { key: "happening", label: "What's happening", hint: "Who's doing what, right now" },
  { key: "wearing", label: "What they're wearing", hint: "Clothed, half undressed, nude; what exactly" },
  { key: "place", label: "Where", hint: "The place, and anything in it" },
  { key: "mood", label: "Mood", hint: "Flirting, trash talking, tender, in a roleplay…" },
];

/**
 * A scene picture's context before it's drawn (David, 2026-10-25: "add the context that will be sent, and allow
 * additional context … more confidence the better"): what the night says, field by field, each one editable, and
 * anything else, with the exact prompt a tap away. Only what the owner changes is sent, and it replaces the guess.
 * `target`: an offered moment, a line (Picture this), or a picture already drawn (Redraw).
 */
export default function PictureContext({
  a,
  b,
  target,
  disabled = false,
  submitLabel,
  onSubmit,
  onCancel,
  cancelLabel = "Cancel",
}: {
  a: string;
  b: string;
  target: { beat?: string; line?: number; picture?: string };
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (edit: PictureEdit | undefined) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [guess, setGuess] = useState<PictureFields | null>(null);
  const [values, setValues] = useState<PictureFields>({ happening: "", wearing: "", place: "", mood: "" });
  const [extra, setExtra] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const targetKey = JSON.stringify(target);

  /** What the owner changed: each field only when it differs from what the night says, and anything else. */
  const edit = (): PictureEdit | undefined => {
    const out: PictureEdit = {};
    for (const { key } of LABELS) if (guess && values[key].trim() && values[key].trim() !== guess[key].trim()) out[key] = values[key].trim();
    if (extra.trim()) out.extra = extra.trim();
    return Object.keys(out).length ? out : undefined;
  };

  async function load(withEdit?: PictureEdit) {
    setNote(null);
    const res = await requestJson("/api/admin/after-dark", { a, b, picture_preview: { ...JSON.parse(targetKey), ...(withEdit ? { edit: withEdit } : {}) } }).catch(() => null);
    if (!res || !res.ok) {
      setNote(res?.message ?? "Couldn't read this moment. Try again.");
      return;
    }
    const p = res.data.preview as { fields: PictureFields; edit: PictureEdit | null; prompt: string };
    setPrompt(p.prompt);
    if (!withEdit) {
      setGuess(p.fields);
      // A picture redrawn starts from the changes it was drawn with.
      setValues({ ...p.fields, ...Object.fromEntries(LABELS.filter(({ key }) => p.edit?.[key]).map(({ key }) => [key, p.edit![key]!])) } as PictureFields);
      setExtra(p.edit?.extra ?? "");
    }
  }
  useEffect(() => {
    void load();
    // Each time it's opened for another moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, targetKey]);

  return (
    <div className="ad-picture-context">
      {LABELS.map(({ key, label, hint }) => (
        <label key={key} className="ad-pc-field">
          <span className="ad-pc-label">
            {label}
            {guess && values[key].trim() !== guess[key].trim() && <span className="ad-pc-changed"> · yours</span>}
          </span>
          <textarea
            rows={key === "happening" ? 2 : 1}
            maxLength={FIELD_MAX}
            value={values[key]}
            placeholder={guess ? guess[key] || hint : "Reading the moment…"}
            disabled={disabled || !guess}
            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
          />
        </label>
      ))}
      <label className="ad-pc-field">
        <span className="ad-pc-label">Anything else</span>
        <input type="text" maxLength={EXTRA_MAX} value={extra} placeholder="Leads the picture: the angle, the light, a detail it must get right" disabled={disabled} onChange={(e) => setExtra(e.target.value)} />
      </label>
      {note && (
        <p className="ad-pc-note" role="alert">
          {note}
        </p>
      )}
      <details className="ad-pc-prompt" open={showPrompt} onToggle={(e) => setShowPrompt((e.target as HTMLDetailsElement).open)}>
        <summary>🔎 What will be sent</summary>
        {prompt ? <p className="small">{prompt}</p> : <p className="muted small">…</p>}
        <button type="button" className="button-ghost small" disabled={disabled || !guess} onClick={() => void load(edit())}>
          Update with my changes
        </button>
      </details>
      <div className="ad-beat-actions">
        <button type="button" className="primary small" disabled={disabled || !guess} onClick={() => onSubmit(edit())}>
          {submitLabel}
        </button>
        <button type="button" className="button-ghost small" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
