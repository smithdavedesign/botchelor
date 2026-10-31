"use client";

import { useState, type FormEvent } from "react";
import { trackConversion } from "@/app/conversion";
import { requestJson } from "@/app/request";

/**
 * Asking for an invite to the beta (app/api/after-dark/invite): the two boxes the person ticks themselves (18 or older;
 * how the beta works) and an optional note for whoever reviews it.
 */
export default function InviteForm({ days, clipTokens, reelTokens }: { days: number; clipTokens: number; reelTokens: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const note = String(form.get("note") ?? "").trim();
      const { ok, message } = await requestJson("/api/after-dark/invite", {
        adult: form.get("adult") === "on",
        terms: form.get("terms") === "on",
        ...(note ? { note } : {}),
      });
      if (ok) {
        setSent(true);
        trackConversion("ad_invite_requested");
      }
      else setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <p className="notice" data-invite-sent>
        Thanks: your request is in. You&apos;ll get an email when it&apos;s approved.
      </p>
    );
  }
  return (
    <form className="card" onSubmit={submit} data-invite-form>
      <h2>Ask for an invite</h2>
      <p>
        After Dark is in an invite-only beta. If you&apos;re invited, it&apos;s free for {days} days: every chapter and the pictures are on us. Video
        isn&apos;t included: a clip is {clipTokens} token{clipTokens === 1 ? "" : "s"} and the video of the night {reelTokens} tokens, from the shop.
      </p>
      <label>
        <span>Anything you&apos;d like us to know (optional)</span>
        <textarea name="note" maxLength={500} rows={3} />
      </label>
      <label className="check">
        <input type="checkbox" name="adult" required />
        <span>I&apos;m 18 or older.</span>
      </label>
      <label className="check">
        <input type="checkbox" name="terms" required />
        <span>I understand it&apos;s a beta: free for {days} days, and video costs tokens.</span>
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Ask for an invite"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
