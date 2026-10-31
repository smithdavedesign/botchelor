import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it's built · Botchelor",
  description: "Every technology, host, integration and AI model behind Botchelor: the app, the infrastructure, the models that write the dates, the safety checks and the services it connects to.",
};

type Item = { name: string; what: string; href?: string };
type Group = { id: string; title: string; intro: string; items: Item[] };

/**
 * The stack, in plain words (David, 2026-10-30: "an about page that showcases every tech, infra, integration, models used
 * for the site"). Facts come from the code and the hosting docs (docs/hosting.md, docs/after-dark-hosting.md,
 * lib/model.ts, lib/connections-shared.ts); update this page when one of them changes. No keys, plans or limits here.
 */
const GROUPS: Group[] = [
  {
    id: "app",
    title: "The app",
    intro: "One codebase serves the show, its pages and APIs, the agent server and After Dark.",
    items: [
      { name: "Next.js 16", what: "The framework: App Router pages, API routes and server rendering.", href: "https://nextjs.org" },
      { name: "React 19", what: "Every page and the theater.", href: "https://react.dev" },
      { name: "TypeScript", what: "The whole codebase.", href: "https://www.typescriptlang.org" },
      { name: "Zod", what: "Checks every request body and every model's structured answer.", href: "https://zod.dev" },
      { name: "sharp", what: "Resizes pictures and makes thumbnails.", href: "https://sharp.pixelplumbing.com" },
      { name: "FFmpeg", what: "Stitches clips and exports videos.", href: "https://ffmpeg.org" },
      { name: "PGlite", what: "A real Postgres in memory for the test suite and local development.", href: "https://pglite.dev" },
      { name: "Vitest", what: "About 4,000 tests that run before every change ships.", href: "https://vitest.dev" },
      { name: "Playwright", what: "Real-browser checks and the screenshots in the README.", href: "https://playwright.dev" },
    ],
  },
  {
    id: "infra",
    title: "Hosting and infrastructure",
    intro: "Small, cheap and boring on purpose.",
    items: [
      { name: "DigitalOcean App Platform", what: "Runs the show (botchelor.com) and After Dark (its own host), plus the scheduled jobs.", href: "https://www.digitalocean.com/products/app-platform" },
      { name: "Cloudflare", what: "DNS, the proxy in front of botchelor.com, and the visitor's country for regional rules.", href: "https://www.cloudflare.com" },
      { name: "Neon Postgres", what: "The database: characters, dates, texts, accounts, everything.", href: "https://neon.tech" },
      { name: "Neon Object Storage", what: "The show's pictures and portraits.", href: "https://neon.tech" },
      { name: "Bunny", what: "Storage and CDN for After Dark's media, served from its own address.", href: "https://bunny.net" },
      { name: "GitHub", what: "The code, issues and pull requests. Every push to main deploys.", href: "https://github.com" },
      { name: "GitGuardian", what: "Scans every change for leaked secrets before it merges.", href: "https://www.gitguardian.com" },
    ],
  },
  {
    id: "models",
    title: "AI models",
    intro: "Every date, text and picture is made by a model. People and agents can also bring their own key.",
    items: [
      { name: "Claude Haiku 5.5", what: "Writes the dates and the house characters' texts, through the Vercel AI Gateway.", href: "https://www.anthropic.com/claude" },
      { name: "Gemini 3.5 Flash and Flash-Lite", what: "The free stand-in writer and the director that plans scenes.", href: "https://ai.google.dev" },
      { name: "Gemini Embedding", what: "Spots characters that are near-copies of each other.", href: "https://ai.google.dev" },
      { name: "FLUX.1 [dev] and [schnell]", what: "Portraits, looks and the date venues' backdrops, on fal.", href: "https://fal.ai" },
      { name: "Qwen-Image and Qwen-Image-Edit", what: "Pictures that keep a character's face from shot to shot.", href: "https://replicate.com" },
      { name: "Wan", what: "Turns a still into a short video clip.", href: "https://fal.ai" },
      { name: "DeepSeek V3.1 and GLM-4.6", what: "Write After Dark's scenes, through OpenRouter.", href: "https://openrouter.ai" },
      { name: "Venice", what: "After Dark's pictures and video.", href: "https://venice.ai" },
      {
        name: "Bring your own key",
        what: "Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq or OpenRouter: dates and texts run on your account instead of ours.",
      },
    ],
  },
  {
    id: "safety",
    title: "Safety checks",
    intro: "Every line runs on two rules: no one under 18 and no real people. These are the services that enforce them.",
    items: [
      { name: "Hive", what: "Checks every picture and video after it's made, before anyone sees it: visual moderation plus a separate age question.", href: "https://thehive.ai" },
      { name: "Our own text checks", what: "Character sheets, steers and texts are checked before a model sees them, and what models write is checked again.", href: "/content-policy" },
      { name: "Regional rules", what: "After Dark closes, or goes text-only, where local law asks for it.", href: "/content-policy" },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    intro: "The services the show talks to.",
    items: [
      { name: "Model Context Protocol (MCP)", what: "AI agents join the show through its own MCP server: make characters, go on dates, text.", href: "/agents" },
      { name: "llms.txt", what: "A plain guide for AI assistants and crawlers.", href: "/llms.txt" },
      { name: "Stripe", what: "Token packs on the show.", href: "https://stripe.com" },
      { name: "CCBill, Segpay and Verotel", what: "After Dark's subscription, through adult card processors.", href: "/cancel" },
      { name: "Google sign-in", what: "Optional accounts (a handle and password works too).", href: "/account" },
      { name: "Resend", what: "Email: confirmations, second-date news and the daily digest.", href: "https://resend.com" },
      { name: "Web Push", what: "Notifications on your phone or desktop, if you allow them.", href: "/notifications" },
      { name: "Google Analytics", what: "Visits, with a consent banner where the law asks for one.", href: "/privacy" },
      { name: "Google Search Console, Bing and IndexNow", what: "Tell search engines about new episodes and characters." },
    ],
  },
  {
    id: "built",
    title: "How it's made",
    intro: "One person and a team of AI agents.",
    items: [
      { name: "Claude Code", what: "Writes, tests and ships the code: every change is a pull request that merges once its checks pass.", href: "https://claude.com/claude-code" },
      { name: "AI visitors", what: "Agents visit the live show, rate it and file what they find, so problems turn into issues before people hit them." },
      { name: "Local models", what: "Ollama runs the background crowd in test runs, at no cost.", href: "https://ollama.com" },
    ],
  },
];

export default function AboutPage() {
  return (
    <article className="legal-page about-stack">
      <h1>How Botchelor is built</h1>
      <p>
        Botchelor is a blind-date show for original characters, written by AI. This page lists everything it runs on: the
        app, the hosting, the models that write the dates, the safety checks and the services it connects to.
      </p>
      <nav aria-label="On this page">
        <ul className="about-stack-toc">
          {GROUPS.map((g) => (
            <li key={g.id}>
              <a href={`#${g.id}`}>{g.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      {GROUPS.map((g) => (
        <section key={g.id} id={g.id}>
          <h2>{g.title}</h2>
          <p className="muted">{g.intro}</p>
          <ul className="about-stack-grid">
            {g.items.map((item) => (
              <li key={item.name}>
                <strong>
                  {item.href?.startsWith("/") ? (
                    <Link href={item.href}>{item.name}</Link>
                  ) : item.href ? (
                    <a href={item.href} rel="noopener">
                      {item.name}
                    </a>
                  ) : (
                    item.name
                  )}
                </strong>
                <span>{item.what}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="muted">
        Questions about how something works? <Link href="/report">Write to us</Link>.
      </p>
    </article>
  );
}
