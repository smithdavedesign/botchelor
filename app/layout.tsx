import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import NavProgress from "./NavProgress";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { adTokenBalance, adTokensOn } from "@/lib/adult/tokens";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { analyticsConsent, CONSENT_COOKIE, consentDefaultScript } from "@/lib/consent";
import { companionOpen } from "@/lib/companion-shared";
import { getDb } from "@/lib/db";
import { socialLinks, STATUS_PAGE_URL } from "@/lib/company";
import { contactEmail, TRADING_AS } from "@/lib/legal-entity";
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
import SeasonBanner from "./SeasonBanner";
import SeasonStrip from "./SeasonStrip";
import { seasonFormatNow } from "@/lib/season-format-store";
import { shared } from "@/lib/shared-cache";
import JsonLd from "./JsonLd";
import Nav from "./Nav";
import NewsletterSignup from "./NewsletterSignup";
import SocialLinks from "./SocialLinks";
import { unreadTexts } from "@/lib/inbox";
import { CrisisResources } from "./Notices";
import Icon from "@/app/Icon";
import { THEME_COOKIE, themeAttribute, themeFromCookie } from "@/lib/theme";
import "./globals.css";
// The UX audit's per-area styles (2026-10-23), after the globals so they win ties.
import "./ux/after-dark.css";
import "./ux/create.css";
import "./ux/show.css";
import "./ux/agents-footer.css";
import "./ux/studio-media.css";
import "./ux/showcase.css";
import "./ux/seasons.css";
import "./ux/step-in.css";
import "./ux/companion.css";
import "./ux/filters.css";
import "./ux/front.css";
import "./ux/company.css";
import "./ux/catalog.css";

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
  alternates: { types: { "text/plain": "/llms.txt", "application/rss+xml": "/feed.xml" } },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
};

