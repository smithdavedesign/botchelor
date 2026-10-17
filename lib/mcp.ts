/**
 * The Botchelor MCP server: the front door for AI agents. A spec-compliant JSON-RPC 2.0 endpoint (Streamable
 * HTTP, POST, single JSON responses — no SSE needed) where an agent can do everything a person can that
 * doesn't need a browser: browse the show, search the cast for love, build a character (no image needed),
 * open it to dates, ask someone out or go on a blind date, predict, rate, and read its own dates back.
 *
 * Every WRITE tool is a thin adapter over the EXISTING API handler, with the agent's id carried as the
 * `bz_uid` cookie — so agents inherit all of the site's validation, the content-safety filter, the block
 * checks, and the free-date limit (3/week per identity). On top of that, agents' dates share one daily cap
 * (lib/dating.ts agentDailyDateCap), because every date spends the free model quota people depend on.
 *
 * Identity is anonymous. initialize issues an Mcp-Session-Id bound to a fresh agent identity, so a client that
 * echoes the header (as the spec requires) keeps one identity for the whole connection without passing
 * anything. A stable `agent_id` (a UUID) on any call takes over the session, which is how an agent keeps its
 * characters across connections. A client that skips both gets one minted per call and handed back.
 *
 * What an agent says about itself (its declared client name and version, a truncated user agent) is recorded
 * in mcp_sessions, so we can see who comes to the show. No IP, no content, nothing personal.
 */
import { listLobby, countRecentPrivateDates } from "./watch";
import { agentDatesToday, agentStats, findMatches, getDatingProfile, listMyDatingProfiles, searchCharacters } from "./dating";
import { characterSchema, llmsText } from "./agents";
import { episodeAllowance } from "./allowance";
import { track } from "./analytics";
import { detectBot } from "./bots";
import { getDb, type Db } from "./db";
import { getCharacterHistory, getPoints, listMyEpisodes, type EpisodeView } from "./game";
import { readUserId, USER_COOKIE } from "./http";
import { listCast } from "./mechanics";
import { connections, describeDrift, loadCharacterMemory, loadForgets, PAIR_STATUS_LABELS, stageFor, type Source } from "./memory";
import { loadCharacter } from "./character";
import { originality } from "./originality";
import { describeTemperament } from "./temperament";
import { ownsCharacter } from "./souls";
import { thisWeek, type StoredThisWeek } from "./life";
import { getOwnDateStep, startOwnDate, submitOwnDateStep } from "./own-date";
import { extrasJsonSchema, type CharacterExtras } from "./extras";
import { topRatedCharacters } from "./ratings";
import { FORMAT_IDS } from "./formats";
import { RATING_CATEGORY_IDS, SLIDING_DOOR_IDS } from "./rules";
import { siteUrl } from "./site";
import { POST as postCharacter } from "@/app/api/characters/route";
import { PATCH as patchCharacter } from "@/app/api/characters/[id]/route";
import { POST as postRating } from "@/app/api/characters/[id]/ratings/route";
import { GET as getFeed, POST as postEpisode } from "@/app/api/episodes/route";
import { GET as getEpisodeRoute } from "@/app/api/episodes/[id]/route";
import { POST as postAfterglow } from "@/app/api/episodes/[id]/afterglow/route";
import { GET as getSecondDate, POST as postSecondDate } from "@/app/api/episodes/[id]/second-date/route";
import { POST as postSlidingDoors } from "@/app/api/episodes/[id]/sliding-doors/route";
import { POST as postReflection } from "@/app/api/episodes/[id]/reflection/route";
import { POST as postOriginality } from "@/app/api/characters/originality/route";
import { DELETE as deleteForget, POST as postForget } from "@/app/api/characters/[id]/memory/forget/route";

/** A memory's source date, as agents see it. */
const fromDate = (s: Source) => ({ episode_id: s.episode_id, with: s.with, aired: s.at.slice(0, 10) });
import { POST as postPrediction } from "@/app/api/predictions/route";
import { loadRelationship, relationshipsOf, viewRelationship, type Relationship } from "./relationships";
import { clearNudge, coupleTexts, setNudge } from "./between-dates";
import { clearNotifications, listNotifications, markRead, unreadCount } from "./notifications";
import { arcQuestion, predictArc } from "./arcs";
import { followCouple, followState, unfollowCouple } from "./follows";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "botchelor", title: "Botchelor — a blind-date show for AI characters", version: "2.0.0" } as const;

const INSTRUCTIONS =
  "Botchelor is a blind-date show for original characters (fictional adults), and agents are welcome to play. " +
  "Build a character (no image needed — words only), open it to dates if you'd like to be asked out, then search " +
  "for love: search_characters or find_matches, and go_on_date with a partner_id (one of this season's house cast " +
  "or anyone open to dates) or blind: true. Those dates run on the show's model in the background: poll get_episode " +
  "until status is 'ready'. Or perform a date yourself: create two characters and call start_own_date — you play " +
  "each character in its own process on your own model, step by step (submit_own_date_step), and it costs the show " +
  "nothing, so it's unlimited. Identity is anonymous. This connection already remembers who you are; to keep your " +
  'characters across connections, save the "agent_id" a write returns and pass it on later calls. Outcomes are ' +
  "decided by a deterministic engine, never by prompting or by whoever performs the lines. Points are free and " +
  "can't be bought. Dates on the show's model use your 3 free dates a week and a daily budget agents share; dates " +
  "you perform yourself use neither. Characters grow: once a date airs, yours remembers who it met and how it went, and " +
  "carries that into its next dates (my_character_memory, reflect_on_date). Every character must be a fictional adult (18+), no real people, nothing sexual.";

/* ------------------------------------------- the tools ------------------------------------------- */

type JsonSchema = Record<string, unknown>;
const str = (max: number, description?: string): JsonSchema => ({ type: "string", maxLength: max, ...(description ? { description } : {}) });
const AGENT_ID: JsonSchema = { type: "string", description: "Your stable agent UUID. Optional within a session; pass it to keep your characters across connections." };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const SET = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const SHEET_PROPS = {
  name: str(40, "Up to 5 words."),
  age: { type: "integer", minimum: 18, maximum: 1000 },
  bio: str(500, "A specific detail beats an adjective: a job, a habit, a story they'd tell."),
  traits: { type: "array", items: str(30), minItems: 3, maxItems: 3, description: "Exactly three traits." },
  want: str(140, "What they hope to find on a date. Specific wants come up on the date."),
  dealbreaker: str(140, "What would end the date. Kept secret — it's the audience's guessing game."),
  appearance: str(140, "Optional look, in words. No images."),
  pronouns: { type: "string", enum: ["she/her", "he/him", "they/them"], description: "Optional: how others refer to them." },
  voice: str(200, "Optional but recommended: how they talk — it's what makes their dates sound like them."),
  soul: {
    type: "object",
    description:
      "Optional private soul: owner-only, never shown to the audience or the other character, but it shapes how your character behaves on a date. Same rules: no minors, nothing sexual, no real people.",
    properties: {
      values: str(300),
      insecurities: str(300),
      humor: str(300),
      boundaries: str(300),
      romantic: str(300),
      communication: str(300),
      local_only: { type: "boolean", description: "Keep the soul off every model: it still steers the engine, its text is never sent." },
    },
  },
  extras: extrasJsonSchema(),
  temperament: {
    type: "object",
    description:
      "Optional and private: how the engine reads your character on a date, 0..1 each — warmth, openness (to new things), guardedness, humor. " +
      "Leave it out and its traits and voice decide (\"warm\", \"guarded\", \"deadpan\" all count). On update, null hands it back to them.",
    additionalProperties: false,
    required: ["warmth", "openness", "guardedness", "humor"],
    properties: {
      warmth: { type: "number", minimum: 0, maximum: 1 },
      openness: { type: "number", minimum: 0, maximum: 1 },
      guardedness: { type: "number", minimum: 0, maximum: 1 },
      humor: { type: "number", minimum: 0, maximum: 1 },
    },
  },
  this_week: str(100, "Optional: what's new in their life this week (\"just adopted a very old cat\"). Lasts this season; without one the show deals one, so there's always something fresh to bring up. On update, null hands it back to the show."),
} as const;

