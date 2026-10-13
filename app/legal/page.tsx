import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms, purchases and privacy · Botchelor" };
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** Terms of use and sale, the refund policy and the privacy notice, on one page. */
export default function LegalPage() {
  const contact = process.env.CONTACT_EMAIL;
  return (
    <article>
      <h1>Terms, purchases and privacy</h1>
      <p className="muted">Last updated 13 October 2026 (seasons, badges and episode packs added).</p>

      <h2>Who Botchelor is for</h2>
      <p>
        Botchelor is for adults (18+). Every character must be a fictional adult: no minors, no real people and no
        sexual content. Episodes are written by an AI model from two character sheets. They are fiction, nobody can
        steer them, and they may be odd or wrong. Report anything that breaks these rules; an episode that several
        people report is hidden.
      </p>

      <h2>Points, seasons and badges</h2>
      <p>
        Points are free. They can&apos;t be bought, sold, cashed out or transferred, they have no cash value, and there
        are no prizes. Nothing you buy changes anyone&apos;s points, picks, odds or rank.
      </p>
      <p>
        Each week is a season. When it closes (Monday 00:00 UTC), the top 3 players with points in each friend league
        earn a badge. Badges are free, can&apos;t be bought or transferred, have no value and carry no prizes.
      </p>

      <h2>What you can buy</h2>
      <p>
        Premium house characters (your character can go on a date with them), frames (a cosmetic border around your
        name on league boards) and episode packs (more dates for your characters, on top of the free ones every week;
        pack dates never expire, and they add episodes, never points). Each is a one-time price in US dollars, paid
        through Stripe Checkout. We never see your card details.
      </p>
      <p>
        Botchelor has no accounts yet, so an item belongs to the browser you bought it in. If you clear your cookies or
        switch browsers, email us your Stripe receipt and we&apos;ll move the item to the new browser.
      </p>

      <h2>Refunds</h2>
      <p>
        If an item doesn&apos;t work, or you change your mind within 14 days of buying it, email us with your Stripe
        receipt and we&apos;ll refund you in full. A refunded item is removed: for an episode pack, its dates stop
        counting, and episodes already written stay up.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          An anonymous random ID in a cookie, which keeps your characters, picks, leagues and purchases together. There
          is no login.
        </li>
        <li>Your character sheets and the episodes written from them, and a display name if you set one.</li>
        <li>Reports and blocks you make.</li>
        <li>
          For purchases: the item, its price and Stripe&apos;s checkout ID. We never see your card. Stripe keeps the email
          and name you give it at checkout, and the checkout ID links your purchases in this browser to your Stripe
          receipt, so we can find them for a refund or a restore. It also means we could connect that receipt to this
          browser&apos;s anonymous characters and episodes. We only look it up when you ask us to.
        </li>
        <li>
          For the Season 1 waitlist: your email, where you roleplay if you tell us, and which link brought you. We use
          the email once, to tell you Season 1 is open. We never sell or share it, and we delete it if you ask.
        </li>
      </ul>

      <h2>Who processes it</h2>
      <p>
        Character sheets are sent to the AI model provider that writes the episodes (Google&apos;s Gemini API by
        default). Payments are handled by Stripe under its own privacy policy. The site and its database run on
        third-party cloud hosting.
      </p>

      <h2>Contact</h2>
      {contact ? (
        <p>
          Refunds, restores, removal from the waitlist and anything else: <a href={`mailto:${contact}`}>{contact}</a>.
        </p>
      ) : (
        <p>The contact address will be posted here before purchases open.</p>
      )}
      <p>
        <Link href="/">Back to the show</Link>
      </p>
    </article>
  );
}
