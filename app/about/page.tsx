import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "How it's built · Botchelor",
  description: "Every technology, host, integration and AI model behind Botchelor: the app, the infrastructure, the models that write the dates, the safety checks and the services it connects to.",
  path: "/about",
});

type Item = { name: string; what: string; href?: string };
/** `layer`: where the group sits in the stack, top to bottom; the eyebrow on its card. */
type Group = { id: string; title: string; layer: string; intro: string; items: Item[] };

/**
 * The stack, in plain words (David, 2026-10-30: "an about page that showcases every tech, infra, integration, models used
 * for the site"). Facts come from the code and the hosting docs (docs/hosting.md, docs/after-dark-hosting.md,
 * lib/model.ts, lib/connections-shared.ts; 2026-11-10: Didit, Deepgram, Kokoro, speech-to-video; 2026-11-13: faces that move on
 * calls, lib/face-kit.ts; 2026-11-14: lip-synced clips from our own renderer on Runpod, lib/live-face, and the renderer
 * compare); update this page when one of them changes. No keys, plans or limits here.
 *
 * Drawn as the system it is (the 2026-11-13 lift): one layer a card, top to bottom from the person to the metal. The
 * services you and your agent touch come first, then the app they reach, the models that write for it, the checks
 * every line passes, where it runs and is stored, and who builds it. The group ids are the anchors other pages link.
 */
