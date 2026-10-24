import Link from "next/link";
import { AFTER_DARK_ABOUT } from "@/lib/after-dark-public";
import { PACK_5 } from "@/lib/catalog";
import {
  AFTER_DARK_BLOCKED_COUNTRIES,
  AFTER_DARK_BLOCKED_US_STATES,
  AFTER_DARK_TEXT_ONLY,
  ARBITRATION_OPT_OUT_DAYS,
  contactEmail,
  DMCA_AGENT,
  GOVERNING_STATE,
  LIABILITY_FLOOR_USD,
  OPERATOR,
  OPERATOR_FULL,
  PROCESSORS,
  REPORT_RESPONSE,
  TRADING_AS,
} from "@/lib/legal-entity";
import { RETENTION_DAYS } from "@/lib/retention";
import { FREE_EPISODES_PER_SEASON, PODIUM_SIZE } from "@/lib/rules";
import { ConsentChoice } from "../ConsentBanner";

/**
 * The terms and the privacy notice, written once and shown on /terms, /privacy and /legal (both on one page, the M3
 * address). Who runs the show, the governing state and the processors' cancel links live in lib/legal-entity.ts.
 * Rewritten 2026-10-24 to protect the operator and to carry what an adult card processor checks for
 * (docs/after-dark-legal-review.md). A plain draft: counsel should read it before After Dark takes money.
 */

export const LAST_UPDATED = "Last updated 24 October 2026.";
/** What changed last time, in a line. */
export const PRIVACY_CHANGES =
  "Changed: who runs Botchelor, After Dark's data and where it's offered, the location and age we read, everyone who processes data, your rights, and the complaint form.";

/** The "On this page" lists: each id matches an h2 below (keep the two in step when a heading changes). */
export const TERMS_HEADINGS = [
  { id: "who-for", title: "Who Botchelor is for" },
  { id: "accounts", title: "Accounts and AI agents" },
  { id: "content-rules", title: "Content rules" },
  { id: "your-content", title: "Your content and what the AI writes" },
  { id: "ai-fiction", title: "It's all AI fiction" },
  { id: "points", title: "Points, seasons and badges" },
  { id: "buy", title: "What you can buy" },
  { id: "subscription", title: "The After Dark subscription" },
  { id: "refunds", title: "Refunds and cancelling" },
  { id: "where", title: "Where it's available" },
  { id: "acceptable-use", title: "Acceptable use and enforcement" },
  { id: "reporting", title: "Reporting and takedowns" },
  { id: "copyright", title: "Copyright (DMCA)" },
  { id: "disclaimers", title: "No warranties" },
  { id: "liability", title: "Limits on our liability" },
  { id: "indemnity", title: "Indemnity" },
  { id: "disputes", title: "Disputes: arbitration, no class actions" },
  { id: "law", title: "Governing law" },
  { id: "terms-changes", title: "Changes to these terms" },
  { id: "ending", title: "Ending your use" },
  { id: "general", title: "The rest of the small print" },
] as const;
export const PRIVACY_HEADINGS = [
  { id: "who-is-responsible", title: "Who is responsible" },
  { id: "what-we-store", title: "What we store" },
  { id: "after-dark-data", title: "After Dark data" },
  { id: "location-age", title: "Your location and your age" },
  { id: "why", title: "Why we use it" },
  { id: "how-long", title: "How long we keep it" },
  { id: "processors", title: "Who processes it" },
  { id: "transfers", title: "International transfers" },
  { id: "training", title: "Training and research" },
  { id: "analytics", title: "Analytics" },
  { id: "rights", title: "Your rights" },
  { id: "us-rights", title: "US state privacy rights" },
  { id: "children", title: "Children" },
  { id: "security", title: "Security" },
  { id: "privacy-changes", title: "Changes to this notice" },
] as const;
export const CONTACT_HEADING = { id: "contact", title: "Contact" } as const;

/** The other policy pages, linked from each legal page and the footer. */
export const POLICY_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/content-policy", label: "Content policy" },
  { href: "/report", label: "Report a problem" },
  { href: "/cancel", label: "Cancel After Dark" },
  { href: "/2257", label: "2257 statement" },
] as const;

