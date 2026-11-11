"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { requestJson } from "../request";

type Status = { available: boolean; has_password: boolean; email: string | null };
type Note = { form: "password" | "email"; text: ReactNode; error?: boolean };

/**
 * A handle-and-password account's password and recovery email (lib/account-recovery.ts). Each change takes the current
 * password. /.well-known/change-password sends password managers here (#password).
 */
export default function PasswordSettings({ handle }: { handle: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = (await fetch("/api/auth/recovery")
      .then((x) => x.json())
      .catch(() => null)) as Partial<Status> | null;
    if (r && typeof r.has_password === "boolean") setStatus(r as Status);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Arriving from /.well-known/change-password (/account#password): the card appears after the page, so scroll to it then.
  const ready = Boolean(status?.has_password);
  useEffect(() => {
    if (ready && window.location.hash === "#password") document.getElementById("password")?.scrollIntoView();
  }, [ready]);

  if (!status?.has_password) return null;
  const email = status.email;

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("again") ?? "")) {
      setNote({ form: "password", text: "The two new passwords aren't the same.", error: true });
      return;
    }
    setBusy(true);
    const r = await requestJson("/api/auth/password", { current: String(form.get("current") ?? ""), password }).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      formEl.reset();
      setNote({ form: "password", text: email ? "Password changed. We've let your recovery email know." : "Password changed." });
    } else setNote({ form: "password", text: r?.message ?? "Network error. Try again.", error: true });
  }

  async function sendResetLink() {
    setBusy(true);
    const r = await requestJson("/api/auth/forgot", { who: handle ?? "" }).catch(() => null);
    setBusy(false);
    setNote(
      r?.ok
        ? { form: "password", text: <>A link to choose a new password is on its way to <strong>{email}</strong>. It works for an hour.</> }
        : { form: "password", text: r?.message ?? "Network error. Try again.", error: true },
    );
  }

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const removing = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "remove";
    setBusy(true);
    const password = String(form.get("password") ?? "");
    const r = removing
      ? await requestJson("/api/auth/recovery", { password }, "DELETE").catch(() => null)
      : await requestJson("/api/auth/recovery", { email: String(form.get("email") ?? ""), password }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setNote({ form: "email", text: r?.message ?? "Network error. Try again.", error: true });
      return;
    }
    formEl.reset();
    if (removing) setNote({ form: "email", text: "Removed. A forgotten password can't be reset by email now." });
    else if (r.data.status === "sent") {
      setNote({
        form: "email",
        text: (
          <>
            Check <strong>{String(r.data.email)}</strong>: the address counts once you press the button in our email. The link works for 2 days.
          </>
        ),
      });
    } else setNote({ form: "email", text: "Saved: reset links go there now." });
    await load();
  }

  const shown = (form: Note["form"]) =>
    note?.form === form && (
      <p className={note.error ? "error" : "notice"} role={note.error ? "alert" : "status"}>
        {note.text}
      </p>
    );

  return (
    <section className="card" id="password">
      <h2>Password and recovery</h2>
      <p className="muted small">
        {email ? (
          <>
            If you forget your password, the reset link goes to <strong>{email}</strong>.
          </>
        ) : (
          "No recovery email yet. Without one, a forgotten password can't be reset, and the account can't be got back."
        )}
      </p>

      <form onSubmit={changePassword}>
        <h3>Change your password</h3>
        {/* So a password manager saves the new password under the right account. */}
        <input type="text" name="username" autoComplete="username" value={handle ?? ""} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
        <label>
          Current password
          <input type="password" name="current" required maxLength={200} autoComplete="current-password" />
        </label>
        <label>
          New password
          <input type="password" name="password" required minLength={8} maxLength={200} autoComplete="new-password" />
        </label>
        <label>
          The new one again
          <input type="password" name="again" required minLength={8} maxLength={200} autoComplete="new-password" />
        </label>
        <div className="account-actions">
          <button type="submit" disabled={busy}>
            Change password
          </button>
          {email && (
            <button type="button" className="button-ghost" onClick={sendResetLink} disabled={busy}>
              Forgot it? Email me a link
            </button>
          )}
        </div>
        {shown("password")}
      </form>

      {status.available ? (
        <form onSubmit={saveEmail}>
          <h3>{email ? "Change the recovery email" : "Add a recovery email"}</h3>
          <p className="muted small">Used only to reset your password and to tell you when it or this address changes.</p>
          <label>
            Email
            <input type="email" name="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" />
          </label>
          <label>
            Current password
            <input type="password" name="password" required maxLength={200} autoComplete="current-password" />
          </label>
          <div className="account-actions">
            <button type="submit" value="save" disabled={busy}>
              Save
            </button>
            {email && (
              <button type="submit" value="remove" formNoValidate className="button-ghost" disabled={busy}>
                Remove it
              </button>
            )}
          </div>
          {shown("email")}
        </form>
      ) : (
        <p className="muted small">Email isn&apos;t set up on this deployment, so a recovery email can&apos;t be added here.</p>
      )}
    </section>
  );
}
