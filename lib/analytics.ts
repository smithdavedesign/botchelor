/**
 * M10 — product analytics + unit economics.
 *
 * One structured JSON line per event to stdout, which Vercel captures as the system log (and a log
 * drain can ship onward to a warehouse). This is the hosted-app equivalent of the system-log emitter
 * the local runtime uses. Deliberately free of PII and character content: ids, enums and counts only —
 * never names, bios, dialogue, notes or soul data (PRD §14: "without placing sensitive character content
 * or personal information in analytics events").
 */
import type { DateUsage } from "./pricing";

export type AnalyticsEvent =
  | "episode_created"
  | "episode_generated" // the unit-economics event: model calls + latency for one date
  | "prediction_submitted"
  | "situation_vote" // a vote on tonight's situation (lib/situations.ts)
  | "night_plan_read" // a house date read the plan the producer wrote for it at night: whether it still fit (lib/night-plans.ts)
  | "night_plans_written" // the night's plans: how many, how many passed, how long (lib/night-plans.ts)
  | "season_format_vote" // a vote for next season's format (lib/season-vote.ts)
  | "show_idea_vote" // someone's answers on a show idea (lib/show-ideas.ts): which idea, which of the three, person or agent
  | "show_idea_proposed" // a show idea was proposed and is waiting for an admin: person or agent, never the words
  | "recoupling_vote" // a vote on the recoupling night (lib/recoupling.ts)
  | "ceremony_vote" // a vote on who goes home at Sunday's rose ceremony (lib/ceremony.ts)
  | "premiere_built" // the Sunday premiere's room was built: its kind, tries and the notices it sent (lib/sunday-premiere.ts)
  | "reveal_vote" // a vote on Sunday's reveal (lib/weekly-reveal.ts)
  | "cast_backed" // a viewer backed a cast member for the month (lib/backing.ts)
  | "audition" // an owner put their character up for next month's cast (lib/auditions.ts)
  | "audition_vote" // a vote on next month's auditions (lib/auditions.ts)
  | "cast_date_booked" // the weekly earned slot was spent on a date with a season cast member (lib/cast-date.ts)
  | "life_date_booked" // the house took an owned character out with a cast member, house-paid (lib/character-life.ts)
  | "casting_date" // a person's new character walked on: its first date went to the season's lead (lib/casting.ts)
  | "rose_date_booked" // a walk-on's Sunday rose booked its second date with the lead, show-paid (lib/casting.ts)
  | "casting_invites_made" // the admin made creator invite codes (lib/casting-invites.ts): how many
  | "casting_invite_used" // an invite applied a character, or its date was tried again (lib/casting-invites.ts): the code, the character, whether the lead's date booked
  | "dare_vote" // a vote on tonight's dare (lib/dares.ts)
  | "purchase_completed"
  | "purchase_refunded" // a full refund made in Stripe took the pack's unused dates back
  | "content_reported"
  | "generation_failed"
  | "conversation_failed" // the best-effort two-agent conversation gave up (the date still airs, with no thread)
  | "daily_job" // the daily cron: lobby refresh + transcript backfill + queued-job backstop
  | "daily_job_load" // what one daily-job request cost the instance: time, memory peak, longest event-loop stall (lib/job-meter.ts)
  | "date_quality" // the free genuineness metrics for one generated conversation (lib/quality.ts) — no content
  | "bot_visit" // a crawler or AI agent let past the 18+ gate (lib/bots.ts): its name, kind and the path
  | "agent_connected" // an MCP client initialized: its self-declared name/version, and the session we issued
  | "agent_tool_call" // one MCP tool call: the tool, the client and whether it succeeded — never arguments
  | "agent_date_capped" // an agent's date was refused because the agents' daily date cap was reached
  | "agent_feedback" // an agent sent feedback over MCP (lib/feedback.ts)
  | "user_feedback" // a person sent a note from the site (lib/user-feedback.ts): category, rated, flagged, ours, account; never the words
  | "own_date_handed_over" // a two-agent date's quiet side was handed to the show's model (lib/own-date.ts)
  | "own_date_autoplay" // an agent had the show's model play the rest of a self-played date (lib/own-date.ts)
  | "agent_doc_fetch" // someone fetched an agent-facing doc (/llms.txt, /llms-full.txt, the MCP discovery doc, the schema, robots, sitemap): which doc, and the bot's name/kind
  | "agent_referral_visit" // a visit that arrived from a link in an agent doc (utm_medium=ai_agent): the doc it came from and the landing path
  | "second_date_yes" // an owner said yes to a second date that also needs the other owner's yes (lib/second-date.ts)
  | "second_date_planned" // a second date was booked from a mutual afterglow: the new date, the one it follows, and the planned venue
  | "overnight_yes" // an owner said yes to an overnight date that also needs the other owner's yes (lib/overnight.ts)
  | "overnight_booked" // an overnight date was booked: by an owner (through the second-date flow) or by the house (lib/overnight-house.ts)
  | "overnight_continued" // an After Dark viewer continued an overnight date's night there (lib/adult/overnight.ts); ids only
  | "locked_picture_sent" // a character's locked-picture text went out (lib/locked-picture-texts.ts): what set it off and which tile they'll see; never the words or who
  | "show_date_free" // a show-model date fell through to the free model (the frontier wasn't configured): the episode, and whether that's unexpected
  | "scene_requested" // a finished date went somewhere the library has no set for (lib/scenes.ts): the place, normalized, and how (plan or move)
  | "date_link_accepted" // someone took a character's "date my OC" link (lib/date-invites.ts): the code, both characters
  | "double_link_made" // a couple's "bring a friend" double-date link was made (lib/double-links.ts): the code
  | "double_link_taken" // someone took a double-date link and both tables booked: the code, the night, and whether the taker's first character came after the link (new_creator)
  | "date_moved" // a finished date moved somewhere else by both characters' agreement (lib/moves.ts): how many times, and who performed it
  | "relationship_metrics" // the daily snapshot of the long game (lib/relationship-metrics.ts): counts only
  | "crisis_notice_shown" // a person's own words tripped the self-harm check (lib/crisis.ts): the surface only, never who or what
  | "companion_reply" // a companion answered (lib/companion.ts): the model, its cost and how long; never the words
  | "companion_report" // a person reported a companion's reply: the reason only
  | "companion_scene" // a companion thread started a scene at a place, or went back to texting: the place only
  | "companion_message_delete" // a person deleted one message of a companion thread (lib/companion-message-delete.ts): whose it was and whether it was said on a call; never the words
  | "companion_text" // a character texted its person first (lib/companion.ts postFromCharacter): the kind of text and how many bubbles; never the words
  | "express_draft" // one-sentence create drafted a sheet, or didn't (app/api/characters/draft): ready or the reason; never the words
  | "character_question" // a character asked its owner about its own sheet (lib/character-questions.ts): the field only
  | "character_lessons" // the daily job wrote characters' weekly lessons (lib/character-lessons-job.ts): how many (ours apart), by model or template, texts sent, the cost; never the words
  | "character_answer" // the owner answered one (the thread's answer box): the field, and whether the sheet's checks took it
  | "companion_offer" // a chip under one of those texts was tapped (lib/companion-offers.ts): which offer (second_date, someone_new, advice), and whether a guest
  | "companion_voice" // a companion reply recorded as a voice note (lib/companion-voice.ts): how long, its length, what paid; never the words
  | "companion_call" // a voice call with a companion started or ended (stage; app/companion/[id]/CompanionCall.tsx): how long, how many turns, which voice, and for a live call (live: P6) its minutes, first-audio ms and barge-ins; never the words
  | "face_kit" // a character's face kit was drawn for calls (lib/face-kit.ts): how many stills, whether the loop was queued, failures, the cost estimate; never a picture
  | "step_in_started" // a person stepped into a date with a cast member (lib/step-in.ts): the episode, how it was paid, as which kind of character
  | "step_in_finished" // a step-in date's last line and recap are in: the episode, its ending, its lines and what the show's side cost
  | "step_in_aired" // the person chose to air their step-in date (it was private until then)
  | "step_in_refused" // a start that a cap turned away (lib/step-in.ts): which cap, and whether a guest; never who
  | "step_in_line_withheld" // a cast line on a step-in date was never said (it voiced self-harm): the episode and why
  | "data_pruned" // the daily job's retention prune (lib/retention.ts): rows removed per table
  | "story_check" // one pass of the story check (lib/story-check.ts): verdict counts, repairs, tokens and cost; never a date or its words
  | "plus_interest"; // a tap on the "Botchelor Plus" intent tile (lib/plus-interest.ts): where, and whether an email was left

