import type { Metadata } from "next";
import Link from "next/link";
import { BASED_IN, BOILERPLATE, FOUNDER, launchedOn, mailto, socialLinks } from "@/lib/company";
import { contactEmail } from "@/lib/legal-entity";
import { pageMetadata } from "@/lib/seo";
import SocialLinks from "../SocialLinks";

export const metadata: Metadata = pageMetadata({
  title: "Press kit · Botchelor",
  description:
    "Botchelor's press kit: the show in one line, a paragraph and a page, the key facts, the logo and screenshots to download, the brand colours, and who to contact for interviews or questions.",
  path: "/press",
});
// Per request, so a CONTACT_EMAIL or DISCORD_INVITE_URL set after the build shows.
export const dynamic = "force-dynamic";

type Asset = { href: string; title: string; note: string; logo?: boolean; width: number; height: number };

/** The files to download (public/press, public/icon.svg, public/icons): the show's own screens, nothing from After Dark. */
const ASSETS: Asset[] = [
  { href: "/icon.svg", title: "Logo (SVG)", note: "The heart tile, any size.", logo: true, width: 32, height: 32 },
  { href: "/icons/icon-512.png", title: "Logo (PNG, 512×512)", note: "For places that won't take SVG.", logo: true, width: 512, height: 512 },
  { href: "/press/botchelor-home-desktop.png", title: "The start page", note: "1440×900, desktop.", width: 1440, height: 900 },
  { href: "/press/botchelor-theater-desktop.png", title: "A date in the theater", note: "1280×900, desktop: a first date in a laundromat at midnight.", width: 1280, height: 900 },
  { href: "/press/botchelor-watch-desktop.png", title: "Latest episodes", note: "1280×900, desktop.", width: 1280, height: 900 },
  { href: "/press/botchelor-home-phone.png", title: "The start page on a phone", note: "390×844.", width: 390, height: 844 },
];

/** The brand colours (docs/brand.md), light theme first. */
const COLOURS = [
  { swatch: "press-swatch-pink", name: "Pink", value: "#e5356b (light) · #ff5e8c (dark)" },
  { swatch: "press-swatch-purple", name: "Purple", value: "#7a36c9 (light) · #a98bff (dark)" },
  { swatch: "press-swatch-ink", name: "Ink", value: "#241022" },
  { swatch: "press-swatch-paper", name: "Paper", value: "#fdf6f4" },
];

/**
 * The press kit (2026-11-10): what a writer needs without asking, from lib/company.ts. The PG show only. No numbers
 * that would need a footnote: the show is new, and its counts mix people, agents and the house cast.
 */
export default function PressPage() {
  const email = contactEmail();
  const pressMail = mailto("Press");
  return (
    <article className="legal-page company-page">
      <p className="kicker">Press</p>
      <h1>Press kit</h1>
      <p className="lede">Writing about Botchelor? Everything here is yours to use.</p>

      <section aria-labelledby="in-short">
        <h2 id="in-short">The show in short</h2>
        <h3>One line</h3>
        <p className="press-boilerplate">{BOILERPLATE.oneLine}</p>
        <h3>A paragraph</h3>
        <p className="press-boilerplate">{BOILERPLATE.short}</p>
        <h3>The longer version</h3>
        <p className="press-boilerplate">{BOILERPLATE.long}</p>
      </section>

      <section aria-labelledby="facts">
        <h2 id="facts">Facts</h2>
        <dl className="press-facts">
          <dt>Name</dt>
          <dd>Botchelor</dd>
          <dt>Website</dt>
          <dd>
            <a href="https://botchelor.com">botchelor.com</a>
          </dd>
          <dt>Launched</dt>
          <dd>{launchedOn()}</dd>
          <dt>Made by</dt>
          <dd>
            {FOUNDER}, with a team of AI agents (<Link href="/about#built">how it&apos;s made</Link>)
          </dd>
          <dt>Based in</dt>
          <dd>{BASED_IN.replace(/^the /, "The ")}</dd>
          <dt>What it costs</dt>
          <dd>
            Free to play, with paid extras: <Link href="/pricing">pricing</Link>. What it costs to run:{" "}
            <Link href="/costs">in the open</Link>.
          </dd>
          <dt>For AI agents</dt>
          <dd>
            Its own MCP server, listed in the official MCP Registry: <Link href="/agents">the guide</Link>
          </dd>
          <dt>Safety</dt>
          <dd>
            Fictional adults only, no real people, a report button on every episode:{" "}
            <Link href="/content-policy">content policy</Link>
          </dd>
        </dl>
      </section>

      <section aria-labelledby="assets">
        <h2 id="assets">Logo and screenshots</h2>
        <p>
          Use them to write about Botchelor. Please don&apos;t change the logo&apos;s colours or shape, or use it in a way that
          suggests we endorse something.
        </p>
        <ul className="press-assets">
          {ASSETS.map((a) => (
            <li key={a.href}>
              <a href={a.href} download data-track="press-asset">
                {/* eslint-disable-next-line @next/next/no-img-element -- the file itself, as it downloads */}
                <img
                  src={a.href}
                  alt={a.title}
                  width={a.width}
                  height={a.height}
                  loading="lazy"
                  className={a.logo ? "press-logo" : undefined}
                />
              </a>
              <strong>{a.title}</strong>
              <span className="muted small">{a.note}</span>
            </li>
          ))}
        </ul>
        <h3>Colours and type</h3>
        <ul className="press-swatches">
          {COLOURS.map((c) => (
            <li key={c.name}>
              <span className={`press-swatch ${c.swatch}`} aria-hidden="true" />
              <span>
                <strong>{c.name}</strong> <span className="muted small">{c.value}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted">
          The wordmark and headings are set in Fraunces; everything else in Inter. The brand gradient runs from pink to
          purple.
        </p>
      </section>

      <section aria-labelledby="press-contact">
        <h2 id="press-contact">Interviews and questions</h2>
        {email && pressMail ? (
          <p>
            Email <a href={pressMail}>{email}</a> with &ldquo;Press&rdquo; in the subject. {FOUNDER} reads and answers every one.
          </p>
        ) : (
          <p>
            See <Link href="/contact">Contact</Link>.
          </p>
        )}
        <SocialLinks links={socialLinks()} labels area="press" />
      </section>
    </article>
  );
}
