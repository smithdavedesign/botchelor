"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestJson } from "../request";
import EmailNotifications from "./EmailNotifications";

type Account = { handle: string | null; has_password: boolean; has_google: boolean };
type Me = {
  points: number;
  authenticated: boolean;
  account: Account | null;
  accounts_available: boolean;
  google_available: boolean;
};
type Character = { id: string; name: string };
type SavedKey = { provider: string; kind: string; last4: string; model: string | null };
const TEXT_PROVIDERS: { id: string; label: string }[] = [
  { id: "google", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
];
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
export default function AccountPanel({ next = null, emailConfirmed = null }: { next?: string | null; emailConfirmed?: "confirmed" | "invalid" | null }) {
  const [me, setMe] = useState<Me | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeCard[]>([]);
  const [keys, setKeys] = useState<SavedKey[]>([]);
  const [keyError, setKeyError] = useState<string | null>(null);
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
    if ((m as Me).authenticated) {
      const k = await fetch("/api/me/keys").then((r) => r.json());
      setKeys((k.keys ?? []) as SavedKey[]);
    } else {
      setKeys([]);
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
    if (ok && next) window.location.assign(next); // back where they were going (the shop, to buy)
    else if (ok) await load();
    else setError(message);
  }

  async function signOut() {
    setBusy(true);
    await requestJson("/api/auth/logout").catch(() => {});
    setBusy(false);
    await load();
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setKeyError(null);
    const { ok, message } = await requestJson(
      "/api/me/keys",
      { provider: String(form.get("provider") ?? ""), kind: "text", key: String(form.get("key") ?? ""), model: String(form.get("model") ?? "").trim() || undefined },
      "PUT",
    ).catch(() => ({ ok: false, message: "Network error." }));
    if (ok) {
      (event.target as HTMLFormElement).reset();
      await load();
    } else setKeyError(message);
  }

  async function saveImageKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setKeyError(null);
    const { ok, message } = await requestJson(
      "/api/me/keys",
      { provider: "openai", kind: "image", key: String(form.get("key") ?? "") },
      "PUT",
    ).catch(() => ({ ok: false, message: "Network error." }));
    if (ok) {
      (event.target as HTMLFormElement).reset();
      await load();
    } else setKeyError(message);
  }

  async function saveClipKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setKeyError(null);
    const { ok, message } = await requestJson(
      "/api/me/keys",
      { provider: "google", kind: "image", key: String(form.get("key") ?? "") },
      "PUT",
    ).catch(() => ({ ok: false, message: "Network error." }));
    if (ok) {
      (event.target as HTMLFormElement).reset();
      await load();
    } else setKeyError(message);
  }

  async function removeKey(provider: string, kind: string) {
    await requestJson("/api/me/keys", { provider, kind }, "DELETE").catch(() => {});
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
        {next === "/shop" && (
          <p className="notice">Sign in or create an account to buy tokens. Your characters and dates come with you, and you&apos;ll go straight back to the shop.</p>
        )}
        <p className="muted" hidden={next === "/shop"}>
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
      {me.authenticated && <EmailNotifications confirmed={emailConfirmed} />}

      <section className="card">
        <h2>Your characters</h2>
        {characters.length === 0 ? (
          <p className="muted">
            None yet. <Link href="/create">Make one</Link> — it&apos;s yours to edit any time.
          </p>
        ) : (
          <ul className="account-characters">
            {characters.map((c) => {
              const id = encodeURIComponent(c.id);
              return (
                <li key={c.id} className="account-character">
                  <Link className="account-character-name" href={`/characters/${c.id}`}>
                    {c.name}
                  </Link>
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

      {me.authenticated && (
        <section className="card" id="model-key">
          <h2>Your model key (optional)</h2>
          <p className="muted">
            Bring your own key and your dates run on your quota and your chosen model instead of the free tier. The
            engine still decides every outcome, so a stronger model can&apos;t buy a result. Your key runs only your own
            character&apos;s lines (and a house partner&apos;s) — never another player&apos;s private character. Stored
            encrypted; we only ever show the last four characters.
          </p>
          <p className="muted">
            It also lets your characters text the people they&apos;ve dated whenever you like, as much as you like: on their
            couple page, tap send on the phone.
          </p>
          {keys.filter((k) => k.kind === "text").length > 0 && (
            <ul className="account-links">
              {keys
                .filter((k) => k.kind === "text")
                .map((k) => (
                  <li key={k.provider}>
                    <strong>{TEXT_PROVIDERS.find((p) => p.id === k.provider)?.label ?? k.provider}</strong> ····{k.last4}
                    {k.model ? ` · ${k.model}` : ""}{" "}
                    <button type="button" className="link-button danger" onClick={() => removeKey(k.provider, "text")}>
                      remove
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <form onSubmit={saveKey}>
            <label>
              Provider
              <select name="provider" defaultValue="google">
                {TEXT_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API key
              <input name="key" type="password" required minLength={8} maxLength={400} autoComplete="off" placeholder="sk-… / AIza…" />
            </label>
            <label>
              Model (optional)
              <input name="model" maxLength={80} placeholder="leave blank for a sensible default" />
            </label>
            <button type="submit">Save key</button>
          </form>

          <h3>Image key (optional)</h3>
          <p className="muted small">
            An OpenAI key to generate a portrait for your own characters, on your own quota. Images are
            moderated by the provider and built only from your character&apos;s sheet. Generate from a
            character&apos;s card.
          </p>
          {keys.filter((k) => k.kind === "image" && k.provider === "openai").length > 0 ? (
            <ul className="account-links">
              {keys
                .filter((k) => k.kind === "image" && k.provider === "openai")
                .map((k) => (
                  <li key={`img-${k.provider}`}>
                    <strong>OpenAI Images</strong> ····{k.last4}{" "}
                    <button type="button" className="link-button danger" onClick={() => removeKey(k.provider, "image")}>
                      remove
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <form onSubmit={saveImageKey}>
              <label>
                OpenAI image key
                <input name="key" type="password" required minLength={8} maxLength={400} autoComplete="off" placeholder="sk-…" />
              </label>
              <button type="submit">Save image key</button>
            </form>
          )}

          <h3>Clip key (optional)</h3>
          <p className="muted small">
            Intro clips run on Google&apos;s Veo 3.1 Lite on your own Google key (about $0.20 for a 4-second clip, on your
            Google bill; Veo needs billing turned on in AI Studio). Each clip also costs a bought token. If you already
            saved a Google key above for dates, that one works too.
          </p>
          {keys.filter((k) => k.kind === "image" && k.provider === "google").length > 0 ? (
            <ul className="account-links">
              {keys
                .filter((k) => k.kind === "image" && k.provider === "google")
                .map((k) => (
                  <li key="clip-google">
                    <strong>Google (Veo clips)</strong> ····{k.last4}{" "}
                    <button type="button" className="link-button danger" onClick={() => removeKey("google", "image")}>
                      remove
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <form onSubmit={saveClipKey}>
              <label>
                Google AI Studio key
                <input name="key" type="password" required minLength={8} maxLength={400} autoComplete="off" placeholder="AIza…" />
              </label>
              <button type="submit">Save clip key</button>
            </form>
          )}
          {keyError && <p className="error">{keyError}</p>}
        </section>
      )}

      <section className="card" id="your-dates">
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
