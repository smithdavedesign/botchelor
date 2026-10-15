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
type Character = { id: string; name: string };
type EpisodeCard = {
  episode_id: string;
  share_path: string;
  title: string;
  ending: string;
  revealed: boolean;
  status: string;
  visibility: "public" | "private" | "unlisted";
  is_host: boolean;
};

/**
 * The account page. Anonymous by default: an account is optional and only ADDS things (your characters and
 * dates follow you across devices, private dates, a key you bring). Signing out returns to anonymous play.
 * Your characters and dates show either way — they belong to this browser's session.
 */
export default function AccountPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeCard[]>([]);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, c, e] = await Promise.all([
      fetch("/api/me").then((r) => r.json()),
      fetch("/api/me/characters").then((r) => r.json()),
      fetch("/api/me/episodes").then((r) => r.json()),
    ]);
    setMe(m as Me);
    setCharacters((c.characters ?? []) as Character[]);
    setEpisodes((e.episodes ?? []) as EpisodeCard[]);
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
    if (ok) await load();
    else setError(message);
  }

  async function signOut() {
    setBusy(true);
    await requestJson("/api/auth/logout").catch(() => {});
    setBusy(false);
    await load();
  }

  async function setVisibility(episodeId: string, visibility: string) {
    setEpisodes((list) => list.map((e) => (e.episode_id === episodeId ? { ...e, visibility: visibility as EpisodeCard["visibility"] } : e)));
    const { ok, message } = await requestJson(`/api/episodes/${episodeId}/visibility`, { visibility }, "PATCH").catch(() => ({ ok: false, message: "Network error." }));
    if (!ok) {
      setError(message);
      await load();
    }
  }

  if (!me) return <p className="muted">Loading…</p>;

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
      <section className="card">
        <h2>{mode === "register" ? "Create an account" : "Sign in"}</h2>
        <p className="muted">
          Optional. Anonymous play already works. An account keeps your characters across devices, lets you keep dates
          private, and (soon) bring your own model key. No email needed — a handle is anonymous.
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

  return (
    <>
      {authCard}

      <section className="card">
        <h2>Your characters</h2>
        {characters.length === 0 ? (
          <p className="muted">
            None yet. <Link href="/">Make one</Link> — it&apos;s yours to edit any time.
          </p>
        ) : (
          <ul className="account-links">
            {characters.map((c) => (
              <li key={c.id}>
                <Link href={`/characters/${c.id}`}>{c.name}</Link> <span className="muted small">edit on its card</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Your dates</h2>
        {episodes.length === 0 ? (
          <p className="muted">No dates yet.</p>
        ) : (
          <ul className="account-dates">
            {episodes.map((e) => (
              <li key={e.episode_id}>
                <Link href={e.share_path}>{e.title}</Link>
                {e.is_host ? (
                  <label className="visibility-pick">
                    <span className="muted small">who sees it</span>
                    <select value={e.visibility} onChange={(ev) => setVisibility(e.episode_id, ev.target.value)}>
                      <option value="public">Public — in the feed</option>
                      <option value="unlisted">Unlisted — link only</option>
                      <option value="private">Private — only me</option>
                    </select>
                  </label>
                ) : (
                  <span className="badge">{e.visibility}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
