/**
 * Who's a bot. Bots skip the 18+ gate: the gate is a self-attestation for people (lib/age.ts), and a crawler
 * or an AI agent can't tick a box. Letting them through is what makes the show indexable and readable by
 * agents. A visitor's answer to the gate never depended on the user agent, so a person spoofing one gains
 * nothing they couldn't get by clicking "yes".
 *
 * Pure and dependency-free so the middleware can import it.
 */

/** The robots.txt tokens of AI crawlers and assistants, welcomed by name in app/robots.ts. */
export const AI_ROBOTS_TOKENS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "meta-externalagent",
  "CCBot",
  "cohere-ai",
  "MistralAI-User",
  "DuckAssistBot",
  "YouBot",
] as const;

export type BotKind = "search" | "ai" | "social" | "agent" | "other";
export type Bot = { name: string; kind: BotKind };

/**
 * Known bots, matched case-insensitively against the User-Agent. Order matters only for the name reported:
 * the more specific token comes first (e.g. "Claude-User" before "ClaudeBot").
 */
const KNOWN: { pattern: RegExp; name: string; kind: BotKind }[] = [
  // AI assistants fetching on a person's behalf, and AI crawlers.
  { pattern: /ChatGPT-User/i, name: "ChatGPT-User", kind: "agent" },
  { pattern: /OAI-SearchBot/i, name: "OAI-SearchBot", kind: "ai" },
  { pattern: /GPTBot/i, name: "GPTBot", kind: "ai" },
  { pattern: /Claude-User/i, name: "Claude-User", kind: "agent" },
  { pattern: /Claude-SearchBot/i, name: "Claude-SearchBot", kind: "ai" },
  { pattern: /ClaudeBot/i, name: "ClaudeBot", kind: "ai" },
  { pattern: /anthropic-ai/i, name: "anthropic-ai", kind: "ai" },
  { pattern: /Perplexity-User/i, name: "Perplexity-User", kind: "agent" },
  { pattern: /PerplexityBot/i, name: "PerplexityBot", kind: "ai" },
  { pattern: /MistralAI-User/i, name: "MistralAI-User", kind: "agent" },
  { pattern: /DuckAssistBot/i, name: "DuckAssistBot", kind: "ai" },
  { pattern: /cohere-ai/i, name: "cohere-ai", kind: "ai" },
  { pattern: /YouBot/i, name: "YouBot", kind: "ai" },
  { pattern: /Amazonbot/i, name: "Amazonbot", kind: "ai" },
  { pattern: /meta-externalagent/i, name: "meta-externalagent", kind: "ai" },
  { pattern: /CCBot/i, name: "CCBot", kind: "ai" },
  { pattern: /Bytespider/i, name: "Bytespider", kind: "ai" },
  { pattern: /Diffbot/i, name: "Diffbot", kind: "ai" },
  // Search engines.
  { pattern: /Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google/i, name: "Googlebot", kind: "search" },
  { pattern: /bingbot|BingPreview/i, name: "Bingbot", kind: "search" },
  { pattern: /Applebot/i, name: "Applebot", kind: "search" },
  { pattern: /DuckDuckBot/i, name: "DuckDuckBot", kind: "search" },
  { pattern: /YandexBot|YandexMobileBot/i, name: "YandexBot", kind: "search" },
  { pattern: /Baiduspider/i, name: "Baiduspider", kind: "search" },
  { pattern: /Slurp/i, name: "Yahoo Slurp", kind: "search" },
  { pattern: /Qwantbot|SeznamBot|Naver|Yeti\//i, name: "search-other", kind: "search" },
  // Link unfurlers (social cards).
  { pattern: /facebookexternalhit|facebookcatalog|FacebookBot/i, name: "Facebook", kind: "social" },
  { pattern: /Twitterbot/i, name: "Twitterbot", kind: "social" },
  { pattern: /LinkedInBot/i, name: "LinkedInBot", kind: "social" },
  { pattern: /Slackbot|Slack-ImgProxy/i, name: "Slackbot", kind: "social" },
  { pattern: /Discordbot/i, name: "Discordbot", kind: "social" },
  { pattern: /WhatsApp/i, name: "WhatsApp", kind: "social" },
  { pattern: /TelegramBot/i, name: "TelegramBot", kind: "social" },
  { pattern: /redditbot/i, name: "redditbot", kind: "social" },
  { pattern: /Embedly|Iframely|vkShare|Pinterest/i, name: "unfurler", kind: "social" },
];

/**
 * Anything else that says what it is: a "…bot/1.0"-style token, a bot info link ("+http…"), a crawler or
 * spider, or an HTTP library an agent runs on. "bot" must be followed by a version or separator, so a phone
 * model like "CUBOT P20" isn't mistaken for one.
 */
const GENERIC =
  /bot[/;+)-]|\+https?:\/\/|crawler|spider|scraper|headlesschrome|python-requests|python-httpx|python-urllib|aiohttp|node-fetch|undici|axios\/|go-http-client|okhttp|curl\/|wget\//i;

/**
 * The bot behind a request, or null for a person. `signatureAgent` is the HTTP Message Signatures
 * `Signature-Agent` header that browser agents (e.g. ChatGPT's agent) send to identify themselves while
 * using a normal browser user agent.
 */
export function detectBot(userAgent: string | null | undefined, signatureAgent?: string | null): Bot | null {
  const ua = (userAgent ?? "").trim();
  if (signatureAgent && signatureAgent.trim()) {
    const host = signatureAgent.replace(/^"|"$/g, "").replace(/^https?:\/\//, "").split("/")[0].slice(0, 60);
    return { name: host || "signed-agent", kind: "agent" };
  }
  if (!ua) return null;
  for (const k of KNOWN) if (k.pattern.test(ua)) return { name: k.name, kind: k.kind };
  if (GENERIC.test(ua)) return { name: genericName(ua), kind: "other" };
  return null;
}

/** A short, log-safe label for an unlisted bot: its first product token, e.g. "python-httpx/0.27" → "python-httpx". */
function genericName(ua: string): string {
  const first = ua.split(/[\s;()]+/).find((t) => t.includes("/")) ?? ua.split(/\s+/)[0] ?? "bot";
  return first.split("/")[0].replace(/[^\w.-]/g, "").slice(0, 40) || "bot";
}
