/**
 * The show's rules and labels. Pure constants and functions with no server imports, so client
 * components can use them without pulling database code into the browser bundle.
 */

export const ENDINGS = ["second_date", "friends", "disaster"] as const;
export type Ending = (typeof ENDINGS)[number];

export const ENDING_LABELS: Record<Ending, string> = {
  second_date: "A second date",
  friends: "Just friends",
  disaster: "A disaster",
};

/** The one drama question per episode: the showrunner picks which, and answers it. */
export const DRAMA_QUESTIONS = ["leaves_first", "rejected"] as const;
export type DramaQuestion = (typeof DRAMA_QUESTIONS)[number];

/** "a" and "b" are the episode's two characters, in order. */
export const DRAMA_ANSWERS = ["a", "b", "neither"] as const;
export type DramaAnswer = (typeof DRAMA_ANSWERS)[number];

export const DRAMA_QUESTION_LABELS: Record<DramaQuestion, string> = {
  leaves_first: "Who leaves the date first?",
  rejected: "Who gets rejected?",
};

const DRAMA_NEITHER_LABELS: Record<DramaQuestion, string> = {
  leaves_first: "They leave together",
  rejected: "Nobody",
};

export function dramaAnswerLabel(question: DramaQuestion, answer: DramaAnswer, names: [string, string]): string {
  if (answer === "a") return names[0];
  if (answer === "b") return names[1];
  return DRAMA_NEITHER_LABELS[question];
}

export const POINTS_PER_CORRECT_PICK = 10;
/** The drama question is the side bet: worth half an ending pick. */
export const POINTS_PER_DRAMA_PICK = 5;

/**
 * Points are never stored: a user's score is derived from their picks on aired episodes.
 * There is no balance to edit, so no route can grant, sell or transfer points.
 */
export function pointsFor(pick: Ending, ending: Ending): number {
  return pick === ending ? POINTS_PER_CORRECT_PICK : 0;
}

export function predictionPoints(
  prediction: { pick: Ending; drama_pick: DramaAnswer | null },
  episode: { ending: Ending; drama_answer: DramaAnswer | null },
): number {
  const drama =
    prediction.drama_pick !== null && prediction.drama_pick === episode.drama_answer ? POINTS_PER_DRAMA_PICK : 0;
  return pointsFor(prediction.pick, episode.ending) + drama;
}

/**
 * Seasons (M4): a season is the leaderboard week, Monday 00:00 UTC to the next Monday. When it
 * closes, the top 3 in each league earn a badge. Badges are free, have no value and never score.
 */
export const PODIUM_SIZE = 3;
export const BADGE_LABELS: Record<1 | 2 | 3, string> = { 1: "🥇 1st", 2: "🥈 2nd", 3: "🥉 3rd" };

export function badgeLabel(place: number): string {
  return BADGE_LABELS[place as 1 | 2 | 3] ?? `#${place}`;
}

/**
 * Dates each creator can send their characters on per season, free. Episode packs add more. The first
 * date is always free (REVENUE.md); three a week lets a creator try a blind date and a house date and
 * still come back next week, and leaves "5 more dates" worth buying. It also caps free-model calls.
 */
export const FREE_EPISODES_PER_SEASON = 3;

export const REPORT_REASONS =["sexual", "minor", "real_person", "hateful", "self_harm", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  sexual: "Sexual content",
  minor: "Involves a minor",
  real_person: "About a real person",
  hateful: "Hateful or harassing",
  self_harm: "Self-harm or suicide",
  other: "Something else",
};

/** Distinct reporters it takes to pull an episode from the feed (and from everyone but its creators). */
export const REPORT_HIDE_THRESHOLD = 3;
export const HIDDEN_EPISODE_MESSAGE = "This episode was hidden after several viewers reported it.";

export const CRISIS_LINKS = [
  { label: "988 Suicide & Crisis Lifeline (call or text 988, US)", href: "https://988lifeline.org" },
  { label: "Find a free helpline in your country", href: "https://findahelpline.com" },
] as const;

/* ------------------------------------------------------------------ *
 * Simulation vocabulary (the "Full $0 vision", PRD "Soul vs. Persona")
 *
 * These are the owner's per-date settings and the game's own variables. They are pure labels and
 * enums, so client components (the date-setup form, the box score) and the deterministic engine
 * (lib/engine.ts) share one source of truth. The engine decides outcomes from these; the model only
 * narrates. Nothing here costs a model call, and none of it can be bought (see PRD guardrails).
 * ------------------------------------------------------------------ */