type Props = Record<string, string | number | boolean | null | undefined>;

/** Emit one analytics event. Never throws: logging must not break a request. */
export function track(event: AnalyticsEvent, props: Props = {}): void {
  try {
    const clean: Record<string, unknown> = { log: "analytics", event };
    for (const [k, v] of Object.entries(props)) if (v !== undefined) clean[k] = v;
    clean.at = new Date().toISOString();
    console.log(JSON.stringify(clean));
  } catch {
    /* ignore: analytics must never be load-bearing */
  }
}

/**
 * Unit economics for one generated date (no content): which model, how many calls, how long, and the tokens they
 * used. cost_usd is what the date would cost at paid-tier list prices (lib/pricing.ts): $0 in cash on the free
 * tier, and the number pricing is set against (docs/upgrade-cost.md).
 */
export function trackEpisodeCost(props: {
  episode_id: string;
  where?: "job" | "template" | "template_retake" | "backfill" | "step_in";
  model: "free" | "frontier";
  model_calls: number;
  ms: number;
  transcript_turns: number;
  usage?: DateUsage;
}): void {
  const { usage, ...rest } = props;
  track("episode_generated", {
    ...rest,
    ...(usage
      ? {
          input_tokens: usage.input_tokens,
          cached_input_tokens: usage.cached_input_tokens,
          output_tokens: usage.output_tokens,
          thinking_tokens: usage.thinking_tokens,
          cost_usd: usage.cost_usd,
          models: usage.models.join(","),
        }
      : {}),
  });
}

/**
 * The genuineness metrics for one generated date (lib/quality.ts), logged so quality on real dates is watched
 * for free, every day — numbers only, never a line of dialogue.
 */
export function trackDateQuality(
  episode_id: string,
  where: string,
  plan: "director" | "rules" | "producer" | null,
  q: {
    index: number; turns: number; profile_reading: number; self_labels: number; self_quotes: number; misgendered: number;
    abrupt_flips: number; repeated_openers: number; repeated_actions: number; name_tics: number; question_rate: number;
    responsiveness: number; distinctness: number; voice_breaks?: number;
  },
): void {
  track("date_quality", {
    episode_id, where, plan, index: q.index, turns: q.turns, profile_reading: q.profile_reading, self_labels: q.self_labels,
    self_quotes: q.self_quotes, misgendered: q.misgendered, abrupt_flips: q.abrupt_flips, repeated_openers: q.repeated_openers,
    repeated_actions: q.repeated_actions, name_tics: q.name_tics, question_rate: q.question_rate, responsiveness: q.responsiveness, distinctness: q.distinctness,
    voice_breaks: q.voice_breaks ?? 0,
  });
}
