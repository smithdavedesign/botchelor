"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { queueEvent } from "@/app/engagement";
import {
  cardJsonFromPng,
  freeTextFallback,
  importCharacter,
  importFromFields,
  IMPORT_STORAGE_KEY,
  IMPORT_TEXT_MAX,
  type ImportResult,
  type SourceFields,
} from "@/lib/import-character";
import { importedEvent, importFailedEvent, type ImportFailure, type ReadBy } from "@/lib/import-events";

/** A small card to try it with (an original sample, written for this page). */
const EXAMPLE = JSON.stringify(
  {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Marisol Vane",
      description:
        "{{char}} is a 29-year-old lighthouse keeper on a foggy island who repairs old radios and listens to ships talk at night.\nOccupation: lighthouse keeper\nLikes: shortwave radio, storms, black licorice\nDislikes: people who whistle indoors",
      personality: "wry, patient, guarded",
      scenario: "",
      first_mes: '*looks up from a radio in pieces* "You\'re dripping on my schematics. Tea\'s on the stove."',
      mes_example: '<START>\n{{char}}: "A radio that only picks up the weather. Like me."',
    },
  },
  null,
  2,
);

/** Reads the free text with the show's free model; null when it can't (out of quota, down, limited). */
async function readFreeText(text: string): Promise<{ fields: SourceFields } | { refused: string } | null> {
  try {
    const res = await fetch("/api/characters/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const data = (await res.json().catch(() => null)) as { fields?: SourceFields; reason?: string; message?: string } | null;
    if (res.status === 422 && data?.reason === "minor" && data.message) return { refused: data.message };
    return res.ok && data?.fields ? { fields: data.fields } : null;
  } catch {
    return null;
  }
}

/** `from`: the door the page was opened through (?from=cai), kept on the events so the rescue thread can be read apart. */
export default function ImportForm({ from = null }: { from?: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);

  /** A refusal, said on the page and counted (import_failed) so the funnel shows where pastes stop. */
  function refuse(message: string, reason: ImportFailure) {
    setError(message);
    const ev = importFailedEvent(reason, from);
    queueEvent(ev.name, ev.props);
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setFileNote(null);
    if (file.size > IMPORT_TEXT_MAX * 20) {
      setError("That file is too big to be a character card.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === "image/png" || /\.png$/i.test(file.name)) {
      const json = cardJsonFromPng(bytes);
      if (!json) {
        setError("That PNG has no character card inside it. Export the card as JSON, or paste its fields.");
        return;
      }
      setText(json);
      setFileNote(`Read the card inside ${file.name}.`);
      return;
    }
    setText(new TextDecoder().decode(bytes).slice(0, IMPORT_TEXT_MAX));
    setFileNote(`Read ${file.name}.`);
  }

  async function bringIn() {
    setError(null);
    setBusy(true);
    try {
      let result: ImportResult;
      let readBy: ReadBy = null;
      const first = importCharacter(text);
      if (first.ok === "free_text") {
        const read = await readFreeText(first.text);
        if (read && "refused" in read) {
          refuse(read.refused, "minor");
          return;
        }
        readBy = read ? "model" : "fallback";
        result = importFromFields("free_text", read ? read.fields : freeTextFallback(first.text), text);
      } else {
        result = first;
      }
      if (!result.ok) {
        refuse(result.message, result.reason);
        return;
      }
      try {
        localStorage.setItem(IMPORT_STORAGE_KEY, JSON.stringify({ ...result, readBy }));
      } catch {
        refuse("This browser won't let the page hand your character to the builder (private mode?). Copy the fields into the builder by hand.", "storage");
        return;
      }
      // Counted before the move, so the event rides this page's visit (the beacon flushes when the page is hidden).
      const ev = importedEvent(result.format, readBy, result.readyToDate, from);
      queueEvent(ev.name, ev.props);
      router.push("/create?imported=1");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="import-form"
      onSubmit={(e) => {
        e.preventDefault();
        void bringIn();
      }}
    >
      <label htmlFor="import-text">Your character</label>
      <textarea
        id="import-text"
        name="text"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Name: …\nTagline: …\nDescription: …\nGreeting: …\nDefinition: …\n\nor a character card's JSON"}
        spellCheck={false}
      />
      <div className="import-actions">
        <label className="import-file button-ghost">
          Open a card file (.json or .png)
          <input type="file" accept=".json,.png,.txt,application/json,image/png,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        <button type="button" className="link-button" onClick={() => setText(EXAMPLE)}>
          Try an example card
        </button>
      </div>
      {fileNote && <p className="muted small">{fileNote}</p>}
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !text.trim()}>
        {busy ? "Reading…" : "Bring them in"}
      </button>
    </form>
  );
}
