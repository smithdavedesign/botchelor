"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "./request";

/** Landing-page waitlist for Season 1. `refSlug` is the cleaned `?ref=` the visitor arrived with. */
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
        <p className="notice">You&apos;re on the list. We&apos;ll email you once, when Season 1 opens.</p>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Get Season 1 first</h2>
      <p className="muted">
        Seasons run monthly: when one closes on the 1st, the top 3 in each friend league earn a badge and the cast
        rotates. Season 1 is the public launch. Leave your email and we&apos;ll send exactly one message when it starts. We never share it.
      </p>
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
