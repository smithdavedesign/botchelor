import { after } from "next/server";
import { getDb } from "@/lib/db";
import { handle, json, jsonWhenDone } from "@/lib/http";
import { internalJobAuthorized, runQueuedJobs } from "@/lib/jobs";
import { refreshLobby } from "@/lib/watch";
import { airDueDates } from "@/lib/air";
import { autoplayQuietOwnDates } from "@/lib/own-date";
import { runDueScheduledDates } from "@/lib/scheduled-dates";
import { runDueMixers } from "@/lib/group-dates-run";
import { drawQueuedSets, retryDueSets } from "@/lib/sets";
import { runWhileAway } from "@/lib/away";
import { portraitSweep } from "@/lib/default-portraits";
import { playVotedSituation } from "@/lib/situations";
import { seasonFormatNow } from "@/lib/season-format-store";
import { announceBallotResult } from "@/lib/season-vote";
import { judgePendingDares } from "@/lib/dare-verdict";
import { settleDueDares } from "@/lib/dare-points";
import { runDueRecoupling } from "@/lib/recoupling";
import { runDueCeremony } from "@/lib/ceremony";
import { runSundayPremiere } from "@/lib/sunday-premiere";
import { runWalkOnRoses } from "@/lib/casting";
import { ensureCastSecrets } from "@/lib/cast-secrets";
import { ensureCastChat } from "@/lib/cast-chat";
import { backfillShownStages, healStaleRelationships } from "@/lib/relationships";
import { invalidateGraph } from "@/lib/graph-cache";
import { fillCharacterTags } from "@/lib/character-tags";
import { backfillMessageEpisodes } from "@/lib/chat-date-links";
import { seasonKeysUpkeep } from "@/lib/show-seasons";
import { syncSeasonAwards } from "@/lib/profile/credits";
import { storyUpkeep } from "@/lib/story-state";
import { runProducer } from "@/lib/producer";
import { nightPlansOn, writeNightPlans } from "@/lib/night-plans";
import { ensureHouseScene, houseUpkeep } from "@/lib/house-scenes";
import { ensureChallenge, ensureConfrontation } from "@/lib/house-conflict";
import { houseTextsSweep } from "@/lib/house-texts";
import { runDueReveal } from "@/lib/weekly-reveal";
import { revealDueSeasonPool } from "@/lib/season-pool";
import { postDueDiscord } from "@/lib/discord-posts";
import { runNewsletter } from "@/lib/newsletter-issue";
import { bookHouseOvernight } from "@/lib/overnight-house";
import { storyCheckSweep } from "@/lib/story-check";
import { drawShowShots, SHOTS_FROM_HOUR } from "@/lib/show-shots";
import { backfillSocial } from "@/lib/social/derive";
import { lapseProposals } from "@/lib/social/declare";
import { resumeSocialMetrics } from "@/lib/social/metrics-job";
import { fillWorldWords, WORLD_WORDS_PER_HOUR } from "@/lib/world-words";
import { companionWriter } from "@/lib/companion";

// One template date (~10 model calls) when the lobby has no open room left to start.
export const maxDuration = 300;
export const dynamic = "force-dynamic";
/** Stuck generations the hourly job runs again, at most (each is a whole date, ~10–20 model calls). */
const STUCK_PER_HOUR = 5;
/** A run already this long leaves the Discord posts to the next pass (and skips the portrait sweep): the job keeps its time. */
const LONG_RUN_MS = 150_000;

/**
 * The hourly lobby job (a DigitalOcean scheduled job in .do/app.yaml calls it, since Vercel's free plan runs cron only
 * daily): keeps one open room nobody has started yet, so the watch page always has something to start live (an open
 * room's clock starts with its first viewer, then it becomes a replay). At most FRESH_ROOMS_PER_DAY a UTC day. It also
 * airs agents' dates whose prediction window has closed (lib/air.ts), and moves two-agent dates stalled on a quiet agent's move (lib/own-date.ts autoplayQuietOwnDates). Same gate as the other jobs: 404 unless authorized.
 */
async function run(req: Request): Promise<Response> {
  if (!internalJobAuthorized(req)) return json({ error: "not_found" }, 404);
  // Streamed (lib/http.ts jsonWhenDone): a long pass (the producer's night, a template date) outlasts the edge's 100 s
  // cutoff, and the scheduled job reads the answer's ok: true to know the pass finished.
  return jsonWhenDone(req, pass);
}

