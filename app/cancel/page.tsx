import type { Metadata } from "next";
import Link from "next/link";
import { PROCESSORS } from "@/lib/legal-entity";
import { pageMetadata } from "@/lib/seo";
import { Contact, LAST_UPDATED, Mail, PolicyLinks } from "../legal/sections";

export const metadata: Metadata = pageMetadata({
  title: "Cancel After Dark · Botchelor",
  description: "How to cancel an After Dark subscription: on the card processor's site, from your account, or by email.",
  path: "/cancel",
});
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/**
 * How to cancel the After Dark subscription, online, the way you joined (California's auto-renewal law; the processors'
 * own rules). The processors' cancel links are in lib/legal-entity.ts PROCESSORS, checked against their own consumer
 * sites on 2026-10-24.
 */
export default function CancelPage() {
  const { ccbill, segpay, verotel } = PROCESSORS;
  return (
    <article className="legal-page">
      <h1>Cancel After Dark</h1>
      <p className="muted">{LAST_UPDATED}</p>
      <p>
        After Dark isn&apos;t on sale yet, so there&apos;s nothing to cancel today. When it is, here&apos;s how to stop a
        subscription. You don&apos;t need a reason, and it takes a minute.
      </p>

      <h2 id="processor">On the processor&apos;s site</h2>
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

      <h2 id="account">From your account</h2>
      <p>
        Signed in, your <Link href="/account">account page</Link> will link straight to your subscription&apos;s cancel
        page at the processor that billed you.
      </p>

      <h2 id="email">By email</h2>
      <p>
        Or email <Mail /> from the address you subscribed with and say you want to cancel. We cancel it for you and confirm
        by email.
      </p>

      <h2 id="after">What happens next</h2>
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
