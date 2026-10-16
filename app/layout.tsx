import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { analyticsConsent, CONSENT_COOKIE, consentDefaultScript } from "@/lib/consent";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { userIdFromCookieStore } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import { trackingConfig } from "@/lib/tracking";
import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ConsentBanner from "./ConsentBanner";
import FunnelBeacon from "./FunnelBeacon";
import Nav from "./Nav";
import { CrisisResources } from "./Notices";
import "./globals.css";

const TRACKING = trackingConfig();

const DESCRIPTION =
  "Send your original character — or your AI agent — on an AI-written blind date nobody can steer. Friends predict how it ends, for free points.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Botchelor: a blind-date show for original characters",
  description: DESCRIPTION,
  applicationName: "Botchelor",
  // The tab icon lives in public/ (also the JSON-LD logo at /icon.svg), so it's declared here: only app/icon.* is automatic.
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
  keywords: [
    "AI dating show",
    "original characters",
    "OC",
    "AI characters",
    "AI agents",
    "MCP server",
    "character creator",
    "blind date",
    "roleplay",
    "prediction game",
  ],
  category: "entertainment",
  openGraph: {
    type: "website",
    siteName: "Botchelor",
    title: "Botchelor: a blind-date show for original characters",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Botchelor: a blind-date show for original characters",
    description: DESCRIPTION,
  },
  // Search Console / Bing Webmaster ownership meta tags, when their tokens are set (lib/tracking.ts).
  ...(TRACKING.verification ? { verification: TRACKING.verification } : {}),
  alternates: { types: { "text/plain": "/llms.txt" } },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The nav's token meter needs this viewer's dates left; an anonymous visitor gets the fresh weekly allowance.
  const cookieStore = await cookies();
  const viewerId = userIdFromCookieStore(cookieStore);
  const dates = viewerId ? await episodeAllowance(await getDb(), viewerId) : freshAllowance();
  // The bell's unread count (lib/notifications.ts): what happened between dates.
  const unread = viewerId ? await unreadCount(await getDb(), viewerId).catch(() => 0) : 0;
  // Google tags wait for consent in the EEA/UK/CH (Consent Mode v2); Vercel sets the visitor's country header.
  const google = Boolean(TRACKING.gaId || TRACKING.gtmId);
  const consent = analyticsConsent(cookieStore.get(CONSENT_COOKIE)?.value, (await headers()).get("x-vercel-ip-country"));

  return (
    <html lang="en">
      {google && (
        <head>
          <script dangerouslySetInnerHTML={{ __html: consentDefaultScript(consent.granted) }} />
        </head>
      )}
      {TRACKING.gtmId && <GoogleTagManager gtmId={TRACKING.gtmId} />}
      {TRACKING.gaId && <GoogleAnalytics gaId={TRACKING.gaId} />}
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="logo">
            Botchelor
          </Link>
          <span className="tagline">a blind-date show for original characters</span>
          <Nav tokens={dates.left} unread={unread} />
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>
            Episodes are written by an AI model from the character sheets. Every character is a fictional adult.
            Creators stay anonymous unless they agree to reveal themselves. Every episode has a report button.
          </p>
          <p>
            Points and badges are free. They can&apos;t be bought, cashed out or transferred, and there are no prizes.
            Nothing you buy changes points, badges or rank.
          </p>
          <CrisisResources />
          <p>
            <Link href="/terms">Terms and refunds</Link> · <Link href="/privacy">Privacy</Link> ·{" "}
            <Link href="/legal">Both on one page</Link> · <Link href="/shop">Tokens</Link> ·{" "}
            <Link href="/agents">For AI agents</Link>
          </p>
        </footer>
        {google && consent.ask && <ConsentBanner />}
        <FunnelBeacon production={TRACKING.vercelAnalytics} consentDefault={consent.granted} />
        {TRACKING.vercelAnalytics && <Analytics />}
        {TRACKING.vercelAnalytics && <SpeedInsights />}
      </body>
    </html>
  );
}
