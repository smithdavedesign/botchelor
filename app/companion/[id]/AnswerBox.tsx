"use client";

import { useState } from "react";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import { queueEvent } from "@/app/engagement";
import type { CrisisResources } from "@/lib/crisis";
import type { CompanionQuestionView, CompanionThreadView } from "@/lib/companion-shared";

/**
 * The answer box under a question your own character asked about its sheet (lib/character-questions.ts): one short
 * field and Save, in the character's column, right under the question. The answer goes to the thread's own route (the
 * offer action, kind `answer`), which saves it through the sheet's edit checks; a refusal shows that route's own words
 * here and keeps what was typed. Saved, the thread comes back with the box gone and the character's thanks in it.
 */
export default function AnswerBox({
  threadId,
  messageId,
  question,
  first,
  disabled = false,
  onThread,
}: {
  threadId: string;
  messageId: string;
  question: CompanionQuestionView;
  /** The character's first name, for the box's label. */
  first: string;
  disabled?: boolean;
  /** The thread as the server has it after the answer (their thanks included). */
  onThread: (view: CompanionThreadView) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  const id = `answer-${messageId}`;

  async function save() {
    const answer = text.trim();
    if (!answer || busy) return;
    setBusy(true);
    setNote(null);
    setCrisis(null);
    queueEvent("character_answer", { field: question.field });
    try {
      const res = await fetch(`/api/companion/${threadId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "offer", offer: "answer", message_id: messageId, text: answer }),
      });
      const data = (await res.json().catch(() => null)) as ({ view?: CompanionThreadView; message?: string } & Record<string, unknown>) | null;
      const help = crisisFrom(data);
      if (help) setCrisis(help);
      if (!res.ok) setNote(typeof data?.message === "string" ? data.message : "That didn't save. Try again in a moment.");
      if (data?.view) onThread(data.view);
    } catch {
      setNote("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="companion-answer"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id} className="companion-answer-label">
        {question.label} <span className="muted">(saved to {first}&apos;s sheet)</span>
      </label>
      <div className="companion-answer-row">
        <input
          id={id}
          type="text"
          name="answer"
          value={text}
          maxLength={question.max}
          placeholder={question.placeholder}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          disabled={busy || disabled}
          aria-describedby={note ? `${id}-note` : undefined}
          data-private
        />
        <button type="submit" className="button small" disabled={busy || disabled || !text.trim()} data-track="companion-answer">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {note && (
        <p id={`${id}-note`} className="companion-answer-note" role="alert">
          {note}
        </p>
      )}
      {crisis && <CrisisNotice resources={crisis} />}
    </form>
  );
}