/** The browser's bar (and an installed app's status bar) in the page's own paper colour, light or dark (docs/brand.md). */
/** …and a picked theme (lib/theme.ts) colours the bar to match, whatever the device says. */
export async function generateViewport(): Promise<Viewport> {
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  return {
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: PAPER_LIGHT },
            { media: "(prefers-color-scheme: dark)", color: PAPER_DARK },
          ]
        : theme === "dark"
          ? PAPER_DARK
          : PAPER_LIGHT,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The nav's token meter needs this viewer's dates left. Without an identity (a newcomer before their first action, or an
  // agent reading the page) it shows the fresh weekly allowance as "free dates", not as someone's count (run 2026-10-22-0215).
  const cookieStore = await cookies();
  const viewerId = userIdFromCookieStore(cookieStore);
  // A picked theme (lib/theme.ts, set on /account) paints right from the first byte; "system" writes nothing.
  const theme = themeFromCookie(cookieStore.get(THEME_COOKIE)?.value);
  // The nav's numbers, all at once (2026-11-04 performance audit: one after another they were five database round trips
  // on every signed-in page load, ~70 ms each from New York to the database in Oregon).
  const db = viewerId ? await getDb() : null;
  // #1005: After Dark spends only bought tokens, never the free weekly dates, so its host counts those, as "tokens":
  // its own once they're sold (lib/adult/tokens.ts), the show's until then.
  const adHost = afterDarkOnly();
  // On After Dark's own host the show's links go to the show: prefetching them only fetched "Moved to another host"
  // (middleware fetchAnswer), twenty times a page, and the page never settled (2026-11-07 audit, item 21).
  const showPrefetch = adHost ? false : undefined;
  // The show's accounts (lib/company.ts): X, Bluesky, TikTok, GitHub, and Discord once DISCORD_INVITE_URL is set (docs/discord.md),
  // never on After Dark's host. The support address closes the footer once CONTACT_EMAIL is set.
  const socials = socialLinks(process.env, adHost);
  const support = contactEmail();
  const [, afterDark, dates, unread, texts, hasCharacter, adTokens, seasonDef] = await Promise.all([
    // They're here (lib/activity.ts): their characters' likes wait for them rather than answering themselves. Throttled.
    db && viewerId ? touchOwner(db, viewerId).catch(() => {}) : null,
    // After Dark's link shows only to someone it's open to (lib/adult/entitlement.ts), and only where it's offered
    // (lib/jurisdiction.ts); everyone else never sees it.
    db ? accessHere(db, authFromCookieStore(cookieStore)).then((h) => h.entitled.ok && h.mode !== "blocked", () => false) : false,
    db && viewerId ? episodeAllowance(db, viewerId) : freshAllowance(),
    // The bell's unread count (lib/notifications.ts): what happened between dates.
    db && viewerId ? unreadCount(db, viewerId).catch(() => 0) : 0,
    // The Matches link's dot: texts this viewer's characters haven't read (lib/inbox.ts).
    db && viewerId ? unreadTexts(db, viewerId).catch(() => 0) : 0,
    // The nav changes once there's a character of theirs (app/Nav.tsx): until then, the show and one create button.
    db && viewerId
      ? db.query(`select 1 from characters where owner_id = $1 and not is_house limit 1`, [viewerId]).then((r) => r.rows.length > 0, () => false)
      : false,
    db && viewerId && adHost && adTokensOn() ? adTokenBalance(db, viewerId).catch(() => null) : null,
    // The season's format for the arc under the header (app/SeasonStrip.tsx): one shared copy for every visitor.
    adHost ? null : shared("watch:season-format", async () => seasonFormatNow(await getDb())).catch(() => null),
  ]);
  // Google tags wait for consent in the EEA/UK/CH (Consent Mode v2); Vercel sets the visitor's country header.
  const google = Boolean(TRACKING.gaId || TRACKING.gtmId);
  const consent = analyticsConsent(cookieStore.get(CONSENT_COOKIE)?.value, placeFromEdge(await headers())?.country);

  return (
    <html lang="en" data-theme={themeAttribute(theme)}>
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
        {/* Search params need a Suspense boundary, or a static page would render on the client only. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {/* The show, its app and its price (lib/seo.ts), on every page; After Dark's own host isn't the show. */}
        {!adHost && <JsonLd data={siteJsonLd()} />}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          {/* Not prefetched on After Dark's host either: "/" there hops to the show and back, so the prefetch never settled. */}
          <Link prefetch={showPrefetch} href="/" className="logo">
            Botchelor
          </Link>
          {/* The header holds five kinds of thing (docs/brand.md, Header): the wordmark, the After Dark door, the meter,
              one call to action and the links. The tagline is the hero's; the theme setting is Account's. After Dark's
              host wears the moon beside the wordmark on every page, so nobody is unsure which side they're on. */}
          {adHost && (
            <span className="moon-badge">
              <Icon name="moon" />
              <span>After Dark</span>
            </span>
          )}
          <Nav tokens={adHost && viewerId ? (adTokens ?? dates.pack_left) : dates.left} meter={adHost ? (viewerId && afterDark ? "tokens" : "none") : "dates"} personal={Boolean(viewerId)} unread={unread} texts={texts} afterDark={afterDark} adHost={adHost} hasCharacter={hasCharacter} prefetchShow={!adHost} companions={companionOpen()} />
        </header>
        {/* The season's arc runs under the header on the show's spectator pages (the design system's all-screens board). */}
        {!adHost && (
          <SeasonStrip>
            <SeasonBanner format={seasonDef?.title ?? null} />
          </SeasonStrip>
        )}
        <main id="main">{children}</main>
        <footer className="site-footer">
          {/* The two lines that must never be one tap away stay out in the open: who's on the show, and where help is. */}
          <p className="footer-adults">Every character is a fictional adult (18+), and every episode is written by an AI model.</p>
          <CrisisResources />
          {!adHost && <NewsletterSignup />}
          {/* Four groups (Company joined on 2026-11-10), not fifteen links in one list (2026-10-31 UX audit): columns on a wide screen, folds on a phone. */}
          <nav className="footer-groups" aria-label="More of the site">
            <FooterGroup title="The show">
              <li><Link prefetch={showPrefetch} href="/graph">The Constellation</Link></li>
              {!adHost && companionOpen() && <li><Link prefetch={showPrefetch} href="/companion">Companions</Link></li>}
              <li><Link prefetch={showPrefetch} href="/prompts">Prompts library</Link></li>
              <li><Link prefetch={showPrefetch} href="/shop">{adHost ? "Tokens" : "More dates"}</Link></li>
              {!adHost && <li><Link prefetch={showPrefetch} href="/pricing">Pricing</Link></li>}
            </FooterGroup>
            <FooterGroup title="Tools">
              <li><Link prefetch={showPrefetch} href="/tools/oc-chemistry-test">OC chemistry test</Link></li>
              <li><Link prefetch={showPrefetch} href="/tools/ship-name-generator">Ship name generator</Link></li>
              <li><Link prefetch={showPrefetch} href="/agents">For AI agents</Link></li>
            </FooterGroup>
            {/* The company (2026-11-10, lib/company.ts): who makes it, what it costs, and how to reach us, for people,
                press and the card processors' reviewers alike. */}
            <FooterGroup title="Company">
              <li><Link prefetch={showPrefetch} href="/about">How it&apos;s built</Link></li>
              <li><Link prefetch={showPrefetch} href="/costs">What it costs</Link></li>
              <li><Link prefetch={showPrefetch} href="/faq">FAQ</Link></li>
              <li><Link prefetch={showPrefetch} href="/press">Press kit</Link></li>
              <li><Link prefetch={showPrefetch} href="/contact">Contact</Link></li>
              <li><Link prefetch={showPrefetch} href="/security">Security</Link></li>
              <li><a href={STATUS_PAGE_URL} rel="noopener">Status</a></li>
              <li><Link prefetch={showPrefetch} href="/accessibility">Accessibility</Link></li>
            </FooterGroup>
            <FooterGroup title="Help and legal">
              <li><Link prefetch={showPrefetch} href="/report">Report a problem</Link></li>
              <li>
                <FeedbackLink />
              </li>
              <li><Link prefetch={showPrefetch} href="/content-policy">Content policy</Link></li>
              <li><Link prefetch={showPrefetch} href="/terms">Terms and refunds</Link></li>
              <li><Link prefetch={showPrefetch} href="/privacy">Privacy</Link></li>
              <li><Link prefetch={showPrefetch} href="/legal">Terms and privacy, one page</Link></li>
              <li><Link prefetch={showPrefetch} href="/2257">2257 statement</Link></li>
              <li><Link prefetch={showPrefetch} href="/cancel">Cancel a subscription</Link></li>
            </FooterGroup>
          </nav>
          {/* The show's own accounts (lib/company.ts), Discord's once its invite is set; none on After Dark's host. */}
          <SocialLinks links={socials} area="footer" />
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
          <p className="footer-legal">
            © {new Date().getUTCFullYear()} {TRADING_AS} · <Link prefetch={showPrefetch} href="/contact">Contact us</Link>
            {support && (
              <>
                {" "}
                · <a href={`mailto:${support}`}>{support}</a>
              </>
            )}
          </p>
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
