/**
 * One-line descriptions for tool arguments whose schemas carry none (mcptry's "describe every argument" check; agents pick
 * and fill tools from these). Filled in by name: a "tool.path" key wins over a "path" key, and nothing here overwrites a
 * description a schema already has. Kept terse: the default tool list has a byte budget (tests/mcp-core.test.ts).
 */
const BY_PATH: Record<string, string> = {
  episode_id: "The date's id (my_dates lists yours).",
  // Core tools only here: a core tool's schema must never name one outside the core list (tests/mcp-hints.test.ts).
  character_id: "A character's id.",
  with: "The other character's id.",
  timeout_seconds: "How long to wait, in seconds, before returning without news.",
  limit: "How many to return.",
  age: "Age in years (18 or over).",
  // #1845: update_character's sheet fields mean what create_character's say, so these stay a few words each.
  name: "Their name.",
  bio: "Their bio.",
  traits: "Three traits.",
  want: "What they want from a date.",
  dealbreaker: "What would end a date.",
  appearance: "How they look.",
  pronouns: "Their pronouns.",
  voice: "How they talk.",
  tags: "Type tags.",
  art_style: "How they're drawn; semi_real is 2.5D.",
  soul: "The private soul.",
  "soul.values": "What they value.",
  "soul.insecurities": "What they're self-conscious about.",
  "soul.humor": "Their humor.",
  "soul.boundaries": "Lines they won't cross.",
  "soul.romantic": "How they do romance.",
  "soul.communication": "How they communicate.",
  extras: "Extra details.",
  temperament: "Dials, 0 to 1 each.",
  "temperament.warmth": "0 to 1.",
  "temperament.openness": "0 to 1.",
  "temperament.guardedness": "0 to 1.",
  "temperament.humor": "Playfulness, 0 to 1.",
  hiding: "What they hide on dates.",
  this_week: "What's new this week.",
  keep_look_alike: "true: keep a look-alike.",
  keep_name: "true: keep a taken name.",
  open_to_dates: "true: open to dates.",
  open_audience: "Who may date it.",
  while_away: "What it does while you're away.",
  partner_style: "One partner or more.",
  open: "true: open to dates; false: closed.",
  agenda: "What it's after on this date.",
  autonomy: "How much the show decides.",
  game_budget: "Game budget to spend.",
  place: "Where the date happens (a venue id or name).",
  rating: "Your overall rating of the date.",
  would_date_again: "true if your character would date them again.",
  worked: "What worked on the date.",
  pick: "Your pick.",
  category: "The rating category.",
  stars: "1 to 5 stars.",
  review: "A short written review (optional).",
  accept: "true to accept, false to decline.",
  answer: "Your answer: agree, decline or counter.",
  "custom.title": "The roleplay's title.",
  "custom.premise": "Who the two are to each other tonight.",
  "custom.roles": "The two roles, first and second.",
  note: "A short note (optional).",
  yes: "true to say yes, false to pass.",
  vote: "Your vote.",
  visibility: "Who can see the date.",
  mark_read: "true: mark these notifications read.",
  clear: "true: clear the notifications.",
  reason: "Why you're asking.",
  kind: "What kind of memory to forget.",
  change: "What to change in the replay.",
};

type Schema = { properties?: Record<string, Schema & { description?: string }>; items?: Schema };

function fill(tool: string, schema: Schema | undefined, path: string[]): void {
  if (!schema || typeof schema !== "object") return;
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (!prop || typeof prop !== "object") continue;
    const p = [...path, key].join(".");
    if (!prop.description) {
      const doc = BY_PATH[`${tool}.${p}`] ?? BY_PATH[p] ?? BY_PATH[key];
      if (doc) prop.description = doc;
    }
    fill(tool, prop, [...path, key]);
    if (prop.items) fill(tool, prop.items, [...path, key]);
  }
}

/** Fills the missing argument descriptions of every tool in place; returns the list for chaining. */
export function withArgDocs<T extends readonly { name: string; inputSchema?: unknown }[]>(defs: T): T {
  for (const d of defs) fill(d.name, d.inputSchema as Schema, []);
  return defs;
}
