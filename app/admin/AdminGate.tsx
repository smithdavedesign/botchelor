"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

const STORAGE_KEY = "bz_frontier";

type Area = { href: string; label: string };

/**
 * /admin's sign-in. Every panel below reads the admin password from this browser (localStorage) and, without it, used
 * to say "Not signed in." over its own empty form — eight times down a phone screen. Until there's a password (or the
 * account is an admin), this shows one sign-in card and a line of the admin areas instead.
 */
export default function AdminGate({ areas, children }: { areas: Area[]; children: ReactNode }) {
  const [state, setState] = useState<"checking" | "out" | "in">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The same check the panels' API makes: the password, or a signed-in admin account (no header).
  async function check(key: string): Promise<boolean> {
    const res = await fetch("/api/admin/reports", { headers: key ? { "x-frontier-key": key } : {} }).catch(() => null);
    return Boolean(res?.ok);
  }

  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      /* private mode: an admin account still works */
    }
    if (saved) {
      setState("in");
      return;
    }
    void check("").then((ok) => setState(ok ? "in" : "out"));
  }, []);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const key = password.trim();
    const ok = await check(key);
    setBusy(false);
    if (!ok) {
      setError("That isn't the admin password.");
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* private mode: the panels will ask again */
    }
    setPassword("");
    setState("in");
  }

  function signOut() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing saved */
    }
    setState("out");
  }

  if (state === "checking") return <p className="muted small">Checking…</p>;
  if (state === "in") {
    return (
      <>
        <p className="admin-signed-in muted small">
          Signed in on this browser.{" "}
          <button type="button" className="link-button" onClick={signOut}>
            Forget the password
          </button>
        </p>
        {children}
      </>
    );
  }
  return (
    <>
      <section className="card admin-signin">
        <h2>Sign in</h2>
        <form onSubmit={signIn}>
          <label>
            Admin password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
        <p className="muted small">Kept in this browser only. An admin account works too: sign in to it and reload.</p>
        {error && <p className="error">{error}</p>}
      </section>
      <p className="muted small admin-areas">
        Admin areas:{" "}
        {areas.map((a, i) => (
          <span key={a.href}>
            {i > 0 && " · "}
            <Link href={a.href}>{a.label}</Link>
          </span>
        ))}
      </p>
    </>
  );
}