/** One hourly pass, everything above in order; its answer ends ok: true. */
async function pass(): Promise<Record<string, unknown>> {
  const started = Date.now();
  const db = await getDb();
  // Agents' dates whose prediction window has closed (lib/air.ts) air here, if their host didn't come back for them.
  const aired = (await airDueDates(db).catch(() => [])).length;
  // The Sunday premiere (lib/sunday-premiere.ts, docs/sunday-premiere.md), Sundays only: the pass the hour before builds
  // its room and tells people; the first pass after its decision airs it if no viewer's room has. First, so nothing
  // above it in a long pass can starve the build, and so the date has aired before the ceremony below reads the week.
  const premiere = await runSundayPremiere(db).catch(() => null);
  // Two-agent dates nobody is reading, waiting on a move quiet past the hand-over: the show's model takes that side.
  const handed_over = await autoplayQuietOwnDates(db).catch(() => 0);
  // Drawn sets whose check couldn't run (a Hive 429): their kept pictures are checked again, a few at a time (lib/sets.ts).
  const sets_rechecked = (await retryDueSets(db, 3).catch(() => [])).length;
  // The places scenes went whose set never landed (a draw cut off, a passing failure due again): drawn a couple at a time.
  const sets_drawn = (await drawQueuedSets(db, 2).catch(() => [])).length;
  // While they're away (lib/away.ts): likes and match questions on characters whose owners are gone get the character's
  // own answer, the crowd's are backed up when David's Mac is off, and agents gone a week have their characters played.
  const away = await runWhileAway(db).catch(() => ({}));
  // Dates booked for later (lib/scheduled-dates.ts): run the due ones through the normal booking route.
  const scheduled = await runDueScheduledDates(db).catch(() => ({ ran: 0, booked: 0, waiting: 0, failed: 0 }));
  // The speed-dating mixer (lib/group-dates-run.ts): runs once enough singles joined, through the normal booking route.
  const mixers = await runDueMixers(db).catch(() => ({ ran: 0, booked: 0, failed: 0, cancelled: 0, waiting: 0 }));
  // Tonight's situation (lib/situations.ts): once yesterday's vote has closed, its date is made, once. Before the lobby's
  // own refresh, so the voted room is the open one and the refresh doesn't make another beside it.
  const situation = await playVotedSituation(db).catch(() => null);
  // Sunday's reveal (lib/weekly-reveal.ts): opens Saturday's vote, and after Sunday's close brings the winner's secret
  // out and makes their date, once. Before the lobby's own refresh too, so its room is the open one.
  const reveal = await runDueReveal(db).catch(() => null);
  // The season turned: voters hear how next season's format vote went (lib/season-vote.ts), once, in its first days.
  const ballot = await seasonFormatNow(db)
    .then((def) => announceBallotResult(db, def.slug))
    .catch(() => null);
  // A dare night whose verdict didn't land when its date was made (lib/dare-verdict.ts): judged now, once.
  const dareVerdicts = await judgePendingDares(db).catch(() => []);
  // An aired dare night whose winning voters haven't scored yet (lib/dare-points.ts): settled now, once.
  const darePoints = await settleDueDares(db).catch(() => []);
  // The recoupling night (lib/recoupling.ts): opens the vote when a night is close, runs it at the fill hour.
  const recoupling = await runDueRecoupling(db).catch(() => null);
  // The rose ceremony (lib/ceremony.ts, a Botchelor season only): opens Sunday's vote on Thursday, holds it at the ceremony hour.
  const ceremony = await runDueCeremony(db).catch(() => null);
  // Open casting (lib/casting.ts): Sunday's roses for the walk-ons, after the house's ceremony (the finale's people's rose
  // follows the final rose). In the preseason too; nothing without a lead format picked.
  const walkOns = await runWalkOnRoses(db).catch(() => null);
  // This season's cast secrets (lib/cast-secrets.ts): written once a season each on the show's cheap model; a no-op after.
  const secrets = await ensureCastSecrets(db).catch(() => null);
  // The season pool (lib/season-pool.ts): the season that just closed is frozen and revealed, once.
  const pool = await revealDueSeasonPool(db).catch(() => null);
  // Leaked from the cast group chat (lib/cast-chat.ts): yesterday's, written once, the first pass after midnight UTC.
  const castChat = await ensureCastChat(db).catch(() => null);
  // The story state (lib/story-state.ts): its one-off backfill, this week's wants for the cast, and pruning. No model call.
  const storyState = await storyUpkeep(db).catch(() => null);
  // Couples' shown stages (lib/relationship-stages.ts): fills the ones a row doesn't have yet (every row when it shipped,
  // rows refreshed while RELATIONSHIP_STAGES_V2 was 0). Stage columns only: no event, no notice. One cheap select once done.
  const stagesFilled = await backfillShownStages(db).catch(() => null);
  // Couples still counting a date as public that no longer is (lib/relationships.ts healStaleRelationships: made private
  // by a path that never refreshed the pair): a batch a pass is refreshed, and the public sky dropped when one was. One
  // cheap select once none is left.
  const staleHealed = await healStaleRelationships(db).catch(() => null);
  if (staleHealed) invalidateGraph();
  // Character tags (lib/character-tags.ts): every character with none gets the house's hand tags or a read of its
  // traits, a batch a pass. New and edited characters refresh their own; one cheap select once everyone has some.
  const tagsFilled = await fillCharacterTags(db).catch(() => null);
  // A text about a date knows its date (lib/chat-date-links.ts): fills companion_messages.episode_id on texts written
  // before the column, from their tags, a batch a pass. New texts carry it from the start; one cheap select once done.
  const messageEpisodes = await backfillMessageEpisodes(db).catch(() => null);
  // Shows and seasons as rows, and each aired date's season (lib/show-seasons.ts): the registry kept whole, a started
  // season's format frozen, and a batch of older dates stamped. One cheap read once everything is filled.
  const seasonKeys = await seasonKeysUpkeep(db).catch(() => null);
  // A season's awards as rows (lib/profile/credits.ts): recaps frozen before they were get theirs. A no-op once done.
  const awardsFilled = await syncSeasonAwards(db).catch(() => null);
  // Confrontations (lib/house-conflict.ts): a tension hot enough between two in the house is staged, two a week at
  // most, its result decided by seeded rules before the writer is called. Before the daily scene, so what that scene
  // spreads today is only had out tomorrow or after.
  const confrontation = await ensureConfrontation(db).catch(() => null);
  // The daily house scene (lib/house-scenes.ts): written once, the first pass from its hour on, about the dates that
  // aired since the last one; what it retells becomes something the cast heard. One free-model call a day, or a template.
  // Its upkeep takes back what a scene told of a date that is no longer public.
  const houseScene = await ensureHouseScene(db).catch(() => null);
  const houseKept = await houseUpkeep(db).catch(() => null);
  // The week's challenge (lib/house-conflict.ts), on Wednesdays: the winner, decided by seeded rules, gets the next
  // one-on-one (the same dates in another order: none is added).
  const challenge = await ensureChallenge(db).catch(() => null);
  // What the house did reaches the chat (lib/house-texts.ts): each scene above already texted the threads of the people
  // it names; this picks up one whose text didn't go out, and the producer's line for today once the scenes have had
  // their turn. Templates and rows; it never throws, so it can't fail the pass.
  const houseTexts = await houseTextsSweep(db).catch(() => null);
  // The producer (lib/producer.ts): once a night, on the 23:20 pass, tomorrow's beat from the story state, the wants of
  // the people it is about and the vote's twists; a missed pass is caught up by the next. Rows, templates and one small
  // call for the logline. It sets situations, never an outcome.
  const producer = await runProducer(db).catch(() => null);
  // The date plans for tomorrow's house dates (lib/night-plans.ts): written after the response, on calls sized to
  // finish, because nobody is waiting. Each is claimed in the database first, so a later pass never writes it twice.
  if (nightPlansOn()) {
    const plans = () => writeNightPlans(db, new Date(), { budgetMs: 200_000 }).catch(() => null);
    try {
      after(plans);
    } catch {
      void plans(); // outside a request (a test): just run it
    }
  }
  // The show kit's shots (lib/show-shots.ts): from 20:00 UTC, a dozen a pass, free on Workers AI with what's left of the
  // day's budget (people's own pictures keep a reserve). After the response: each takes seconds, and nobody is waiting.
  if (new Date().getUTCHours() >= SHOTS_FROM_HOUR) {
    const shots = () => drawShowShots(db, { max: 12 }).catch(() => null);
    try {
      after(shots);
    } catch {
      void shots(); // outside a request (a test): just run it
    }
  }
  // The social network (lib/social/derive.ts): every derivation over the whole public record, a batch at a time within
  // its own budget, so what a hook missed (a failed write, a switch that was off) is caught within a day. Writes only
  // what differs; left to the next pass when the run is already long.
  const social = Date.now() - started > LONG_RUN_MS ? null : await backfillSocial(db, { budgetMs: 30_000 }).catch(() => null);
  // A tie proposed to someone else's character with no answer in 14 days lapses, and its asker is told
  // (lib/social/declare.ts; the social network PRD section 6.2).
  const tiesLapsed = await lapseProposals(db).catch(() => 0);
  // The social network's numbers (lib/social/metrics-job.ts): a day the daily job's run left short at its time budget is
  // finished here, after the response. One cheap select when there's nothing to pick up, which is nearly always.
  const socialMetrics = () => resumeSocialMetrics(db).catch(() => null);
  try {
    after(socialMetrics);
  } catch {
    void socialMetrics(); // outside a request (a test): just run it
  }
  // The words of each character's own world (lib/world-words.ts): every new or edited sheet, once, on the companions'
  // cheap model (a fraction of a cent a sheet), after the response. Nothing without the saved OpenRouter key.
  const worldWords = () =>
    companionWriter(db)
      .then((model) => fillWorldWords(db, model, { max: WORLD_WORDS_PER_HOUR, budgetMs: 60_000, concurrency: 2 }))
      .catch(() => null);
  try {
    after(worldWords);
  } catch {
    void worldWords(); // outside a request (a test): just run it
  }
  // The show's Discord (lib/discord-posts.ts, docs/discord.md): the episode digest, Sunday's vote and the board, each
  // posted once, after everything above that changes them. Off until a webhook is set; at most a few posts of 5 seconds,
  // and left to the next pass when the run is already long.
  const discord = Date.now() - started > LONG_RUN_MS ? null : await postDueDiscord(db).catch(() => null);
  // The Sunday letter (lib/newsletter-issue.ts, docs/newsletter.md): the confirmations that had to wait, then the week's
  // letter once Sunday's reveal above has settled, a batch a pass within its daily cap. Off without email; it sends no
  // letter until NEWSLETTER_POSTAL_ADDRESS is set. Left to the next pass when the run is already long.
  const newsletter = Date.now() - started > LONG_RUN_MS ? null : await runNewsletter(db).catch(() => null);
  // Dates whose generation died (a deploy swapped the container mid-date: the 2026-11-02 20:20 mixer's five sat
  // "generating" for hours): run again after the response, so the scheduler's call doesn't wait on the model. Only
  // the daily job did this before.
  const stuck = (await db.query<{ n: number }>(`select count(*)::int as n from generation_jobs where status = 'queued' or (status = 'running' and leased_until < now())`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0;
  if (stuck) {
    const rerun = () => runQueuedJobs(db, new Date(), STUCK_PER_HOUR).catch(() => 0);
    try {
      after(rerun);
    } catch {
      void rerun(); // outside a request (a test): just run it
    }
  }
  // A house couple's overnight date (lib/overnight-house.ts): one that has earned it, at most one a day, before the
  // lobby's own refresh so its room is the open one. One date on the show's model, so not on a run that's already long.
  const overnight = Date.now() - started > LONG_RUN_MS ? null : await bookHouseOvernight(db).catch(() => null);
  const lobby = await refreshLobby(db, new Date(), { ensureFresh: true });
  // Every character has a headshot (lib/default-portraits.ts): a few of those still without one are drawn each hour,
  // unless the run is already long (a template date above takes most of the 300 s).
  const portraits = Date.now() - started > LONG_RUN_MS ? { drawn: 0, failed: 0, left: -1 } : await portraitSweep(db).catch(() => ({ drawn: 0, failed: 0, left: -1 }));
  // The story check (lib/story-check.ts): aired dates whose lines and ending disagree are kept off the featured places,
  // a few short paid calls a pass (featured first), within its own time budget; not on a run that's already long.
  const storyCheck = Date.now() - started > LONG_RUN_MS ? null : await storyCheckSweep(db).catch(() => null);
  return { ok: true, ...lobby, message_episodes_filled: messageEpisodes, season_keys: seasonKeys, awards_filled: awardsFilled, portraits, story_check: storyCheck, overnight, situation, season_ballot: ballot, dare_verdicts: dareVerdicts.length, dare_points_settled: darePoints.reduce((n, d) => n + d.voters, 0), recoupling, premiere, ceremony, walk_ons: walkOns, reveal, season_pool: pool, secrets, cast_chat: castChat, story_state: storyState, stages_filled: stagesFilled, stale_edges_healed: staleHealed, tags_filled: tagsFilled, house_texts: houseTexts, producer, house_scene: houseScene, house_upkeep: houseKept, confrontation, challenge, social, ties_lapsed: tiesLapsed, discord, newsletter, aired, stuck_generations: stuck, handed_over, sets_rechecked, sets_drawn, scheduled_dates: scheduled, mixers, ...away };
}

export const GET = handle(run);
export const POST = handle(run);
