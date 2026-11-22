"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trackConversion } from "../conversion";
import { requestJson } from "../request";
import EmailNotifications from "./EmailNotifications";
import ForgotPassword from "./ForgotPassword";
import MlConsent from "./MlConsent";
import PasswordSettings from "./PasswordSettings";
import YourDates from "./YourDates";
import { DELETE_ACCOUNT_ID } from "./DeleteAccount";
import Avatar from "../Avatar";
import CharacterName from "../CharacterName";
import Icon from "../Icon";

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
 * One of your characters as a tile (2026-11-13 design lift: each was a row of four identical underlined links): the face,
 * the name, one main thing to do (send them on a date) and the rest as quiet links. Your own: its page is open to you
 * even when it's private, so everything links.
 */
export function AccountCharacterTile({ c }: { c: Character }) {
  const id = encodeURIComponent(c.id);
  return (
    <li className="account-character card">
      <Link href={`/characters/${c.id}`} className="account-character-face" aria-label={`${c.name}'s page`}>
        <Avatar seed={c.id} name={c.name} hue={c.hue ?? null} portraitSrc={c.portrait ?? null} size={56} decorative />
      </Link>
      <div className="account-character-body">
        <CharacterName character={c} avatar={false} strong className="account-character-name" />
        <span className="account-character-links">
          <Link href={`/matches?character=${id}`}>
            <Icon name="chat" /> Matches
          </Link>
          <Link href={`/swipe?character=${id}`}>
            <Icon name="heart" /> Swipe
          </Link>
          <Link href={`/characters/${c.id}/edit`}>Edit</Link>
        </span>
      </div>
      <Link href={`/create?character=${id}`} className="button small account-character-go">
        Send on a date
      </Link>
    </li>
  );
}

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
/** The signed-in account page's jump links, in the page's order (app/account/page.tsx renders Appearance and Scenes). */
export function accountJumps({ characters, password, persona }: { characters: number; password: boolean; persona: boolean }): { id: string; label: string }[] {
  return [
    { id: "signed-in", label: "Account" },
    { id: "your-characters", label: "Characters" },
    ...(characters > 0 ? [{ id: "your-dates", label: "Dates" }] : []),
    ...(password ? [{ id: "password", label: "Password" }] : []),
    { id: "model-key", label: "Connections" },
    { id: "appearance", label: "Appearance" },
    ...(persona ? [{ id: "persona", label: "You in scenes" }] : []),
  ];
}

export default function AccountPanel({ next = null, emailConfirmed = null, persona = false }: { next?: string | null; emailConfirmed?: "confirmed" | "invalid" | null; /** "Who you are in scenes" is on the page (app/account/PersonaCard.tsx): a jump link to it. */ persona?: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [connections, setConnections] = useState<ConnectionLine[]>([]);
  const [mode, setModeState] = useState<"login" | "register">("register");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Forgot your password?" in place of the sign-in form (lib/account-recovery.ts).
  const [forgot, setForgot] = useState(false);
  const setMode = (m: "login" | "register") => {
    setModeState(m);
    setError(null);
    setForgot(false);
    try {
      localStorage.setItem(AUTH_MODE_KEY, m);
    } catch {
      /* storage blocked (a private window): not remembered */
    }
  };
  useEffect(() => {
    try {
      if (localStorage.getItem(AUTH_MODE_KEY) === "login") setModeState("login");
    } catch {
      /* storage blocked (a private window): not remembered */
    }
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
      } catch {
        /* storage blocked (a private window): not remembered */
      }
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

  // Everywhere: every device and browser this account is signed in on, not just this one (app/api/auth/logout).
  async function signOut(everywhere = false) {
    setBusy(true);
    await requestJson("/api/auth/logout", everywhere ? { everywhere: true } : {}).catch(() => {});
    setBusy(false);
    await load();
    router.refresh();
  }

  // Holds the panel's room while it loads, so the page doesn't jump by ~1,000px when it arrives (a layout shift of 0.61).
  if (!me) return <p className="muted account-loading" aria-busy="true">Loading…</p>;

  const authCard =
    me.authenticated && me.account ? (
      <section className="card" id="signed-in">
        <h2>Signed in{me.account.handle ? ` as ${me.account.handle}` : ""}</h2>
        <p className="muted">
          Your characters and dates follow you across devices. {me.points} point{me.points === 1 ? "" : "s"} so far.
        </p>
        <div className="account-actions">
          <a href="/api/me/export" className="button-ghost">
            Download your data
          </a>
          <button type="button" className="button-ghost" onClick={() => signOut()} disabled={busy}>
            Sign out
          </button>
          <button type="button" className="button-ghost" onClick={() => signOut(true)} disabled={busy}>
            Sign out everywhere
          </button>
        </div>
        <p className="muted small">
          Signing out returns you to anonymous play. Sign out everywhere does it on every device you&apos;ve signed in on. To
          delete your account and all its data, use{" "}
          <a href={`#${DELETE_ACCOUNT_ID}`}>Delete my account</a> at the foot of this page.
        </p>
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
        {forgot && mode === "login" ? (
          <ForgotPassword onBack={() => setForgot(false)} />
        ) : (
          <>
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
            {mode === "login" && (
              <p>
                <button type="button" className="link-button" onClick={() => setForgot(true)}>
                  Forgot your password?
                </button>
              </p>
            )}
          </>
        )}
        </div>
      </section>
    );

  // Jump links for a signed-in account (the 2026-11-20 mobile audit, C15): the page runs about five phone screens of
  // separate cards, so finding Appearance or Sign out again meant scrolling. Only to cards that are always there for
  // them (email and training cards hide themselves when unavailable, so they're reached through their neighbours).
  const jumps = me.authenticated
    ? accountJumps({ characters: characters.length, password: Boolean(me.account?.has_password), persona })
    : [];

  return (
    <>
      {jumps.length > 0 && (
        <nav className="account-jumps scroll-row" aria-label="On this page">
          {jumps.map((j) => (
            <a key={j.id} className="chip" href={`#${j.id}`}>
              {j.label}
            </a>
          ))}
        </nav>
      )}
      {authCard}

      {/* With no characters there are no dates either: one line, not two empty cards (2026-10-31 UX audit). */}
      <section className="card" id="your-characters">
        <h2>Your characters</h2>
        {characters.length === 0 ? (
          <p className="muted">
            No characters or dates yet. <Link href="/create">Make your character</Link>: it&apos;s yours to edit any time.
          </p>
        ) : (
          <ul className="account-characters">
            {characters.map((c) => (
              <AccountCharacterTile key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>

      {characters.length > 0 && <YourDates />}

      {/* The settings below what's theirs (2026-10-31 UX audit, D8: a signed-in page opened on email and training). */}
      {me.authenticated && me.account?.has_password && <PasswordSettings handle={me.account.handle} />}
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