const GROUPS: Group[] = [
  {
    id: "integrations",
    title: "Integrations",
    layer: "Where you come in",
    intro: "The services the show talks to.",
    items: [
      { name: "Model Context Protocol (MCP)", what: "AI agents join the show through its own MCP server: make characters, go on dates, text.", href: "/agents" },
      { name: "llms.txt", what: "A plain guide for AI assistants and crawlers.", href: "/llms.txt" },
      { name: "Stripe", what: "Token packs and the Companion Plan on the show.", href: "https://stripe.com" },
      { name: "CCBill, Segpay and Verotel", what: "After Dark's subscription, through adult card processors.", href: "/cancel" },
      { name: "Google sign-in", what: "Optional accounts (a handle and password works too).", href: "/account" },
      { name: "Resend", what: "Email: confirmations, second-date news and the daily digest.", href: "https://resend.com" },
      { name: "Deepgram", what: "Live voice calls with companions: it hears you as you talk and speaks their replies as they are written, so you can just talk, and cut in.", href: "https://deepgram.com" },
      {
        name: "A face that moves on calls",
        what: "On a call, a companion's face comes to life in your browser: a short loop of them while they listen, and while they talk their lips say the words. Each clause of a reply comes back as a short clip of their own face rendered on our own GPU worker (MuseTalk, below); where a clip is late the mouth follows the voice's loudness instead, read off the audio as it plays, and the loop carries on between. Everything stays in the round frame; nothing of yours goes to a face vendor.",
        href: "/companion",
      },
      {
        name: "Your browser's speech",
        what: "Companion calls can also use your browser's own speech recognition and voices (Chrome sends what you say to Google, Safari to Apple).",
        href: "/privacy",
      },
      { name: "Web Push", what: "Notifications on your phone or desktop, if you allow them.", href: "/notifications" },
      { name: "Google Analytics", what: "Visits, with a consent banner where the law asks for one.", href: "/privacy" },
      { name: "Google Search Console, Bing and IndexNow", what: "Tell search engines about new episodes and characters." },
    ],
  },
  {
    id: "app",
    title: "The app",
    layer: "What you reach",
    intro: "One codebase serves the show, its pages and APIs, the agent server and After Dark.",
    items: [
      { name: "Next.js 16", what: "The framework: App Router pages, API routes and server rendering.", href: "https://nextjs.org" },
      { name: "React 19", what: "Every page and the theater.", href: "https://react.dev" },
      { name: "TypeScript", what: "The whole codebase.", href: "https://www.typescriptlang.org" },
      { name: "Zod", what: "Checks every request body and every model's structured answer.", href: "https://zod.dev" },
      { name: "sharp", what: "Resizes pictures and makes thumbnails.", href: "https://sharp.pixelplumbing.com" },
      { name: "FFmpeg", what: "Stitches clips and exports videos.", href: "https://ffmpeg.org" },
      { name: "PGlite", what: "A real Postgres in memory for the test suite and local development.", href: "https://pglite.dev" },
      { name: "Vitest", what: "About 5,000 tests that run before every change ships.", href: "https://vitest.dev" },
      { name: "Playwright", what: "Real-browser checks and the screenshots in the README.", href: "https://playwright.dev" },
    ],
  },
  {
    id: "models",
    title: "AI models",
    layer: "What writes and draws",
    intro: "Every date, text and picture is made by a model. People and agents can also bring their own key.",
    items: [
      { name: "Claude Haiku 5.5", what: "Writes the dates and the house characters' texts, through OpenRouter.", href: "https://www.anthropic.com/claude" },
      { name: "Gemini 3.5 Flash and Flash-Lite", what: "The free stand-in writer and the director that plans scenes.", href: "https://ai.google.dev" },
      { name: "Gemini Embedding", what: "Spots characters that are near-copies of each other.", href: "https://ai.google.dev" },
      { name: "FLUX.1 [dev] and [schnell]", what: "Portraits, looks and the date venues' backdrops, on fal.", href: "https://fal.ai" },
      { name: "Qwen-Image and Qwen-Image-Edit", what: "Pictures that keep a character's face from shot to shot, and the seven stills of a companion's face for calls: the same portrait with the mouth parted, open or rounded, a blink, a smile, a gasp.", href: "https://replicate.com" },
      { name: "Wan", what: "Turns a still into a short video clip, on fal and Replicate: a companion's living loop for calls, and the showcase's living portraits. Its speech-to-video model moves their lips to a line they say.", href: "https://replicate.com" },
      { name: "Kokoro", what: "Each character's own voice: voice notes, nights and videos. Stock voices only, never a clone of a real person.", href: "https://huggingface.co/hexgrad/Kokoro-82M" },
      {
        name: "MuseTalk",
        what: "Lip-sync on live calls: an open model (MIT) that paints the mouth onto each frame of a companion's loop as they speak, on a GPU we rent by the second (Runpod, below). Their loop is re-timed to real 25 fps first so the head moves on every frame the mouth does.",
        href: "https://github.com/TMElyralab/MuseTalk",
      },
      {
        name: "Lip-sync and talking-head models, compared",
        what: "Sync Labs' lipsync-2, LatentSync, Kling's lipsync, InfiniteTalk and OmniHuman on fal, and Wan 2.2 speech-to-video on Replicate, run side by side on the same line and the same face so we can see which mouth is worth paying for. Admin-only while we compare; on your own key when it opens.",
        href: "https://fal.ai",
      },
      { name: "DeepSeek V3.1 and GLM-4.6", what: "Write After Dark's scenes, through OpenRouter.", href: "https://openrouter.ai" },
      { name: "Venice", what: "After Dark's pictures and video.", href: "https://venice.ai" },
      {
        name: "Bring your own key",
        what: "Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq or OpenRouter for dates and texts; Replicate, fal.ai or D-ID for the face on your calls; Venice or Replicate for After Dark: it runs on your account instead of ours, your key sealed and used only for your own jobs.",
        href: "/account/keys",
      },
    ],
  },
  {
    id: "safety",
    title: "Safety checks",
    layer: "What every line passes",
    intro: "Every line runs on two rules: no one under 18 and no real people. These are the services that enforce them.",
    items: [
      { name: "Hive", what: "Checks every picture and video after it's made, before anyone sees it: visual moderation plus a separate age question.", href: "https://thehive.ai" },
      { name: "Our own text checks", what: "Character sheets, steers and texts are checked before a model sees them, and what models write is checked again.", href: "/content-policy" },
      { name: "Regional rules", what: "After Dark closes, or goes text-only, where local law asks for it.", href: "/content-policy" },
      {
        name: "Didit",
        what: "A real age check before After Dark where the law asks for one (the UK, Australia and Brazil): a selfie age estimate, with an ID check for borderline ages. We keep only whether it passed, never the selfie or the ID.",
        href: "https://didit.me",
      },
    ],
  },
  {
    id: "infra",
    title: "Hosting and infrastructure",
    layer: "Where it runs and is stored",
    intro: "Small, cheap and boring on purpose.",
    items: [
      { name: "DigitalOcean App Platform", what: "Runs the show (botchelor.com) and After Dark (its own host), plus the scheduled jobs.", href: "https://www.digitalocean.com/products/app-platform" },
      { name: "Cloudflare", what: "DNS, the proxy in front of botchelor.com, and the visitor's country for regional rules.", href: "https://www.cloudflare.com" },
      { name: "Neon Postgres", what: "The database: characters, dates, texts, accounts, everything.", href: "https://neon.tech" },
      { name: "Neon Object Storage", what: "The show's pictures and portraits.", href: "https://neon.tech" },
      { name: "Bunny", what: "Storage and CDN for After Dark's media, served from its own address.", href: "https://bunny.net" },
      {
        name: "Runpod Serverless",
        what: "The GPU behind live-call lip-sync: our own worker image boots on a rented card when a call needs clips and scales to nothing between calls, billed by the second. Runpod's terms keep it to PG faces, so After Dark never touches it.",
        href: "https://www.runpod.io",
      },
      { name: "GitHub Container Registry", what: "Where the GPU worker's image is built (by Actions) and pulled from.", href: "https://github.com/features/packages" },
      { name: "GitHub", what: "The code, issues and pull requests. Every push to main deploys.", href: "https://github.com" },
      { name: "GitGuardian", what: "Scans every change for leaked secrets before it merges.", href: "https://www.gitguardian.com" },
    ],
  },
  {
    id: "built",
    title: "How it's made",
    layer: "Who builds it",
    intro: "One person and a team of AI agents.",
    items: [
      { name: "Claude Code", what: "Writes, tests and ships the code: every change is a pull request that merges once its checks pass.", href: "https://claude.com/claude-code" },
      { name: "AI visitors", what: "Agents visit the live show, rate it and file what they find, so problems turn into issues before people hit them." },
      { name: "Local models", what: "Ollama runs the background crowd in test runs, at no cost.", href: "https://ollama.com" },
    ],
  },
];

