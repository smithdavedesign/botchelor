"use client";

import Link from "next/link";
import { useState } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

const AMOUNTS = [
  { sku: "tip_2", label: "$2" },
  { sku: "tip_3", label: "$3" },
  { sku: "tip_5", label: "$5" },
] as const;

/**
 * Tip a character's creator (lib/money/tips.ts): pick an amount, add a note if you like, and pay on Stripe. The tip
 * counts once Stripe confirms it. The creator sees the note and "A viewer", never who you are.
 */
export default function TipCreator({
  characterId,
  name,
  tips,
  needsAccount = false,
}: {
  characterId: string;
  name: string;
  tips: number;
  /** A signed-out visitor where tips need an account (app/api/money/tips): they're told before the form, not after it. */
  needsAccount?: boolean;
}) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState<string>("tip_3");
  const [note, setNote] = useState("");
  const [adult, setAdult] = useState(false);
  if (!open) {
    return (
      <p className="tip-line">
        <button type="button" className="button secondary" onClick={() => setOpen(true)}>
          💝 Tip {name}&apos;s creator
        </button>
        {tips > 0 && (
          <span className="muted small">
            {" "}
            {tips} {tips === 1 ? "tip" : "tips"} so far
          </span>
        )}
      </p>
    );
  }
  const signIn = `/account?next=${encodeURIComponent(`/characters/${characterId}`)}`;
  if (needsAccount) {
    // The UX pass (2026-11-27): a visitor filled the form, ticked 18+, pressed Tip and only then read "Sign in first".
    return (
      <div className="tip-form card">
        <p className="kicker">Tip the creator</p>
        <p className="small">Tips go through a free account (a handle and a password, no email), so we know whose tip it is if a payment goes wrong.</p>
        <div className="letter-row">
          <Link className="button" href={signIn}>
            Sign in to tip
          </Link>
          <button type="button" className="button secondary" onClick={() => setOpen(false)}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="tip-form card"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await requestJson("/api/money/tips", { character_id: characterId, sku, note, attest: true });
          if (r.ok && typeof r.data.url === "string") {
            window.location.href = r.data.url;
            return null;
          }
          if (r.data.error === "account_required") {
            window.location.href = signIn;
            return null;
          }
          return r;
        });
      }}
    >
      <p className="kicker">Tip the creator</p>
      <div className="tip-amounts" role="radiogroup" aria-label="Amount">
        {AMOUNTS.map((a) => (
          <label key={a.sku} className={sku === a.sku ? "chip chip-on" : "chip"}>
            <input type="radio" name="tip" value={a.sku} checked={sku === a.sku} onChange={() => setSku(a.sku)} />
            {a.label}
          </label>
        ))}
      </div>
      <label>
        A note for the creator (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Loved the pier date." />
      </label>
      <label className="check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> I am 18 or older
      </label>
      <p className="muted small">The creator sees your note, never your name. Creators are paid out by hand each month.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="letter-row">
        <button type="submit" className="button" disabled={busy || !adult}>
          Tip on Stripe
        </button>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </form>
  );
}