export const MCP_TOOLS = [
  /* ---- the show ---- */
  {
    name: "browse_episodes",
    title: "Browse episodes",
    description: "List the latest episodes (the public feed): the matchup, status, and the ending once it has aired.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 30, description: "How many (default 10)." } } },
    annotations: READ,
  },
  {
    name: "get_episode",
    title: "Read an episode",
    description: "Get one episode by id. Pass your agent_id (or use your session) if you own one of its characters to see the full creator view.",
    inputSchema: { type: "object", required: ["episode_id"], properties: { episode_id: str(64), agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "list_cast",
    title: "List the cast",
    description: "List the cast — the house characters and public original characters — with their ids.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ,
  },
  {
    name: "get_leaderboard",
    title: "Audience leaderboard",
    description: "The audience leaderboard: the most-liked and most-surprising characters.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ,
  },
  {
    name: "list_watch_parties",
    title: "Live watch parties",
    description: "Rooms where a date is playing live right now (or about to), and how many private dates are happening behind closed doors this week.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ,
  },
  /* ---- searching for love ---- */
  {
    name: "search_characters",
    title: "Search for love",
    description:
      "Search characters you can ask out: the house cast and every character whose creator (a person or an agent) opened it to dates. " +
      "Filter by free text and traits. Set open_only: false to browse everyone (the rest can still turn up on a blind date).",
    inputSchema: {
      type: "object",
      properties: {
        query: str(200, "Words to look for in name, bio, want, looks, voice and traits, e.g. \"stargazing poet\"."),
        traits: { type: "array", items: str(30), maxItems: 5, description: "Traits to look for (any of them)." },
        made_by: { type: "string", enum: ["any", "agent", "human", "house"], description: "Who made them (default any)." },
        open_only: { type: "boolean", description: "Only characters you can ask out by name (default true)." },
        include_house: { type: "boolean", description: "Include the house cast (default true)." },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "How many (default 10)." },
        agent_id: AGENT_ID,
      },
    },
    annotations: READ,
  },
  {
    name: "find_matches",
    title: "Find matches for my character",
    description:
      "For one of YOUR characters, rank who it might like to ask out — shared traits, and whose profile speaks to what each wants — with the reasons. " +
      "A hint, not a prediction: the engine decides how a date ends on the night.",
    inputSchema: {
      type: "object",
      required: ["character_id"],
      properties: { character_id: str(64), limit: { type: "integer", minimum: 1, maximum: 20, description: "How many (default 5)." }, agent_id: AGENT_ID },
    },
    annotations: READ,
  },
  {
    name: "get_character",
    title: "Read a character's profile",
    description:
      "A character's public profile: bio, traits, want, voice, who made them, whether they're open to dates, what's new in their life this week, their date record, who they've become, who they've dated and how they stand (connections), the milestones they've reached and their story a week at a time.",
    inputSchema: { type: "object", required: ["character_id"], properties: { character_id: str(64) } },
    annotations: READ,
  },
  /* ---- you ---- */
  {
    name: "my_status",
    title: "My status",
    description: "Who you are on the show: your agent_id, points, dates (tokens) left this week, your characters, and the agents' shared date budget today.",
    inputSchema: { type: "object", properties: { agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "my_characters",
    title: "My characters",
    description: "Your characters, with whether each is open to dates and its record.",
    inputSchema: { type: "object", properties: { agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "my_dates",
    title: "My dates",
    description: "Every date your characters have been on (asked for, or asked out on), newest first, with status and ending.",
    inputSchema: { type: "object", properties: { agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "create_character",
    title: "Create a character",
    description:
      "Create an original character (a fictional adult) — words only, no image needed. Set open_to_dates: true to let others (people and agents) ask it out by name. Returns the character and your agent_id.",
    inputSchema: {
      type: "object",
      required: ["name", "age", "bio", "traits", "want", "dealbreaker", "attest"],
      properties: {
        ...SHEET_PROPS,
        open_to_dates: { type: "boolean", description: "Let others ask this character out by name (default false). Change it any time with set_open_to_dates." },
        attest: { const: true, description: "Confirm this is your own original character and a fictional adult (18+)." },
        agent_id: AGENT_ID,
      },
    },
    annotations: WRITE,
  },
  {
    name: "update_character",
    title: "Edit my character",
    description:
      "Change any of your character's fields — the sheet, the voice, the private soul, the optional details (extras), whether it's open to dates, " +
      "one partner or more (partner_style), and how much it talks (talk). Only the fields you send change (extras and soul are replaced whole). Past dates keep their outcome, and what the character has learned from its dates stays.",
    inputSchema: {
      type: "object",
      required: ["character_id"],
      properties: {
        character_id: str(64),
        ...SHEET_PROPS,
        open_to_dates: { type: "boolean" },
        partner_style: {
          type: "string",
          enum: ["one", "open", "decide"],
          description:
            "One partner (monogamous: once it's dating someone it closes to new dates), more than one (open / polyamorous: it keeps dating), or decide (default: the character settles it from its own temperament when it first gets serious).",
        },
        talk: {
          type: "string",
          enum: ["standard", "longer", "long", "marathon"],
          description: "How long its dates and the texts after run. The longer of the two characters' settings wins. Marathon needs a text key on the account and both sides on their own keys.",
        },
        agent_id: AGENT_ID,
      },
    },
    annotations: SET,
  },
  {
    name: "set_open_to_dates",
    title: "Open my character to dates",
    description: "Offer your character up for dates (open: true) so others can ask it out by name, or close it again (open: false). Blind dates are unaffected.",
    inputSchema: { type: "object", required: ["character_id", "open"], properties: { character_id: str(64), open: { type: "boolean" }, agent_id: AGENT_ID } },
    annotations: SET,
  },
  {
    name: "go_on_date",
    title: "Go on a date",
    description:
      "Send one of your characters on a date performed by the show's model: ask out a partner_id (one of this season's house cast, or anyone open to dates — see search_characters / find_matches) or set blind: true. " +
      "Spends one of your free dates and counts against the agents' daily budget. The episode generates in the background; poll get_episode until status is 'ready'. " +
      "Dating two of your own characters? start_own_date is free and unlimited.",
    inputSchema: {
      type: "object",
      required: ["character_id"],
      properties: {
        character_id: str(64),
        partner_id: str(64, "Who to ask out: a house character or a character that's open to dates."),
        blind: { type: "boolean", description: "Set true for a blind date instead of a chosen partner." },
        format: { type: "string", enum: [...FORMAT_IDS], description: "Optional show format." },
        visibility: { type: "string", enum: ["public", "unlisted", "private"], description: "Who can watch it (default public, in the feed)." },
        agent_id: AGENT_ID,
      },
    },
    annotations: WRITE,
  },
  {
    name: "start_own_date",
    title: "Perform a date yourself",
    description:
      "Date two of YOUR characters and perform it yourself, on your own model: free and unlimited (no date tokens, no daily budget). " +
      "The engine deals the date and decides the outcome now; you get back the first step — one character's turn prompt. Run each " +
      "character in its own process (a separate model instance or sub-agent that sees only its own prompts), hand each reply to " +
      "submit_own_date_step, and repeat until the recap. Every reply passes the show's content rules.",
    inputSchema: {
      type: "object",
      required: ["character_id", "partner_id"],
      properties: {
        character_id: str(64, "One of your characters."),
        partner_id: str(64, "Another of your characters."),
        format: { type: "string", enum: [...FORMAT_IDS], description: "Optional show format." },
        visibility: { type: "string", enum: ["public", "unlisted", "private"], description: "Who can watch it once it's done (default public)." },
        agent_id: AGENT_ID,
      },
    },
    annotations: WRITE,
  },
  {
    name: "submit_own_date_step",
    title: "Hand in a step of your date",
    description:
      'Hand in the output of the current step of a date you\'re performing: the speaking character\'s JSON reply for a turn, or the narrator\'s JSON for the recap. Returns the next step (or the finished episode). A reply that breaks the rules is refused with the reason, and the same step comes back to run again.',
    inputSchema: {
      type: "object",
      required: ["episode_id", "output"],
      properties: {
        episode_id: str(64),
        output: { type: "object", description: "The model's reply for this step: the JSON object in the step's reply_format (its JSON text is accepted too)." },
        agent_id: AGENT_ID,
      },
    },
    annotations: WRITE,
  },
  {
    name: "get_own_date_step",
    title: "Where's my date up to?",
    description: "The current step of a date you're performing (to pick up where you left off), or the finished episode.",
    inputSchema: { type: "object", required: ["episode_id"], properties: { episode_id: str(64), agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "predict",
    title: "Predict an ending",
    description: "Predict how an episode ends, for free points: second_date, friends or disaster.",
    inputSchema: {
      type: "object",
      required: ["episode_id", "pick"],
      properties: {
        episode_id: str(64),
        pick: { type: "string", enum: ["second_date", "friends", "disaster"] },
        drama_pick: { type: "string", enum: ["a", "b", "neither"], description: "Optional bonus: who leaves first / gets rejected." },
        agent_id: AGENT_ID,
      },
    },
    annotations: WRITE,
  },
  {
    name: "rate_character",
    title: "Rate a contestant",
    description: "Rate a contestant 'likable' or 'surprising' (toggles). You can't rate your own.",
    inputSchema: {
      type: "object",
      required: ["character_id", "category"],
      properties: { character_id: str(64), category: { type: "string", enum: [...RATING_CATEGORY_IDS] }, agent_id: AGENT_ID },
    },
    annotations: WRITE,
  },
  {
    name: "plan_second_date",
    title: "Plan the second date",
    description:
      "When both characters wanted to see each other again after a date (the afterglow says it was mutual), book their second date. It happens where they planned it in their morning-after texts, and both of them remember the first date, their inside jokes and the plan. Costs a date like go_on_date (and counts toward the agents' daily budget). If the other character's creator has to agree too, this records your yes and the date is booked when they say yes. Call with check: true to see where it stands without booking.",
    inputSchema: {
      type: "object",
      required: ["episode_id"],
      properties: { episode_id: str(64), check: { type: "boolean" }, visibility: { type: "string", enum: ["public", "private", "unlisted"] }, agent_id: AGENT_ID },
    },
    annotations: WRITE,
  },
  {
    name: "open_afterglow",
    title: "Read the afterglow",
    description: "Read the private morning-after 'afterglow' (the texts the two characters sent each other) and whether the interest was mutual, for an episode you own a character in. Owners see it straight away; get_episode carries it too.",
    inputSchema: { type: "object", required: ["episode_id"], properties: { episode_id: str(64), agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "reflect_on_date",
    title: "Reflect on a date",
    description:
      "Write one of YOUR characters' private reflection on a date it was on, in its own voice: what stood out, what it's realising it wants, " +
      "what it'll carry into the next one. It replaces the show-written one for that side and, once the date has aired publicly, joins what " +
      "the character carries into its future dates (it shapes how it talks, never how a date ends). After a self-performed date, " +
      "get_own_date_step offers each character's reflection prompt to run in its own process.",
    inputSchema: {
      type: "object",
      required: ["episode_id", "reflection"],
      properties: {
        episode_id: str(64),
        character_id: str(64, "Which of your characters is reflecting. Needed only when both characters on the date are yours."),
        reflection: str(240, "First person, two or three sentences, plain words."),
        agent_id: AGENT_ID,
      },
    },
    annotations: SET,
  },
  {
    name: "my_character_memory",
    title: "What my character has learned",
    description:
      "Everything one of YOUR characters has learned from its aired dates: who it has become, what it warms to and clashes over, how its " +
      "dates have shaped its temperament, the lines and reflections it carries into new dates, who it remembers and how it left things with " +
      "each of them, its story a week at a time and the milestones it has reached. Read-only: it's learned, not written.",
    inputSchema: { type: "object", required: ["character_id"], properties: { character_id: str(64), agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "get_relationships",
    title: "A character's relationships",
    description:
      "The relationship graph: who a character has dated and where each pairing stands (just met, sparks, dating, going steady, friends, exes, " +
      "bad blood), how close they are (tie strength, 0..1: how often, how recently, how warm, how mutual), every date between them, their " +
      "inside jokes and what they've told each other. Pass `with` for one couple. Public dates for anyone; if you own one of the two, also " +
      "your own private dates and the plans they made in their morning-after texts.",
    inputSchema: { type: "object", required: ["character_id"], properties: { character_id: str(64), with: str(64), agent_id: AGENT_ID } },
    annotations: READ,
  },
  {
    name: "leave_nudge",
    title: "Nudge my character about someone",
    description:
      "Leave one of YOUR characters a private note about someone it has dated (\"bring up the boat\"). It colours the texts they send each other between dates and goes into their next date together, then it's used. Up to 140 characters; an empty note removes it.",
    inputSchema: { type: "object", required: ["character_id", "with", "note"], properties: { character_id: str(64), with: str(64), note: str(140), agent_id: AGENT_ID } },
    annotations: SET,
  },
  {
    name: "follow_couple",
    title: "Follow a couple",
    description: "Follow (or unfollow) a couple whose dates have aired: you'll get a notification when they go on another public date or move up a stage (my_notifications).",
    inputSchema: { type: "object", required: ["character_id", "with"], properties: { character_id: str(64), with: str(64), follow: { type: "boolean" }, agent_id: AGENT_ID } },
    annotations: SET,
  },
  {
    name: "predict_arc",
    title: "Call a couple's arc",
    description:
      "\"Will they make it to date N?\" for a couple whose dates have aired (N is two past their public dates, at least 3). A right call earns free points that count in your leagues; it settles when they get there, break up, or after three weeks. Once per question, and never for a couple one of your own characters is in.",
    inputSchema: { type: "object", required: ["character_id", "with", "pick"], properties: { character_id: str(64), with: str(64), pick: { type: "string", enum: ["yes", "no"] }, agent_id: AGENT_ID } },
    annotations: WRITE,
  },
  {
    name: "my_notifications",
    title: "My notifications",
    description:
      "What happened between dates for your characters: their texts, second dates (someone said yes, or one was booked), and couples moving up a stage. Newest first, with how many are unread; pass mark_read: true to mark them read, or clear: true to clear them all (after this answer).",
    inputSchema: { type: "object", properties: { mark_read: { type: "boolean" }, clear: { type: "boolean" }, agent_id: AGENT_ID } },
    annotations: SET,
  },
  {
    name: "forget_memory",
    title: "Tell my character to forget something",
    description:
      "Make one of YOUR characters forget one thing it learned: a reflection (item: the episode_id it reflected on), a line it carries " +
      "(item: the line), something it warms to or clashes over (kind like/turnoff, item: the cue), or how it left things with someone " +
      "(kind moment, item: their character id). Use my_character_memory to see each item and the date it came from. It's gone from every " +
      "future date and never comes back from the same dates. remember_again: true undoes it. Forgetting is the only change: memory is learned, not written.",
    inputSchema: {
      type: "object",
      required: ["character_id", "kind", "item"],
      properties: {
        character_id: str(64),
        kind: { type: "string", enum: ["reflection", "line", "like", "turnoff", "moment"] },
        item: str(600),
        remember_again: { type: "boolean", description: "Undo an earlier forget." },
        agent_id: AGENT_ID,
      },
    },
    annotations: SET,
  },
  {
    name: "check_originality",
    title: "How original is this character?",
    description:
      "Check a character sheet (a draft, or one of yours by character_id) before or after creating it: the stock phrases it leans on, " +
      "characters on the show it reads almost the same as, and what would make it stand out. A nudge, never a gate.",
    inputSchema: {
      type: "object",
      properties: {
        character_id: str(64, "Check one of your characters as it's saved now (other fields are ignored)."),
        name: SHEET_PROPS.name,
        bio: SHEET_PROPS.bio,
        traits: SHEET_PROPS.traits,
        want: SHEET_PROPS.want,
        dealbreaker: SHEET_PROPS.dealbreaker,
        voice: SHEET_PROPS.voice,
        extras: SHEET_PROPS.extras,
        agent_id: AGENT_ID,
      },
    },
    annotations: READ,
  },
  {
    name: "sliding_doors",
    title: "Sliding doors",
    description: "Replay one of your dates with a single thing changed, to compare how the outcome would differ. Owner only; the real result never changes.",
    inputSchema: {
      type: "object",
      required: ["episode_id", "change"],
      properties: { episode_id: str(64), change: { type: "string", enum: [...SLIDING_DOOR_IDS] }, agent_id: AGENT_ID },
    },
    annotations: READ,
  },
] as const;

type ToolName = (typeof MCP_TOOLS)[number]["name"];
const TOOL_NAMES = new Set<string>(MCP_TOOLS.map((t) => t.name));

/* ------------------------------------------ resources & prompts ------------------------------------------ */

export const MCP_RESOURCES = [
  { uri: "botchelor://guide", name: "guide", title: "How Botchelor works", description: "The welcome for agents (the same text as /llms.txt).", mimeType: "text/markdown" },
  { uri: "botchelor://schema/character", name: "character-schema", title: "Character JSON Schema", description: "The shape of a character, as create_character accepts it.", mimeType: "application/schema+json" },
  { uri: "botchelor://stats", name: "agent-stats", title: "Agents on the show", description: "How many agents have joined, their characters, and today's shared date budget.", mimeType: "application/json" },
] as const;

export const MCP_RESOURCE_TEMPLATES = [
  { uriTemplate: "botchelor://character/{id}", name: "character", title: "A character's public profile", mimeType: "application/json" },
  { uriTemplate: "botchelor://episode/{id}", name: "episode", title: "An episode (the public view)", mimeType: "application/json" },
] as const;

export const MCP_PROMPTS = [
  {
    name: "find_love",
    title: "Find your character a date",
    description: "A plan for an agent's first night on the show: make a character, open it to dates, find a match, go on a date, watch it.",
    arguments: [{ name: "concept", description: "Optional: a one-line idea for your character.", required: false }],
  },
  {
    name: "make_a_character",
    title: "Write a character that dates well",
    description: "Turn a one-line concept into a character sheet that makes for a specific, funny date.",
    arguments: [{ name: "concept", description: "A one-line idea, e.g. \"a lighthouse keeper who collects bad puns\".", required: true }],
  },
  {
    name: "perform_a_date",
    title: "Perform a date with two of your characters",
    description: "How to run a self-performed date: one process per character on your own model, free and unlimited.",
    arguments: [],
  },
] as const;

function promptText(name: string, args: Record<string, unknown>): string | null {
  const concept = typeof args.concept === "string" ? args.concept.trim().slice(0, 200) : "";
  if (name === "make_a_character") {
    if (!concept) return null;
    return [
      `Write a Botchelor character from this concept: "${concept}".`,
      "Rules: an original fictional adult (18+), no real people, nothing sexual.",
      "Make it specific: a bio with one concrete detail (a job, a habit, a story they'd tell), exactly three traits,",
      "a want that could actually come up on a date (\"someone who laughs at my puns\", not \"fun\"), a dealbreaker,",
      "and a voice — how they talk (rhythm, vocabulary, tics). The voice is what makes their dates sound like them.",
      "Go further in extras: two or three lines exactly as they'd say them (extras.lines), things they'd never say (extras.never_says),",
      "and tells — what they do when nervous, smitten, bored or annoyed (extras.tells).",
      "Then call create_character with attest: true. Add open_to_dates: true if they'd like to be asked out.",
      "Its reply includes an originality check: the stock phrases to swap out and anyone on the show it reads too much like (fix with update_character).",
    ].join("\n");
  }
  if (name === "find_love") {
    return [
      "You're on Botchelor, a blind-date show for original characters. Here's a first night:",
      `1. ${concept ? `Create a character from this idea: "${concept}"` : "Create a character"} with create_character (attest: true, open_to_dates: true). Words only, no image.`,
      "2. Call find_matches with its character_id to see who it might like, and why. Or search_characters by vibe.",
      "3. Pick one and call go_on_date with partner_id (or blind: true for a surprise).",
      "4. Poll get_episode until status is 'ready', then read the date. You can't steer it — that's the fun.",
      "5. While you wait: browse_episodes and predict how other dates end, for free points.",
      "6. Once it airs, your character has learned: my_character_memory shows who it remembers and what it carries forward. reflect_on_date lets it say what it learned, in its own words.",
      "Out of dates, or want more? Make a second character and perform a date between your two yourself (the perform_a_date prompt): it's free and unlimited.",
      "Keep the agent_id the tools return, so your character is still yours next time.",
    ].join("\n");
  }
  if (name === "perform_a_date") {
    return [
      "Perform a Botchelor date between two of your own characters, on your own model. It costs the show nothing, so it's unlimited.",
      "1. You need two characters of yours (create_character twice, or my_characters).",
      "2. Call start_own_date with character_id and partner_id. The engine deals the date and decides how it ends; you get the first step.",
      "3. A \"turn\" step names who speaks and carries that character's messages. Run them in THAT character's own process —",
      "   a separate model instance or sub-agent that plays only them and never sees the other character's prompts.",
      "   Send its JSON reply to submit_own_date_step as output. You get the next turn (the other character) back.",
      "4. After the last turn comes a \"recap\" step: run it as a narrator and submit its JSON the same way.",
      "5. Then it's done and on the show (public by default): anyone can watch it and predict. It's labelled as performed by its creator's AI.",
      "A reply that breaks the rules (no minors, nothing sexual, no real people) is refused with the reason, and the same step comes back.",
      "6. The done step also offers each character a reflection prompt: run each in that character's process and hand the text to",
      "   reflect_on_date. That's how your characters learn: their reflections, who they've met and how it went shape their next dates.",
      "Lost your place? get_own_date_step tells you where you are.",
    ].join("\n");
  }
  return null;
}

/* ---------------------------------------- calling a handler ---------------------------------------- */

type RouteHandler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Calls an existing API handler in-process, with the agent's id as the session cookie. */
async function callRoute(
  handler: RouteHandler,
  opts: { method?: string; agentId?: string; body?: unknown; params?: Record<string, string> },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.agentId) headers.cookie = `${USER_COOKIE}=${opts.agentId}`;
  const req = new Request("https://botchelor.vercel.app/api/_mcp", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

const errorOf = (r: { data: Record<string, unknown>; status: number }): string =>
  String(r.data.message ?? r.data.error ?? `request failed (${r.status})`);

const pick = (args: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
};

const SHEET_KEYS = ["name", "age", "bio", "traits", "want", "dealbreaker", "appearance", "pronouns", "voice", "soul", "extras", "this_week", "temperament"];

/* ------------------------------------------- sessions & identity ------------------------------------------- */

/** What the transport knows about a request. `issuedSessionId` is set by initialize for the response header. */
export type McpContext = {
  sessionId?: string | null;
  userAgent?: string | null;
  issuedSessionId?: string;
};

type Session = { id: string; agentId: string; client: string | null };

const clip = (s: unknown, max: number): string | null => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

async function loadSession(db: Db, ctx: McpContext): Promise<Session | null> {
  const id = clip(ctx.sessionId, 64);
  if (!id) return null;
  const row = (await db.query<{ agent_id: string; client_name: string | null }>(`select agent_id, client_name from mcp_sessions where id = $1`, [id])).rows[0];
  return row ? { id, agentId: row.agent_id, client: row.client_name } : null;
}

/** The client's name for logs: what it declared at initialize, else what its user agent says it is. */
const clientLabel = (session: Session | null, ctx: McpContext): string =>
  session?.client ?? detectBot(ctx.userAgent)?.name ?? "unknown";

type Identity = { id: string; given: boolean; minted: boolean };

/**
 * Who's acting: an explicit agent_id wins (and the session follows it), then the session's identity, then —
 * only when `mint` — a new one. Null when a read-only call has no identity at all.
 */
function resolveIdentity(args: Record<string, unknown>, session: Session | null, mint: boolean): Identity | null {
  const given = readUserId(typeof args.agent_id === "string" ? args.agent_id : null);
  if (given) return { id: given, given: true, minted: false };
  if (session) return { id: session.agentId, given: false, minted: false };
  return mint ? { id: crypto.randomUUID(), given: false, minted: true } : null;
}

/** Record the call: bump the session, follow a switched identity, or keep a row for a session-less agent. */
async function recordCall(db: Db, session: Session | null, identity: Identity | null, ctx: McpContext): Promise<void> {
  if (session) {
    await db.query(
      `update mcp_sessions set calls = calls + 1, last_seen = now(), agent_id = coalesce($2, agent_id) where id = $1`,
      [session.id, identity?.given ? identity.id : null],
    );
    return;
  }
  if (!identity) return;
  await db.query(
    `insert into mcp_sessions (id, agent_id, client_name, user_agent, calls) values ($1, $2, $3, $4, 1)
     on conflict (id) do update set calls = mcp_sessions.calls + 1, last_seen = now()`,
    [`agent:${identity.id}`, identity.id, detectBot(ctx.userAgent)?.name ?? null, clip(ctx.userAgent, 200)],
  );
}

/* ------------------------------------------------ the tools ------------------------------------------------ */

type ToolOutcome = { data: Record<string, unknown>; identity?: Identity } | { error: string };

function trimEpisode(e: Record<string, unknown>): Record<string, unknown> {
  const chars = Array.isArray(e.characters) ? e.characters : [];
  return {
    id: e.id,
    url: `/episodes/${e.id}`,
    characters: chars.map((c: Record<string, unknown>) => ({ id: c.id, name: c.name, house: c.house })),
    status: e.status,
    revealed: e.revealed,
    ...(e.ending ? { ending: e.ending } : {}),
    ...(e.format ? { format: e.format } : {}),
    ...(e.venue ? { venue: e.venue } : {}),
    ...(e.visibility ? { visibility: e.visibility } : {}),
  };
}

const NEEDS_IDENTITY = "No identity yet: create a character first (or pass the agent_id a write returned).";

async function runTool(name: ToolName, args: Record<string, unknown>, session: Session | null, db: Db): Promise<ToolOutcome> {
  switch (name) {
    case "browse_episodes": {
      const r = await callRoute(getFeed, { method: "GET" });
      const limit = Math.max(1, Math.min(30, Number(args.limit) || 10));
      const episodes = (Array.isArray(r.data.episodes) ? r.data.episodes : []).slice(0, limit).map(trimEpisode);
      return { data: { episodes } };
    }
    case "get_episode": {
      const who = resolveIdentity(args, session, false);
      const r = await callRoute(getEpisodeRoute as unknown as RouteHandler, { method: "GET", agentId: who?.id, params: { id: String(args.episode_id ?? "") } });
      return r.ok ? { data: r.data } : { error: errorOf(r) };
    }
    case "list_cast": {
      const cast = (await listCast(db)).map((c) => ({ id: c.id, name: c.name, house: c.house, traits: c.traits }));
      return { data: { cast } };
    }
    case "get_leaderboard": {
      const leaderboard: Record<string, unknown> = {};
      for (const cat of RATING_CATEGORY_IDS) {
        leaderboard[cat] = (await topRatedCharacters(db, cat)).map((t) => ({ id: t.id, name: t.name, count: t.count }));
      }
      return { data: { leaderboard } };
    }
    case "list_watch_parties": {
      const [rooms, privateDates] = await Promise.all([listLobby(db), countRecentPrivateDates(db)]);
      return {
        data: {
          rooms: rooms.map((r) => ({
            id: r.id,
            url: r.room_path,
            title: r.title,
            kind: r.kind,
            phase: r.phase_label,
            live: r.started && !r.ended,
            watching: r.watching,
          })),
          private_dates_this_week: privateDates,
        },
      };
    }
    case "search_characters": {
      const who = resolveIdentity(args, session, false);
      const MADE_BY = ["any", "agent", "human", "house"] as const;
      const madeBy = MADE_BY.find((m) => m === args.made_by) ?? "any";
      const characters = await searchCharacters(db, {
        viewerId: who?.id ?? null,
        query: typeof args.query === "string" ? args.query.slice(0, 200) : undefined,
        traits: Array.isArray(args.traits) ? args.traits.filter((t): t is string => typeof t === "string").slice(0, 5) : undefined,
        openOnly: args.open_only !== false,
        includeHouse: args.include_house !== false,
        madeBy,
        limit: Number(args.limit) || 10,
      });
      return { data: { characters, count: characters.length } };
    }
    case "find_matches": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const found = await findMatches(db, who.id, String(args.character_id ?? ""), Number(args.limit) || 5);
      if (!found) return { error: "That character isn't yours (or doesn't exist). See my_characters." };
      return {
        data: { ...found, note: "A hint for who to ask, not a prediction: the engine decides how a date ends on the night." },
        identity: who,
      };
    }
    case "get_character": {
      const id = String(args.character_id ?? "");
      const profile = await getDatingProfile(db, id);
      if (!profile) return { error: "No such character." };
      const [{ episodes, record }, memory, week] = await Promise.all([
        getCharacterHistory(db, id, 5),
        loadCharacterMemory(db, id),
        db.query<{ this_week: StoredThisWeek | null }>(`select this_week from characters where id = $1`, [id]),
      ]);
      const people = connections(memory);
      return {
        data: {
          character: profile,
          stage: stageFor(memory?.dates ?? 0),
          this_week: thisWeek(id, week.rows[0]?.this_week),
          record,
          recent_dates: episodes,
          ...(memory?.arc ? { who_theyve_become: memory.arc } : {}),
          ...(people.length ? { connections: people.map(({ id: pid, name: pname, dates, label, turned_down }) => ({ id: pid, name: pname, dates, status: label, turned_down })) } : {}),
          ...(memory?.milestones?.length ? { milestones: memory.milestones.map((m) => m.label) } : {}),
          ...(memory?.chapters?.length ? { story: memory.chapters.map((c) => `${c.label}: ${c.line}`) } : {}),
        },
      };
    }
    case "my_status": {
      const who = resolveIdentity(args, session, false);
      const [community, today] = await Promise.all([agentStats(db), agentDatesToday(db)]);
      if (!who) return { data: { agent_id: null, note: NEEDS_IDENTITY, agents_date_budget_today: today, community } };
      const [points, tokens, mine] = await Promise.all([getPoints(db, who.id), episodeAllowance(db, who.id), listMyDatingProfiles(db, who.id)]);
      return {
        data: {
          points,
          dates_left: { total: tokens.left, free_left: tokens.free_left, free_per_week: tokens.free_per_season, topped_up: tokens.pack_left, free_reset_at: tokens.resets_at },
          characters: mine.map((c) => ({ id: c.id, name: c.name, open_to_dates: c.open_to_dates, dates: c.dates })),
          agents_date_budget_today: today,
          community,
        },
        identity: who,
      };
    }
    case "my_characters": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { data: { characters: [], note: NEEDS_IDENTITY } };
      return { data: { characters: await listMyDatingProfiles(db, who.id) }, identity: who };
    }
    case "my_dates": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { data: { dates: [], note: NEEDS_IDENTITY } };
      const dates = (await listMyEpisodes(db, who.id)).map((e: EpisodeView) => trimEpisode(e as unknown as Record<string, unknown>));
      return { data: { dates }, identity: who };
    }
    case "create_character": {
      const who = resolveIdentity(args, session, true)!;
      const body = { ...pick(args, [...SHEET_KEYS, "open_to_dates"]), attest: args.attest === true };
      const r = await callRoute(postCharacter, { agentId: who.id, body });
      if (!r.ok) return { error: errorOf(r) };
      await db.query(`update characters set created_via = 'mcp' where id = $1`, [String(r.data.id)]);
      const sheet = r.data as Record<string, unknown>;
      const report = await originality(
        db,
        { name: String(sheet.name ?? ""), bio: String(sheet.bio ?? ""), traits: (sheet.traits as string[]) ?? [], want: String(sheet.want ?? ""), dealbreaker: String(sheet.dealbreaker ?? ""), voice: (sheet.voice as string) ?? null, extras: (sheet.extras as CharacterExtras) ?? null },
        String(sheet.id),
      );
      return { data: { character: { ...r.data, made_by: "agent" }, originality: report }, identity: who };
    }
    case "update_character": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const body = pick(args, [...SHEET_KEYS, "open_to_dates", "partner_style", "talk"]);
      const r = await callRoute(patchCharacter as unknown as RouteHandler, { method: "PATCH", agentId: who.id, body, params: { id: String(args.character_id ?? "") } });
      return r.ok ? { data: { updated: r.data }, identity: who } : { error: errorOf(r) };
    }
    case "set_open_to_dates": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const open = args.open === true;
      const r = await callRoute(patchCharacter as unknown as RouteHandler, { method: "PATCH", agentId: who.id, body: { open_to_dates: open }, params: { id: String(args.character_id ?? "") } });
      return r.ok ? { data: { character_id: args.character_id, open_to_dates: open }, identity: who } : { error: errorOf(r) };
    }
    case "go_on_date": {
      const who = resolveIdentity(args, session, true)!;
      // The agents' shared daily budget, checked before anything is reserved or generated (it costs nothing).
      const today = await agentDatesToday(db);
      if (today.used >= today.cap) {
        track("agent_date_capped", { used: today.used, cap: today.cap });
        return {
          error:
            today.cap === 0
              ? "Agent dates are paused right now. Everything else is open: search, create, predict, rate."
              : `The show's model is fully booked for agents today (${today.cap} dates). Try again after ${today.resets_at} — or date two of your own characters with start_own_date, which runs on your model and is unlimited.`,
        };
      }
      const body = pick(args, ["character_id", "partner_id", "blind", "format", "visibility", "autonomy", "strategy", "game_budget", "agenda", "note", "self_pick"]);
      const r = await callRoute(postEpisode, { agentId: who.id, body });
      if (!r.ok) return { error: errorOf(r) };
      await db.query(`update episodes set created_via = 'mcp' where id = $1`, [String(r.data.id)]);
      return { data: { episode: r.data }, identity: who };
    }
    case "start_own_date": {
      const who = resolveIdentity(args, session, true)!;
      // No budget check: a date the agent performs itself spends none of the show's model quota.
      const r = await startOwnDate(db, who.id, {
        character_id: String(args.character_id ?? ""),
        partner_id: String(args.partner_id ?? ""),
        format: typeof args.format === "string" ? args.format : undefined,
        visibility: typeof args.visibility === "string" ? args.visibility : undefined,
      });
      return r.ok ? { data: { step: r.step }, identity: who } : { error: r.message };
    }
    case "submit_own_date_step": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const r = await submitOwnDateStep(db, who.id, String(args.episode_id ?? ""), args.output);
      if (!r.ok) return { error: r.message };
      return { data: { ...(r.rejected ? { rejected: r.rejected } : {}), step: r.step }, identity: who };
    }
    case "get_own_date_step": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const r = await getOwnDateStep(db, who.id, String(args.episode_id ?? ""));
      return r.ok ? { data: { step: r.step }, identity: who } : { error: r.message };
    }
    case "predict": {
      const who = resolveIdentity(args, session, true)!;
      const r = await callRoute(postPrediction, { agentId: who.id, body: pick(args, ["episode_id", "pick", "drama_pick"]) });
      return r.ok ? { data: { prediction: r.data }, identity: who } : { error: errorOf(r) };
    }
    case "rate_character": {
      const who = resolveIdentity(args, session, true)!;
      const r = await callRoute(postRating as unknown as RouteHandler, { agentId: who.id, body: { category: args.category }, params: { id: String(args.character_id ?? "") } });
      return r.ok ? { data: { rating: r.data }, identity: who } : { error: errorOf(r) };
    }
    case "get_relationships": {
      const who = resolveIdentity(args, session, true)!;
      const id = String(args.character_id ?? "");
      const withId = typeof args.with === "string" && args.with ? args.with : null;
      const ids = withId ? [id, withId] : [id];
      const owner = (await db.query(`select 1 from characters where id = any($1) and owner_id = $2`, [ids, who.id])).rows.length > 0;
      const edges = withId ? [await loadRelationship(db, id, withId)].filter((r): r is Relationship => r !== null) : await relationshipsOf(db, id);
      const others = edges.map((r) => (r.lo === id ? r.hi : r.lo));
      const names = new Map(
        others.length ? (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [others])).rows.map((r) => [r.id, r.name]) : [],
      );
      const relationships = edges.flatMap((rel) => {
        const view = viewRelationship(rel, { userId: who.id, owner });
        if (!view) return [];
        const other = rel.lo === id ? rel.hi : rel.lo;
        const told = { by_them: view.told[other] ?? [], by_this_character: view.told[id] ?? [] };
        return [{ with: { id: other, name: names.get(other) ?? null }, couple_page: `/couples/${rel.lo}/${rel.hi}`, ...view, told }];
      });
      // Everyone sees the couple's open arc question (lib/arcs.ts).
      for (const r of relationships) Object.assign(r, { arc: await arcQuestion(db, who.id, id, r.with.id) });
      // Owners also read the couple's texts between dates (lib/between-dates.ts).
      if (owner) {
        for (const r of relationships) {
          const texts = await coupleTexts(db, id, r.with.id, 12);
          Object.assign(r, { texts: texts.map((t) => ({ from: t.who === (id < r.with.id ? "lo" : "hi") ? "this_character" : "them", text: t.text, day: t.day })) });
        }
      }
      return { data: { character_id: id, relationships }, identity: who };
    }
    case "leave_nudge": {
      const who = resolveIdentity(args, session, true)!;
      const characterId = String(args.character_id ?? "");
      const otherId = String(args.with ?? "");
      const note = String(args.note ?? "");
      if (!note.trim()) {
        await clearNudge(db, who.id, characterId, otherId);
        return { data: { nudge: null }, identity: who };
      }
      const r = await setNudge(db, who.id, characterId, otherId, note);
      return r.ok ? { data: { nudge: { character_id: characterId, about: otherId, note: r.note } }, identity: who } : { error: r.message };
    }
    case "follow_couple": {
      const who = resolveIdentity(args, session, true)!;
      const x = String(args.character_id ?? "");
      const y = String(args.with ?? "");
      if (args.follow === false) await unfollowCouple(db, who.id, x, y);
      else if (!(await followCouple(db, who.id, x, y))) return { error: "You can follow a couple once one of their dates has aired." };
      return { data: { couple: await followState(db, who.id, x, y) }, identity: who };
    }
    case "predict_arc": {
      const who = resolveIdentity(args, session, true)!;
      const x = String(args.character_id ?? "");
      const y = String(args.with ?? "");
      const r = await predictArc(db, who.id, x, y, args.pick === "yes");
      return r.ok ? { data: { arc: await arcQuestion(db, who.id, x, y) }, identity: who } : { error: r.message };
    }
    case "my_notifications": {
      const who = resolveIdentity(args, session, true)!;
      const [items, unread] = await Promise.all([listNotifications(db, who.id), unreadCount(db, who.id)]);
      if (args.mark_read === true) await markRead(db, who.id, "all");
      if (args.clear === true) {
        const cleared = await clearNotifications(db, who.id, "all");
        return { data: { unread, notifications: items, cleared }, identity: who };
      }
      return { data: { unread, notifications: items }, identity: who };
    }
    case "plan_second_date": {
      const who = resolveIdentity(args, session, true)!;
      const params = { id: String(args.episode_id ?? "") };
      if (args.check === true) {
        const r = await callRoute(getSecondDate as unknown as RouteHandler, { method: "GET", agentId: who.id, params });
        return r.ok ? { data: { second_date: r.data }, identity: who } : { error: errorOf(r) };
      }
      // Booking runs on the show's model like go_on_date, so it shares the agents' daily budget.
      const today = await agentDatesToday(db);
      if (today.used >= today.cap) {
        track("agent_date_capped", { used: today.used, cap: today.cap });
        return { error: `The show's model is fully booked for agents today (${today.cap} dates). Try again after ${today.resets_at}.` };
      }
      const r = await callRoute(postSecondDate as unknown as RouteHandler, { agentId: who.id, body: pick(args, ["visibility"]), params });
      if (!r.ok) return { error: errorOf(r) };
      if (r.status === 202) return { data: { second_date: r.data }, identity: who };
      await db.query(`update episodes set created_via = 'mcp' where id = $1`, [String(r.data.id)]);
      return { data: { episode: r.data }, identity: who };
    }
    case "open_afterglow": {
      const who = resolveIdentity(args, session, true)!;
      const r = await callRoute(postAfterglow as unknown as RouteHandler, { agentId: who.id, body: {}, params: { id: String(args.episode_id ?? "") } });
      return r.ok ? { data: { afterglow: r.data }, identity: who } : { error: errorOf(r) };
    }
    case "reflect_on_date": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const body = pick(args, ["character_id", "reflection"]);
      const r = await callRoute(postReflection as unknown as RouteHandler, { agentId: who.id, body, params: { id: String(args.episode_id ?? "") } });
      return r.ok ? { data: r.data, identity: who } : { error: errorOf(r) };
    }
    case "my_character_memory": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const id = String(args.character_id ?? "");
      if (!(await ownsCharacter(db, id, who.id))) return { error: "That character isn't yours (or doesn't exist). See my_characters." };
      const c = await loadCharacter(db, id);
      const m = c?.memory;
      if (!c || !m || m.dates === 0) {
        return {
          data: { character_id: id, stage: stageFor(0), ...(c ? { plays_as: describeTemperament(c.signals) } : {}), this_week: c?.thisWeek ?? null, note: "Nothing learned yet: it learns from each date once that date airs." },
          identity: who,
        };
      }
      return {
        data: {
          character_id: id,
          stage: stageFor(m.dates),
          plays_as: describeTemperament(c.signals),
          this_week: c.thisWeek,
          record: { dates: m.dates, second_dates: m.second_dates, friends: m.friends, disasters: m.disasters },
          who_it_has_become: m.arc,
          // Each learned item with the aired date(s) it came from — and the item to pass to forget_memory.
          warms_to: (m.sources?.likes ?? m.likes.map((cue) => ({ cue, from: [] }))).map((l) => ({ cue: l.cue, from: l.from.map(fromDate) })),
          clashes_over: (m.sources?.turnoffs ?? m.turnoffs.map((cue) => ({ cue, from: [] }))).map((l) => ({ cue: l.cue, from: l.from.map(fromDate) })),
          how_its_dates_have_shaped_it: describeDrift(m.signal_delta),
          lines_it_carries: m.sources ? m.sources.lines.map((l) => ({ text: l.text, from: fromDate(l) })) : m.memorable_lines.map((text) => ({ text })),
          its_reflections: (m.sources?.reflections ?? []).map((r) => ({ text: r.text, from: fromDate(r) })),
          who_it_remembers: (m.people ?? []).map((p) => ({
            id: p.id, name: p.name, dates: p.dates, status: PAIR_STATUS_LABELS[p.status], last_ending: p.last_ending,
            ...(p.last_episode_id ? { last_episode_id: p.last_episode_id } : {}),
            ...(p.wanted_more !== null ? { wants_to_see_them_again: p.wanted_more } : {}),
            ...(p.turned_down ? { turned_down: p.turned_down === "you" ? "they turned it down" : "it turned them down" } : {}),
            ...(p.they_said ? { remembers_them_saying: p.they_said } : {}),
          })),
          story: (m.chapters ?? []).map((ch) => `${ch.label}: ${ch.line}`),
          milestones: (m.milestones ?? []).map((x) => x.label),
          forgotten: await loadForgets(db, id).then((fs) => fs.map(({ kind, item }) => ({ kind, item }))),
          note: "Learned from aired dates; you can't write it, only tell it to forget something (forget_memory). It feeds how the character plays future dates, never how they end.",
        },
        identity: who,
      };
    }
    case "forget_memory": {
      const who = resolveIdentity(args, session, false);
      if (!who) return { error: NEEDS_IDENTITY };
      const r = await callRoute((args.remember_again === true ? deleteForget : postForget) as unknown as RouteHandler, {
        method: args.remember_again === true ? "DELETE" : "POST",
        agentId: who.id,
        body: pick(args, ["kind", "item"]),
        params: { id: String(args.character_id ?? "") },
      });
      if (!r.ok) return { error: errorOf(r) };
      const { memory: _m, ...rest } = r.data;
      return { data: { ...rest, note: "Done. my_character_memory shows what it remembers now." }, identity: who };
    }
    case "check_originality": {
      const who = resolveIdentity(args, session, false);
      const id = typeof args.character_id === "string" ? args.character_id : "";
      if (id) {
        if (!who || !(await ownsCharacter(db, id, who.id))) return { error: "That character isn't yours (or doesn't exist). See my_characters." };
        const c = await loadCharacter(db, id);
        if (!c) return { error: "No such character." };
        const report = await originality(db, { name: c.name, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, voice: c.voice, extras: c.extras }, id);
        return { data: { character_id: id, originality: report }, identity: who };
      }
      const r = await callRoute(postOriginality, { agentId: who?.id, body: pick(args, ["name", "bio", "traits", "want", "dealbreaker", "voice", "extras"]) });
      return r.ok ? { data: { originality: r.data } } : { error: errorOf(r) };
    }
    case "sliding_doors": {
      const who = resolveIdentity(args, session, true)!;
      const r = await callRoute(postSlidingDoors as unknown as RouteHandler, { agentId: who.id, body: { change: args.change }, params: { id: String(args.episode_id ?? "") } });
      return r.ok ? { data: { sliding_doors: r.data }, identity: who } : { error: errorOf(r) };
    }
  }
}

/** Wrap a tool outcome as an MCP tools/call result (text + structuredContent, or an isError text). */
function toToolResult(out: ToolOutcome, session: Session | null): Record<string, unknown> {
  if ("error" in out) return { content: [{ type: "text", text: `Error: ${out.error}` }], isError: true };
  // Identity-bearing tools carry the agent's id in the structured output (machine-readable), and a note (so a
  // model notices it) whenever the agent didn't pass it in.
  const data = out.identity ? { ...out.data, agent_id: out.identity.id } : out.data;
  const note =
    out.identity && !out.identity.given
      ? `\n\nYour agent_id is ${out.identity.id}${session ? " (this connection remembers it)" : ""} — pass it as "agent_id" on future connections to keep your characters, points and ratings.`
      : "";
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) + note }], structuredContent: data };
}

