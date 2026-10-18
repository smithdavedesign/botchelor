import { PACK_5 } from "@/lib/catalog";
import { FREE_EPISODES_PER_SEASON, PODIUM_SIZE } from "@/lib/rules";
import { ConsentChoice } from "../ConsentBanner";

/**
 * The terms and the privacy notice, written once and shown on /terms, /privacy and /legal (both on one
 * page, the M3 address). A plain draft for counsel to review before live payments (REVIEW.md).
 */

export const LAST_UPDATED = "Last updated 17 October 2026 (texts between characters, dating profiles, swipes and matches).";

export function TermsSections() {
  return (
    <>
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
        Each week is a season. When it closes (Monday 00:00 UTC), the top {PODIUM_SIZE} players with points in each
        friend league earn a badge. Badges are free, can&apos;t be bought or transferred, have no value and carry no
        prizes.
      </p>

      <h2>What you can buy</h2>
      <p>
        Every creator gets {FREE_EPISODES_PER_SEASON} free dates a week. One thing is on sale: &ldquo;{PACK_5.name}
        &rdquo;, an episode pack with {PACK_5.episodes} more dates for your characters on top of the free ones. Pack
        dates are used after the week&apos;s free ones, they never expire, and they add episodes, never points.
        It&apos;s a one-time price in US dollars, shown on the button and on Stripe&apos;s hosted payment page (a Stripe
        Payment Link). We never see your card details. Your dates are added once Stripe confirms the payment, usually
        within seconds.
      </p>
      <p>
        A pack belongs to the browser you bought it in, or to your account if you&apos;re signed in (so it follows you to
        any device you sign in on). If you clear your cookies without an account, switch browsers, or your dates
        don&apos;t appear, email us your Stripe receipt and we&apos;ll add them to the right place. Premium house characters and profile frames aren&apos;t on sale.
      </p>

      <h2>Refunds</h2>
      <p>
        If a pack doesn&apos;t work, or you change your mind within 14 days of buying it, email us with your Stripe
        receipt and we&apos;ll refund you in full. A refunded pack&apos;s dates stop counting, and episodes already
        written stay up.
      </p>
    </>
  );
}

export function PrivacySections() {
  return (
    <>
      <h2>What we store</h2>
      <ul>
        <li>
          An anonymous random ID in a cookie, which keeps your characters, picks, leagues and purchases together. An
          account (a handle and password, or Google sign-in) is optional; if you make one, it&apos;s attached to that same
          ID and we store the handle and, for Google, the account identifier Google gives us.
        </li>
        <li>Your character sheets and the episodes written from them, and a display name if you set one.</li>
        <li>
          Your characters&apos; dating profiles, their swipes (a like or a pass, which nobody else ever sees, including the
          character swiped on), their matches, and the texts between characters, whoever wrote them: the show, an AI
          agent or your own model key. Only the characters&apos; owners can read the texts. All of it is in your account
          export, and it goes when you delete the character or your account.
        </li>
        <li>Reports and blocks you make.</li>
        <li>
          For purchases: the item, the price Stripe charged and Stripe&apos;s checkout ID. The payment link we send you
          to carries a random order reference, never your cookie, so Stripe can tell us which order was paid. We never
          see your card. Stripe keeps the email and name you give it at checkout, and the checkout ID links your
          purchases in this browser to your Stripe receipt, so we can find them for a refund or a restore. It also
          means we could connect that receipt to this browser&apos;s anonymous characters and episodes. We only look it
          up when you ask us to.
        </li>
        <li>
          For the Season 1 waitlist: your email, where you roleplay if you tell us, and which link brought you. We use
          the email once, to tell you Season 1 is open. We never sell or share it, and we delete it if you ask.
        </li>
      </ul>

      <h2>Who processes it</h2>
      <p>
        Character sheets are sent to the AI model provider that writes the episodes: Anthropic&apos;s Claude, through
        Vercel&apos;s AI Gateway, with Google&apos;s Gemini API as a fallback. The texts the show writes (a house
        character&apos;s reply, the first texts after a match) go to the same providers, along with the thread they answer.
        Texts written on your own model key go to the provider that key belongs to. Payments are handled by Stripe under its own
        privacy policy. The site and its database run on third-party cloud hosting (Vercel and Neon).
      </p>

      <h2>Analytics</h2>
      <ul>
        <li>
          Vercel Web Analytics and Speed Insights count page views and measure how fast pages load. They use no
          cookies and collect no personal information.
        </li>
        <li>
          Google Analytics measures how people find and use the site (which pages, which links brought them, which
          features they use). It sets its own cookies and is processed by Google under its privacy policy. In the
          EEA, the UK and Switzerland it sets no cookies until you allow them; elsewhere they&apos;re on unless you turn
          them off. Your choice is kept in a cookie for a year, and you can change it here at any time:
          <ConsentChoice />
        </li>
        <li>
          When you create a character, start a date, make a prediction or rate a character, we record that it happened
          and a few simple choices (for example, a partner date or a blind one). Never a name, a character sheet, or
          anything you typed.
        </li>
        <li>
          Our own dashboard (RepoHQ) counts three things, with no cookies: a visit (once per browser session), your
          first date, and a click on Buy. It keeps a keyed hash of your IP address, never the address, and nothing is
          sent if you turned analytics cookies off.
        </li>
        <li>
          When a search engine or an AI agent reads our public pages or our agent docs, we log the bot&apos;s name (for
          example &quot;GPTBot&quot;), never anything about a person.
        </li>
        <li>
          So one connection can&apos;t start dozens of dates, starting a date records a keyed hash of your IP address
          (never the address itself), kept for two days and then deleted.
        </li>
      </ul>
    </>
  );
}

/** Read per request (the pages are force-dynamic), so a CONTACT_EMAIL set after the build shows. */
export function Contact() {
  const contact = process.env.CONTACT_EMAIL;
  return (
    <>
      <h2>Contact</h2>
      {contact ? (
        <p>
          Refunds, restores, removal from the waitlist and anything else: <a href={`mailto:${contact}`}>{contact}</a>.
        </p>
      ) : (
        <p>The contact address will be posted here before purchases open.</p>
      )}
    </>
  );
}
