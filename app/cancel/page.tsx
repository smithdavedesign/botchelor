import type { Metadata } from "next";
import Link from "next/link";
import { companionFreePerDay } from "@/lib/companion-plan";
import { PROCESSORS } from "@/lib/legal-entity";
import { planPrice, portalLink } from "@/lib/paid-plans";
import { pageMetadata } from "@/lib/seo";
import { Contact, LAST_UPDATED, Mail, PolicyLinks } from "../legal/sections";

export const metadata: Metadata = pageMetadata({
  title: "Cancel a subscription · Botchelor",
  description: "How to cancel the Companion Plan online, in Stripe's billing portal or by email, and how After Dark's subscription is cancelled once it's on sale.",
  path: "/cancel",
});
// Rendered per request, so a CONTACT_EMAIL or STRIPE_PORTAL_LINK added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/**
 * How to cancel a subscription, online, the way you joined (California's auto-renewal law; Stripe's and the processors'
 * own rules). The footer's "Cancel a subscription" and /contact land here. The Companion Plan first: it's the one on sale,
 * billed on a Stripe Payment Link and cancelled in Stripe's billing portal (lib/paid-plans.ts portalLink, the same link
 * the plan page, the account page and the plan's emails give). After Dark's after it: billed by an adult card processor
 * once it's on sale; the processors' cancel links are in lib/legal-entity.ts PROCESSORS, checked against their own
 * consumer sites on 2026-10-24.
 */
export default function CancelPage() {
  const { ccbill, segpay, verotel } = PROCESSORS;
  const portal = portalLink();
  return (
    <article className="legal-page">
      <h1>Cancel a subscription</h1>
      <p className="muted">{LAST_UPDATED}</p>
      <p>
        You can cancel online at any time. You don&apos;t need a reason, and it takes a minute. The{" "}
        <a href="#companion-plan">Companion Plan</a> is the subscription on sale today; <a href="#after-dark">After Dark</a>
        &apos;s isn&apos;t on sale yet.
      </p>

      <h2 id="companion-plan">The Companion Plan</h2>
      <p>The Companion Plan ({planPrice("companion")}) is billed by Stripe every month until you cancel. To cancel:</p>
      <ul>
        <li>
          <strong>Online, in Stripe&apos;s billing portal:</strong>{" "}
          {portal ? (
            <>
              <a href={portal} rel="noopener" data-cancel-portal>
                open the portal
              </a>
              , sign in with the email you paid with, and cancel.
            </>
          ) : (
            <>use the link in Stripe&apos;s receipt email, sign in with the email you paid with, and cancel.</>
          )}{" "}
          While you&apos;re subscribed, the same link is on <Link href="/companion/plan">the plan&apos;s page</Link> and your{" "}
          <Link href="/account">account page</Link>, and in the email we send when the plan starts.
        </li>
        <li>
          <strong>By email:</strong> email <Mail /> from the address you subscribed with and say you want to cancel. We
          cancel it for you and confirm by email.
        </li>
      </ul>
      <h3 id="companion-plan-after">What happens next</h3>
      <ul>
        <li>You&apos;re not charged again.</li>
        <li>
          The plan runs to the end of the month you&apos;ve already paid for. Then it stops, and you&apos;re back to{" "}
          {companionFreePerDay()} free replies a day.
        </li>
        <li>
          We don&apos;t refund part of a month, except where the law requires it (see{" "}
          <Link href="/terms#refunds">refunds and cancelling</Link>). If a charge was a mistake, email us.
        </li>
        <li>Your companion conversations stay, as they do without the plan.</li>
      </ul>

      <h2 id="after-dark">After Dark</h2>
      <p>
        After Dark isn&apos;t on sale yet, so there&apos;s nothing to cancel there today. When it is, it&apos;s billed by an
        adult card processor, not Stripe, and here&apos;s how to stop it.
      </p>

      <h3 id="processor">On the processor&apos;s site</h3>
      <p>
        Your card statement names the company that billed you. Cancel on its consumer site: look up your purchase with the
        email or card you paid with, then cancel.
      </p>
      <ul>
        <li>
          Statement says <strong>{ccbill.statement}</strong>: cancel at{" "}
          <a href={ccbill.cancelUrl} rel="noopener">
            {ccbill.name}&apos;s consumer support ({new URL(ccbill.cancelUrl).host})
          </a>
          .
        </li>
        <li>
          Statement says <strong>{segpay.statement}</strong>: cancel at{" "}
          <a href={segpay.cancelUrl} rel="noopener">
            {segpay.name}&apos;s consumer support ({new URL(segpay.cancelUrl).host})
          </a>
          .
        </li>
        <li>
          Statement says <strong>{verotel.statement}</strong>: cancel at{" "}
          <a href={verotel.cancelUrl} rel="noopener">
            {verotel.name}&apos;s cancellation page
          </a>{" "}
          (or its billing support site,{" "}
          <a href={verotel.supportUrl} rel="noopener">
            {new URL(verotel.supportUrl).host}
          </a>
          ).
        </li>
      </ul>

      <h3 id="account">From your account</h3>
      <p>
        Signed in, your <Link href="/account">account page</Link> will link straight to your subscription&apos;s cancel
        page at the processor that billed you.
      </p>

      <h3 id="email">By email</h3>
      <p>
        Or email <Mail /> from the address you subscribed with and say you want to cancel. We cancel it for you and confirm
        by email.
      </p>

      <h3 id="after">What happens next</h3>
      <ul>
        <li>You&apos;re not charged again.</li>
        <li>You keep After Dark until the end of the period you&apos;ve already paid for; then it closes.</li>
        <li>
          We don&apos;t refund part of a period, except where the law requires it (see{" "}
          <Link href="/terms#refunds">refunds and cancelling</Link>). If a charge was a mistake, email us.
        </li>
        <li>Your After Dark scenes stay in your account until you delete them or your account.</li>
      </ul>

      <Contact />
      <PolicyLinks current="/cancel" />
    </article>
  );
}
