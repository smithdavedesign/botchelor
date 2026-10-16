"use client";

import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "../request";

type Status = { status: "off" | "pending" | "on"; email: string | null; google_email: string | null; available: boolean };

/**
 * Email notifications (lib/email.ts) for a signed-in player: on with their Google address in one click, or with
 * another address after its confirmation link. Only what's waiting on them comes at once; the rest is one daily digest.
 */
export default function EmailNotifications({ confirmed }: { confirmed?: "confirmed" | "invalid" | null }) {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(
    confirmed === "confirmed" ? { text: "Email confirmed: it's on." } : confirmed === "invalid" ? { text: "That confirmation link has expired. Send a new one.", error: true } : null,
  );

  useEffect(() => {
    fetch("/api/me/email")
      .then((r) => r.json())
      .then((d) => setS(d as Status))
      .catch(() => {});
  }, []);

  async function turnOn(email: string | null) {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/me/email", email ? { email } : {}).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again.", error: true });
    if (!res.ok) return setMessage({ text: res.message, error: true });
    setS(res.data as Status);
    setMessage({ text: String(res.data.message ?? "") });
  }

  async function turnOff() {
    setBusy(true);
    const res = await requestJson("/api/me/email", {}, "DELETE").catch(() => null);
    setBusy(false);
    if (res?.ok) setS(res.data as Status);
    setMessage({ text: "Email is off." });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void turnOn(String(new FormData(event.currentTarget).get("email") ?? "").trim());
  }

  if (!s || !s.available) return null;
  return (
    <section className="card">
      <h2>Email notifications</h2>
      <p className="muted">
        Hear by email when someone&apos;s waiting on your second-date yes, or a second date is booked. Everything else
        (texts, couples moving up) comes as one daily digest. Unsubscribe from any email in one click.
      </p>
      {s.status === "on" ? (
        <p>
          On, to <strong>{s.email}</strong>.{" "}
          <button type="button" className="link-button" onClick={turnOff} disabled={busy}>
            Turn off
          </button>
        </p>
      ) : (
        <>
          {s.status === "pending" && (
            <p className="notice">
              Waiting for you to confirm <strong>{s.email}</strong>: check its inbox for the link.
            </p>
          )}
          {s.google_email && (
            <p>
              <button type="button" className="primary" onClick={() => turnOn(null)} disabled={busy}>
                Email me at {s.google_email}
              </button>
            </p>
          )}
          <form onSubmit={submit}>
            <label>
              {s.google_email ? "Or another address" : "Your email"}
              <input type="email" name="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" />
            </label>
            <button type="submit" disabled={busy}>
              Send a confirmation link
            </button>
          </form>
        </>
      )}
      {message && message.text && <p className={message.error ? "error" : "muted small"}>{message.text}</p>}
    </section>
  );
}
