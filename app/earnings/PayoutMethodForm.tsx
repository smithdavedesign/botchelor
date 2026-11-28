"use client";

import { useState } from "react";
import { useT } from "@/app/I18nProvider";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

type Method = "paypal" | "wise" | "bank" | "other";

/** Where a creator's payouts go (POST /api/money/earnings): a PayPal or Wise email, or a note for a bank or other. */
export default function PayoutMethodForm({ initial }: { initial: { method: Method; handle: string } | null }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [method, setMethod] = useState<Method>(initial?.method ?? "paypal");
  const [handle, setHandle] = useState(initial?.handle ?? "");
  const [saved, setSaved] = useState(false);
  const labels: Record<Method, string> = { paypal: t("PayPal"), wise: t("Wise"), bank: t("Bank transfer"), other: t("Other") };
  return (
    <form
      data-payout-method
      onSubmit={(ev) => {
        ev.preventDefault();
        setSaved(false);
        run(async () => {
          const r = await requestJson("/api/money/earnings", { method, handle });
          if (r.ok) setSaved(true);
          return r;
        });
      }}
    >
      <fieldset className="row">
        <legend className="sr-only">{t("Where to send it")}</legend>
        {(Object.keys(labels) as Method[]).map((m) => (
          <label key={m}>
            <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} /> {labels[m]}
          </label>
        ))}
      </fieldset>
      <label>
        {method === "paypal" || method === "wise" ? t("Email for that account") : t("Details (no full bank numbers: we'll ask for those privately)")}
        <input value={handle} onChange={(ev) => setHandle(ev.target.value)} maxLength={120} required />
      </label>
      <button className="button" type="submit" disabled={busy}>
        {t("Save")}
      </button>
      {saved && (
        <p className="notice notice-ok" role="status">
          {t("Saved.")}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
