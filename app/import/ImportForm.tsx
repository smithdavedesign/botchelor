"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { queueEvent } from "@/app/engagement";
import { holdUs } from "./held-history";
import HistoryReview, { type HistoryRow } from "./HistoryReview";
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
import {
  applyHistory,
  cardHistory,
  historyFailedEvent,
  historyKeptEvent,
  historySource,
  historyStartedEvent,
  HISTORY_CARD_MIN,
  HISTORY_CLIENT_TIMEOUT_MS,
  HISTORY_MIN,
  isHistoryFailure,
  screenHistoryItem,
  trimNote,
  withHistory,
  type HistoryFailure,
  type HistoryItem,
  type KeptHistory,
} from "@/lib/import-history";

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

/**
 * Reads a history with the show's paid model (app/api/characters/import/history): the lines, or why there are none. The
 * text goes in the request body and nowhere else: not into an address, a log or this browser's storage.
 */
async function readHistory(text: string, name: string): Promise<{ items: HistoryItem[]; dropped: number } | { failed: HistoryFailure }> {
  try {
    const res = await fetch("/api/characters/import/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...(name ? { name } : {}) }),
      signal: AbortSignal.timeout(HISTORY_CLIENT_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => null)) as { items?: HistoryItem[]; dropped?: number; reason?: string } | null;
    if (!res.ok) return { failed: isHistoryFailure(data?.reason) ? data.reason : res.status === 429 ? "limited" : "model" };
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.length ? { items, dropped: Number(data?.dropped) || 0 } : { failed: "empty" };
  } catch (err) {
    return { failed: err instanceof DOMException && err.name === "TimeoutError" ? "timeout" : "network" };
  }
}

const listWords = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

type Imported = Extract<ImportResult, { ok: true }>;
/** The checklist's state (app/import/HistoryReview.tsx): the character that came in, and what the reader made of its history. */
type Review = { result: Imported; readBy: ReadBy; rows: HistoryRow[]; dropped: number; note: string | null; failure: HistoryFailure | null };

/**
 * `from`: the door the page was opened through (?from=cai), kept on the events so the rescue thread can be read apart.
 * `history`: "Bring their history" is on (IMPORT_MEMORIES, lib/import-history.ts): the second box, and the checklist.
 */
