"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

type Mine = { id: string; name: string };

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}

/** Buy a template: confirm you're an adult, then pay on Stripe. */
export function BuyTemplate({ listingId, price }: { listingId: string; price: string }) {
  const { busy, error, run } = useAction();
  const [adult, setAdult] = useState(false);
  return (
    <form
      className="market-buy"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await requestJson("/api/money/market", { action: "buy", listing_id: listingId, attest: true });
          if (r.ok && typeof r.data.url === "string") {
            window.location.href = r.data.url;
            return null;
          }
          if (r.data.error === "account_required") return "Sign in first, so the template is yours on any device. Nothing was charged.";
          return r;
        });
      }}
    >
      <label className="check small">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> I am 18 or older
      </label>
      <button type="submit" className="button" disabled={busy || !adult}>
        Buy for {price}
      </button>
      <FormError error={error} />
    </form>
  );
}

/** Make your copy from a paid purchase, under a name of your own. */
export function ClaimTemplate({ orderId, template }: { orderId: string; template: string }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  return (
    <form
      className="letter-row"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await requestJson("/api/money/market/claim", { order_id: orderId, name });
          if (r.ok && typeof r.data.character_id === "string") {
            window.location.href = `/characters/${r.data.character_id}`;
            return null;
          }
          return r;
        });
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder={`A name for your ${template}`} aria-label="Your copy's name" />
      <button type="submit" className="button" disabled={busy || !name.trim()}>
        Make my copy
      </button>
      <FormError error={error} />
    </form>
  );
}

/** List one of your public characters as a template. */
export function ListTemplate({ mine }: { mine: Mine[] }) {
  const { busy, error, run } = useAction();
  const [character, setCharacter] = useState(mine[0]?.id ?? "");
  const [sku, setSku] = useState("market_3");
  const [blurb, setBlurb] = useState("");
  if (!mine.length) return <p className="muted small">Make a public character to list one here.</p>;
  return (
    <form
      className="club-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => requestJson("/api/money/market", { action: "list", character_id: character, sku, blurb }));
      }}
    >
      <div className="letter-row">
        <label>
          Character
          <select value={character} onChange={(e) => setCharacter(e.target.value)}>
            {mine.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Price
          <select value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="market_3">$3</option>
            <option value="market_5">$5</option>
          </select>
        </label>
      </div>
      <label>
        What a buyer gets (optional)
        <input value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={280} placeholder="A lighthouse keeper with a past, ready for a new story." />
      </label>
      <p className="muted small">A buyer gets a private copy of the sheet to rename and change. Your character, its dates and its face stay yours.</p>
      <FormError error={error} />
      <button type="submit" className="button" disabled={busy}>
        List it
      </button>
    </form>
  );
}

/** Take your listing down. Copies already bought stay with their buyers. */
export function Delist({ listingId }: { listingId: string }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <button type="button" className="button secondary" disabled={busy} onClick={() => run(() => requestJson("/api/money/market", { action: "delist", listing_id: listingId }))}>
        Take it down
      </button>
      <FormError error={error} />
    </>
  );
}
