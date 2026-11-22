import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import NavProgress from "./NavProgress";
import IntentLink from "./IntentLink";
import { episodeAllowance, freshAllowance, ownAllowance } from "@/lib/allowance";
import { adTokenBalance } from "@/lib/adult/tokens";
import { afterDarkOnly, afterDarkOrigin } from "@/lib/after-dark-host";
import { afterDarkDoors } from "@/lib/adult/doors";
import { NO_AD_DOORS } from "@/lib/adult/door-links";
import { analyticsConsent, CONSENT_COOKIE, consentDefaultScript } from "@/lib/consent";
import { companionOpen } from "@/lib/companion-shared";
import { getDb } from "@/lib/db";
import { socialLinks } from "@/lib/company";
import { contactEmail, OPERATOR } from "@/lib/legal-entity";
import { gaGuardScript } from "@/lib/ga-guard";
import { unreadCount } from "@/lib/notifications";
import { authFromCookieStore, userIdFromCookieStore } from "@/lib/http";
import { afterDarkDoor } from "@/lib/adult/door";
import Threshold from "./Threshold";
import { touchOwner } from "@/lib/activity";
import { APP_NAME, APPLE_TOUCH_ICON, PAPER_DARK, PAPER_LIGHT } from "@/lib/pwa";
import { placeFromEdge } from "@/lib/place";
import { AFTER_DARK_DESCRIPTION, SHARE_IMAGE, SITE_DESCRIPTION, SITE_TITLE, siteJsonLd } from "@/lib/seo";
import { NONCE_HEADER } from "@/lib/security-headers";
import { showHome, siteUrl } from "@/lib/site";
import { trackingConfig } from "@/lib/tracking";
import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import ConsentBanner from "./ConsentBanner";
import FeedbackDock, { FeedbackLink } from "./FeedbackDock";
import EngagementBeacon from "./EngagementBeacon";
import FunnelBeacon from "./FunnelBeacon";
import InstallHint from "./InstallHint";
import PhoneTabBar from "./PhoneTabBar";
import SeasonBanner from "./SeasonBanner";
import SeasonStrip from "./SeasonStrip";
import { seasonFormatNow } from "@/lib/season-format-store";
import { seasonPageLiveOn } from "@/lib/season-page";
import { seasonPath } from "@/lib/season-ref";
import { nextSeasonStart, seasonIdOf } from "@/lib/season-window";
import { shared } from "@/lib/shared-cache";
import JsonLd from "./JsonLd";
import Nav from "./Nav";
import NewsletterSignup from "./NewsletterSignup";
import FooterGroup from "./FooterGroup";
import SocialLinks from "./SocialLinks";
import SupportEmail from "./SupportEmail";
import { unreadChatTexts, unreadTexts } from "@/lib/inbox";
import { rememberedCharacter } from "@/lib/current-character";
import { pickerCharacters } from "@/lib/my-characters";
import { navChatOn } from "@/lib/nav-chat";
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
import "./ux/money.css";
import "./ux/thin.css";
import "./ux/prompts.css";
import "./ux/phone.css";
// The motion kit (pass 2 of the visual pop audit): fill, rise, sheen, slide together, tilt, count-up.
import "./ux/motion.css";
// The show's stage past the front door (the visual pop audit, 2026-11-20): SetHero, FaceRibbon, LoopClip.
import "./ux/stage.css";
import "./ux/chrome.css";
import "./ux/catalog.css";

