"use client";

import { useState, type FormEvent } from "react";
import { trackConversion } from "@/app/conversion";
import { requestJson } from "@/app/request";

/**
 * Starting a free taste of After Dark (app/api/after-dark/taste, lib/adult/taste.ts): one box the person ticks themselves
 * (18 or older), then straight in.
 */
export default function TasteForm({ hours, steps }: { hours: number; steps: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { ok, message } = await requestJson("/api/after-dark/taste", { adult: form.get("adult") === "on" });
      if (ok) {
        trackConversion("ad_taste_started");
        window.location.assign("/after-dark");
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  }

  return (
    <form className="card" onSubmit={submit} data-taste-form>
      <h2>Try it free</h2>
      <p>
        Start a free taste now, no card: {hours} hours of private scenes with this season&apos;s cast, up to {steps} scene steps (about a
        chapter). It&apos;s the words only: pictures, video and voice come with the subscription. Once per account.
      </p>
      <label className="check">
        <input type="checkbox" name="adult" required />
        <span>I&apos;m 18 or older.</span>
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Opening…" : "Start my free taste"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
