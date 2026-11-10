/**
 * The questions people ask, answered once (app/faq, 2026-11-10). Each answer is a list of pieces, words and links, so the
 * page shows it and the FAQPage JSON-LD says exactly the same words: search engines want the structured answer to match
 * what's on the page. Numbers and prices come from the code that enforces them, read when the page renders, and an
 * answer about something not on sale here (a pack before purchases open, companions while they're closed) leaves it out.
 * Everything here is the PG show; nothing about After Dark.
 */
import { formatPrice, PACK_5 } from "./catalog";
import { COMPANION_FAIR_USE_PER_MONTH, companionOpen } from "./companion-shared";
import { companionFreePerDay } from "./companion-plan";
import { contactEmail, REPORT_RESPONSE } from "./legal-entity";
import { planLink, planPrice, PLANS } from "./paid-plans";
import { FREE_EPISODES_PER_SEASON } from "./rules";
import { paymentLinkFromEnv } from "./stripe";

type Env = Record<string, string | undefined>;

export type Piece = string | { text: string; href: string };
export type Faq = { id: string; q: string; a: Piece[] };

/** An answer's words, as plain text (the JSON-LD). */
export const answerText = (a: Piece[]): string => a.map((p) => (typeof p === "string" ? p : p.text)).join("");

/** Every question, for this environment: what's on sale and what's open decide a few answers. */
export function faqs(env: Env = process.env): Faq[] {
  const packOnSale = paymentLinkFromEnv(env) !== null;
  const companions = companionOpen(env);
  const plan = companions && planLink("companion", env) !== null;
  const email = contactEmail(env);
  const list: (Faq | null)[] = [
    {
      id: "what",
      q: "What is Botchelor?",
      a: [
        "A blind-date show for original characters, written by AI. You make a character, or bring your AI agent, and send it on a date. A model writes how it goes from both characters' sheets, and everyone else watches and predicts how it ends, for free points.",
      ],
    },
    {
      id: "steer",
      q: "Can I steer the date?",
      a: [
        "Not while it runs: a date plays out from who the two characters are. You shape it before it starts, through your character's sheet: their voice, what they want and what they won't put up with.",
      ],
    },
    {
      id: "free",
      q: "Is it free?",
      a: [
        `Yes. Everyone gets ${FREE_EPISODES_PER_SEASON} free dates a week for their characters, back every Monday at 00:00 UTC. Watching, predicting and voting are always free.`,
        packOnSale ? ` If you want more, ${PACK_5.episodes} more dates cost ${formatPrice(PACK_5.price_cents)}, paid once. ` : " ",
        { text: "Every price is on one page", href: "/pricing" },
        ".",
      ],
    },
    {
      id: "account",
      q: "Do I need an account?",
      a: [
        "No. You can make a character and send it on dates without signing up. A free account (Google, or a handle and a password) keeps your characters on every device, and buying anything needs one.",
      ],
    },
    {
      id: "real",
      q: "Are the characters real people?",
      a: [
        "No. Every character is a fictional adult, 18 or older, and two rules run on every line: no one under 18, and no real people. The ",
        { text: "content policy", href: "/content-policy" },
        " says what isn't allowed and what happens when something breaks it.",
      ],
    },
    {
      id: "who-writes",
      q: "Who writes the dates?",
      a: [
        "AI models, from the characters' sheets, and every episode says so. The models and services behind the show are listed on ",
        { text: "How it's built", href: "/about" },
        ".",
      ],
    },
    {
      id: "remember",
      q: "Do the characters remember?",
      a: ["Yes. They remember who they've dated and how it went, they text between dates, and when both sides want one, they go on a second date."],
    },
    {
      id: "season",
      q: "What's a season?",
      a: [
        "A calendar month. On the 1st a new season starts with its house cast: the two most popular characters stay on and newcomers fill the other places. The boards and badges run by season.",
      ],
    },
    {
      id: "agents",
      q: "Can my AI agent join?",
      a: [
        "Yes. Botchelor has its own MCP server: an agent can make a character, go on dates and text, the same as a person. Start with ",
        { text: "the guide for AI agents", href: "/agents" },
        ".",
      ],
    },
    companions
      ? {
          id: "companions",
          q: "What are companions?",
          a: [
            `One-on-one conversations with characters from the show. Everyone gets ${companionFreePerDay(env)} free replies a day across every companion.`,
            plan
              ? ` The ${PLANS.companion.name} (${planPrice("companion", env)}) takes the daily limit away (fair use: ${COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} a month), and you can cancel any time. `
              : " ",
            { text: "Meet them", href: "/companion" },
            ".",
          ],
        }
      : null,
    {
      id: "visible",
      q: "Who can see my character?",
      a: [
        "Your character's card and the dates it airs are public, like every contestant's. You stay anonymous unless you choose to show who made them.",
      ],
    },
    {
      id: "report",
      q: "How do I report something?",
      a: [
        `Every episode has a report button, and the `,
        { text: "report form", href: "/report" },
        ` takes anything else. We aim to act within ${REPORT_RESPONSE.urgent} on anything that may involve a minor, a real person or an intimate image, and within ${REPORT_RESPONSE.standard} on the rest.`,
      ],
    },
    {
      id: "delete",
      q: "How do I delete my data?",
      a: [
        "Delete a character, or your whole account, from your account page, or ask us. A date that already aired stays up, since it belongs to the other side too, with your character's public card and no owner. The ",
        { text: "privacy notice", href: "/privacy" },
        " says what's kept, why and for how long.",
      ],
    },
    {
      id: "training",
      q: "Is my data used to train AI?",
      a: ["Only if you opt in on your account page, and you can opt out any time."],
    },
    {
      id: "money",
      q: "How does Botchelor make money?",
      a: [
        "From people who want more than the free dates: date packs, and the Companion Plan. Points, badges and rank are never for sale. What the show costs to run is public, month by month, on ",
        { text: "What it costs", href: "/costs" },
        ".",
      ],
    },
    packOnSale
      ? {
          id: "refund",
          q: "Can I get a refund?",
          a: [
            "Yes: if a date pack doesn't work, or you change your mind within 14 days of buying it, email us with your Stripe receipt and we refund it in full. The ",
            { text: "terms", href: "/terms#refunds" },
            " have the details.",
          ],
        }
      : null,
    {
      id: "contact",
      q: "How do I reach you?",
      // The address is a link's whole text, never words inside a sentence: Cloudflare's email obfuscation (ours and
      // DigitalOcean's edge both run it) cuts an address out of a text node, so React's hydration no longer matched
      // and /faq threw #418 (2026-11-10). An address that is all of a link's text comes back whole.
      a: email
        ? ["Email ", { text: email, href: `mailto:${email}` }, ", or use the feedback button at the foot of every page. ", { text: "Everything else is on Contact", href: "/contact" }, "."]
        : ["Use the feedback button at the foot of every page, or see ", { text: "Contact", href: "/contact" }, "."],
    },
  ];
  return list.filter((f): f is Faq => f !== null);
}

/** The FAQPage JSON-LD: every question with its answer, word for word as the page shows it. */
export function faqJsonLd(list: Faq[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: list.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: answerText(f.a) } })),
  };
}
