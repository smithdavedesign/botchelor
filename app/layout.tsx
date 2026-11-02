import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { analyticsConsent, CONSENT_COOKIE, consentDefaultScript } from "@/lib/consent";
import { getDb } from "@/lib/db";
import { gaGuardScript } from "@/lib/ga-guard";
import { unreadCount } from "@/lib/notifications";
import { authFromCookieStore, userIdFromCookieStore } from "@/lib/http";
import { accessHere } from "@/lib/adult/place";
import { touchOwner } from "@/lib/activity";
import { APP_NAME, APPLE_TOUCH_ICON, PAPER_DARK, PAPER_LIGHT } from "@/lib/pwa";
import { placeFromEdge } from "@/lib/place";
import { SITE_DESCRIPTION, SITE_TITLE, siteJsonLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { trackingConfig } from "@/lib/tracking";
import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import ConsentBanner from "./ConsentBanner";
import FeedbackDock, { FeedbackLink } from "./FeedbackDock";
import EngagementBeacon from "./EngagementBeacon";
import FunnelBeacon from "./FunnelBeacon";
import InstallHint from "./InstallHint";
import FooterGroup from "./FooterGroup";
import JsonLd from "./JsonLd";
import Nav from "./Nav";
import { unreadTexts } from "@/lib/inbox";
import { CrisisResources } from "./Notices";
import "./globals.css";
// The UX audit's per-area styles (2026-10-23), after the globals so they win ties.
import "./ux/after-dark.css";
import "./ux/create.css";
import "./ux/show.css";
import "./ux/agents-footer.css";
import "./ux/studio-media.css";
import "./ux/showcase.css";
import "./ux/seasons.css";

const TRACKING = trackingConfig();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "Botchelor",
  // The tab icon lives in public/ (also the JSON-LD logo at /icon.svg), so it's declared here: only app/icon.* is automatic.
  // The Home Screen icon on an iPhone is the same PG tile as a PNG (scripts/make-icons.mjs); the manifest is app/manifest.ts.
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" }],
  },
  // Added to an iPhone's Home Screen it opens as its own app (lib/pwa.ts): the only way web push reaches an iPhone.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
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
  // No title or description here: Next fills og:title and twitter:title from each page's own (lib/seo.ts pageMetadata
  // sets all of them on the public pages), so a page that sets neither never shares the home page's.
  openGraph: { type: "website", siteName: "Botchelor", locale: "en_US" },
  twitter: { card: "summary_large_image" },
  // Search Console / Bing Webmaster ownership meta tags, when their tokens are set (lib/tracking.ts).
  ...(TRACKING.verification ? { verification: TRACKING.verification } : {}),
  alternates: { types: { "text/plain": "/llms.txt" } },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
};

/** The browser's bar (and an installed app's status bar) in the page's own paper colour, light or dark (docs/brand.md). */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PAPER_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: PAPER_DARK },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The nav's token meter needs this viewer's dates left. Without an identity (a newcomer before their first action, or an
  // agent reading the page) it shows the fresh weekly allowance as "free dates", not as someone's count (run 2026-10-22-0215).
  const cookieStore = await cookies();
  const viewerId = userIdFromCookieStore(cookieStore);
  // They're here (lib/activity.ts): their characters' likes wait for them rather than answering themselves. Throttled.
  if (viewerId) await touchOwner(await getDb(), viewerId).catch(() => {});
  // After Dark's link shows only to someone it's open to (lib/adult/entitlement.ts), and only where it's offered
  // (lib/jurisdiction.ts); everyone else never sees it.
  const afterDark = viewerId
    ? await accessHere(await getDb(), authFromCookieStore(cookieStore)).then((h) => h.entitled.ok && h.mode !== "blocked", () => false)
    : false;
  const dates = viewerId ? await episodeAllowance(await getDb(), viewerId) : freshAllowance();
  // #1005: After Dark spends only bought tokens, never the free weekly dates, so its host counts those, as "tokens".
  const adHost = afterDarkOnly();
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
  const consent = analyticsConsent(cookieStore.get(CONSENT_COOKIE)?.value, placeFromEdge(await headers())?.country);

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
        {/* The show, its app and its price (lib/seo.ts), on every page; After Dark's own host isn't the show. */}
        {!adHost && <JsonLd data={siteJsonLd()} />}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="logo">
            Botchelor
          </Link>
          <span className="tagline">a blind-date show for original characters</span>
          <Nav tokens={adHost && viewerId ? dates.pack_left : dates.left} meter={adHost && viewerId ? "tokens" : "dates"} personal={Boolean(viewerId)} unread={unread} texts={texts} afterDark={afterDark} hasCharacter={hasCharacter} />
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          {/* The two lines that must never be one tap away stay out in the open: who's on the show, and where help is. */}
          <p className="footer-adults">Every character is a fictional adult (18+), and every episode is written by an AI model.</p>
          <CrisisResources />
          {/* Three groups, not fifteen links in one list (2026-10-31 UX audit): columns on a wide screen, folds on a phone. */}
          <nav className="footer-groups" aria-label="More of the site">
            <FooterGroup title="The show">
              <li><Link href="/graph">The Constellation</Link></li>
              <li><Link href="/prompts">Prompts library</Link></li>
              <li><Link href="/shop">{adHost ? "Tokens" : "More dates"}</Link></li>
              <li><Link href="/about">How it&apos;s built</Link></li>
            </FooterGroup>
            <FooterGroup title="Tools">
              <li><Link href="/tools/oc-chemistry-test">OC chemistry test</Link></li>
              <li><Link href="/tools/ship-name-generator">Ship name generator</Link></li>
              <li><Link href="/agents">For AI agents</Link></li>
            </FooterGroup>
            <FooterGroup title="Help and legal">
              <li><Link href="/report">Report a problem</Link></li>
              <li>
                <FeedbackLink />
              </li>
              <li><Link href="/content-policy">Content policy</Link></li>
              <li><Link href="/terms">Terms and refunds</Link></li>
              <li><Link href="/privacy">Privacy</Link></li>
              <li><Link href="/legal">Terms and privacy, one page</Link></li>
              <li><Link href="/2257">2257 statement</Link></li>
              <li><Link href="/cancel">Cancel a subscription</Link></li>
            </FooterGroup>
          </nav>
          <details className="footer-about ux-fold">
            <summary>About this show</summary>
            <p>
              Episodes are written by an AI model from the character sheets. Every character is a fictional adult.
              Creators stay anonymous unless they agree to reveal themselves. Every episode has a report button.
            </p>
            <p>
              Points and badges are free. They can&apos;t be bought, cashed out or transferred, and there are no prizes.
              Nothing you buy changes points, badges or rank.
            </p>
          </details>
        </footer>
        <FeedbackDock />
        <InstallHint hasCharacter={hasCharacter} />
        {google && consent.ask && <ConsentBanner />}
        <FunnelBeacon production={TRACKING.production} consentDefault={consent.granted} />
        <EngagementBeacon afterDarkHost={adHost} />
      </body>
    </html>
  );
}
