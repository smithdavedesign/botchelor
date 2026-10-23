import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { analyticsConsent, CONSENT_COOKIE, consentDefaultScript } from "@/lib/consent";
import { getDb } from "@/lib/db";
import { gaGuardScript } from "@/lib/ga-guard";
import { unreadCount } from "@/lib/notifications";
import { authFromCookieStore, userIdFromCookieStore } from "@/lib/http";
import { canAfterDark } from "@/lib/adult/entitlement";
import { siteUrl } from "@/lib/site";
import { trackingConfig } from "@/lib/tracking";
import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ConsentBanner from "./ConsentBanner";
import FeedbackDock, { FeedbackLink } from "./FeedbackDock";
import FunnelBeacon from "./FunnelBeacon";
import Nav from "./Nav";
import { unreadTexts } from "@/lib/inbox";
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
  // The nav's token meter needs this viewer's dates left. Without an identity (a newcomer before their first action, or an
  // agent reading the page) it shows the fresh weekly allowance as "free dates", not as someone's count (run 2026-10-22-0215).
  const cookieStore = await cookies();
  const viewerId = userIdFromCookieStore(cookieStore);
  // After Dark's link shows only to someone it's open to (lib/adult/entitlement.ts); everyone else never sees it.
  const afterDark = viewerId ? (await canAfterDark(await getDb(), authFromCookieStore(cookieStore)).catch(() => ({ ok: false }))).ok : false;
  const dates = viewerId ? await episodeAllowance(await getDb(), viewerId) : freshAllowance();
  // The bell's unread count (lib/notifications.ts): what happened between dates.
  const unread = viewerId ? await unreadCount(await getDb(), viewerId).catch(() => 0) : 0;
  // The Matches link's dot: texts this viewer's characters haven't read (lib/inbox.ts).
  const texts = viewerId ? await unreadTexts(await getDb(), viewerId).catch(() => 0) : 0;
  // The nav changes once there's a character of theirs (app/Nav.tsx): until then, the show and one create button.
  const hasCharacter = viewerId
    ? ((await (await getDb()).query(`select 1 from characters where owner_id = $1 and not is_house limit 1`, [viewerId]).catch(() => ({ rows: [] }))).rows.length > 0)
    : false;
  // Google tags wait for consent in the EEA/UK/CH (Consent Mode v2); Vercel sets the visitor's country header.
  const google = Boolean(TRACKING.gaId || TRACKING.gtmId);
  const consent = analyticsConsent(cookieStore.get(CONSENT_COOKIE)?.value, (await headers()).get("x-vercel-ip-country"));

  return (
    <html lang="en">
      {google && (
        <head>
          {/* Before the Google tags load: GA stays off on After Dark's pages, and in a tab after it (lib/ga-guard.ts). */}
          <script dangerouslySetInnerHTML={{ __html: gaGuardScript(TRACKING.gaId) }} />
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
          <Nav tokens={dates.left} personal={Boolean(viewerId)} unread={unread} texts={texts} afterDark={afterDark} hasCharacter={hasCharacter} />
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
            <Link href="/agents">For AI agents</Link> · <Link href="/graph">The Constellation</Link> ·{" "}
            <Link href="/tools/ship-name-generator">Ship name generator</Link> ·{" "}
            <FeedbackLink />
          </p>
        </footer>
        <FeedbackDock />
        {google && consent.ask && <ConsentBanner />}
        <FunnelBeacon production={TRACKING.vercelAnalytics} consentDefault={consent.granted} />
        {TRACKING.vercelAnalytics && <Analytics />}
        {TRACKING.vercelAnalytics && <SpeedInsights />}
      </body>
    </html>
  );
}
