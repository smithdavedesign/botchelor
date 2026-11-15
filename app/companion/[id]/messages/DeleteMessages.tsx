"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestJson } from "@/app/request";
import When from "@/app/When";
import type { DeletableMessage } from "@/lib/companion-message-delete";
import type { CompanionCharacterRef } from "@/lib/companion-shared";

/**
 * The thread's messages as a plain list, newest first, each with a Delete that asks once (lib/companion-message-delete.ts).
 * Reached from the thread's Settings only: the chat has no delete on its bubbles, by the owner's call (too noisy).
 */
export default function DeleteMessages({ threadId, character, initial }: { threadId: string; character: CompanionCharacterRef; initial: DeletableMessage[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = character.name.split(/\s+/)[0] || character.name;

  async function remove(m: DeletableMessage) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { ok, status, message } = await requestJson(`/api/companion/${threadId}/messages/${encodeURIComponent(m.id)}`, {}, "DELETE");
      // Gone already (deleted in another tab) reads the same as deleted now.
      if (ok || status === 404) {
        setMessages((list) => list.filter((x) => x.id !== m.id));
        setNote("Deleted.");
        setAsking(null);
        // The chat behind this page is read again, so going back never shows the message.
        router.refresh();
      } else setError(message);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="companion-memory" data-companion-delete>
      <p>
        <Link href={`/companion/${threadId}`}>← Back to {first}</Link>
      </p>
      <h1>Delete messages</h1>
      <p className="muted">
        Delete anything you or {first} said, one message at a time. It&apos;s gone for good: the words, its voice note, and any earlier version of a reply you had {first} write
        again.
      </p>
      <p className="muted">
        What {first} already remembers from a message stays until you change it on <Link href={`/companion/${threadId}/memory`}>the memory page</Link>.
      </p>

      <p className="small" role="status" aria-live="polite">
        {note}
      </p>
      {error && <p className="error">{error}</p>}

      {messages.length === 0 ? (
        <p className="muted">Nothing to delete: neither of you has said anything here.</p>
      ) : (
        <ul className="companion-facts companion-delete-list">
          {messages.map((m) => (
            <li key={m.id} data-message={m.id}>
              <span className="chip">{m.from === "you" ? "You" : first}</span>
              <span className="muted small">
                {m.call ? "📞 " : ""}
                {m.photo ? "📷 " : ""}
                {m.voice ? "🔊 " : ""}
                <When iso={m.at} />
              </span>
              <span className="companion-fact-text">{m.photo ? `A photo: ${m.text}` : m.text}</span>
              {asking === m.id ? (
                <span className="companion-fact-tools" role="group" aria-label="Delete this message for good?">
                  <span className="small">{m.reported ? "Delete for good? Your report on it goes too." : "Delete for good?"}</span>
                  <button type="button" className="button secondary small" onClick={() => void remove(m)} disabled={busy}>
                    Yes, delete
                  </button>
                  <button type="button" className="button-ghost small" onClick={() => setAsking(null)} disabled={busy}>
                    Keep
                  </button>
                </span>
              ) : (
                <span className="companion-fact-tools">
                  <button type="button" className="button-ghost small" onClick={() => setAsking(m.id)} disabled={busy} aria-label={`Delete: ${m.text.slice(0, 80)}`}>
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="muted small">
        Not listed: the &ldquo;{first} is an AI character&rdquo; notices and a scene&apos;s opening line, which stay with the conversation and go when you delete all of it (in the
        conversation&apos;s Settings). If {first} texted you first about something on the show, deleting that text leaves a blank marker of what it was about, with none of its words, so
        the same text isn&apos;t sent again.
      </p>
    </article>
  );
}
