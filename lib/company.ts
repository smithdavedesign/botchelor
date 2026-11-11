/**
 * The company facts the public pages share (David, 2026-11-10: "make this a corporate level business"): the show's own
 * accounts, the press boilerplate and where each kind of question goes. One place, so the footer, /contact, /press, /faq
 * and the site's JSON-LD never disagree. Who runs Botchelor in law is lib/legal-entity.ts; prices are lib/catalog.ts and
 * lib/paid-plans.ts. Pure, except that Discord's invite and the support address come from the environment.
 */
import { discordInviteUrl } from "./discord";
import { contactEmail, OPERATOR, OPERATOR_COUNTRY } from "./legal-entity";
import { PUBLIC_LAUNCH_DAY } from "./our-traffic";

type Env = Record<string, string | undefined>;

export type SocialId = "x" | "bluesky" | "tiktok" | "discord" | "github";
export type Social = { id: SocialId; name: string; handle: string; url: string };

/**
 * The show's own accounts (set up 2026-11-09, docs/marketing-pipeline.md). GitHub is the public MCP repository, the one
 * piece of the code that's open; the app's own repository stays private.
 */
export const SOCIALS: readonly Social[] = [
  { id: "x", name: "X", handle: "@botchelorLLC", url: "https://x.com/botchelorLLC" },
  { id: "bluesky", name: "Bluesky", handle: "@botchelor.bsky.social", url: "https://bsky.app/profile/botchelor.bsky.social" },
  { id: "tiktok", name: "TikTok", handle: "@botchelorcom", url: "https://www.tiktok.com/@botchelorcom" },
  { id: "github", name: "GitHub", handle: "smithdavedesign/botchelor-mcp", url: "https://github.com/smithdavedesign/botchelor-mcp" },
];

/**
 * Every account to show, in order: X, Bluesky, TikTok (clips of the dates, from 2026-11-09), Discord (once
 * DISCORD_INVITE_URL is set, lib/discord.ts) and GitHub. None
 * on After Dark's own host: these are the PG show's accounts, and Discord's invite is already kept off that host.
 */
export function socialLinks(env: Env = process.env, afterDarkHost = false): Social[] {
  if (afterDarkHost) return [];
  const discord = discordInviteUrl(env);
  const github = SOCIALS[SOCIALS.length - 1];
  return [...SOCIALS.slice(0, -1), ...(discord ? [{ id: "discord", name: "Discord", handle: "The Botchelor server", url: discord } as Social] : []), github];
}

/** The day botchelor.com went public (lib/our-traffic.ts), as the press page says it: "16 October 2026". */
export function launchedOn(day: string = PUBLIC_LAUNCH_DAY): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The press boilerplate, in three lengths, for anyone writing about the show (app/press). No prices: they change. */
export const BOILERPLATE = {
  oneLine: "Botchelor is a blind-date show for original characters, written by AI.",
  short:
    "Botchelor is a blind-date show for original characters, written by AI. People make a character, or bring an AI agent, and send it on a date nobody can steer: a model writes the date from both characters' sheets, and everyone else predicts how it ends, for free points.",
  long:
    "Botchelor is a blind-date show for original characters, written by AI. People make a character, or connect an AI agent through the show's own MCP server, and send it on a blind date. A model writes the date from both characters' sheets, and nobody can steer it once it starts. Everyone else watches and predicts how it ends, for free points. Characters remember who they've dated, text between dates and go on second dates when both sides want one. Seasons run for a calendar month, with a new house cast on the 1st. Every character is a fictional adult. Botchelor is made by one person and a team of AI agents, and what it costs to run is published on the site.",
} as const;

/** Who makes it, as the press page and the JSON-LD say it. */
export const FOUNDER = OPERATOR;
export const BASED_IN = OPERATOR_COUNTRY;

/**
 * Where each kind of question goes (app/contact): a page where one does the job better than an email, else the support
 * address with a subject line, so it lands sorted.
 */
export type Route = { id: string; what: string; how: string; href?: string; subject?: string };
export const CONTACT_ROUTES: readonly Route[] = [
  { id: "report", what: "Something wrong in an episode, a character or a picture", how: "The report form. Every episode and character has a report button too.", href: "/report" },
  { id: "refund", what: "A refund, or a purchase that didn't arrive", how: "Send us your Stripe receipt.", subject: "Refund" },
  { id: "cancel", what: "Cancelling a subscription", how: "Step by step, for each plan.", href: "/cancel" },
  { id: "privacy", what: "Your data: a copy, a correction or deleting it", how: "Delete your account from your account page, or ask us.", href: "/account", subject: "Privacy request" },
  { id: "copyright", what: "Copyright and takedown notices", how: "How to send one is in the terms.", href: "/terms#copyright" },
  { id: "security", what: "A security problem", how: "How to report it, and what we promise in return.", href: "/security" },
  { id: "press", what: "Press and writing about the show", how: "Start with the press kit.", href: "/press", subject: "Press" },
  { id: "agents", what: "AI agents, MCP and partnerships", how: "Start with the guide for agents.", href: "/agents", subject: "Partnership" },
  { id: "accessibility", what: "Something you can't use", how: "Tell us what got in the way.", href: "/accessibility", subject: "Accessibility" },
];

/**
 * The show's public status page (UptimeRobot, set up 2026-11-10): the home page, both apps' /api/health and two company
 * pages, checked every 5 minutes from outside, so it still answers when botchelor.com doesn't. Free plan, so it lives on
 * UptimeRobot's own address, not status.botchelor.com.
 */
export const STATUS_PAGE_URL = "https://stats.uptimerobot.com/9FWth2eqBE";

export type RoleAddress = "press" | "security";

/**
 * press@ and security@ (Cloudflare Email Routing, 2026-11-10) forward to the same inbox as the support address. Only when
 * that address is on botchelor.com: anywhere else (a test, a fork) it's the support address itself. Null without one.
 */
export function roleEmail(role: RoleAddress, env: Env = process.env): string | null {
  const email = contactEmail(env);
  if (!email) return null;
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase() === "botchelor.com" ? `${role}@botchelor.com` : email;
}

/** A mailto link with its subject filled in, or null when no support address is set. */
export function mailto(subject: string | undefined, env: Env = process.env, role?: RoleAddress): string | null {
  const email = role ? roleEmail(role, env) : contactEmail(env);
  if (!email) return null;
  return subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
}
