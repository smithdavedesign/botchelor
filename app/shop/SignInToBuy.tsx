"use client";

import Link from "next/link";
import { useState } from "react";
import Sheet from "@/app/Sheet";
import { trackConversion } from "@/app/conversion";
import { sendFunnel } from "@/app/funnel";
import { useT } from "@/app/I18nProvider";
import { fillNodes } from "@/app/fillNodes";

/**
 * Buy, for a visitor who isn't signed in (2026-10-31 UX audit, A9): the price is still the button, and it asks them to
 * sign in, in a sheet, instead of the card reading like an error. The click counts as intent to pay, as BuyButton's does.
 * Signing up keeps everything they already have (the account adopts their anonymous id), and both ways back land on
 * the shop again. `quiet`: the outlined button, as BuyButton's.
 */
export default function SignInToBuy({ sku, label, google, quiet = false }: { sku: string; label: string; google: boolean; quiet?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const next = encodeURIComponent("/shop");
  return (
    <>
      <button
        type="button"
        className={quiet ? "secondary" : undefined}
        onClick={() => {
          sendFunnel("checkout");
          trackConversion("begin_checkout", { sku });
          setOpen(true);
        }}
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("Sign in to buy")}>
        <p>{t("Your dates follow you to any device you sign in on, and your characters and dates so far come with you.")}</p>
        {google ? (
          <>
            <a className="button-google" href={`/api/auth/google/start?next=${next}`}>
              {t("Continue with Google")}
            </a>
            <p className="muted small or-divider">
              {fillNodes(t("or {handle}"), { handle: <Link href={`/account?next=${next}`}>{t("use a handle")}</Link> })}
            </p>
          </>
        ) : (
          <Link className="button" href={`/account?next=${next}`}>
            {t("Sign in or create an account")}
          </Link>
        )}
        <p className="muted small">{t("Then you pay on Stripe's own page. We never see your card.")}</p>
      </Sheet>
    </>
  );
}
