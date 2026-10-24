"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";

type Option = { id: "segpay" | "verotel"; label: string; statement: string };

/**
 * The subscribe step (app/api/after-dark/subscribe): two boxes the person ticks themselves (18 or older; it renews
 * monthly until they cancel), the processor when there's a choice, then off to the processor's own payment page.
 */
export default function SubscribeForm({ options, price }: { options: Option[]; price: string }) {
  const [processor, setProcessor] = useState<Option["id"]>(options[0]!.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = options.find((o) => o.id === processor) ?? options[0]!;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { ok, data, message } = await requestJson("/api/after-dark/subscribe", {
        adult: form.get("adult") === "on",
        renewal_terms: form.get("renewal_terms") === "on",
        processor,
      });
      if (ok && typeof data.url === "string") {
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
    <form className="card" onSubmit={submit} data-subscribe-form>
      {options.length > 1 && (
        <fieldset>
          <legend>Pay with</legend>
          {options.map((o) => (
            <label key={o.id} className="check">
              <input type="radio" name="processor" value={o.id} checked={processor === o.id} onChange={() => setProcessor(o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="check">
        <input type="checkbox" name="adult" required />
        <span>I&apos;m 18 or older.</span>
      </label>
      <label className="check">
        <input type="checkbox" name="renewal_terms" required />
        <span>
          I agree it renews monthly at {price} until I cancel, and I can cancel any time online.
        </span>
      </label>
      <p className="muted small">
        Billed by {chosen.label}. It shows on your statement as <strong>{chosen.statement}</strong>.
      </p>
      <button type="submit" disabled={busy}>
        {busy ? "Opening checkout…" : `Subscribe for ${price} a month`}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
