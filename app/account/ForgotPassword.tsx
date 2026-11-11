"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "../request";

/**
 * "Forgot your password?" in the sign-in card (lib/account-recovery.ts): the handle or the recovery email, and a link goes
 * to the recovery email. The answer is the same whether or not there's such an account.
 */
export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const who = String(new FormData(event.currentTarget).get("who") ?? "");
    setBusy(true);
    setError(null);
    const r = await requestJson("/api/auth/forgot", { who }).catch(() => null);
    setBusy(false);
    if (r?.ok) setAnswer(String(r.data.message ?? ""));
    else setError(r?.message ?? "Network error. Try again.");
  }

  return (
    <div>
      <h3>Forgot your password?</h3>
      {answer ? (
        <p className="notice" role="status">
          {answer}
        </p>
      ) : (
        <form onSubmit={submit}>
          <p className="muted small">
            Type your handle or your recovery email, and we&apos;ll email a link to choose a new password. It works for accounts
            that added a recovery email.
          </p>
          <label>
            Handle or recovery email
            <input type="text" name="who" required minLength={3} maxLength={254} autoComplete="username" autoFocus />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "…" : "Email me a link"}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <p>
        <button type="button" className="link-button" onClick={onBack}>
          Back to sign in
        </button>
      </p>
    </div>
  );
}