const TRACKING = trackingConfig();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: SITE_TITLE,
  // After Dark's own host isn't the show: its description says what it is (the build reads the same switch, lib/after-dark-host.ts).
  description: afterDarkOnly() ? AFTER_DARK_DESCRIPTION : SITE_DESCRIPTION,
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
  // sets all of them on the public pages), so a page that sets neither never shares the home page's. The share card is
  // named, so a page that names none shares the .png the CDN keeps, not app/opengraph-image.tsx (2026-11-22 audit).
  openGraph: { type: "website", siteName: "Botchelor", locale: "en_US", images: [SHARE_IMAGE] },
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
  // agent reading the page) it shows the fresh weekly allowance as "free dates", not as someone's count (run 2026-10-22-0215);
  // so does an anonymous identity that hasn't acted yet (lib/allowance.ts ownAllowance).
  const cookieStore = await cookies();
  const viewer = authFromCookieStore(cookieStore);
  const viewerId = userIdFromCookieStore(cookieStore);
  // A picked theme (lib/theme.ts, set on /account) paints right from the first byte; "system" writes nothing.
  const theme = themeFromCookie(cookieStore.get(THEME_COOKIE)?.value);
  // The nav's numbers, all at once (2026-11-04 performance audit: one after another they were five database round trips
  // on every signed-in page load, ~70 ms each from New York to the database in Oregon).
  const db = viewerId ? await getDb() : null;
  // #1005: After Dark spends only tokens, never the free weekly dates, so its host counts those, as "tokens": its own once
  // they're sold, until then the show's balance only as After Dark may spend it (lib/adult/tokens.ts: never a bought one).
  const adHost = afterDarkOnly();
  // On After Dark's own host the show's links go to the show: prefetching them only fetched "Moved to another host"
  // (middleware fetchAnswer), twenty times a page, and the page never settled (2026-11-07 audit, item 21).
  const showPrefetch = adHost ? false : undefined;
  // The show's accounts (lib/company.ts): X, Bluesky, TikTok, GitHub, and Discord once DISCORD_INVITE_URL is set (docs/discord.md),
  // never on After Dark's host. The support address closes the footer once CONTACT_EMAIL is set.
  const socials = socialLinks(process.env, adHost);
  const support = contactEmail();
  const navChat = navChatOn();
  const [, door, count, unread, texts, mine, adTokens, seasonDef, adDoors, nextDef] = await Promise.all([
    // They're here (lib/activity.ts): their characters' likes wait for them rather than answering themselves. Throttled.
    db && viewerId ? touchOwner(db, viewerId).catch(() => {}) : null,
    // After Dark's link shows to someone it's open to (lib/adult/entitlement.ts), only where it's offered
    // (lib/jurisdiction.ts); once its public door is opened (lib/adult/door.ts, admins only until payments), to every
    // adult where it isn't blocked.
    afterDarkDoor(db, viewer, await headers()).catch(() => ({ door: false, threshold: false, admin: false })),
    // The meter's count. When its read fails (the pool busy, #1948) the meter is left out for this page, rather than the
    // whole frame failing or the meter showing a count that isn't theirs.
    db && viewerId
      ? episodeAllowance(db, viewerId).then(
          (allowance) => ({ allowance, failed: false }),
          (err: unknown) => {
            console.error(`[layout] the meter's count didn't load: ${err instanceof Error ? err.message : "unknown"}`);
            return { allowance: freshAllowance(), failed: true };
          },
        )
      : { allowance: freshAllowance(), failed: false },
    // The bell's unread count (lib/notifications.ts): what happened between dates.
    db && viewerId ? unreadCount(db, viewerId).catch(() => 0) : 0,
    // Chat's count (lib/nav-chat.ts): unread texts of both kinds, a character's to them and their characters' own
    // (lib/inbox.ts). With NAV_CHAT=0 it's the Dating link's, the characters' own only.
    db && viewerId ? (navChat ? unreadChatTexts(db, viewerId) : unreadTexts(db, viewerId)).catch(() => 0) : 0,
    // The nav changes once there's a character of theirs (app/Nav.tsx): until then, the show and one create button;
    // after, the face of the one they're working with, which switches it (app/CharacterPicker.tsx). One round trip.
    db && viewerId ? pickerCharacters(db, viewerId).catch(() => []) : [],
    db && viewerId && adHost ? adTokenBalance(db, viewerId).catch(() => null) : null,
    // The season's format for the arc under the header (app/SeasonStrip.tsx): one shared copy for every visitor.
    adHost ? null : shared("watch:season-format", async () => seasonFormatNow(await getDb())).catch(() => null),
    // After Dark's header doors that depend on the viewer (lib/adult/doors.ts): the Studio's word, and the Showcase.
    db && viewerId && adHost ? afterDarkDoors(db, viewerId).catch(() => NO_AD_DOORS) : NO_AD_DOORS,
    // Next month's format, for the arc's "December: The Botchelor" beside this month's (app/SeasonBanner.tsx `next`).
    adHost ? null : shared("watch:season-format-next", async () => seasonFormatNow(await getDb(), nextSeasonStart(new Date()))).catch(() => null),
  ]);
  const dates = count.allowance;
  const hasCharacter = mine.length > 0;
  const afterDark = door.door;
  // Google tags wait for consent in the EEA/UK/CH (Consent Mode v2); Vercel sets the visitor's country header.
  const google = Boolean(TRACKING.gaId || TRACKING.gtmId);
  const requestHeaders = await headers();
  const consent = analyticsConsent(cookieStore.get(CONSENT_COOKIE)?.value, placeFromEdge(requestHeaders)?.country);
  // This load's nonce (proxy.ts, lib/security-headers.ts): Next puts it on its own scripts, these get it by hand.
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined;

  return (
    <html lang="en" data-theme={themeAttribute(theme)}>
      {google && (
        <head>
          {/* Before the Google tags load: GA stays off on After Dark's pages, and in a tab after it (lib/ga-guard.ts). */}
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: gaGuardScript(TRACKING.gaId) }} />
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: consentDefaultScript(consent.granted) }} />
        </head>
      )}
      {TRACKING.gtmId && <GoogleTagManager gtmId={TRACKING.gtmId} nonce={nonce} />}
      {TRACKING.gaId && <GoogleAnalytics gaId={TRACKING.gaId} nonce={nonce} />}
      {/* After Dark's own host is night from edge to edge (the design kit's After Dark frame): app/ux/after-dark.css body.ad-host. */}
      <body className={adHost ? "ad-host" : undefined}>
        {/* Search params need a Suspense boundary, or a static page would render on the client only. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {/* The show, its app and its price (lib/seo.ts), on every page; After Dark's own host isn't the show. */}
        {!adHost && <JsonLd data={siteJsonLd()} />}
        {/* Coming back from After Dark's host: "Back to the show", once a session (app/Threshold.tsx). */}
        {!adHost && door.threshold && <Threshold side="show" from={afterDarkOrigin()} />}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          {/* Not prefetched on After Dark's host either: "/" there hops to the show and back, so the prefetch never settled. */}
          {/* On After Dark's own host the wordmark is its home: "/" there only hopped to the show and back. */}
          {/* On the show, prefetched on intent only, as the header's links are (app/IntentLink.tsx). */}
          <IntentLink prefetch={showPrefetch} href={adHost ? "/after-dark" : "/"} className="logo">
            Botchelor
          </IntentLink>
          {/* The header holds five kinds of thing (docs/brand.md, Header): the wordmark, the After Dark door, the meter,
              one call to action and the links. The tagline is the hero's; the theme setting is Account's. After Dark's
              host wears the moon beside the wordmark on every page, so nobody is unsure which side they're on. */}
          {adHost && (
            <span className="moon-badge">
              <Icon name="moon" />
              <span>After Dark</span>
            </span>
          )}
          <Nav tokens={adHost && viewerId ? (adTokens ?? 0) : dates.left} meter={count.failed ? "none" : adHost ? (viewerId && afterDark && !door.admin ? "tokens" : "none") : "dates"} personal={adHost ? Boolean(viewerId) : ownAllowance(viewer, hasCharacter, dates)} unread={unread} texts={texts} afterDark={afterDark} adHost={adHost} showHref={showHome()} hasCharacter={hasCharacter} prefetchShow={!adHost} companions={companionOpen()} chat={navChat} adDoors={adDoors} characters={adHost ? [] : mine} character={rememberedCharacter(cookieStore)} />
        </header>
        {/* The season's arc runs under the header on the show's spectator pages (the design system's all-screens board).
            A lead season's (The Botchelor) counts to the final rose and opens its own page (docs/season-page.md). */}
        {!adHost && (
          <SeasonStrip>
            <SeasonBanner format={seasonDef?.title ?? null} def={seasonDef} next={nextDef?.lead && nextDef.slug !== seasonDef?.slug ? nextDef.title : null} href={seasonDef?.lead && seasonPageLiveOn() ? seasonPath(seasonIdOf(new Date())) : undefined} />
          </SeasonStrip>
        )}
        <main id="main">{children}</main>
        <footer className="site-footer">
          {/* The footer in the page's own column (David 2026-11-17, "keep it contained within content wrapper"): the letter
              and the show's accounts on the left, four groups beside them (columns on a wide screen, rows that fold on a
              phone), then the fine print at the very bottom: the adults line, where to find help, the © line. The adults
              line and the crisis line stay in the open, never one tap away. /everything keeps every other page. Its links
              are never prefetched: on a short page all 25 came into view at once, two requests to the app each, before
              anyone chose one (2026-11-22 load audit). */}
          <div className="footer-main">
            {/* The letter beside the show's own accounts (lib/company.ts), Discord's once its invite is set; neither on
                After Dark's host. */}
            {!adHost && (
              <div className="footer-side">
                <NewsletterSignup />
                <SocialLinks links={socials} labels area="footer" />
              </div>
            )}
            <nav className="footer-groups" aria-label="More of the site">
              <FooterGroup title="The show">
                <li><Link prefetch={false} href="/watch">Watch</Link></li>
                <li><Link prefetch={false} href="/graph">The Constellation</Link></li>
                {/* The show's shop sells dates through Stripe, whose rules bar paying for adult content: never linked from After
                    Dark's host (the 2026-11-22 audit), whose tokens page is its account's. */}
                {!adHost && <li><Link prefetch={false} href="/shop">More dates</Link></li>}
                {!adHost && <li><Link prefetch={false} href="/pricing">Pricing</Link></li>}
                <li><Link prefetch={false} href="/everything" className="footer-all">Everything on Botchelor →</Link></li>
              </FooterGroup>
              <FooterGroup title="Tools">
                <li><Link prefetch={false} href="/tools/random-oc-generator">Random OC generator</Link></li>
                <li><Link prefetch={false} href="/tools/oc-chemistry-test">OC chemistry test</Link></li>
                <li><Link prefetch={false} href="/tools/ship-name-generator">Ship name generator</Link></li>
                {/* Every free tool (app/tools/page.tsx): the two newer ones and the hub itself get a link from every page (SEO, 2026-11-19). */}
                <li><Link prefetch={false} href="/tools" className="footer-all">All free tools →</Link></li>
                {/* For people building agents: the MCP server's front door (/agents: tools and changelog are a tap further). */}
                {!adHost && <li><Link prefetch={false} href="/agents">For AI agents</Link></li>}
                <li><a href="/llms.txt">llms.txt</a></li>
              </FooterGroup>
              <FooterGroup title="Company">
                <li><Link prefetch={false} href="/about">How it&apos;s built</Link></li>
                <li><Link prefetch={false} href="/costs">What it costs</Link></li>
                <li><Link prefetch={false} href="/faq">FAQ</Link></li>
                <li><Link prefetch={false} href="/press">Press kit</Link></li>
                <li><Link prefetch={false} href="/contact">Contact</Link></li>
                <li><Link prefetch={false} href="/security">Security</Link></li>
                <li><Link prefetch={false} href="/accessibility">Accessibility</Link></li>
              </FooterGroup>
              {/* The two ways to tell us something stay side by side (tests/user-feedback.test.ts). On After Dark's host the
                  group stays open on a phone too: reporting and the 2257 statement are never a tap away there. */}
              <FooterGroup title="Help and legal" keepOpen={adHost}>
                <li><Link prefetch={false} href="/report">Report a problem</Link></li>
                <li>
                  <FeedbackLink />
                </li>
                <li><Link prefetch={false} href="/content-policy">Content policy</Link></li>
                <li><Link prefetch={false} href="/safety">Safety</Link></li>
                <li><Link prefetch={false} href="/terms">Terms and refunds</Link></li>
                <li><Link prefetch={false} href="/privacy">Privacy</Link></li>
                <li><Link prefetch={false} href="/legal">Terms and privacy, one page</Link></li>
                <li><Link prefetch={false} href="/2257">2257 statement</Link></li>
                <li><Link prefetch={false} href="/cancel">Cancel a subscription</Link></li>
              </FooterGroup>
            </nav>
          </div>
          <p className="footer-adults">Every character is a fictional adult (18+), and every episode is written by an AI model.</p>
          <CrisisResources />
          <p className="footer-legal">
            Adults (18+) only · No real people · {adHost ? "Every character is AI-generated fiction" : "Points are free and can't be bought"} · © {new Date().getUTCFullYear()} {OPERATOR}
            {/* Never the address whole in the markup, where Cloudflare's email obfuscation would rewrite it (app/SupportEmail.tsx). */}
            {support && (
              <>
                {" "}
                · <SupportEmail address={support} />
              </>
            )}
          </p>
        </footer>
        {/* The phone's tab bar (app/PhoneTabBar.tsx): Watch, Chat, Characters, You. Not on After
            Dark's host, which has its own five doors in its header. Last in the page's flow, so its room is the foot. */}
        {!adHost && <PhoneTabBar companions={companionOpen()} chat={navChat} unread={texts} hasCharacter={hasCharacter} />}
        <FeedbackDock />
        {/* The show's app, installed: not offered on After Dark's host (its legal pages are served there too). */}
        {!adHost && <InstallHint hasCharacter={hasCharacter} />}
        {google && consent.ask && <ConsentBanner />}
        <FunnelBeacon production={TRACKING.production} consentDefault={consent.granted} />
        <EngagementBeacon afterDarkHost={adHost} />
      </body>
    </html>
  );
}
