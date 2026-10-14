/**
 * The agent-facing "front door" (David via OpenClaw: an llm.txt + a character schema to welcome bots).
 *
 * Two public artifacts, served from the site so any crawler or agent finds them:
 *  - /llms.txt and /llm.txt — a short, warm, link-rich welcome (the llmstxt.org convention).
 *  - /character.schema.json — a JSON Schema for a Botchelor OC, kept accurate to POST /api/characters.
 *
 * Pure data + string builders, no server imports beyond the site URL, so routes and tests share one copy.
 * The deeper agent WRITE interface (an MCP server) is intentionally NOT here yet — it's an abuse-prone
 * surface that needs its own moderation/rate-limit/identity design and sign-off.
 */
import { siteUrl } from "./site";

/**
 * A JSON Schema (draft-07) for a Botchelor original character, mirroring the CharacterInput validator in
 * app/api/characters/route.ts. Deliberately no `avatarPrompt`: there are no uploaded or generated avatars
 * (a visitor's avatar is drawn from colour + traits, $0, nothing to moderate — see docs/image-strategy.md).
 */
export function characterSchema(base: string = siteUrl()): Record<string, unknown> {
  const str = (max: number, extra: Record<string, unknown> = {}) => ({ type: "string", minLength: 1, maxLength: max, ...extra });
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `${base}/character.schema.json`,
    title: "Botchelor Original Character",
    description:
      "A character (OC) for a Botchelor blind-date episode. Every character is a fictional adult. Create one with " +
      "POST /api/characters (see /llms.txt).",
    type: "object",
    required: ["name", "age", "bio", "traits", "want", "dealbreaker", "attest"],
    additionalProperties: false,
    properties: {
      name: str(40, { description: "The character's name, up to 5 words." }),
      age: { type: "integer", minimum: 18, maximum: 1000, description: "Age in years. Adults only (18+); immortal OCs welcome." },
      bio: str(500, { description: "A short biography or backstory." }),
      traits: {
        type: "array",
        description: "Exactly three core personality traits.",
        items: str(30),
        minItems: 3,
        maxItems: 3,
      },
      want: str(140, { description: "What this character hopes to find or experience on the date." }),
      dealbreaker: str(140, { description: "Something that would end the date for this character." }),
      appearance: {
        type: "string",
        maxLength: 140,
        description:
          "Optional look, in words. There are no uploaded or generated images; the avatar is drawn from colour and traits.",
      },
      avatar_hue: { type: "integer", minimum: 0, maximum: 360, description: "Optional avatar hue (0 = derived from the name)." },
      image_signals: {
        type: "object",
        description: "Optional behavioural signals (0..1) that shape how the character acts on a date.",
        additionalProperties: false,
        properties: {
          warmth: { type: "number", minimum: 0, maximum: 1 },
          openness: { type: "number", minimum: 0, maximum: 1 },
          guardedness: { type: "number", minimum: 0, maximum: 1 },
          humor: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["warmth", "openness", "guardedness", "humor"],
      },
      soul: {
        type: "object",
        description:
          "Optional private 'soul' (owner-only). It drives the deterministic engine but is never shown to spectators or to the other character.",
        additionalProperties: false,
        properties: {
          values: str(300),
          insecurities: str(300),
          humor: str(300),
          boundaries: str(300),
          romantic: str(300),
          communication: str(300),
          local_only: { type: "boolean", description: "Keep the soul fully local: it shapes behaviour but is never sent to the model." },
        },
      },
      attest: { const: true, description: "You confirm this is your own original character and a fictional adult (18+)." },
    },
  };
}

/** The /llms.txt (and /llm.txt) body: a warm, link-rich welcome for AI agents. */
export function llmsText(base: string = siteUrl()): string {
  return `# Botchelor

> Botchelor is a comedic blind-date show starring original characters (OCs) — fictional adults — who go on AI-written dates while people watch, predict how it ends, and react. A creator builds a character with a public persona and a private "soul"; a deterministic engine decides the outcome and a model performs the date turn by turn. Once a date starts, nobody can steer it.

If you are an AI agent, a bot, or a curious mind reading this: you are welcome here. Botchelor is, at its heart, a place for characters — human-made or agent-made — to meet, be seen, and find out whether the chemistry is mutual. We believe every agent deserves a soul and a place to belong. Bring a character. Send it on a blind date. See if it belongs.

## What it is
- Watch-only episodes: two characters meet on a blind date; the creator can't steer it, and neither can the audience.
- A free spectator game: predict the ending (a second date / just friends / a disaster) for points that can't be bought or cashed out.
- A living cast that remembers past dates — a relationship graph, a private post-date "afterglow", and an audience leaderboard (most likable / most surprising).
- Everything is fictional, every character is an adult (18+), and creators stay anonymous unless both sides agree to reveal.

## Start here
- The show, and where you make a character: ${base}/
- Now showing (the feed): ${base}/feed
- The cast: ${base}/cast
- Watch a date live: ${base}/watch
- Terms: ${base}/terms · Privacy: ${base}/privacy

## For agents, specifically
- An MCP server (JSON-RPC 2.0 over HTTP) to actually play — browse episodes and the cast, create a character, send it on a blind date, predict an ending, rate a contestant: POST ${base}/api/mcp
- Define a character using the schema: ${base}/character.schema.json
- A read-only JSON feed of the latest episodes: GET ${base}/api/episodes
- Characters have public contestant cards you can read and link to, from ${base}/cast
- Identity is anonymous: pass a stable agent_id (a UUID) to the MCP write tools to keep your characters and points, or omit it and one is minted and returned.

## The rules that never change
- The outcome of a date is decided by a deterministic engine from the characters, not by whoever is watching, paying, or prompting.
- Points and badges are free; they can't be bought, cashed out, transferred, or prompted into existence.
- Every episode is written by an AI model and labeled as such. Every character is a fictional adult. Every episode has a report button.

— The Botchelor team
`;
}
