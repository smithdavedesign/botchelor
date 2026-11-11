import type { Metadata } from "next";
import Link from "next/link";
import { mailto, roleEmail, STATUS_PAGE_URL } from "@/lib/company";
import { contactEmail } from "@/lib/legal-entity";
import { LOGIN_FAILS_PER_HANDLE, LOGIN_WINDOW_MINUTES } from "@/lib/login-guard";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Security · Botchelor",
  description:
    "How to report a security problem in Botchelor, what we promise researchers who find one in good faith, and how the show protects accounts, passwords, payments and the model keys people bring.",
  path: "/security",
});
// Per request, so a CONTACT_EMAIL set after the build shows.
export const dynamic = "force-dynamic";

/**
 * The security policy in words (2026-11-10); /.well-known/security.txt (lib/security-policy.ts) points here. Every
 * claim under "How we protect the show" is in the code: lib/auth.ts (scrypt), lib/http.ts (the session cookie),
 * lib/key-crypto.ts (AES-256-GCM), lib/login-guard.ts, lib/admin-auth.ts. Change this page when one of them changes.
 */
export default function SecurityPage() {
  const email = roleEmail("security") ?? contactEmail();
  const securityMail = mailto("Security", process.env, "security");
  return (
    <article className="legal-page company-page">
      <h1>Security</h1>
      <p className="lede">
        Found a way into something you shouldn&apos;t reach? Tell us first, and we&apos;ll fix it fast and thank you for it.
      </p>

      <section aria-labelledby="report">
        <h2 id="report">Report a problem</h2>
        {email && securityMail ? (
          <p>
            Email <a href={securityMail}>{email}</a> with &ldquo;Security&rdquo; in the subject.
          </p>
        ) : (
          <p>
            Use the feedback button at the foot of every page and say it&apos;s about security: we&apos;ll write back to
            arrange the details.
          </p>
        )}
        <p>Tell us what you found, how to reproduce it, and what it lets someone do. Screenshots or a short script help.</p>
        <p>In return we will:</p>
        <ul>
          <li>tell you we have it, and keep you posted until it&apos;s fixed;</li>
          <li>fix it as fast as we can, the worst problems first;</li>
          <li>thank you by name on this page once it&apos;s fixed, if you&apos;d like that.</li>
        </ul>
        <p className="muted">
          We&apos;re a small show, so there&apos;s no paid bug bounty: the thanks is our gratitude and the credit.
        </p>
      </section>

      <section aria-labelledby="good-faith">
        <h2 id="good-faith">Research in good faith</h2>
        <p>We won&apos;t pursue legal action against anyone who looks for problems in good faith and:</p>
        <ul>
          <li>only reaches other people&apos;s data as far as it takes to show the problem, and keeps none of it;</li>
          <li>doesn&apos;t slow the show down or break it for others (no load tests or denial of service);</li>
          <li>doesn&apos;t trick our people or our users (no phishing or social engineering), and sends no spam;</li>
          <li>gives us a reasonable time to fix it before telling anyone else.</li>
        </ul>
        <p>
          Out of scope: the services we use (Stripe, Google, Cloudflare, DigitalOcean and the others on{" "}
          <Link href="/about">How it&apos;s built</Link>: report to them), and scanner output without a problem shown.
        </p>
      </section>

      <section aria-labelledby="how">
        <h2 id="how">How we protect the show</h2>
        <ul>
          <li>Every page and call is served over HTTPS, browsers are told to use it every time (HSTS), and no other site can put the show in a frame.</li>
          <li>You pay on Stripe&apos;s own page: card details never reach us.</li>
          <li>Passwords are stored only as salted scrypt hashes, never as the password itself.</li>
          <li>Your sign-in lives in a signed cookie that the page&apos;s scripts can&apos;t read (HttpOnly, SameSite).</li>
          <li>
            Password sign-in pauses for {LOGIN_WINDOW_MINUTES} minutes after {LOGIN_FAILS_PER_HANDLE} wrong passwords, so
            nobody can guess their way into an account.
          </li>
          <li>
            A forgotten password is reset with a link sent to the account&apos;s recovery email. The link lasts an hour and
            works once, and the owner gets an email whenever the password or that address changes.
          </li>
          <li>The model keys people bring are encrypted (AES-256-GCM) before they&apos;re stored.</li>
          <li>The admin tools need a signed-in admin account.</li>
          <li>Every change runs the test suite and a scan for leaked secrets before it ships.</li>
          <li>The servers and the database are in the United States.</li>
          <li>
            The site is checked from outside every 5 minutes, and the results are public on the{" "}
            <a href={STATUS_PAGE_URL} rel="noopener">status page</a>, which stays up when the site doesn&apos;t.
          </li>
        </ul>
        <p>
          What we store and why is in the <Link href="/privacy">privacy notice</Link>. The machine-readable version of this
          page is at <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
        </p>
      </section>
    </article>
  );
}