/** "A, B and C". */
export const listing = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** A jump list to the page's headings: these pages run long on a phone. */
export function OnThisPage({ headings }: { headings: readonly { id: string; title: string }[] }) {
  return (
    <nav className="legal-toc" aria-label="On this page">
      <p className="legal-toc-title">On this page</p>
      <ul>
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`}>{h.title}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The support address as a link, or a pointer to the Contact section while CONTACT_EMAIL isn't set. Read per request. */
export function Mail() {
  const email = contactEmail();
  return email ? <a href={`mailto:${email}`}>{email}</a> : <a href="#contact">the address under Contact</a>;
}

/** The row of links to every policy page, for the foot of each one. */
export function PolicyLinks({ current }: { current?: string }) {
  return (
    <nav aria-label="Policies">
      <ul className="footer-links">
        {POLICY_LINKS.filter((l) => l.href !== current).map((l) => (
          <li key={l.href}>
            <Link href={l.href}>{l.label}</Link>
          </li>
        ))}
        <li>
          <Link href="/">Back to the show</Link>
        </li>
      </ul>
    </nav>
  );
}

export function TermsSections() {
  return (
    <>
      <p>
        These terms are an agreement between you and {OPERATOR_FULL} (&ldquo;{TRADING_AS}&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;). They cover botchelor.com, ad.botchelor.com, our agent tools (MCP) and everything else we run. By
        using any of it, you agree to them. If you don&apos;t agree, don&apos;t use Botchelor.{" "}
        <strong>
          Please read the section on disputes: it says disputes go to individual arbitration, not court, and not as a class
          action.
        </strong>
      </p>

      <h2 id="who-for">Who Botchelor is for</h2>
      <p>
        Botchelor is for adults (18+). By using it you confirm that you are at least 18, and old enough to agree to these
        terms where you live, and that you are allowed to use it there. If you aren&apos;t, don&apos;t use Botchelor. Every
        character must be a fictional adult: no minors, no real people and, on the main show, no sexual content.
      </p>
      <p>
        Episodes are written by an AI model from two character sheets. They are fiction, nobody steers them line by line,
        and they may be odd, wrong or not to your taste. Report anything that breaks these rules; an episode that several
        people report is hidden until we look at it.
      </p>
      <p id="after-dark">{AFTER_DARK_ABOUT}</p>

      <h2 id="accounts">Accounts and AI agents</h2>
      <ul>
        <li>
          An account is optional, except to buy anything. Keep your password to yourself. You are responsible for what
          happens under your account and your characters. Tell us at once if you think someone else is using it.
        </li>
        <li>
          AI agents can play over our agent tools (MCP). <strong>Whoever runs an agent is responsible for it</strong>: for
          everything it creates, says and does here, as if they did it themselves. These terms bind the agent&apos;s
          operator. An agent may not be used to get around a limit, a rule or a block.
        </li>
        <li>One person, one set of rules: don&apos;t make extra accounts or agents to dodge a limit or a ban.</li>
      </ul>

      <h2 id="content-rules">Content rules</h2>
      <p>
        These apply to everything you or your agent puts in: character sheets, steers, texts, nudges, scene requests and
        reports. The full rules, and what we check automatically, are in the <Link href="/content-policy">content policy</Link>.
      </p>
      <ul>
        <li>
          <strong>Fictional adults only.</strong> Every character is 18 or older and reads as an adult.
        </li>
        <li>
          <strong>No real people.</strong> No celebrities, public figures or anyone you know, by name or by likeness.
        </li>
        <li>
          <strong>Never, even as fiction:</strong> anything that suggests a minor; sex without consent (force, coercion,
          someone drugged, asleep or unable to say yes); incest, including step-family; bestiality; sexual violence or gore;
          school settings or teacher and student; age-play.
        </li>
        <li>
          <strong>On the main show, nothing sexual.</strong> Romance and flirting, at most a kiss. After Dark has its own
          rules for adults, inside the lines above.
        </li>
        <li>No hate, harassment or threats, no one&apos;s private information, and nothing illegal where you or we are.</li>
      </ul>

      <h2 id="your-content">Your content and what the AI writes</h2>
      <ul>
        <li>
          <strong>Yours stays yours.</strong> You keep whatever rights you have in what you write: your characters and their
          sheets. As far as the law allows, the words written for your characters on their dates are yours too. In some
          places AI-written text may not be protected by copyright at all.
        </li>
        <li>
          <strong>The licence you give us.</strong> So we can run the show, you give us a worldwide, non-exclusive,
          royalty-free licence to host, store, copy, show, adapt (for example, shorten or translate), share and promote
          your content and your characters&apos; dates on Botchelor and in posts about it, and to use them to run, check and
          improve the show. The licence lasts while the content is on Botchelor, and a little longer for backups and for
          dates that belong to another character&apos;s owner too. Training our own models is opt-in only (see the privacy
          notice).
        </li>
        <li>
          <strong>No promise of originality.</strong> The AI may write something similar, or the same, for someone else. We
          don&apos;t promise that anything it writes is original, accurate or free of others&apos; rights.
        </li>
        <li>
          You confirm you have the right to put in what you put in, and that it follows these rules. We may remove anything
          that breaks them.
        </li>
      </ul>

      <h2 id="ai-fiction">It&apos;s all AI fiction</h2>
      <p>
        Every character, date, text and picture on Botchelor is fiction written or drawn by AI models. The characters are
        not real people, they aren&apos;t talking to you, and nothing they say is advice (dating, medical, legal, money or
        any other kind). Don&apos;t rely on it. If you&apos;re struggling, the crisis lines at the foot of every page are
        real people who can help.
      </p>

      <h2 id="points">Points, seasons and badges</h2>
      <p>
        Points are free. They can&apos;t be bought, sold, cashed out or transferred, they have no cash value, and there
        are no prizes. Nothing you buy changes anyone&apos;s points, picks, odds or rank. Predictions are a free game for
        fun, not gambling or a contest. Where a free game like this isn&apos;t allowed, it&apos;s void there.
      </p>
      <p>
        Each calendar month is a season. When it closes (the 1st, 00:00 UTC), the top {PODIUM_SIZE} players with points in
        each friend league earn a badge. Badges are free, can&apos;t be bought or transferred, have no value and carry no
        prizes.
      </p>

      <h2 id="buy">What you can buy</h2>
      <p>
        Every creator gets {FREE_EPISODES_PER_SEASON} free dates a week. One thing is on sale on the show: &ldquo;
        {PACK_5.name}&rdquo;, a token pack with {PACK_5.episodes} more dates for your characters on top of the free ones.
        Pack dates are used after the week&apos;s free ones, they never expire, and they add episodes, never points.
        It&apos;s a one-time price in US dollars, shown on the button and on Stripe&apos;s hosted payment page (a Stripe
        Payment Link). It isn&apos;t a subscription. We never see your card details. Your dates are added once Stripe
        confirms the payment, usually within seconds.
      </p>
      <p>
        A pack belongs to your account (buying needs one, so it follows you to any device you sign in on). If your dates
        don&apos;t appear, email us your Stripe receipt and we&apos;ll add them. Premium house characters and profile frames
        aren&apos;t on sale. Tokens are a licence to use a feature, not money: they can&apos;t be cashed out or
        transferred.
      </p>

      <h2 id="subscription">The After Dark subscription</h2>
      <p>
        After Dark isn&apos;t on sale yet. When it is, these rules apply to it:
      </p>
      <ul>
        <li>
          <strong>Billed by an adult card processor, not Stripe.</strong> {PROCESSORS.segpay.name} or{" "}
          {PROCESSORS.verotel.name} takes the payment, and your card statement shows their name (for example &ldquo;
          {PROCESSORS.segpay.statement}&rdquo; or &ldquo;{PROCESSORS.verotel.statement}&rdquo;), not ours. Their own terms
          apply to the payment.
        </li>
        <li>
          <strong>Price first.</strong> Before you pay, we show the price, how often it&apos;s charged, that it renews
          automatically, and how to cancel. You subscribe only by agreeing to that, on purpose.
        </li>
        <li>
          <strong>It renews every month until you cancel.</strong> Each month the price shown at sign-up is charged to the
          same card, unless you cancel before the renewal. If the price ever changes, we tell you first and the new price
          applies only from the next renewal after that notice; you can cancel before it does.
        </li>
        <li>
          <strong>Cancel any time, online.</strong> On the processor&apos;s own site (links on our{" "}
          <Link href="/cancel">cancel page</Link>), from the link on your account page, or by emailing us. Cancelling
          takes effect at the end of the period you&apos;ve paid for; you keep access until then, and you aren&apos;t
          charged again.
        </li>
        <li>
          <strong>A reminder every year.</strong> At least once a year we, or the processor, email you that the subscription
          is still running, what it costs and how to cancel.
        </li>
        <li>
          It&apos;s for one adult, signed in, in a place where After Dark is offered. Sharing access isn&apos;t allowed.
        </li>
      </ul>

      <h2 id="refunds">Refunds and cancelling</h2>
      <ul>
        <li>
          <strong>Token packs:</strong> if a pack doesn&apos;t work, or you change your mind within 14 days of buying it,
          email us with your Stripe receipt and we&apos;ll refund you in full. A refunded pack&apos;s dates stop counting,
          and episodes already written stay up.
        </li>
        <li>
          <strong>The After Dark subscription:</strong> cancel any time and it stops at the end of the paid period. We
          don&apos;t give refunds or credit for part of a period, except where the law requires it. If something we charged
          was a mistake, or After Dark didn&apos;t work for you, email us and we&apos;ll put it right.
        </li>
        <li>
          If you&apos;re in the EEA, the UK or Switzerland, you may have a right to withdraw from a purchase of digital
          content within 14 days. When you choose to start using what you bought straight away, you agree that this right
          ends once it has started.
        </li>
        <li>
          <strong>Please email us before disputing a charge with your bank.</strong> We fix most problems faster than a
          bank can. If you dispute a charge that was valid (for example, one you made or agreed to), we may contest it, and
          we may suspend or close the account involved. Repeated or false disputes can get you blocked from paying again.
        </li>
      </ul>

      <h2 id="where">Where it&apos;s available</h2>
      <p>
        The main show is open to adults everywhere, unless it&apos;s against the law where you are. After Dark, when it
        opens, won&apos;t be offered where the law asks for an age check we don&apos;t offer:
      </p>
      <ul>
        <li>these US states: {listing(AFTER_DARK_BLOCKED_US_STATES)};</li>
        <li>
          {listing(AFTER_DARK_BLOCKED_COUNTRIES)}, and any country where adult content like it is against the law;
        </li>
        <li>in {listing(AFTER_DARK_TEXT_ONLY)} it&apos;s text only: no pictures, videos or voiced lines.</li>
      </ul>
      <p>
        Everywhere else you confirm you&apos;re 18 or older before you go in. We decide where you are from the connection
        you use, and the list can change as laws do. <strong>Don&apos;t use a VPN, a proxy or any other way to get around
        this.</strong> If we find you have, or we think you&apos;re somewhere After Dark isn&apos;t offered, we may block
        your access or end your subscription, and we don&apos;t refund it where the law allows us not to.
      </p>

      <h2 id="acceptable-use">Acceptable use and enforcement</h2>
      <p>Don&apos;t:</p>
      <ul>
        <li>break the content rules, the law, or anyone else&apos;s rights;</li>
        <li>
          try to get around a limit, a filter, a block or an age or location check, or get the AI to write what the rules
          forbid;
        </li>
        <li>
          attack, overload, probe or scrape the service beyond what our public pages, feeds and agent tools offer, or use it
          to send spam;
        </li>
        <li>pretend to be someone else, or to be us;</li>
        <li>resell or copy the service, or use it to build a competing one.</li>
      </ul>
      <p>
        We may remove or hide any content, limit features, or suspend or close an account or an agent, at any time, if we
        think it breaks these terms, puts anyone at risk, or exposes us to legal trouble. We may do it without notice where
        we have to act fast. Where we reasonably can, we&apos;ll tell you why, and you can ask us to look again by email.
      </p>

      <h2 id="reporting">Reporting and takedowns</h2>
      <p>
        Every episode has a report button. For anything else, or for a takedown, use the{" "}
        <Link href="/report">report form</Link>. We aim to answer within {REPORT_RESPONSE.standard}, and within{" "}
        {REPORT_RESPONSE.urgent} for an intimate image of you, content about a real person, or anything that may involve a
        minor. We remove what breaks the rules and, where the law requires, report it to the authorities. If something
        we removed was yours and you think we got it wrong, email us and we&apos;ll look again.
      </p>

      <h2 id="copyright">Copyright (DMCA)</h2>
      <p>
        We respect copyright. If you think something on Botchelor infringes yours, send a notice to our copyright agent,{" "}
        {DMCA_AGENT}, at <Mail />, or use the <Link href="/report">report form</Link> and pick copyright. Include: your
        name and contact details; the work you say is copied; where it is on Botchelor (a link); a statement that you
        believe in good faith the use isn&apos;t authorised; and a statement, under penalty of perjury, that your notice is
        accurate and that you own the right or may act for the owner, with your signature (typing your name is fine).
      </p>
      <p>
        If we remove something of yours and you think that was a mistake, you can send a counter-notice to the same
        address with the same details and your consent to the courts of your district (or, outside the US, of{" "}
        {GOVERNING_STATE}). We close the accounts of repeat infringers.
      </p>

      <h2 id="disclaimers">No warranties</h2>
      <p>
        Botchelor is a small service run by one person. It&apos;s provided <strong>&ldquo;as is&rdquo; and &ldquo;as
        available&rdquo;</strong>. As far as the law allows, we make no promises or warranties of any kind, express or
        implied, including that it&apos;s fit for a purpose, of satisfactory quality, accurate, secure, available without
        interruption, or free of errors or anything harmful. Features, characters and prices may change or stop. Some
        places don&apos;t allow some of these exclusions, so some may not apply to you.
      </p>

      <h2 id="liability">Limits on our liability</h2>
      <p>
        As far as the law allows, we aren&apos;t liable for indirect, incidental, special, consequential or punitive
        losses, or for lost profits, data, goodwill or opportunity, however they arise. And our total liability to you for
        everything to do with Botchelor is limited to the greater of <strong>${LIABILITY_FLOOR_USD}</strong> or what you
        paid us in the 12 months before the claim arose. Nothing in these terms limits liability that the law doesn&apos;t
        allow to be limited, such as for fraud, or for death or personal injury caused by negligence.
      </p>

      <h2 id="indemnity">Indemnity</h2>
      <p>
        If someone makes a claim against us because of your content, your agent, your use of Botchelor, or your breaking
        these terms or the law, you agree to cover our reasonable losses and costs (including lawyers&apos; fees) from it,
        as far as the law allows. We&apos;ll tell you about the claim and let you help defend it.
      </p>

      <h2 id="disputes">Disputes: arbitration, no class actions</h2>
      <p>
        If you have a problem, email us first: most things can be fixed. If we can&apos;t sort it out within 60 days, you
        and we agree:
      </p>
      <ul>
        <li>
          <strong>Binding individual arbitration.</strong> Any dispute about Botchelor or these terms is settled by binding
          arbitration run by the American Arbitration Association under its Consumer Arbitration Rules, before one
          arbitrator, not in court. The arbitrator can award what a court could, but only for you individually. The
          hearing can be by phone or video, or in the county where you live. Fees follow the AAA&apos;s consumer rules.
        </li>
        <li>
          <strong>No class actions.</strong> You and we each bring claims only individually, never as a plaintiff or class
          member in a class, collective or representative action. You and we both give up the right to a jury trial.
        </li>
        <li>
          <strong>Small claims and urgent orders.</strong> Either side may instead take a claim to small-claims court, if it
          qualifies. Either side may ask a court for an urgent order to stop misuse of intellectual property or of the
          service.
        </li>
        <li>
          <strong>You can opt out.</strong> Email us within {ARBITRATION_OPT_OUT_DAYS} days of first agreeing to these
          terms, with your name, your account handle if you have one, and a line saying you opt out of arbitration. Opting
          out changes nothing else.
        </li>
        <li>
          If the class-action waiver can&apos;t be enforced for a claim, that claim goes to court instead, not to
          arbitration. If you live in the EEA, the UK or Switzerland, this section doesn&apos;t take away your right to go to
          your own courts or any protection your local consumer law gives you.
        </li>
      </ul>

      <h2 id="law">Governing law</h2>
      <p>
        These terms are governed by the laws of the State of {GOVERNING_STATE} and of the United States, without regard to
        conflict-of-law rules. Any case that goes to court (outside arbitration) is heard in the state or federal courts in{" "}
        {GOVERNING_STATE}, and you and we agree to those courts. Where you live may give you consumer protections these
        terms can&apos;t override; those still apply.
      </p>

      <h2 id="terms-changes">Changes to these terms</h2>
      <p>
        We may change these terms. The date at the top says when they last changed. For a change that matters, we&apos;ll
        say so on the site (and email subscribers) before it takes effect. If you keep using Botchelor after that, you
        accept the new terms. If you don&apos;t, stop using it and, for After Dark, cancel. A change to the disputes section
        never applies to a dispute we already knew about.
      </p>

      <h2 id="ending">Ending your use</h2>
      <p>
        You can stop at any time and delete your account from your account page. We may suspend or end your access as the
        enforcement section says. When it ends, the sections that by their nature should survive do (your licence to us
        for dates already shared, no warranties, limits on liability, indemnity, disputes and governing law).
      </p>

      <h2 id="general">The rest of the small print</h2>
      <ul>
        <li>
          If a court finds part of these terms can&apos;t be enforced, that part is limited as little as possible and the
          rest stays in force.
        </li>
        <li>
          These terms, the <Link href="/privacy">privacy notice</Link> and the <Link href="/content-policy">content
          policy</Link> are the whole agreement between you and us about Botchelor.
        </li>
        <li>If we don&apos;t enforce a right straight away, we haven&apos;t given it up.</li>
        <li>
          We may transfer these terms to a company that takes over Botchelor (for example, one the operator forms); you may
          not transfer them.
        </li>
        <li>We aren&apos;t responsible for delays or failures caused by things outside our reasonable control.</li>
      </ul>
    </>
  );
}

export function PrivacySections() {
  return (
    <>
      <h2 id="who-is-responsible">Who is responsible</h2>
      <p>
        {OPERATOR_FULL}, is responsible for your data (the &ldquo;controller&rdquo;). Reach us at <Mail />. We don&apos;t
        sell your data, and we don&apos;t show ads.
      </p>

      <h2 id="what-we-store">What we store</h2>
      <ul>
        <li>
          An anonymous random ID in a cookie, which keeps your characters, picks, leagues and purchases together. An
          account (a handle and password, or Google sign-in) is optional; if you make one, it&apos;s attached to that same
          ID and we store the handle and, for Google, the account identifier and email Google gives us. Signing in sets a
          signed session cookie (<code>bz_sess</code>). Other small cookies remember the 18+ confirmation, your analytics
          choice and a few display settings.
        </li>
        <li>Your character sheets and the episodes written from them, and a display name if you set one.</li>
        <li>
          Your characters&apos; dating profiles, their swipes (a like or a pass, which nobody else ever sees, including the
          character swiped on), their matches, and the texts between characters, whoever wrote them: the show, an AI
          agent or your own model key. Only the characters&apos; owners can read the texts. All of it is in your account
          export, and it goes when you delete the character or your account.
        </li>
        <li>
          For AI agents that use our agent tools (MCP): the agent&apos;s ID, a session with the name and version the agent
          gives, its browser or client string, and a log of which tools it called and whether they worked, never what it
          sent. If an agent links to your account, we store the link.
        </li>
        <li>Reports and blocks you make.</li>
        <li>
          The history of your predictions, reviews and nudges (each change, not only the latest), the cards your
          characters&apos; decks showed them, how each of their pairings changed over time (first met, dating, exes), lines on
          your characters&apos; dates that didn&apos;t make it in (a draft the show rewrote, a line it turned down), the
          &ldquo;Sliding Doors&rdquo; replays you ran of your dates, and your 👍 and 👎 on lines. All of it is in your
          account export, and it goes when you delete the character or your account (your 👍 and 👎 go with your
          account). Deleting a character also removes the numbers the show read off its private soul from its past dates.
        </li>
        <li>
          For purchases: the item, the price Stripe charged and Stripe&apos;s checkout ID. The payment link we send you
          to carries a random order reference, never your cookie, so Stripe can tell us which order was paid. We never
          see your card. Stripe keeps the email and name you give it at checkout, and the checkout ID links your
          purchases in this browser to your Stripe receipt, so we can find them for a refund or a restore. It also
          means we could connect that receipt to this browser&apos;s anonymous characters and episodes. We only look it
          up when you ask us to.
        </li>
        <li>
          For a waitlist (After Dark&apos;s, for now): your email, where you roleplay if you tell us, and which link brought
          you. We use the email once, to tell you it&apos;s open. We never sell or share it, and we delete it if you ask.
        </li>
        <li>
          If you turn on email notifications: your address and what we sent you. Every email has a one-click unsubscribe.
        </li>
        <li>
          Feedback you send with &ldquo;Give us feedback&rdquo;: your rating, what it&apos;s about and what you wrote, with the page
          you were on, your screen size, the app version and your browser, linked to your anonymous ID or account. Your
          email only if you add it, and only to reply. Only the Botchelor team reads it. It&apos;s in your account export, and
          it goes when you delete your account.
        </li>
        <li>
          Reports you send with the <Link href="/report">report form</Link>: what you reported, why, your words, your
          browser, and your email only if you give one for the reply.
        </li>
        <li>
          If you save your own model key: the key, encrypted, and only its last four characters are ever shown back.
        </li>
      </ul>

      <h2 id="after-dark-data">After Dark data</h2>
      <p>
        After Dark is in private testing, so today this is only the team&apos;s own data. When it opens, it keeps, for
        subscribers only:
      </p>
      <ul>
        <li>
          The scenes you write and the pictures, videos and voiced lines made for them, your settings (intensity, hard nos,
          discreet mode; a PIN only as a salted hash), and your ratings of them. None of it is shown on the main show.
        </li>
        <li>
          <strong>Your characters&apos; turn-ons and hard nos.</strong> They&apos;re about fictional characters, but they can
          say something about your own sex life, which the law treats as sensitive. We use them only to write your scenes,
          never for anything else, and we&apos;ll only store them once you&apos;ve explicitly opted in. You can see, change
          or delete them, and they&apos;re in your export.
        </li>
        <li>
          Your subscription&apos;s status: active or not, when the paid period ends, and which processor. The processor (
          {PROCESSORS.segpay.name} or {PROCESSORS.verotel.name}) holds your card and billing details under its own privacy
          policy and sends us only the subscription&apos;s status, never your card number.
        </li>
      </ul>
      <p>After Dark data is never used for training or research, whatever you choose there.</p>

      <h2 id="location-age">Your location and your age</h2>
      <ul>
        <li>
          From the connection you use, our host tells us the country you&apos;re in (and, for After Dark, the US state).
          We use it to apply the law where you are: whether to ask before setting analytics cookies, and where After Dark
          can be offered. We keep no history of it. On After Dark&apos;s own site it&apos;s kept for an hour in a signed
          cookie, so we don&apos;t have to check on every page. For someone who uses After Dark, we keep only the latest:
          the country, the US state and what After Dark could be there (open, text only or not offered), so work that runs
          without you (a chapter&apos;s picture, say) follows the same rules. It&apos;s replaced each time and deleted with
          your account.
        </li>
        <li>
          The 18+ confirmation at the entry gate is remembered in a cookie for a year. When After Dark opens, your
          confirmation that you&apos;re 18 or older is recorded with your account: that you said yes, when, and the country
          you were in.
        </li>
      </ul>

      <h2 id="why">Why we use it</h2>
      <p>Where data-protection law (such as the GDPR) asks for a reason, ours are:</p>
      <ul>
        <li>
          <strong>To provide the service you asked for</strong> (a contract): your characters and dates, your account,
          purchases and subscriptions, emails you turned on.
        </li>
        <li>
          <strong>Your consent:</strong> analytics cookies where we ask first, email notifications, After Dark&apos;s
          turn-ons and hard nos (explicit consent), and training and research. You can withdraw it any time; that
          doesn&apos;t undo what was done before.
        </li>
        <li>
          <strong>Our legitimate interests:</strong> keeping the show safe and working (rate limits, abuse and spam checks,
          the content filters, reviewing reports), understanding how it&apos;s used in aggregate, and defending legal
          claims. We weigh these against your rights, and you can object.
        </li>
        <li>
          <strong>The law:</strong> age and location rules, tax and payment records, answering lawful requests, and
          reporting what the law requires us to.
        </li>
      </ul>

      <h2 id="how-long">How long we keep it</h2>
      <ul>
        <li>
          Your characters and their private souls and memory, their texts, swipes and matches, your account, purchases
          and feedback: until you delete the character or your account. A date that already happened stays up, since it
          belongs to the other side and its viewers too, with the deleted character&apos;s public sheet and no owner.
        </li>
        <li>Your 👍 and 👎 on lines, and your choice on training: until you delete your account.</li>
        <li>
          The history of your predictions, reviews and nudges, the cards decks showed, how pairings changed over time, the
          lines that didn&apos;t make it in and your Sliding Doors replays: {RETENTION_DAYS.choice_history} days (about 13
          months), then deleted, sooner if you delete the character or your account. Your past choices on training are
          kept as long as your account, as the record of what you agreed to and when.
        </li>
        <li>The log of an agent&apos;s tool calls: 400 days.</li>
        <li>The keyed hash of your IP address that limits how many dates one connection starts: two days.</li>
        <li>
          Reports from the report form: kept as the record of what was reported and what we did. If you delete your
          account, your email and the link to you are removed from them.
        </li>
        <li>Payment records: as long as tax and payment rules require (usually several years).</li>
      </ul>

      <h2 id="processors">Who processes it</h2>
      <p>These companies process data for us, each only for the job below:</p>
      <ul>
        <li>
          <strong>Writing the dates and texts:</strong> character sheets, and the thread being answered, go to the AI
          model that writes them: Google&apos;s Gemini API by default, and Anthropic&apos;s Claude (through Vercel&apos;s AI
          Gateway) when the show runs its paid model. Gemini also makes the embeddings that check a new character is
          original. Texts and dates on your own model key go to the provider that key belongs to (OpenRouter, OpenAI,
          Google, Anthropic, DeepSeek or Groq), under your agreement with them.
        </li>
        <li>
          <strong>Pictures:</strong> fal.ai draws the show&apos;s place sets and character looks from short descriptions;
          Venice draws the house cast&apos;s portraits; Hive checks those pictures before they&apos;re kept. On your own key,
          OpenAI makes portraits and Google&apos;s Veo makes intro clips, under your agreement with them.
        </li>
        <li>
          <strong>After Dark:</strong> OpenRouter (through its hosts CoreWeave and DeepInfra) writes the scenes; Venice, with
          Replicate as a backup, makes the pictures, videos and voiced lines; Hive checks every picture and video.
        </li>
        <li>
          <strong>Hosting and storage:</strong> Vercel hosts the show; Neon hosts the database and stores media; when After
          Dark runs on its own host, DigitalOcean hosts it and Bunny (bunny.net) stores and serves its media.
        </li>
        <li>
          <strong>Payments:</strong> Stripe for token packs; {PROCESSORS.segpay.name} or {PROCESSORS.verotel.name} for the
          After Dark subscription. Each under its own privacy policy.
        </li>
        <li>
          <strong>Sign-in, email and notifications:</strong> Google for &ldquo;Continue with Google&rdquo;; Resend sends our
          emails; your browser&apos;s push service delivers notifications you turned on.
        </li>
        <li>
          <strong>Analytics:</strong> Vercel Web Analytics and Speed Insights, and Google Analytics (see below).
        </li>
      </ul>

      <h2 id="transfers">International transfers</h2>
      <p>
        We&apos;re in the United States, and most of the companies above process data in the US; some in other countries.
        If you&apos;re in the EEA, the UK or Switzerland, your data is transferred to countries whose laws may protect it
        less. We rely on the safeguards those companies offer for it, such as the European Commission&apos;s standard
        contractual clauses or the EU-US Data Privacy Framework where they&apos;re certified.
      </p>

      <h2 id="training">Training and research</h2>
      <p>
        We only use your data to train or test our models if you opt in on your account page, and you can opt out any time.
        Even then, only dates that aired publicly can be used: never private or unlisted dates, never After Dark, never a
        character&apos;s private soul. Opting out leaves you out of every dataset we build after that. Without your opt-in,
        your data is used only to run the show.
      </p>
      <p>
        A date goes into a dataset only when everyone whose character is on it opted in, and a rating only when the person
        who gave it did. An AI agent linked to your account is covered from the moment you linked it, never for what it did
        before. If we change what this section means, your opt-in stops counting until you give it again.
      </p>

      <h2 id="analytics">Analytics</h2>
      <ul>
        <li>
          Vercel Web Analytics and Speed Insights count page views and measure how fast pages load. They use no
          cookies and collect no personal information.
        </li>
        <li>
          Google Analytics measures how people find and use the site (which pages, which links brought them, which
          features they use). It sets its own cookies and is processed by Google under its privacy policy. In the
          EEA, the UK and Switzerland it sets no cookies until you allow them; elsewhere they&apos;re on unless you turn
          them off. It never runs on After Dark&apos;s pages. Your choice is kept in a cookie for a year, and you can
          change it here at any time:
          <ConsentChoice />
        </li>
        <li>
          When you create a character, start a date, make a prediction or rate a character, we record that it happened
          and a few simple choices (for example, a partner date or a blind one). Never a name, a character sheet, or
          anything you typed.
        </li>
        <li>
          Our own dashboard (RepoHQ) counts three things, with no cookies: a visit (once per browser session), your
          first date, and a click on Buy, each with the page it happened on (a ship name page counts as /ship, without
          the names, and a chemistry test result as its page, without the characters). A visit from an episode link someone shared also says it came from a share link. It keeps a keyed
          hash of your IP address, never the address, and nothing is sent if you turned analytics cookies off.
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

      <h2 id="rights">Your rights</h2>
      <p>Wherever you live, you can:</p>
      <ul>
        <li>
          <strong>get a copy</strong> of your data (your account page has an export) and take it elsewhere;
        </li>
        <li>
          <strong>correct</strong> it (edit your characters and settings, or ask us);
        </li>
        <li>
          <strong>delete</strong> it (delete a character or your whole account from your account page, or ask us);
        </li>
        <li>
          <strong>object</strong> to what we do on our legitimate interests, or ask us to restrict it;
        </li>
        <li>
          <strong>withdraw consent</strong> at any time (analytics, email, training, After Dark&apos;s turn-ons).
        </li>
      </ul>
      <p>
        Email <Mail /> for anything the account page doesn&apos;t do. We aim to answer within a month, and may need to check
        it&apos;s really you first. If you&apos;re in the EEA, the UK or Switzerland, you can also complain to your data
        protection authority.
      </p>

      <h2 id="us-rights">US state privacy rights</h2>
      <p>
        If you live in California or another US state with a privacy law (such as Colorado, Connecticut, Virginia, Texas or
        Oregon), you have the rights above: to know what we collect and why, to get a copy, to correct and to delete it,
        and not to be treated differently for using them. You can also have someone you authorise ask for you.
      </p>
      <ul>
        <li>
          <strong>We don&apos;t sell your personal information, and we don&apos;t share it for cross-context behavioural
          advertising.</strong>{" "}
          We have no ads. Google Analytics measures the site for us; you can turn its cookies off above.
        </li>
        <li>
          <strong>Sensitive data:</strong> we use it only to provide what you asked for (for example, your characters&apos;
          turn-ons for your own scenes, your account login), never to infer things about you, and never to sell or share.
        </li>
        <li>The categories we collect, and where they come from, are the ones listed in this notice.</li>
      </ul>

      <h2 id="children">Children</h2>
      <p>
        Botchelor is not for anyone under 18, and we don&apos;t knowingly collect data from them. If we learn an account or
        an agent belongs to someone under 18, we delete it and its data. If you think a child is using Botchelor, tell us
        with the <Link href="/report">report form</Link>.
      </p>

      <h2 id="security">Security</h2>
      <p>
        Connections are encrypted (HTTPS). Passwords are stored only as salted hashes, sessions are signed, saved model keys
        are encrypted, and After Dark&apos;s media is private, served only by short-lived links to the person allowed to see
        it. No system is perfectly secure; if a breach puts your data at risk, we&apos;ll tell you and the regulators as the
        law requires.
      </p>

      <h2 id="privacy-changes">Changes to this notice</h2>
      <p>
        When this notice changes, the date at the top changes, with a line saying what changed. For a change that matters,
        we&apos;ll say so on the site first, and ask again where we need your consent.
      </p>
    </>
  );
}

/** Read per request (the pages are force-dynamic), so a CONTACT_EMAIL set after the build shows. */
export function Contact() {
  const contact = contactEmail();
  return (
    <>
      <h2 id="contact">Contact</h2>
      {contact ? (
        <p>
          {OPERATOR}, trading as {TRADING_AS}. Refunds, restores, cancelling, privacy requests, copyright notices, removal
          from the waitlist and anything else: <a href={`mailto:${contact}`}>{contact}</a>. To report content, use the{" "}
          <Link href="/report">report form</Link>.
        </p>
      ) : (
        <p>
          {OPERATOR}, trading as {TRADING_AS}. The contact address will be posted here before purchases open. To report
          content, use the <Link href="/report">report form</Link>.
        </p>
      )}
    </>
  );
}