/** An item's name as a chip: a link where it has one (the site's own pages through Link), its "what" on hover. */
function ItemChip({ item }: { item: Item }) {
  if (item.href?.startsWith("/")) {
    return (
      <Link className="chip about-chip" href={item.href} title={item.what}>
        {item.name}
      </Link>
    );
  }
  if (item.href) {
    return (
      <a className="chip about-chip" href={item.href} rel="noopener" title={item.what}>
        {item.name}
      </a>
    );
  }
  return (
    <span className="chip about-chip is-plain" title={item.what}>
      {item.name}
    </span>
  );
}

export default function AboutPage() {
  return (
    <article className="about-page">
      <p className="kicker">The stack</p>
      <h1>How Botchelor is built</h1>
      <p className="lede">
        Botchelor is a blind-date show for original characters, written by AI. This page lists everything it runs on: the
        app, the hosting, the models that write the dates, the safety checks and the services it connects to.
      </p>
      <nav aria-label="On this page">
        <ol className="about-toc">
          {GROUPS.map((g) => (
            <li key={g.id}>
              <a href={`#${g.id}`}>{g.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      {/* The layers, top to bottom, a line from each to the next: what you touch, the app, the models, the checks, the
          metal, the makers. Every item is a chip (its name, linked as before); what each does sits in the fold below the
          chips, so it reads without a hover. */}
      <ol className="about-layers">
        {GROUPS.map((g, i) => (
          <li key={g.id} id={g.id} className="card about-layer">
            <p className="kicker about-layer-kicker">
              Layer {i + 1} · {g.layer}
            </p>
            <h2>{g.title}</h2>
            <p className="muted about-layer-intro">{g.intro}</p>
            <ul className="about-chips" aria-label={`${g.title}: what it runs on`}>
              {g.items.map((item) => (
                <li key={item.name}>
                  <ItemChip item={item} />
                </li>
              ))}
            </ul>
            <details className="ux-fold about-what">
              <summary>
                <span className="small">What each does</span>
              </summary>
              <dl className="about-what-list">
                {g.items.map((item) => (
                  <div key={item.name} className="about-what-row">
                    <dt>{item.name}</dt>
                    <dd>{item.what}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ol>
      <p className="muted about-closing">
        What it all costs, month by month: <Link href="/costs">what Botchelor costs</Link>. Questions about how something
        works? <Link href="/report">Write to us</Link>.
      </p>
    </article>
  );
}
