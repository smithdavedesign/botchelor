"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

/** Record a payout made by hand for one creator (POST /api/admin/earnings): the whole balance unless changed. */
export default function RecordPayout({ userId, owedCents }: { userId: string; owedCents: number }) {
  const { busy, error, run } = useAction();
  const [amount, setAmount] = useState((owedCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  return (
    <form
      className="row"
      onSubmit={(ev) => {
        ev.preventDefault();
        run(() => requestJson("/api/admin/earnings", { user_id: userId, amount_cents: Math.round(Number(amount) * 100), note }));
      }}
    >
      <input aria-label="Amount in dollars" inputMode="decimal" size={7} value={amount} onChange={(ev) => setAmount(ev.target.value)} />
      <input aria-label="Note (e.g. PayPal reference)" placeholder="note" size={10} value={note} onChange={(ev) => setNote(ev.target.value)} />
      <button className="button small" type="submit" disabled={busy}>
        Record payout
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
