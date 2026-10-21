"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "./request";

/**
 * A waitlist for something not open yet (After Dark, for now: its subscribe page tags it `after-dark`). The page around
 * it says what it's for. `refSlug` is the cleaned `?ref=` tag. It was the home page's "Season 1" signup until
 * 2026-10-21: seasons have run monthly since launch, with no sign-up, so the home page dropped it.
 */
export default function WaitlistForm({ refSlug }: { refSlug: string | null }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const community = String(form.get("community") ?? "").trim();
    const ref = String(form.get("ref") ?? "");
    setState("busy");
    setError(null);
    try {
      const { status, message } = await requestJson("/api/waitlist", {
        email: String(form.get("email") ?? ""),
        attest: form.get("attest") === "on",
        ...(community ? { community } : {}),
        ...(ref ? { ref } : {}),
      });
      if (status === 201) {
        setState("done");
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setState("idle");
  }

  if (state === "done") {
    return (
      <section className="card">
        <p className="notice">You&apos;re on the list. We&apos;ll email you once, when it opens.</p>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Hear first</h2>
      <p className="muted">One email when it opens, and nothing else. We never share it.</p>
      <label>
        Email
        <input type="email" name="email" required maxLength={254} autoComplete="email" />
      </label>
      <label>
        Where do you roleplay? (optional)
        <input type="text" name="community" maxLength={80} placeholder="A Discord server, a subreddit, an app…" />
      </label>
      <input type="hidden" name="ref" defaultValue={refSlug ?? ""} />
      <label className="check">
        <input type="checkbox" name="attest" required />
        <span>I&apos;m 18 or older.</span>
      </label>
      <button type="submit" disabled={state === "busy"}>
        {state === "busy" ? "Joining…" : "Join the waitlist"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