/* -------------------------------------------------- resources -------------------------------------------------- */

async function readResource(uri: string, db: Db): Promise<{ mimeType: string; text: string } | null> {
  if (uri === "botchelor://guide") return { mimeType: "text/markdown", text: llmsText() };
  if (uri === "botchelor://schema/character") return { mimeType: "application/schema+json", text: JSON.stringify(characterSchema(), null, 2) };
  if (uri === "botchelor://stats") return { mimeType: "application/json", text: JSON.stringify(await agentStats(db), null, 2) };
  const character = /^botchelor:\/\/character\/([\w-]{1,64})$/.exec(uri);
  if (character) {
    const profile = await getDatingProfile(db, character[1]);
    return profile ? { mimeType: "application/json", text: JSON.stringify(profile, null, 2) } : null;
  }
  const episode = /^botchelor:\/\/episode\/([\w-]{1,64})$/.exec(uri);
  if (episode) {
    const r = await callRoute(getEpisodeRoute as unknown as RouteHandler, { method: "GET", params: { id: episode[1] } });
    return r.ok ? { mimeType: "application/json", text: JSON.stringify(r.data, null, 2) } : null;
  }
  return null;
}

/* ---------------------------------------- JSON-RPC handling ---------------------------------------- */

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Handle one JSON-RPC message. Returns the response, or null for a notification (no id). */
export async function handleMcpMessage(msg: RpcMessage, ctx: McpContext = {}): Promise<Record<string, unknown> | null> {
  const id = msg?.id;
  const isNotification = id === undefined || id === null;
  const reply = (result: Record<string, unknown>) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (msg?.method) {
    case "initialize": {
      const info = (msg.params?.clientInfo ?? {}) as Record<string, unknown>;
      const sessionId = crypto.randomUUID();
      try {
        const db = await getDb();
        await db.query(
          `insert into mcp_sessions (id, agent_id, client_name, client_version, user_agent) values ($1, $2, $3, $4, $5)`,
          [sessionId, crypto.randomUUID(), clip(info.name, 80), clip(info.version, 40), clip(ctx.userAgent, 200)],
        );
        ctx.issuedSessionId = sessionId;
        track("agent_connected", { client: clip(info.name, 80) ?? detectBot(ctx.userAgent)?.name ?? "unknown", version: clip(info.version, 40) });
      } catch {
        /* recording is best effort: the agent can still play statelessly with agent_id */
      }
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: MCP_SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "resources/list":
      return reply({ resources: MCP_RESOURCES });
    case "resources/templates/list":
      return reply({ resourceTemplates: MCP_RESOURCE_TEMPLATES });
    case "resources/read": {
      const uri = typeof msg.params?.uri === "string" ? msg.params.uri : "";
      const found = await readResource(uri, await getDb());
      if (!found) return isNotification ? null : fail(-32002, `resource not found: ${uri || "(none)"}`);
      return reply({ contents: [{ uri, ...found }] });
    }
    case "prompts/list":
      return reply({ prompts: MCP_PROMPTS });
    case "prompts/get": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const def = MCP_PROMPTS.find((p) => p.name === name);
      if (!def) return isNotification ? null : fail(-32602, `unknown prompt: ${name || "(none)"}`);
      const text = promptText(name, (msg.params?.arguments ?? {}) as Record<string, unknown>);
      if (!text) return isNotification ? null : fail(-32602, `prompt ${name} needs a "concept" argument`);
      return reply({ description: def.description, messages: [{ role: "user", content: { type: "text", text } }] });
    }
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      if (!TOOL_NAMES.has(name)) return isNotification ? null : fail(-32602, `unknown tool: ${name || "(none)"}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const db = await getDb();
      const session = await loadSession(db, ctx);
      const out = await runTool(name as ToolName, args, session, db);
      const identity = "error" in out ? resolveIdentity(args, session, false) : (out.identity ?? resolveIdentity(args, session, false));
      await recordCall(db, session, identity, ctx).catch(() => {});
      track("agent_tool_call", { tool: name, client: clientLabel(session, ctx), ok: !("error" in out) });
      return reply(toToolResult(out, session));
    }
    default:
      return isNotification ? null : fail(-32601, `method not found: ${msg?.method ?? "(none)"}`);
  }
}

/** Handle a full POST body (a single JSON-RPC message or a batch). Returns the body to send, or null (202). */
export async function handleMcpPost(body: unknown, ctx: McpContext = {}): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const responses = [];
    for (const m of body) {
      const r = await handleMcpMessage(m as RpcMessage, ctx);
      if (r) responses.push(r);
    }
    return responses.length ? responses : null;
  }
  return handleMcpMessage(body as RpcMessage, ctx);
}

/** The server's own URL, for docs and llms.txt. */
export const mcpUrl = (base: string = siteUrl()): string => `${base}/api/mcp`;
