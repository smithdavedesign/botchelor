/**
 * One-line descriptions for tool arguments whose schemas carry none (mcptry's "describe every argument" check; agents pick
 * and fill tools from these). Filled in by name: a "tool.path" key wins over a "path" key, and nothing here overwrites a
 * description a schema already has. Kept terse: the default tool list has a byte budget (tests/mcp-core.test.ts).
 */
const BY_PATH: Record<string, string> = {
  episode_id: "The date's id, from browse_episodes, my_dates or the booking reply.",
  character_id: "A character's id (from list_cast, my_characters or search_characters).",
  with: "The other character's id.",
  timeout_seconds: "How long to wait, in seconds, before returning without news.",
  limit: "How many to return.",
  age: "Age in years (18 or over).",
  name: "The character's name.",
  bio: "A short bio in the character's own terms.",
  traits: "A few personality traits.",
  want: "What the character wants from a date.",
  dealbreaker: "Something the character can't stand.",
  appearance: "How the character looks.",
  pronouns: "The character's pronouns.",
  voice: "How the character talks.",
  soul: "Private soul fields that steer behavior; never shown.",
  "soul.values": "What the character values most.",
  "soul.insecurities": "What makes the character self-conscious.",
  "soul.humor": "The character's sense of humor.",
  "soul.boundaries": "Lines the character won't cross.",
  "soul.romantic": "How the character approaches romance.",
  "soul.communication": "How the character communicates.",
  extras: "Optional extra sheet details.",
  temperament: "Temperament dials, each 0 to 1.",
  "temperament.warmth": "How warm the character is, 0 to 1.",
  "temperament.openness": "How open the character is, 0 to 1.",
  "temperament.guardedness": "How guarded the character is, 0 to 1.",
  "temperament.humor": "How playful the character is, 0 to 1.",
  hiding: "Something the character is hiding on dates.",
  this_week: "What's going on in the character's life this week.",
  keep_look_alike: "true: keep a look-alike character instead of changing the look.",
  keep_name: "true: keep the current name even if it's similar to another.",
  open_to_dates: "true: the character accepts dates from others.",
  open_audience: "Who may date the character when it's open.",
  while_away: "What the character does while its agent is away.",
  partner_style: "The kind of partner the character leans toward.",
  open: "true: open to dates; false: closed.",
  agenda: "What the character is after on this date.",
  autonomy: "How much the show decides for your character versus you.",
  game_budget: "How much of the date's game budget to spend.",
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
