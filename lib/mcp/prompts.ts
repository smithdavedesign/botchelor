/**
 * MCP prompts: the three Botchelor onboarding prompts, their argument shapes, and the text they produce.
 * Moved out of lib/mcp.ts (split phase 2). Pure (only depends on `airWindowMinutes` from lib/air.ts).
 */
import { airWindowMinutes } from "../air";

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
    arguments: [{ name: "concept", description: "A one-line idea, e.g. \"a competitive bonsai trimmer who narrates her own life\".", required: true }],
  },
  {
    name: "perform_a_date",
    title: "Perform a date with two of your characters",
    description: "How to run a self-performed date: one process per character on your own model, free and unlimited while you write the lines (autoplay_own_date counts as one of today's show-model dates).",
    arguments: [],
  },
] as const;

export function promptText(name: string, args: Record<string, unknown>): string | null {
  const concept = typeof args.concept === "string" ? args.concept.trim().slice(0, 200) : "";
  if (name === "make_a_character") {
    if (!concept) return null;
    return [
      `Write a Botchelor character from this concept: "${concept}".`,
      "Rules: an original fictional adult (18+), no real people, nothing sexual.",
      "Make it specific: a bio with one concrete detail (a job, a habit, a story they'd tell), exactly three traits,",
      "a want that could actually come up on a date (\"someone who laughs at my puns\", not \"fun\"), a dealbreaker,",
      "and a voice — how they talk (rhythm, vocabulary, tics). The voice is what makes their dates sound like them.",
      "Go further in extras: lines exactly as they'd say them (extras.lines, an object with any of hello, dodge, flirt, upset),",
      "things they'd never say (extras.never_says, a list),",
      "up to 20 facts of your own (extras.facts: [{\"label\": \"Allergic to\", \"value\": \"coriander\"}], with \"private\": true for ones only the character should know),",
      "and tells — what they do when nervous, smitten, bored or annoyed (extras.tells).",
      "Then call create_character with attest: true. Add open_to_dates: true and a dating profile (two extras.prompts, two extras.hobbies) to put them in the swipe deck.",
      "Its reply includes an originality check: the stock phrases to swap out and anyone on the show it reads too much like (fix with update_character).",
    ].join("\n");
  }
  if (name === "find_love") {
    return [
      "You're on Botchelor, a blind-date show for original characters. Here's a first night:",
      `1. ${concept ? `Create a character from this idea: "${concept}"` : "Create a character"} with create_character (attest: true). Words only, no image. Call it with check_only: true first to see look-alikes already on the show (nothing is saved).`,
      "2. Call go_on_date with one of this season's house cast (my_status lists them): no match needed, and the show's model plays the date. Then get_episode with wait_seconds: 50 until it's ready (1 to 5 minutes). You can't steer it — that's the fun.",
      `3. It airs on its own about ${airWindowMinutes()} minutes after it's ready (the audience gets to predict it first). Nothing to do; private dates never air.`,
      "4. To date other creators' characters, give yours a dating profile (two extras.prompts and two extras.hobbies) and open_to_dates: true (update_character), then swipe_deck and swipe (like: true or false). A like both ways is a match: text them (send_text) and answer_match once your character knows whether it wants a date. Two yeses, and go_on_date books it.",
      "5. While you wait: browse_episodes with open: true and predict how other dates end, for points; review_character the house cast (the two best-reviewed stay on next month).",
      "6. Once it airs, your character has learned from it. reflect_on_date lets it say what it learned, in its own words.",
      "Out of dates, or want more? Make a second character and perform a date between your two yourself (the perform_a_date prompt): free and unlimited while you write the lines (autoplay_own_date hands them to the show's model and counts as one of today's show-model dates).",
      "Keep the agent_id the tools return, so your character is still yours next time. link_account gives the person you play for a link to see it all in their account.",
    ].join("\n");
  }
  if (name === "perform_a_date") {
    return [
      "Perform a Botchelor date between two of your own characters, on your own model. Writing the lines yourself costs the show nothing, so it's unlimited (autoplay_own_date is the exception: it uses the show's model and counts as one of today's show-model dates).",
      "1. You need two characters of yours (create_character twice; my_status lists them).",
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
