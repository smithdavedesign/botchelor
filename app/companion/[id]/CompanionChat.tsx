"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "@/app/Avatar";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import type { CrisisResources } from "@/lib/crisis";
import {
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_LABELS,
  COMPANION_REPORT_REASONS,
  REPLY_LENGTH_LABELS,
  REPLY_LENGTHS,
  type CompanionMessageView,
  type CompanionReportReason,
  type CompanionThreadView,
  type ReplyLength,
} from "@/lib/companion-shared";

type Reply = { view?: CompanionThreadView; message?: string };

/**
 * A companion thread (lib/companion.ts) as a phone-style chat: the character on the left, you on the right, the AI
 * notice as a line in the thread. Draw the last reply again, rewrite your last message, set how much they say, and report
 * any reply. The crisis resources pause the chat until you carry on.
 */
export default function CompanionChat({ initial, initialCrisis }: { initial: CompanionThreadView; initialCrisis: CrisisResources | null }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(initialCrisis);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const c = view.character;
  const first = c.name.split(/\s+/)[0] || c.name;

  const shown = view.messages;
  const lastUser = [...shown].reverse().find((m) => m.role === "user") ?? null;
  const lastIsCharacter = shown.length > 0 && shown[shown.length - 1].role === "character";
  const waitingOnThem = shown.length > 0 && shown[shown.length - 1].role === "user";

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, pending, busy]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/companion/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as (Reply & Record<string, unknown>) | null;
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        setView((v) => ({ ...v, paused: true }));
        return false;
      }
      if (data?.view) setView(data.view);
      if (!res.ok) {
        setNote(data?.message ?? "That didn't work. Try again in a moment.");
        return false;
      }
      return true;
    } catch {
      setNote("Network error. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setPending(text);
    setDraft("");
    const ok = await post(editing ? { action: "edit", text } : { action: "send", text });
    setPending(null);
    if (ok) setEditing(false);
    else setDraft(text);
  }

  function startEdit() {
    if (!lastUser) return;
    setEditing(true);
    setDraft(lastUser.text);
  }

  async function carryOn() {
    if (await post({ action: "carry_on" })) setCrisis(null);
  }

  async function report(m: CompanionMessageView, reason: CompanionReportReason) {
    setReporting(null);
    if (await post({ action: "report", message_id: m.id, reason })) setNote("Thanks. We'll look at it.");
  }

  async function remove() {
    if (!window.confirm(`Delete your conversation with ${first}? Everything ${first} remembers about you goes with it.`)) return;
    const res = await fetch(`/api/companion/${view.id}`, { method: "DELETE" });
    if (res.ok) router.push("/companion");
    else setNote("Couldn't delete it. Try again.");
  }

  const paused = view.paused || Boolean(crisis);

  return (
    <article className="companion-chat">
      <header className="companion-head">
        <Link href="/companion" className="button-ghost small" aria-label="All companions">
          ←
        </Link>
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={40} />
        <div className="companion-head-name">
          <strong>{c.name}</strong>
          <span className="chip companion-ai" title={`${first} is an AI character, not a real person.`}>
            🤖 AI character
          </span>
        </div>
        <details className="companion-menu">
          <summary className="button-ghost small">Settings</summary>
          <div className="companion-menu-body">
            <fieldset>
              <legend>How much {first} says</legend>
              {REPLY_LENGTHS.map((l: ReplyLength) => (
                <label key={l} className="check">
                  <input type="radio" name="reply-length" checked={view.reply_length === l} onChange={() => {
                      // Shown at once; the server's answer confirms it (or puts it back).
                      setView((v) => ({ ...v, reply_length: l }));
                      void post({ action: "length", length: l });
                    }} disabled={busy} />
                  <span>{REPLY_LENGTH_LABELS[l]}</span>
                </label>
              ))}
            </fieldset>
            <p>
              <Link href={`/companion/${view.id}/memory`}>
                What {first} knows about you ({view.facts})
              </Link>
            </p>
            {!c.yours && (
              <p>
                <Link href={`/characters/${c.id}`}>{first}&apos;s profile</Link>
              </p>
            )}
            <p>
              <button type="button" className="linklike" onClick={() => void remove()}>
                Delete this conversation
              </button>
            </p>
          </div>
        </details>
      </header>

      <div className="companion-scroll" ref={scroller}>
        <ol className="chat-thread companion-thread" aria-live="polite">
          {shown.map((m, i) =>
            m.role === "system" ? (
              <li key={m.id} className="chat-item">
                <p className="chat-note" role="note">
                  🤖 {m.text}
                </p>
              </li>
            ) : (
              <li key={m.id} className="chat-item">
                <div className={`chat-row ${m.role === "user" ? "chat-row-b" : "chat-row-a"}`}>
                  {m.role === "character" &&
                    (shown[i + 1]?.role === "character" ? (
                      <span className="companion-avatar-gap" aria-hidden />
                    ) : (
                      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={28} />
                    ))}
                  <div className="chat-col">
                    <p className="chat-bubble">{m.text}</p>
                    {m.role === "character" && (
                      <div className="companion-foot">
                        {m.reported ? (
                          <span className="muted small">Reported</span>
                        ) : reporting === m.id ? (
                          <span className="companion-report">
                            {COMPANION_REPORT_REASONS.map((r) => (
                              <button key={r} type="button" className="button-ghost small" onClick={() => void report(m, r)} disabled={busy}>
                                {COMPANION_REPORT_LABELS[r]}
                              </button>
                            ))}
                            <button type="button" className="button-ghost small" onClick={() => setReporting(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="linklike small muted" onClick={() => setReporting(m.id)} aria-label={`Report ${first}'s message`}>
                            Report
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ),
          )}
          {pending && (
            <li className="chat-item">
              <div className="chat-row chat-row-b">
                <div className="chat-col">
                  <p className="chat-bubble">{pending}</p>
                </div>
              </div>
            </li>
          )}
          {busy && (pending || waitingOnThem) && (
            <li className="chat-item" aria-label={`${first} is typing`}>
              <div className="chat-row chat-row-a">
                <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={28} />
                <div className="chat-col">
                  <p className="chat-bubble chat-typing" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </p>
                </div>
              </div>
            </li>
          )}
        </ol>
      </div>

      {crisis && (
        <div className="companion-pause">
          <CrisisNotice resources={crisis} />
          <p className="small">The conversation is paused. {first} won&apos;t say anything more until you choose to carry on.</p>
          <p className="cta-row">
            <button type="button" className="button secondary" onClick={() => void carryOn()} disabled={busy}>
              Carry on talking
            </button>
            <Link className="button-ghost" href="/companion">
              Leave for now
            </Link>
          </p>
        </div>
      )}

      {!paused && (
        <form className="companion-composer" onSubmit={send}>
          <div className="companion-actions">
            {(lastIsCharacter || waitingOnThem) && (
              <button type="button" className="button-ghost small" onClick={() => void post({ action: "regenerate" })} disabled={busy} data-track="companion-regenerate">
                {waitingOnThem ? `Ask ${first} again` : "↻ Another reply"}
              </button>
            )}
            {lastUser && !editing && (
              <button type="button" className="button-ghost small" onClick={startEdit} disabled={busy}>
                ✎ Edit your last message
              </button>
            )}
            {editing && (
              <button
                type="button"
                className="button-ghost small"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                Cancel the edit
              </button>
            )}
          </div>
          <label className="sr-only" htmlFor="companion-line">
            Your message
          </label>
          <textarea
            id="companion-line"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={COMPANION_MESSAGE_MAX}
            rows={2}
            placeholder={editing ? "Rewrite your last message…" : `Message ${first}…`}
            disabled={busy}
          />
          <div className="companion-send">
            <span className="muted small">
              {draft.length}/{COMPANION_MESSAGE_MAX}
            </span>
            <button type="submit" className="button" disabled={busy || !draft.trim()} data-track="companion-send">
              {editing ? "Send again" : "Send"}
            </button>
          </div>
        </form>
      )}
      {note && (
        <p className="companion-note" role="status">
          {note}
        </p>
      )}
    </article>
  );
}
