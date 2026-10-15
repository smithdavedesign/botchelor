"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestJson } from "../request";

type Account = { handle: string | null; has_password: boolean; has_google: boolean };
type Me = {
  points: number;
  authenticated: boolean;
  account: Account | null;
  accounts_available: boolean;
  google_available: boolean;
};

/**
 * The account page. Anonymous by default: an account is optional and only ADDS things (your characters and
 * dates are yours to edit, private dates, and a key you bring). Signing out always returns to anonymous play.
 */
export default function AccountPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/me", { headers: { accept: "application/json" } });
    setMe((await res.json()) as Me);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const body =
      mode === "register"
        ? { handle: String(form.get("handle") ?? ""), password: String(form.get("password") ?? ""), attest: form.get("attest") === "on" }
        : { handle: String(form.get("handle") ?? ""), password: String(form.get("password") ?? "") };
    const { ok, message } = await requestJson(`/api/auth/${mode}`, body).catch(() => ({ ok: false, message: "Network error." }));
    setBusy(false);
    if (ok) {
      await load();
    } else {
      setError(message);
    }
  }

  async function signOut() {
    setBusy(true);
    await requestJson("/api/auth/logout").catch(() => {});
    setBusy(false);
    await load();
  }

  if (!me) return <p className="muted">Loading…</p>;

  if (me.authenticated && me.account) {
    return (
      <section className="card">
        <h2>Signed in{me.account.handle ? ` as ${me.account.handle}` : ""}</h2>
        <p className="muted">
          Your characters and dates are yours: you can edit your characters any time, keep dates private, and bring your
          own model key. {me.points} point{me.points === 1 ? "" : "s"} so far.
        </p>
        <ul className="account-links">
          <li>
            <Link href="/feed">Your episodes &amp; leagues</Link>
          </li>
          <li>
            <a href="/api/me/export">Download your data (JSON)</a>
          </li>
        </ul>
        <div className="account-actions">
          <button type="button" className="button-ghost" onClick={signOut} disabled={busy}>
            Sign out
          </button>
        </div>
        <p className="muted small">
          Signing out returns you to anonymous play. To delete your account and all its data, see{" "}
          <Link href="/privacy">Privacy</Link>.
        </p>
      </section>
    );
  }

  if (!me.accounts_available) {
    return (
      <section className="card">
        <h2>Accounts</h2>
        <p className="notice">
          You&apos;re playing anonymously, which is all you need. Accounts (to own your characters across devices, keep
          private dates and bring your own model key) aren&apos;t enabled on this deployment yet.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>{mode === "register" ? "Create an account" : "Sign in"}</h2>
      <p className="muted">
        Optional. Anonymous play already works. An account keeps your characters across devices, lets you edit them any
        time, keep dates private, and bring your own model key. No email needed — a handle is anonymous.
      </p>
      {me.google_available && (
        <>
          <a className="button-google" href="/api/auth/google/start">
            Continue with Google
          </a>
          <p className="muted small or-divider">or use a handle</p>
        </>
      )}
      <form onSubmit={submit}>
        <label>
          Handle
          <input type="text" name="handle" required minLength={3} maxLength={20} autoComplete="username" placeholder="3-20 letters, numbers or _" />
        </label>
        <label>
          Password
          <input type="password" name="password" required minLength={8} maxLength={200} autoComplete={mode === "register" ? "new-password" : "current-password"} />
        </label>
        {mode === "register" && (
          <label className="check">
            <input type="checkbox" name="attest" required />
            <span>I&apos;m 18 or older.</span>
          </label>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        {mode === "register" ? (
          <>
            Already have one?{" "}
            <button type="button" className="link-button" onClick={() => setMode("login")}>
              Sign in
            </button>
          </>
        ) : (
          <>
            New here?{" "}
            <button type="button" className="link-button" onClick={() => setMode("register")}>
              Create an account
            </button>
          </>
        )}
      </p>
    </section>
  );
}
