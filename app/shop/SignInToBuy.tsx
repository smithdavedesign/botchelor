"use client";

import Link from "next/link";
import { useState } from "react";
import Sheet from "@/app/Sheet";
import { trackConversion } from "@/app/conversion";
import { sendFunnel } from "@/app/funnel";

/**
 * Buy, for a visitor who isn't signed in (2026-10-31 UX audit, A9): the price is still the button, and it asks them to
 * sign in, in a sheet, instead of the card reading like an error. The click counts as intent to pay, as BuyButton's does.
 * Signing up keeps everything they already have (the account adopts their anonymous id), and both ways back land on
 * the shop again.
 */
export default function SignInToBuy({ sku, label, google }: { sku: string; label: string; google: boolean }) {
  const [open, setOpen] = useState(false);
  const next = encodeURIComponent("/shop");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          sendFunnel("checkout");
          trackConversion("begin_checkout", { sku });
          setOpen(true);
        }}
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sign in to buy">
        <p>Your dates follow you to any device you sign in on, and your characters and dates so far come with you.</p>
        {google ? (
          <>
            <a className="button-google" href={`/api/auth/google/start?next=${next}`}>
              Continue with Google
            </a>
            <p className="muted small or-divider">
              or <Link href={`/account?next=${next}`}>use a handle</Link>
            </p>
          </>
        ) : (
          <Link className="button" href={`/account?next=${next}`}>
            Sign in or create an account
          </Link>
        )}
        <p className="muted small">Then you pay on Stripe&apos;s own page. We never see your card.</p>
      </Sheet>
    </>
  );
}
