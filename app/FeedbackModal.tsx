"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CATEGORY_LABELS, FEEDBACK_CATEGORIES, FEEDBACK_EMAIL_MAX, FEEDBACK_MESSAGE_MAX, RATING_MAX, RATING_MIN, type FeedbackCategory } from "@/lib/user-feedback-shared";

const SCALE = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  open: boolean;
  onClose: () => void;
  /** The path it was opened on, sent with the note. */
  page: string;
};

/**
 * "Give us feedback" (lib/user-feedback-shared.ts): a 0-10 "would you recommend us", a category, a message and an optional
 * email for a reply. A centred dialog on a wide screen, a bottom sheet on a phone. A native modal <dialog>, so the page
 * behind is inert while it's open; Tab stays inside it and Escape closes it. What they've typed survives closing it and
 * a failed send; only a note that went through starts a fresh one.
 */
export default function FeedbackModal({ open, onClose, page }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const thanks = useRef<HTMLHeadingElement>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const pressedBackdrop = useRef(false);
  const prefilled = useRef(false);
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // The prop drives the native dialog: showModal() puts it in the top layer and makes everything behind it inert.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      (sent ? thanks : heading).current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, sent]);

  // The page behind stays put while the sheet is up (a phone would scroll it under the sheet).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("feedback-open");
    return () => root.classList.remove("feedback-open");
  }, [open]);

  // A signed-in person's address, offered once for a reply (they can clear it). Anonymous visitors get nothing back.
  useEffect(() => {
    if (!open || prefilled.current) return;
    prefilled.current = true;
    fetch("/api/feedback", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((ctx: { email?: string | null } | null) => {
        if (ctx?.email) setEmail((typed) => typed || (ctx.email as string));
      })
      .catch(() => {});
  }, [open]);

  // Once a note is through and the sheet is closed, the next open starts a new one (the email stays).
  useEffect(() => {
    if (open || !sent) return;
    setRating(null);
    setCategory(null);
    setMessage("");
    setWebsite("");
    setSent(false);
  }, [open, sent]);

  useEffect(() => {
    if (sent) thanks.current?.focus();
  }, [sent]);

  // Tab and Shift+Tab wrap inside the dialog instead of leaving for the browser's own controls.
  const trap = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab" || !dialog.current) return;
    const els = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // A tap on the dimmed page closes it; a drag that starts inside the sheet and ends outside doesn't. On the click, not
  // the pointer's release, so a phone's follow-up click can't land on whatever was under the backdrop.
  const backdropDown = (e: ReactPointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget;
  };
  const backdropClick = (e: ReactMouseEvent<HTMLDialogElement>) => {
    if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
    pressedBackdrop.current = false;
  };

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const words = message.trim();
    if (!words && rating === null) {
      setError("Write a few words, or pick a number from 0 to 10.");
      messageBox.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating,
          category: category ?? undefined,
          message: words || undefined,
          email: email.trim() || undefined,
          page,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          website: website || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; issues?: { message: string }[] };
      if (res.ok) setSent(true);
      else setError(body.issues?.[0]?.message ?? body.message ?? "That didn't send. Try again in a moment.");
    } catch {
      setError("That didn't send: check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="feedback-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onKeyDown={trap}
      onPointerDown={backdropDown}
      onClick={backdropClick}
    >
      <div className="feedback-sheet">
        <div className="feedback-head">
          <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
            Give us feedback
          </h2>
          <button type="button" className="feedback-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {sent ? (
          <div className="feedback-thanks">
            <h3 ref={thanks} tabIndex={-1}>
              Thank you!
            </h3>
            <p>We read every note. Botchelor is in beta, and what you tell us decides what we fix and build next.</p>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={send}>
            <fieldset className="feedback-field">
              <legend>
                How likely are you to recommend Botchelor to a friend? <span className="feedback-optional">Optional</span>
                <span className="sr-only"> 0 is not at all likely, 10 is very likely.</span>
              </legend>
              <div className="feedback-scale">
                {SCALE.map((n) => (
                  <label key={n} className="feedback-choice">
                    <input type="radio" name={`${id}-rating`} value={n} checked={rating === n} onChange={() => setRating(n)} />
                    {n}
                  </label>
                ))}
              </div>
              <p className="feedback-scale-ends" aria-hidden="true">
                <span>Not likely</span>
                <span>Very likely</span>
              </p>
              {rating !== null && (
                <button type="button" className="link-button" onClick={() => setRating(null)}>
                  Clear the number
                </button>
              )}
            </fieldset>

            <fieldset className="feedback-field">
              <legend>
                What&apos;s it about? <span className="feedback-optional">Optional</span>
              </legend>
              <div className="feedback-categories">
                {FEEDBACK_CATEGORIES.map((c) => (
                  <label key={c} className="feedback-choice">
                    <input type="radio" name={`${id}-category`} value={c} checked={category === c} onChange={() => setCategory(c)} />
                    {CATEGORY_LABELS[c]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label htmlFor={`${id}-message`}>
              What&apos;s on your mind?{" "}
              <span className="feedback-optional">{rating === null ? "Needed unless you pick a number" : "Optional"}</span>
            </label>
            <textarea
              id={`${id}-message`}
              ref={messageBox}
              rows={4}
              maxLength={FEEDBACK_MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby={`${id}-count`}
              placeholder="What worked, what didn't, what you'd love to see"
            />
            <p id={`${id}-count`} className="feedback-count">
              {message.length} / {FEEDBACK_MESSAGE_MAX} characters
            </p>

            <label htmlFor={`${id}-email`}>
              Your email, if you&apos;d like a reply <span className="feedback-optional">Optional</span>
            </label>
            <input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" maxLength={FEEDBACK_EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} />

            {/* The honeypot: hidden from people and screen readers, so only a script filling every box fills it. */}
            <div className="feedback-hp" aria-hidden="true">
              <label htmlFor={`${id}-website`}>Website</label>
              <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <p className="feedback-privacy">
              We keep what you send, the page you&apos;re on, your screen size, the app version and your browser, linked to this
              browser&apos;s anonymous ID or your account. Your email only if you add it, and only to reply. Only the Botchelor
              team reads it.{" "}
              <Link href="/privacy" target="_blank" rel="noopener">
                Privacy<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </p>

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="feedback-actions">
              <button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send"}
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
