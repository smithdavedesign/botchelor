"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

type Option = { id: "ccbill" | "segpay" | "verotel"; label: string; statement: string; packs: number[] };
/** `cents`: the price of one token in the pack, so the cheapest per token can wear "Best value" (the design system, 2026-11-11). */
type Pack = { tokens: number; price: string; each: string; cents?: number };

/**
 * After Dark's token packs (app/api/after-dark/tokens): pick a pack, the processor when there's a choice, then off to the
 * processor's own payment page. A one-time charge, nothing renews; the tokens arrive when the payment is confirmed.
 */
export default function BuyTokens({ packs, options }: { packs: Pack[]; options: Option[] }) {
  const [processor, setProcessor] = useState<Option["id"]>(options[0]!.id);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = options.find((o) => o.id === processor) ?? options[0]!;
  // "Best value": the cheapest token among the packs this processor sells, when exactly one pack has that price.
  const priced = packs.filter((p) => chosen.packs.includes(p.tokens) && p.cents !== undefined).map((p) => p.cents as number);
  const cheapest = priced.length ? Math.min(...priced) : null;
  const bestCents = cheapest !== null && priced.filter((c) => c === cheapest).length === 1 ? cheapest : null;

  async function buy(tokens: number) {
    setBusy(tokens);
    setError(null);
    try {
      const { ok, data, message } = await requestJson("/api/after-dark/tokens", { tokens, processor });
      if (ok && typeof data.url === "string") {
        window.location.assign(data.url);
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(null);
  }

  return (
    <div data-buy-tokens>
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
      <ul className="ad-token-packs">
        {packs.map((p) => {
          const sold = chosen.packs.includes(p.tokens);
          const best = sold && p.cents !== undefined && p.cents === bestCents;
          return (
            <li key={p.tokens}>
              <button
                type="button"
                className={best ? "is-best" : undefined}
                disabled={busy !== null || !sold}
                onClick={() => void buy(p.tokens)}
                data-token-pack={p.tokens}
                aria-label={`${p.tokens} tokens for ${p.price}${best ? ", best value" : ""}`}
              >
                {best && (
                  <span className="ad-token-pack-flag" aria-hidden="true">
                    Best value
                  </span>
                )}
                <strong>{p.tokens} tokens</strong>
                <span>{busy === p.tokens ? "Opening checkout…" : p.price}</span>
                <span className="small muted">{sold ? `${p.each} a token` : `not on ${chosen.label}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        A one-time charge by {chosen.label}; nothing renews. It shows on your statement as <strong>{chosen.statement}</strong>. Tokens don&apos;t expire.
        One spent on something that doesn&apos;t come through comes back by itself.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
