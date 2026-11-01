"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { trackConversion } from "@/app/conversion";
import { sendFunnel } from "@/app/funnel";
import { requestJson } from "@/app/request";

/**
 * Starts buying one item: the server stores a pending order and answers with the owner's Stripe Payment
 * Link for it, and the browser goes there. `label` is the button text (STRIPE_PRICE_LABEL). The shop shows it only
 * while a Payment Link is set (app/shop/page.tsx).
 */
export default function BuyButton({ sku, label }: { sku: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signin, setSignin] = useState<string | null>(null);

  async function buy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    trackConversion("begin_checkout", { sku });
    setBusy(true);
    setError(null);
    setSignin(null);
    try {
      const { status, data, message } = await requestJson("/api/checkout", { sku, attest: form.get("attest") === "on" });
      if (status === 200 && typeof data.url === "string") {
        window.location.assign(data.url);
        return;
      }
      setError(message);
      // Buying needs an account (the server says so even if this page was loaded signed in and signed out since).
      if (status === 401 && typeof data.signin === "string") setSignin(data.signin);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={buy}>
      <label className="check">
        <input type="checkbox" name="attest" required />
        <span>
          I&apos;m 18 or older and agree to the <Link href="/terms">terms and refund policy</Link>.
        </span>
      </label>
      {/* Intent to pay, for RepoHQ's funnel (app/funnel.ts): every Buy click, counted on the click itself, since the
          required checkbox stops the form's submit until it's ticked. */}
      <button type="submit" disabled={busy} onClick={() => sendFunnel("checkout")}>
        {busy ? "Opening Stripe…" : label}
      </button>
      {error && (
        <p className="error">
          {error}
          {signin && (
            <>
              {" "}
              <Link href={signin}>Sign in</Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
