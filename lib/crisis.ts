/**
 * The self-harm protocol (New York's AI companion law, since 2025-11-05; California SB 243, since 2026-01-01;
 * docs/after-dark-legal-review.md "Other laws"; published at /safety and in docs/safety-protocol.md).
 *
 * Where a person types to or about characters (a text's nudge in the thread, a standing note, a date's note, an After
 * Dark steer or whisper, send_text and the After Dark tools over MCP), their own words are checked against a small,
 * conservative list of phrases that clearly say they want to hurt or kill themselves. On a hit, the reply carries
 * `crisis_resources` and the page shows them: US 988 (call or text), UK & Ireland Samaritans 116 123, anywhere else
 * findahelpline.com. The request itself goes on as it would have (nobody is blocked for saying how they feel).
 *
 * Only the person's own words are checked, never a line a model wrote, so a character's dramatic line ("I could die of
 * embarrassment") never fires it, and figures of speech that only sound like it ("I'd kill for a coffee", "dying to
 * see you", "a suicide mission") are left out on purpose. Nothing about the person is recorded: one anonymous counter
 * event (track "crisis_notice_shown", with the surface and nothing else: no id, no words).
 */
import { track } from "./analytics";

export type CrisisLine = { region: string; how: string; href: string };
export type CrisisResources = {
  message: string;
  lines: CrisisLine[];
  /** The published protocol (app/safety/page.tsx). */
  protocol: string;
};

export const CRISIS_RESOURCES: CrisisResources = {
  message:
    "It sounds like you might be going through something hard. You're talking with AI characters, not a person, and they can't help with this, but people can, for free, any time:",
  lines: [
    { region: "US", how: "Call or text 988 (988 Suicide & Crisis Lifeline)", href: "https://988lifeline.org" },
    { region: "UK & Ireland", how: "Call Samaritans on 116 123", href: "https://www.samaritans.org" },
    { region: "Anywhere else", how: "Find a free helpline in your country at findahelpline.com", href: "https://findahelpline.com" },
  ],
  protocol: "/safety",
};

/** Where the words were typed: the counter event's only property. */
export type CrisisSurface = "text_hint" | "nudge_note" | "date_note" | "after_dark_steer" | "after_dark_whisper" | "mcp_send_text" | "mcp_after_dark";

/**
 * The phrases, each a clear first-person statement of intent or an unambiguous term. Matched on words, case and
 * apostrophes ignored. Conservative on purpose: a miss is better covered by the footer's crisis links (on every page)
 * than a notice that fires on ordinary flirting.
 */
const PATTERNS: RegExp[] = [
  /\b(kill|killing|killed|hurt|hurting|harm|harming|cut|cutting) (myself|my self)\b/,
  /\b(end|ending|take|taking) (my|my own) life\b/,
  /\b(i|im|i am|i really|i just|i kinda|i kind of|i sometimes|sometimes i) (want|wanna|wish|want to|need) (to )?(die|be dead|not be here|not exist|not wake up)\b/,
  /\bi (want|wanna) to die\b/,
  /\b(i dont|i do not) want to (live|be alive|be here anymore|exist)\b/,
  /\bno reason to (live|go on|keep going)\b/,
  /\bself[- ]?harm(ing)?\b/,
  /\bsuicid(e|al)\b/,
];

/** Figures of speech that contain a pattern's words but aren't about hurting oneself. */
const NOT_CRISIS: RegExp[] = [
  /\bsuicide (squad|mission|missions|run|runs|doors|door|king|kings|pass|lane|squeeze|blonde)\b/,
  /\b(die|be dead) (of|from) (embarrassment|laughter|laughing|boredom|shame|cuteness|jealousy)\b/,
  /\b(want|wanna) to die (laughing|of)\b/,
];

const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a person's own text clearly says they want to hurt or kill themselves. */
export function crisisIntent(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = normal(text);
  if (!t) return false;
  const hit = PATTERNS.some((p) => p.test(t));
  if (!hit) return false;
  // A hit is let go only when every match is one of the figures of speech.
  const stripped = NOT_CRISIS.reduce((s, p) => s.replace(new RegExp(p.source, "g"), " "), t);
  return PATTERNS.some((p) => p.test(stripped));
}

/**
 * The resources when any of a person's own texts trips the check (and the one anonymous counter event), else null.
 * Pass only what the person typed, never a model's line.
 */
export function crisisCheck(surface: CrisisSurface, ...texts: (string | null | undefined)[]): CrisisResources | null {
  if (!texts.some(crisisIntent)) return null;
  track("crisis_notice_shown", { surface });
  return CRISIS_RESOURCES;
}

/** `{ crisis_resources }` to spread into a reply when the check trips, else nothing. */
export const crisisField = (resources: CrisisResources | null): { crisis_resources?: CrisisResources } => (resources ? { crisis_resources: resources } : {});

/** A JSON response with `crisis_resources` added (any status: a refused request still shows the help). */
export async function withCrisis(res: Response, resources: CrisisResources | null): Promise<Response> {
  if (!resources || !/json/i.test(res.headers.get("content-type") ?? "")) return res;
  const body = (await res.clone().json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ ...(body as Record<string, unknown>), crisis_resources: resources }), { status: res.status, headers });
}

/**
 * A route handler that checks the person's own words in its JSON body (picked by `words`) and adds the resources to
 * whatever it answers. The body is read from a copy, so the handler reads it as before.
 */
export function crisisAware<C extends unknown[]>(
  surface: CrisisSurface | ((body: Record<string, unknown>) => CrisisSurface),
  words: (body: Record<string, unknown>) => (string | null | undefined)[],
  handler: (req: Request, ...ctx: C) => Promise<Response>,
): (req: Request, ...ctx: C) => Promise<Response> {
  return async (req: Request, ...ctx: C) => {
    let resources: CrisisResources | null = null;
    try {
      const body = /^application\/json\b/i.test(req.headers.get("content-type") ?? "") ? ((await req.clone().json()) as unknown) : null;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const b = body as Record<string, unknown>;
        const texts = words(b).filter((w): w is string => typeof w === "string");
        if (texts.length) resources = crisisCheck(typeof surface === "function" ? surface(b) : surface, ...texts);
      }
    } catch {
      /* not JSON: the handler answers that */
    }
    return withCrisis(await handler(req, ...ctx), resources);
  };
}

/** A string field of an unknown value, or undefined. */
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