export default function ImportForm({ from = null, history = false }: { from?: string | null; history?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [historyText, setHistoryText] = useState("");
  // The card's own scenario, example dialogue and lorebook are read with the paste unless the person unticks it.
  const [useCard, setUseCard] = useState(true);
  const [review, setReview] = useState<Review | null>(null);
  const card = useMemo(() => (history ? cardHistory(text) : null), [history, text]);
  const pending = useMemo(() => (history ? historySource(historyText, useCard ? card : null) : null), [history, historyText, useCard, card]);

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
      if (history && (await openReview(result, readBy))) return;
      handOver(result, readBy, null);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The character is read; now its history, when there is one to read. True when the checklist is up (with lines, or
   * with the sentence saying why there are none); false when there was nothing to read and the import goes on as ever.
   */
  async function openReview(result: Imported, readBy: ReadBy): Promise<boolean> {
    const name = result.draft.sheet.name;
    const fromCard = useCard ? cardHistory(text, name) : null;
    const source = historySource(historyText, fromCard);
    // Nothing pasted and a card with a line or two of its own: not worth a reading or a second screen.
    if (!historyText.trim() && source.total < HISTORY_CARD_MIN) return false;
    if (source.total < HISTORY_MIN) {
      setError("That's too short to be a history. Paste more of it, or clear the box.");
      return true;
    }
    const started = historyStartedEvent({ pasted: historyText.trim().length > 0, card: (fromCard?.has.length ?? 0) > 0, trimmed: source.trimmed }, from);
    queueEvent(started.name, started.props);
    const read = await readHistory(source.text, name);
    if ("failed" in read) {
      const failed = historyFailedEvent(read.failed, from);
      queueEvent(failed.name, failed.props);
      setReview({ result, readBy, rows: [], dropped: 0, note: null, failure: read.failed });
      return true;
    }
    // A voice line is kept by default only when the card gave no voice: replacing one is the person's call.
    const rows = read.items.map((i) => ({ ...i, original: i.text, keep: i.kind !== "voice" || !result.draft.voice, error: null }));
    setReview({ result, readBy, rows, dropped: read.dropped, note: trimNote(source), failure: null });
    return true;
  }

  /** The draft (with whatever history was kept) left for the builder, the "two of you" lines held for after Create, and the move. */
  function handOver(result: Imported, readBy: ReadBy, kept: KeptHistory | null): boolean {
    const final = kept ? withHistory(result, kept) : result;
    try {
      localStorage.setItem(IMPORT_STORAGE_KEY, JSON.stringify({ ...final, readBy, us: kept?.us.length ?? 0 }));
      // Also clears what an earlier, unfinished import left, so its lines never ride this character.
      holdUs(final.draft.sheet.name, kept?.us ?? []);
    } catch {
      refuse("This browser won't let the page hand your character to the builder (private mode?). Copy the fields into the builder by hand.", "storage");
      return false;
    }
    // Counted before the move, so the event rides this page's visit (the beacon flushes when the page is hidden).
    const ev = importedEvent(final.format, readBy, final.readyToDate, from);
    queueEvent(ev.name, ev.props);
    router.push("/create?imported=1");
    return true;
  }

  /** The checklist's button: every kept line is checked once more as it now reads, and only then does anything move. */
  function keepHistory(skip: boolean) {
    if (!review) return;
    setError(null);
    const offered = review.rows.length;
    const rows = review.rows.map((r) => ({ ...r, error: !skip && r.keep ? screenHistoryItem(r.kind, r.text) : null }));
    if (rows.some((r) => r.error)) {
      setReview({ ...review, rows });
      return;
    }
    const chosen = skip ? [] : rows.filter((r) => r.keep);
    const kept = applyHistory(review.result.draft, chosen);
    if (!handOver(review.result, review.readBy, chosen.length ? kept : null)) return;
    if (offered) {
      const edited = chosen.filter((r) => r.text.trim() !== r.original).length;
      const ev = historyKeptEvent({ offered, ...kept.counts, edited, skipped: skip }, from);
      queueEvent(ev.name, ev.props);
    }
  }

  async function retryHistory() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const { result, readBy } = review;
      if (!(await openReview(result, readBy))) handOver(result, readBy, null);
    } finally {
      setBusy(false);
    }
  }

  if (review) {
    return (
      <HistoryReview
        name={review.result.draft.sheet.name}
        rows={review.rows}
        setRows={(rows) => setReview({ ...review, rows })}
        dropped={review.dropped}
        note={review.note}
        failure={review.failure}
        existingVoice={review.result.draft.voice}
        busy={busy}
        error={error}
        onKeep={() => keepHistory(false)}
        onSkip={() => keepHistory(true)}
        onBack={() => {
          setError(null);
          setReview(null);
        }}
        onRetry={() => void retryHistory()}
      />
    );
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
      {history && (
        <div className="import-history" data-private>
          <label htmlFor="import-history">
            Bring their history <span className="muted">(optional)</span>
          </label>
          <p className="muted small" id="import-history-help">
            A chat log, a lorebook, a scenario, example dialogue: whatever holds what the two of you built. The show&apos;s reader
            turns it into at most eight short lines, and you choose which to keep. Your paste is sent once to the show&apos;s AI
            model to be read; we never store or log it, and only the lines you keep are saved.
          </p>
          <textarea
            id="import-history"
            name="history"
            rows={5}
            value={historyText}
            onChange={(e) => setHistoryText(e.target.value.slice(0, IMPORT_TEXT_MAX))}
            placeholder={"You: do you remember the storm in March?\nMarisol: The night we fixed the radio. You held the torch.\n…"}
            aria-describedby="import-history-help"
            spellCheck={false}
          />
          {card && card.has.length > 0 && (
            <label className="import-history-card">
              <input type="checkbox" name="history_card" checked={useCard} onChange={(e) => setUseCard(e.target.checked)} />
              <span>Read this card&apos;s own {listWords(card.has)} too</span>
            </label>
          )}
          {pending && trimNote(pending) && <p className="muted small">{trimNote(pending)}</p>}
        </div>
      )}
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
