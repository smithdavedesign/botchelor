"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";

/** Starts a Stripe Checkout for one item and sends the browser to Stripe's hosted page. */
export default function BuyButton({ sku, price, disabled }: { sku: string; price: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
          I&apos;m 18 or older and agree to the <Link href="/legal">terms and refund policy</Link>.
        </span>
      </label>
      <button type="submit" disabled={busy || disabled}>
        {busy ? "Opening checkout…" : `Buy for ${price}`}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
