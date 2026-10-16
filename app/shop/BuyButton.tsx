"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { sendFunnel } from "@/app/funnel";
import { requestJson } from "@/app/request";

/**
 * Starts buying one item: the server stores a pending order and answers with the owner's Stripe Payment
 * Link for it, and the browser goes there. `label` is the button text (STRIPE_PRICE_LABEL).
 */
export default function BuyButton({ sku, label, disabled }: { sku: string; label: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Intent to pay, for RepoHQ's funnel (app/funnel.ts): every Buy click, whether or not checkout opens.
    sendFunnel("checkout");
    setBusy(true);
    setError(null);
    try {
      const { status, data, message } = await requestJson("/api/checkout", { sku, attest: form.get("attest") === "on" });
      if (status === 200 && typeof data.url === "string") {
        window.location.assign(data.url);
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={buy}>
      <label className="check">
        <input type="checkbox" name="attest" required disabled={disabled} />
        <span>
          I&apos;m 18 or older and agree to the <Link href="/terms">terms and refund policy</Link>.
        </span>
      </label>
      <button type="submit" disabled={busy || disabled}>
        {busy ? "Opening Stripe…" : label}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
