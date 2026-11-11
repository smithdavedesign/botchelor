"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestJson } from "../../request";

type State =
  | { kind: "checking" }
  | { kind: "no_link" }
  | { kind: "dead" }
  | { kind: "ready"; token: string; handle: string }
  | { kind: "done"; handle: string };

/** The reset link's token, from after the # (lib/account-recovery.ts puts it there). */
function tokenFromAddress(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("t");
}

/** The new password, twice, for the link's account. Signs this browser in once it's set. */
export default function ResetPasswordForm() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read once: the address loses the token straight after, and React's development double run mustn't read it twice.
  const token = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (token.current === undefined) {
      token.current = tokenFromAddress();
      // Out of the address bar, the history and anything that reads the address later.
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    }
    const t = token.current;
    if (!t) {
      setState({ kind: "no_link" });
      return;
    }
    requestJson("/api/auth/reset", { t }).then(
      (r) => setState(r.ok && typeof r.data.handle === "string" ? { kind: "ready", token: t, handle: r.data.handle } : { kind: "dead" }),
      () => setState({ kind: "dead" }),
    );
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "ready") return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("again") ?? "")) {
      setError("The two passwords aren't the same.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await requestJson("/api/auth/reset", { t: state.token, password }).catch(() => null);
    setBusy(false);
    if (r?.ok) setState({ kind: "done", handle: state.handle });
    else if (r?.data.error === "invalid_link") setState({ kind: "dead" });
    else setError(r?.message ?? "Network error. Try again.");
  }

  if (state.kind === "checking") return <p className="muted" aria-busy="true">Checking the link…</p>;
  if (state.kind === "no_link") {
    return (
      <p className="notice">
        Open this page from the link in the email. Need a new one? Ask on your <Link href="/account">account page</Link>, under Sign in: Forgot your
        password?
      </p>
    );
  }
  if (state.kind === "dead") {
    return (
      <p className="notice">
        That link doesn&apos;t work any more: each one lasts an hour and works once. Ask for a new one on your{" "}
        <Link href="/account">account page</Link>, under Sign in: Forgot your password?
      </p>
    );
  }
  if (state.kind === "done") {
    return (
      <>
        <p className="notice" role="status">
          Done. Your new password is set, and you&apos;re signed in as @{state.handle}.
        </p>
        {/* A full load, so the nav is drawn again for the signed-in account. */}
        <a className="button" href="/account">
          Go to your account
        </a>
      </>
    );
  }
  return (
    <form onSubmit={submit}>
      <p>
        For <strong>@{state.handle}</strong>. Pick something you don&apos;t use anywhere else.
      </p>
      {/* So a password manager saves the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={state.handle} readOnly hidden />
      <label>
        New password
        <input type="password" name="password" required minLength={8} maxLength={200} autoComplete="new-password" autoFocus />
      </label>
      <label>
        The same again
        <input type="password" name="again" required minLength={8} maxLength={200} autoComplete="new-password" />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "…" : "Set the new password"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
