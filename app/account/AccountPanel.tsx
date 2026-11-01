"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trackConversion } from "../conversion";
import { requestJson } from "../request";
import EmailNotifications from "./EmailNotifications";
import MlConsent from "./MlConsent";
import YourDates from "./YourDates";
import CharacterName from "../CharacterName";

type Account = { handle: string | null; has_password: boolean; has_google: boolean };
type Me = {
  points: number;
  authenticated: boolean;
  account: Account | null;
  accounts_available: boolean;
  google_available: boolean;
};
type Character = { id: string; name: string; hue?: number | null; portrait?: string | null };

/**
 * Which tab the sign-in card opens on: the last one used in this browser, so someone coming back lands on Sign in
 * (2026-10-31 UX audit: everyone landed on Create an account, and signing in was a small link under the form).
 */
const AUTH_MODE_KEY = "bz_auth_mode";

/** A job card's one line, from /api/me/connections (lib/connections-shared.ts jobCards). */
type ConnectionLine = { job: string; title: string; status: string; state: "unset" | "connected" | "error"; error: { message: string } | null };

/**
 * The account page. Anonymous by default: an account is optional and only ADDS things (your characters and
 * dates follow you across devices, private dates, a key you bring). Signing out returns to anonymous play.
 * Your characters and dates show either way — they belong to this browser's session.
 */
export default function AccountPanel({ next = null, emailConfirmed = null }: { next?: string | null; emailConfirmed?: "confirmed" | "invalid" | null }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [connections, setConnections] = useState<ConnectionLine[]>([]);
  const [mode, setModeState] = useState<"login" | "register">("register");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setMode = (m: "login" | "register") => {
    setModeState(m);
    setError(null);
    try {
      localStorage.setItem(AUTH_MODE_KEY, m);
    } catch {}
  };
  useEffect(() => {
    try {
      if (localStorage.getItem(AUTH_MODE_KEY) === "login") setModeState("login");
    } catch {}
  }, []);

  const load = useCallback(async () => {
    const [m, c] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/me/characters").then((r) => r.json()),
    ]);
    setMe(m as Me);
    setCharacters((c.characters ?? []) as Character[]);
    if ((m as Me).authenticated) {
      const k = await fetch("/api/me/connections").then((r) => r.json()).catch(() => ({}));
      setConnections((k.cards ?? []) as ConnectionLine[]);
    } else {
      setConnections([]);
    }
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
      // Whoever has an account signs in next time.
      try {
        localStorage.setItem(AUTH_MODE_KEY, "login");
      } catch {}
    }
    if (ok && mode === "register") trackConversion("sign_up", { method: "password" });
    if (ok && next) window.location.assign(next); // back where they were going (the shop, to buy)
    else if (ok) {
      await load();
      // #1034 (the 2026-10-30 prod loop: "After Dark was missing from the nav on /account right after sign-in"): the nav and
      // its meter are drawn on the server for who was signed in before, so they're drawn again.
      router.refresh();
    } else setError(message);
  }

  async function signOut() {
    setBusy(true);
    await requestJson("/api/auth/logout").catch(() => {});
    setBusy(false);
    await load();
    router.refresh();
  }

  // Holds the panel's room while it loads, so the page doesn't jump by ~1,000px when it arrives (a layout shift of 0.61).
  if (!me) return <p className="muted account-loading" aria-busy="true">Loading…</p>;

  const authCard =
    me.authenticated && me.account ? (
      <section className="card">
        <h2>Signed in{me.account.handle ? ` as ${me.account.handle}` : ""}</h2>
        <p className="muted">
          Your characters and dates follow you across devices. {me.points} point{me.points === 1 ? "" : "s"} so far.
        </p>
        <div className="account-actions">
          <a href="/api/me/export" className="button-ghost">
            Download your data
          </a>
          <button type="button" className="button-ghost" onClick={signOut} disabled={busy}>
            Sign out
          </button>
        </div>
        <p className="muted small">Signing out returns you to anonymous play. To delete your account and all its data, see <Link href="/privacy">Privacy</Link>.</p>
      </section>
    ) : !me.accounts_available ? (
      <section className="card">
        <h2>Accounts</h2>
        <p className="notice">You&apos;re playing anonymously, which is all you need. Accounts aren&apos;t enabled on this deployment yet.</p>
      </section>
    ) : (
      <section className="card account-auth">
        <h2 className="sr-only">Your account</h2>
        <div
          className="segmented auth-tabs"
          role="tablist"
          aria-label="Sign in or create an account"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            const other = mode === "login" ? "register" : "login";
            setMode(other);
            document.getElementById(`auth-tab-${other}`)?.focus();
          }}
        >
          {(
            [
              ["login", "Sign in"],
              ["register", "Create account"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              id={`auth-tab-${m}`}
              type="button"
              role="tab"
              className="segmented-tab"
              aria-selected={mode === m}
              aria-controls="auth-panel"
              tabIndex={mode === m ? 0 : -1}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`} className="auth-panel">
        {next === "/shop" && (
          <p className="notice">Sign in or create an account to buy. Your characters and dates come with you, and you&apos;ll go straight back to the shop.</p>
        )}
        <p className="muted" hidden={next === "/shop" || mode === "login"}>
          Optional. Anonymous play already works. An account keeps your characters across devices, lets you keep dates
          private, and bring your own model key. No email needed — a handle is anonymous.
        </p>
        {me.google_available && (
          <>
            <a className="button-google" href={next ? `/api/auth/google/start?next=${encodeURIComponent(next)}` : "/api/auth/google/start"}>
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
        </div>
      </section>
    );

  return (
    <>
      {authCard}

      {/* With no characters there are no dates either: one line, not two empty cards (2026-10-31 UX audit). */}
      <section className="card">
        <h2>Your characters</h2>
        {characters.length === 0 ? (
          <p className="muted">
            No characters or dates yet. <Link href="/create">Make your character</Link>: it&apos;s yours to edit any time.
          </p>
        ) : (
          <ul className="account-characters">
            {characters.map((c) => {
              const id = encodeURIComponent(c.id);
              return (
                <li key={c.id} className="account-character">
                  {/* Your own: its page is open to you even when it's private, so it links. */}
                  <CharacterName character={c} className="account-character-name" size={26} />
                  <span className="account-character-links">
                    <Link href={`/matches?character=${id}`}>💬 Matches</Link>
                    <Link href={`/swipe?character=${id}`}>Swipe</Link>
                    <Link href={`/create?character=${id}`}>Send on a date</Link>
                    <Link href={`/characters/${c.id}/edit`}>Edit</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {characters.length > 0 && <YourDates />}

      {/* The settings below what's theirs (2026-10-31 UX audit, D8: a signed-in page opened on email and training). */}
      {me.authenticated && <EmailNotifications confirmed={emailConfirmed} />}
      {me.authenticated && <MlConsent />}

      {me.authenticated && (
        <section className="card" id="model-key">
          <h2>Connections (optional)</h2>
          <p className="muted small">
            Your own model keys, by what they&apos;re for: your characters&apos; dates and texts, their portraits, their intro clips. Stored
            encrypted; only the last four are ever shown.
          </p>
          {connections.length > 0 && (
            <ul className="account-connections">
              {connections.map((c) => (
                <li key={c.job} className={c.state === "error" ? "is-error" : undefined}>
                  <strong>{c.title}:</strong> <span className="muted">{c.error ? c.error.message : c.status}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="account-actions">
            <Link href="/account/keys" className="button-ghost">
              Manage connections
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
