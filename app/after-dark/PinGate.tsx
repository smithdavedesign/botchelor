"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import { PIN_MAX, PIN_MIN, RESET_CODE_MINUTES, UNLOCK_HOURS } from "@/lib/adult/discreet";

type Ways = { email: string | null; password: boolean };
type Note = { text: string; error: boolean } | null;

/**
 * The PIN prompt (lib/adult/privacy.ts): what an After Dark page shows a device that hasn't entered the account's PIN.
 * Neutral words: nothing on it says what's behind it. Forgetting the PIN goes through the account: a code to its
 * confirmed email, or its password when it has no email.
 */
export default function PinGate({ reset }: { reset: Ways }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [forgot, setForgot] = useState(false);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/unlock", { pin }).catch(() => null);
    setBusy(false);
    setPin("");
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't check that. Try again.", error: true });
    router.refresh();
  }

  return (
    <div className="after-dark-mode ad-lock">
      <section className="after-dark ad-lock-card" aria-labelledby="ad-lock-title">
        <p className="kicker">🔒 Locked</p>
        <h1 id="ad-lock-title">Enter your PIN</h1>
        <p className="muted">This part of your account has a PIN. Once it&apos;s in, this device stays open for {UNLOCK_HOURS} hours.</p>
        <form className="ad-pin-form" onSubmit={unlock}>
          <label>
            PIN
            <input
              type="password"
              name="pin"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              minLength={PIN_MIN}
              maxLength={PIN_MAX}
              required
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
            />
          </label>
          <button type="submit" disabled={busy || pin.length < PIN_MIN}>
            {busy ? "…" : "Unlock"}
          </button>
        </form>
        <div role="status" aria-live="polite">
          {note && <p className={note.error ? "error" : "muted small"}>{note.text}</p>}
        </div>
        <p>
          <button type="button" className="link-button" aria-expanded={forgot} onClick={() => setForgot((f) => !f)}>
            Forgot your PIN?
          </button>
        </p>
        {forgot && <ForgotPin reset={reset} onReset={() => router.refresh()} />}
        <p className="muted small">
          <Link href="/">Back to the show</Link>
        </p>
      </section>
    </div>
  );
}

/** Resetting through the account: the emailed code, or the account password when there's no email. */
function ForgotPin({ reset, onReset }: { reset: Ways; onReset: () => void }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  async function send() {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/pin-reset", {}).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't send a code. Try again.", error: true });
    setSentTo(String(res.data.to ?? reset.email));
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/pin-reset", reset.email ? { code: value } : { password: value }).catch(() => null);
    setBusy(false);
    setValue("");
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't work. Try again.", error: true });
    onReset();
  }

  const status = (
    <div role="status" aria-live="polite">
      {note && <p className={note.error ? "error" : "muted small"}>{note.text}</p>}
    </div>
  );

  if (!reset.email && !reset.password) {
    return (
      <div className="card ad-pin-forgot">
        <p className="muted">
          This account has no confirmed email or password to prove it&apos;s you, so its PIN can&apos;t be reset here. Add and confirm an email on
          your <Link href="/account">account page</Link>, then come back: the code goes there.
        </p>
      </div>
    );
  }

  if (reset.email && !sentTo) {
    return (
      <div className="card ad-pin-forgot">
        <p className="muted">We&apos;ll email a code to {reset.email}. It takes the PIN off, and you can set a new one.</p>
        <button type="button" className="secondary" disabled={busy} onClick={() => void send()}>
          {busy ? "…" : "Email me a code"}
        </button>
        {status}
      </div>
    );
  }

  return (
    <div className="card ad-pin-forgot">
      <p className="muted">
        {reset.email
          ? `Sent to ${sentTo}. It works for ${RESET_CODE_MINUTES} minutes.`
          : "Confirm it's you with your account's password. That takes the PIN off, and you can set a new one."}
      </p>
      <form className="ad-pin-form" onSubmit={confirm}>
        <label>
          {reset.email ? "Code from the email" : "Account password"}
          {reset.email ? (
            <input
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              required
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d ]/g, "").slice(0, 9))}
            />
          ) : (
            <input type="password" name="password" autoComplete="current-password" maxLength={200} required value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </label>
        <button type="submit" disabled={busy || !value.trim()}>
          {busy ? "…" : "Reset PIN"}
        </button>
      </form>
      {status}
    </div>
  );
}
