"use client";

import { useState } from "react";
import { FieldNote, Fold, UnsavedBar, useSettings } from "./autosave";

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/**
 * Who writes the scenes (lib/adult/writer-config.ts): the default writer, saved when it's picked, and the writers people
 * can pick from (the list as JSON, validated when it's saved). The JSON can't save keystroke by keystroke, so an edit
 * to it shows the Unsaved changes bar until it's saved or discarded. The text model above stays the one for recaps,
 * memory and clip directions.
 */
export default function WriterSettings() {
  const { s, base, edit, save, status } = useSettings();
  const writer = base.writer;
  // What's typed in the JSON; null while it's untouched, so it follows the saved list.
  const [draft, setDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const shown = draft ?? pretty(writer.models);
  const dirty = draft !== null && draft !== pretty(writer.models);
  const label = writer.models.find((m) => m.id === writer.default)?.label ?? writer.default;

  async function saveJson() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(shown);
    } catch {
      return setJsonError("That isn't valid JSON.");
    }
    setJsonError(null);
    if (await save("writer.models", { writer: { models: parsed } })) setDraft(null);
  }

  return (
    <Fold title="✍️ The writer" state={`${label} · ${writer.models.length} to pick from`}>
      <p className="muted small">
        The model that writes the scenes and the two sides of a night. Each person can pick from this list on their After Dark page; this is the
        one everyone else gets. Every writer runs on the reviewed hosts only, so try a step before adding one.
      </p>
      <label htmlFor="ad-writer-default">
        The default writer <FieldNote field="writer.default" />
      </label>
      <select
        id="ad-writer-default"
        value={s.writer.default}
        disabled={status["writer.default"]?.state === "saving"}
        onChange={async (e) => {
          const picked = e.target.value;
          edit({ writer: { ...s.writer, default: picked } });
          if (!(await save("writer.default", { writer: { default: picked } }))) edit({ writer: { ...s.writer, default: base.writer.default } });
        }}
      >
        {writer.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.id})
          </option>
        ))}
      </select>
      <label htmlFor="ad-writer-models">
        The writers people can pick from <FieldNote field="writer.models" />
      </label>
      <textarea
        id="ad-writer-models"
        rows={10}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        style={{ fontFamily: "monospace", width: "100%" }}
      />
      <small className="muted ad-hint">Each with its OpenRouter id, a short name and what to expect. Saving checks every value.</small>
      {jsonError && (
        <p className="error small" role="alert">
          {jsonError}
        </p>
      )}
      {dirty && (
        <UnsavedBar
          what="the writers"
          busy={status["writer.models"]?.state === "saving"}
          onSave={() => void saveJson()}
          onDiscard={() => {
            setDraft(null);
            setJsonError(null);
          }}
        />
      )}
    </Fold>
  );
}