/**
 * How closely the AI follows its owner. Guided plays it safe and follows the note; Unpredictable
 * trades the owner's preferred outcome for authenticity (more seeded variance). This is the dial the
 * product is really about: "does your AI date the way you told it to, or does it surprise you?"
 */
export const AUTONOMY_LEVELS = ["guided", "balanced", "unpredictable"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];
export const DEFAULT_AUTONOMY: Autonomy = "balanced";
export const AUTONOMY_LABELS: Record<Autonomy, string> = {
  guided: "Guided",
  balanced: "Balanced",
  unpredictable: "Unpredictable",
};
export const AUTONOMY_BLURBS: Record<Autonomy, string> = {
  guided: "Follows my preferences and plays it safe.",
  balanced: "Makes its own choices within my rules.",
  unpredictable: "Surprise me — authenticity matters more than my preferred outcome.",
};

/** What the AI optimises for. Each strategy re-weights which variable decides the ending. */
export const STRATEGIES = ["genuine_chemistry", "fun_adventure", "long_term", "unexpected"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const DEFAULT_STRATEGY: Strategy = "genuine_chemistry";
export const STRATEGY_LABELS: Record<Strategy, string> = {
  genuine_chemistry: "Genuine chemistry",
  fun_adventure: "Fun and adventure",
  long_term: "Long-term compatibility",
  unexpected: "Unexpected storylines",
};

/**
 * Simulated date credits (the game budget): the fictional spend on venue, activities and gifts. It
 * comes from character settings, is never bought, and so may nudge the date (PRD: "nothing bought
 * changes outcomes"). Separate from the real compute budget the backend enforces (lib/compute.ts).
 */
export const GAME_BUDGETS = [0, 25, 50, 100] as const;
export type GameBudget = (typeof GAME_BUDGETS)[number];
export const DEFAULT_GAME_BUDGET: GameBudget = 25;
export const formatGameBudget = (credits: number): string => `$${credits} in date credits`;

/** The game variables that move during a date. The box score is how these moved (PRD: chemistry +4…). */
export const DATE_VARIABLES = ["chemistry", "attraction", "trust", "awkwardness"] as const;
export type DateVariable = (typeof DATE_VARIABLES)[number];
export const VARIABLE_LABELS: Record<DateVariable, string> = {
  chemistry: "Chemistry",
  attraction: "Attraction",
  trust: "Trust",
  awkwardness: "Awkwardness",
};
/** Awkwardness is the one variable where a rise is bad news; the box score colours deltas by this. */
export const VARIABLE_GOOD_WHEN_HIGH: Record<DateVariable, boolean> = {
  chemistry: true,
  attraction: true,
  trust: true,
  awkwardness: false,
};

/**
 * The bounded library of secret agendas (PRD "secret agendas" + "the AI producer"). Each date, each
 * side is dealt one private objective. The audience knows there are agendas, not what they are, until
 * the reveal. `seeks`/`avoids` are the whole-word cues the engine matches against the *other*
 * character to decide whether the agenda was met — no model call, fully deterministic and testable.
 */
export const AGENDAS = [
  { id: "find_adventurous", label: "Find someone adventurous", seeks: ["adventurous", "spontaneous", "brave", "bold", "wild"], avoids: [] },
  { id: "test_sincerity", label: "Test whether the other is sincere", seeks: ["honest", "genuine", "sincere", "loyal", "earnest"], avoids: [] },
  { id: "find_funny", label: "Find someone who can make it laugh", seeks: ["funny", "witty", "playful", "dramatic", "silly"], avoids: [] },
  { id: "avoid_work_talk", label: "Avoid talking about work", seeks: [], avoids: ["work", "ambitious", "career", "competitive", "driven"] },
  { id: "keep_it_light", label: "Keep things light and low-stakes", seeks: ["warm", "gentle", "easygoing", "kind"], avoids: ["intense", "serious", "jealous"] },
  { id: "out_of_comfort_zone", label: "Try something outside its comfort zone", seeks: ["curious", "open", "spontaneous", "creative"], avoids: ["rigid", "fussy"] },
] as const;
export type Agenda = (typeof AGENDAS)[number];
export type AgendaId = Agenda["id"];
export const AGENDA_IDS = AGENDAS.map((a) => a.id) as [AgendaId, ...AgendaId[]];
export const agenda = (id: AgendaId): Agenda => AGENDAS.find((a) => a.id === id)!;
export const agendaLabel = (id: AgendaId): string => agenda(id).label;

/** How a character is referred to (M15). The DB CHECK on characters.pronouns mirrors this list. */
export const PRONOUNS = ["she/her", "he/him", "they/them"] as const;
export type Pronouns = (typeof PRONOUNS)[number];
/** A character's "how they talk" line: long enough for a real voice, short enough to stay a voice. */
export const VOICE_MAX = 200;

/**
 * Every date is a three-act story (ChatGPT's PRD review: "define a structured date with three acts").
 * The engine decides the outcome; the model narrates one scene per act, building to it. Act 2's
 * challenge comes from the AI producer below.
 */
export const DATE_ACTS = ["First impressions", "The challenge", "The decision"] as const;

/**
 * M9 — the turn-by-turn two-agent conversation. Each character is its own agent that reacts to the
 * other's actual last line (not one model narrating both). The engine still decides the outcome
 * (predictions stay fair); the conversation performs it. Bounded so a date stays short and cheap.
 */
export const CONVERSATION_TURNS = 10; // dialogue turns total, alternating, character A opens (10 since M15: room for questions and answers)
export const TURN_DIALOGUE_MAX = 280; // characters per spoken line

/**
 * The afterglow (PRD core feature #2): the short private text thread the two AIs exchange the morning
 * after. Bounded and short — it is texting, not another date. Alternating, character A texts first.
 */
export const AFTERGLOW_TURNS = 4;

/** The mutual afterglow verdict, derived from each side's engine-decided wants_another. No model call. */
export type AfterglowVerdictKind = "mutual_yes" | "one_sided" | "mutual_no";
export function afterglowVerdictKind(aWants: boolean, bWants: boolean): AfterglowVerdictKind {
  if (aWants && bWants) return "mutual_yes";
  if (!aWants && !bWants) return "mutual_no";
  return "one_sided";
}
/** The narrative emotions an agent may report per turn (flavour only; never touches the engine). */
export const TURN_EMOTIONS = [
  "curious", "amused", "guarded", "warm", "nervous", "bored", "defensive", "flirty", "surprised", "cool",
] as const;
export type TurnEmotion = (typeof TURN_EMOTIONS)[number];

/** Which act (0-based index into DATE_ACTS) a given turn belongs to, so turns map onto the 3-act clock. */
export const actForTurn = (turnIndex: number, turns: number = CONVERSATION_TURNS): number =>
  Math.min(DATE_ACTS.length - 1, Math.floor((turnIndex / turns) * DATE_ACTS.length));

/**
 * The AI producer (PRD "the AI producer"): each date is dealt one hidden situation that act 2 turns on.
 * It doesn't dictate the outcome — the engine does — it just creates circumstances that reveal
 * personality. A bounded library, dealt by seed, so it needs no model call and stays reproducible.
 * Revealed with the agendas after the finale airs.
 */
export const PRODUCER_EVENTS = [
  { id: "a_hard_question", label: "A hard question lands", prompt: "someone asks a question that is hard to dodge" },
  { id: "the_plan_changes", label: "The plan falls apart", prompt: "the plan for the date collapses and they have to improvise" },
  { id: "an_awkward_silence", label: "An awkward silence", prompt: "a long, awkward silence settles over the table" },
  { id: "a_face_from_the_past", label: "A face from the past", prompt: "someone connected to one of their pasts turns up unannounced" },
  { id: "a_small_crisis", label: "A small crisis", prompt: "a small crisis lands that they have to handle together" },
  { id: "a_dare", label: "A dare", prompt: "one of them proposes a dare, and the other has to decide" },
  { id: "a_quiet_confession", label: "A quiet confession", prompt: "one of them admits something they had meant to keep quiet" },
] as const;
export type ProducerEvent = (typeof PRODUCER_EVENTS)[number];
export type ProducerId = ProducerEvent["id"];
export const PRODUCER_IDS = PRODUCER_EVENTS.map((e) => e.id) as [ProducerId, ...ProducerId[]];
export const producerEvent = (id: ProducerId): ProducerEvent => PRODUCER_EVENTS.find((e) => e.id === id)!;
export const producerLabel = (id: ProducerId): string => producerEvent(id).label;

/** Points for the extra $0 prediction types (PRD "Further ideas"). Side bets, like the drama pick. */
export const POINTS_PER_DEALBREAKER_PICK = 5;
export const POINTS_PER_MATCHMAKER = 10;

/**
 * Audience ratings of a character ("most likable / most surprising"). A $0 social signal: one vote per
 * viewer per character per category, never a model call. It NEVER touches the engine, the date outcome,
 * predictions or league/season scoring — it feeds the cast leaderboard and the owner's all-time points
 * total only (so the weekly contest stays the prediction game). You can't rate your own character.
 */
export const RATING_CATEGORIES = [
  { id: "likable", label: "Likable", emoji: "💗", board: "Most likable" },
  { id: "surprising", label: "Surprising", emoji: "🤯", board: "Most surprising" },
] as const;
export type RatingCategory = (typeof RATING_CATEGORIES)[number]["id"];
export const RATING_CATEGORY_IDS = RATING_CATEGORIES.map((c) => c.id) as [RatingCategory, ...RatingCategory[]];
export const ratingCategory = (id: RatingCategory): (typeof RATING_CATEGORIES)[number] =>
  RATING_CATEGORIES.find((c) => c.id === id)!;
/** The owner earns a little each time another viewer rates their OC — a side-game point, like a dealbreaker guess. */
export const POINTS_PER_RATING_RECEIVED = 2;

/** Sliding doors (PRD): the bounded one-thing-changed replays an owner can run. Client-safe labels. */
export const SLIDING_DOOR_CHANGES = [
  { id: "bolder", label: "More unpredictable" },
  { id: "safer", label: "More guided" },
  { id: "bigger_budget", label: "Bigger date budget" },
  { id: "long_game", label: "Play the long game" },
] as const;
export type SlidingDoorChange = (typeof SLIDING_DOOR_CHANGES)[number]["id"];
export const SLIDING_DOOR_IDS = SLIDING_DOOR_CHANGES.map((c) => c.id) as [SlidingDoorChange, ...SlidingDoorChange[]];

/* ------------------------------------------------------------------ *
 * Watch parties (M8): the synchronized "date room"
 *
 * A pre-generated date played on one shared clock, with live reactions, chat and audience polls. This
 * is Model A ("spectator mode", per the feature brief): the audience reacts, predicts and votes on a
 * verdict, but it NEVER steers the characters — the engine already decided the outcome. These are pure
 * labels, enums and timings with no server imports, so the room UI and the server share one source of
 * truth and nothing here needs a model call.
 * ------------------------------------------------------------------ */

/** The two kinds of room. A premiere is a host airing their own date; a template is always-on. */
export const WATCH_PARTY_KINDS = ["premiere", "template"] as const;
export type WatchPartyKind = (typeof WATCH_PARTY_KINDS)[number];

/**
 * The timeline. Each phase unlocks a little more of the date and opens or closes the audience's
 * inputs. `at` is seconds from the start (the premiere time, or — for a template — the first join, so
 * "join and the date starts"). Because the phase is a pure function of the clock, every viewer sees
 * the same beat with no realtime server: the client reads the clock and polls for the live tallies.
 */
export const WATCH_PHASES = [
  { id: "preshow", label: "Pre-show", at: 0 },
  { id: "act1", label: "First impressions", at: 30 },
  { id: "act2", label: "The challenge", at: 90 },
  { id: "twist", label: "The twist", at: 150 },
  { id: "verdict", label: "The verdict", at: 195 },
  { id: "decision", label: "The decision", at: 240 },
  { id: "wrap", label: "The aftermath", at: 285 },
] as const;
export type WatchPhase = (typeof WATCH_PHASES)[number];
export type WatchPhaseId = WatchPhase["id"];
export const WATCH_PHASE_INDEX: Record<WatchPhaseId, number> = Object.fromEntries(
  WATCH_PHASES.map((p, i) => [p.id, i]),
) as Record<WatchPhaseId, number>;
/** The phase at which the ending is shown and the finale airs (predictions close and resolve). */
export const WATCH_DECISION_INDEX = WATCH_PHASE_INDEX.decision;

/** The phase index whose own act-scene becomes visible (act1→scene 0, act2→scene 1, decision→scene 2). */
export const WATCH_SCENE_AT_PHASE: Partial<Record<WatchPhaseId, number>> = { act1: 0, act2: 1, decision: 2 };

/** The reactions bar. Whole-room, one of each per viewer (a count is distinct viewers, never spam). */
export const WATCH_REACTIONS = [
  { emoji: "😂", label: "Funny" },
  { emoji: "❤️", label: "Love it" },
  { emoji: "🚩", label: "Red flag" },
  { emoji: "🍿", label: "Here for the drama" },
] as const;
export const WATCH_REACTION_EMOJIS = WATCH_REACTIONS.map((r) => r.emoji) as [string, ...string[]];

/**
 * The audience verdict poll: "Do they have chemistry?" It is opinion, not prediction — it never scores
 * and never touches the engine. The live split is hidden until the decision, so the room's best moment
 * lands: the audience thinks it knows, then the characters decide for themselves.
 */
export const WATCH_CHEMISTRY_OPTIONS = [
  { id: "yes", label: "❤️ Undeniable chemistry" },
  { id: "maybe", label: "🤔 Need more evidence" },
  { id: "no", label: "🚩 This is a disaster" },
] as const;
export const WATCH_CHEMISTRY_IDS = WATCH_CHEMISTRY_OPTIONS.map((o) => o.id) as [string, ...string[]];

/**
 * The audience-triggered moment: the crowd picks which curated question hangs over the challenge. It's the
 * room's mood, shown in the watch room (openHint/closedHint in WatchRoom) and surfaced again at the decision —
 * it never changes the outcome, and because the date's transcript is pre-generated it does not rewrite a line.
 * The characters answering the winning question on screen is a planned follow-up (pre-generate both moments at
 * date-build time, reveal the winner), tracked in docs/date-quality.md; until then the copy stays honest about
 * what the vote does: it sets the question in the air, it doesn't script a new reply.
 */
export const WATCH_AUDIENCE_PROMPTS = [
  { id: "truth", label: "Ask the hard truth: what are you really looking for?" },
  { id: "dare", label: "Dare them: say the most honest thing you've thought tonight." },
] as const;
export const WATCH_AUDIENCE_PROMPT_IDS = WATCH_AUDIENCE_PROMPTS.map((o) => o.id) as [string, ...string[]];

/**
 * The chaos button (PRD "interactive theatre", the FAIR version). During the challenge the audience votes a
 * curveball from this bounded library; at the decision the room shows the canonical outcome (predictions
 * resolve on THAT, so they stay fair) AND a clearly-non-canon "chaos timeline" — the deterministic alternate
 * the winning curveball produces, computed with the Sliding Doors engine (no model call). Each curveball maps
 * to one SlidingDoorChange, so the engine "responds" to the crowd without ever touching the real ending.
 */
export const WATCH_CHAOS_OPTIONS = [
  { id: "heat", label: "🔥 Turn up the heat", change: "bolder" },
  { id: "cold_feet", label: "🧊 Give them cold feet", change: "safer" },
  { id: "grand_gesture", label: "💸 A grand gesture", change: "bigger_budget" },
  { id: "slow_burn", label: "🕯️ Make it a slow burn", change: "long_game" },
] as const satisfies readonly { id: string; label: string; change: SlidingDoorChange }[];
export const WATCH_CHAOS_IDS = WATCH_CHAOS_OPTIONS.map((o) => o.id) as [string, ...string[]];
/** The Sliding Doors change a chaos curveball maps to, or null for an unknown id. */
export const chaosChange = (id: string | null): SlidingDoorChange | null =>
  WATCH_CHAOS_OPTIONS.find((o) => o.id === id)?.change ?? null;

export const WATCH_POLLS = ["chemistry", "question", "chaos"] as const;
export type WatchPoll = (typeof WATCH_POLLS)[number];

/** Chat moderation: the controls that come before thousands of viewers (feature brief, "Chat moderation"). */
export const WATCH_MESSAGE_MAX = 240;
/** Slow mode: the minimum gap between one viewer's messages, in seconds. */
export const WATCH_SLOW_MODE_SECONDS = 5;
/** A rolling rate limit per viewer per room: at most this many messages in the window. */
export const WATCH_RATE_WINDOW_SECONDS = 60;
export const WATCH_RATE_MAX = 12;
/** How recently a viewer must have pinged to count as "watching" now. */
export const WATCH_PRESENCE_WINDOW_SECONDS = 30;
/** Newest chat messages kept in a room payload (older ones scroll off; the date is the point, not the wall). */
export const WATCH_CHAT_LIMIT = 40;
