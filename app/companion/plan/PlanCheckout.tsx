"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/app/I18nProvider";
import { requestJson } from "@/app/request";

/**
 * Subscribe (app/api/plans/checkout): both boxes ticked, then off to Stripe's page. The renewal terms are said above the
 * boxes and agreed to here, before paying (California's auto-renewal law).
 */
export function PlanCheckout({ price }: { price: string }) {
  const t = useT();
  const [adult, setAdult] = useState(false);
  const [renews, setRenews] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, data, message } = await requestJson("/api/plans/checkout", { plan: "companion", attest: adult, renews });
      if (ok && typeof data.url === "string") {
        window.location.href = data.url;
        return;
      }
      setError(message);
    } catch {
      setError(t("Network error. Nothing was charged. Try again."));
    }
    setBusy(false);
  }
  return (
    <form className="plan-checkout" onSubmit={go}>
      <label className="check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>{t("I'm 18 or older.")}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={renews} onChange={(e) => setRenews(e.target.checked)} />
        <span>{t("I understand it renews automatically at {price} until I cancel.", { price })}</span>
      </label>
      <p className="cta-row">
        <button type="submit" className="button" disabled={busy || !adult || !renews} data-track="companion-plan-subscribe">
          {busy ? t("Opening Stripe…") : t("Subscribe: {price}", { price })}
        </button>
      </p>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}

/** Back from Stripe: waits (up to a minute) for the webhook to start the plan, then shows it. */
export function PlanWait() {
  const t = useT();
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const res = await fetch("/api/plans").catch(() => null);
      const data = (await res?.json().catch(() => null)) as { plans?: { plan: string; active: boolean }[] } | null;
      if (data?.plans?.some((p) => p.plan === "companion" && p.active)) {
        clearInterval(timer);
        router.replace("/companion/plan");
        router.refresh();
      } else if (tries >= 20) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p className="plan-wait" role="status">
      {gaveUp
        ? t("Stripe hasn't told us about the payment yet. It can take a few minutes; refresh this page in a bit. If you were charged and it doesn't start, reply to Stripe's receipt and we'll sort it out.")
        : t("Thanks! Your plan starts as soon as Stripe confirms the payment, usually within seconds…")}
    </p>
  );
}
