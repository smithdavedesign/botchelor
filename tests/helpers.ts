import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { DELETE as deleteBlock, POST as postBlock } from "@/app/api/blocks/route";
import { POST as postCheckout } from "@/app/api/checkout/route";
import { POST as postCharacter } from "@/app/api/characters/route";
import { DELETE as deleteCharacterRoute, PATCH as patchCharacterRoute } from "@/app/api/characters/[id]/route";
import { PATCH as patchVisibilityRoute } from "@/app/api/episodes/[id]/visibility/route";
import { GET as getMyEpisodes } from "@/app/api/me/episodes/route";
import { GET as getMyCharacters } from "@/app/api/me/characters/route";
import { DELETE as deleteSoulRoute, GET as getSoulRoute, PUT as putSoulRoute } from "@/app/api/characters/[id]/soul/route";
import { POST as postDealbreaker } from "@/app/api/dealbreaker-guesses/route";
import { GET as getMatchmakers, POST as postMatchmaker } from "@/app/api/matchmakers/route";
import { POST as postConfessionals } from "@/app/api/episodes/[id]/confessionals/route";
import { POST as postSlidingDoors } from "@/app/api/episodes/[id]/sliding-doors/route";
import { GET as getEpisodeRoute } from "@/app/api/episodes/[id]/route";
import { POST as postReveal } from "@/app/api/episodes/[id]/reveal/route";
import { GET as getFeed, POST as postEpisode } from "@/app/api/episodes/route";
import { POST as postJoinLeague } from "@/app/api/leagues/[id]/join/route";
import { GET as getLeagueRoute } from "@/app/api/leagues/[id]/route";
import { POST as postLeague } from "@/app/api/leagues/route";
import { GET as getMe } from "@/app/api/me/route";
import { POST as postPrediction } from "@/app/api/predictions/route";
import { POST as postProfile } from "@/app/api/profile/route";
import { POST as postReport } from "@/app/api/reports/route";
import { POST as postIdentityConsent } from "@/app/api/reveal/route";
import { POST as postWaitlist } from "@/app/api/waitlist/route";
import { POST as postStripeWebhook } from "@/app/api/webhooks/stripe/route";
import { POST as postWatchParty } from "@/app/api/episodes/[id]/watch-party/route";
import { GET as getLobbyRoute } from "@/app/api/watch-parties/route";
import { GET as getRoomRoute } from "@/app/api/watch-parties/[id]/route";
import { POST as postSync } from "@/app/api/watch-parties/[id]/sync/route";
import { POST as postChat } from "@/app/api/watch-parties/[id]/chat/route";
import { POST as postChatReport } from "@/app/api/watch-parties/[id]/report/route";
import { POST as postReaction } from "@/app/api/watch-parties/[id]/reactions/route";
import { POST as postVote } from "@/app/api/watch-parties/[id]/votes/route";
import { catalogItem, CURRENCY } from "@/lib/catalog";
import { ensureSchema, pgliteDb, setDbForTests, type Db } from "@/lib/db";
import { resetCheckerLogForTests } from "@/lib/mcp/probe-log";
import { fixedEngine, setEngineForTests, type Outcome } from "@/lib/engine";
import { ALL_HOUSE_CHARACTERS, HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { signSession } from "@/lib/auth";
import { USER_COOKIE } from "@/lib/http";
import { setModelForTests, type ChatMessage } from "@/lib/model";
import { setConversationEnabledForTests } from "@/lib/conversation";
import { setAfterglowEnabledForTests } from "@/lib/afterglow";
import { setMixerVoiceEnabledForTests } from "@/lib/mixer-voice";
import { setMatchChatEnabledForTests } from "@/lib/swipes";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { setLookAlikeGateForTests } from "@/lib/originality";
import { setReflectionEnabledForTests } from "@/lib/reflection";
import { setInlineGenerationForTests } from "@/lib/jobs";
import { setPublicLaunchDayForTests } from "@/lib/our-traffic";
import { setPlaceForTests } from "@/lib/place";
import { setCheckSleepForTests } from "@/lib/adult/check";
import { clearEndingsLatelyForTests } from "@/lib/endings-lately";
import { setWelcomeFromForTests } from "@/lib/welcome";
import { POST as postAfterglow } from "@/app/api/episodes/[id]/afterglow/route";
import { POST as postRating } from "@/app/api/characters/[id]/ratings/route";
import type { Ending } from "@/lib/rules";

export const BASE_URL = "http://localhost:3000";

type Table =
  | "characters"
  | "media_teasers"
  | "showcase_thumbs"
  | "show_portrait_tries"
  | "showcase_retwins"
  | "episodes"
  | "predictions"
  | "profiles"
  | "identity_consents"
  | "afterglow_consents"
  | "reports"
  | "blocks"
  | "leagues"
  | "league_members"
  | "orders"
  | "waitlist"
  | "seasons"
  | "badges"
  | "free_episode_usage"
  | "pack_episode_usage"
  | "souls"
  | "generation_jobs"
  | "character_ratings"
  | "character_memory"
  | "memory_forgets"
  | "character_assets"
  | "watch_parties"
  | "watch_messages"
  | "watch_message_reports"
  | "mcp_sessions"
  | "watch_reactions"
  | "watch_poll_votes"
  | "watch_presence"
  | "reports_reviewed"
  | "rate_hits"
  | "paid_usage"
  | "server_errors"
  | "scene_requests"
  | "sim_ratings"
  | "quality_runs"
  | "line_feedback"
  | "user_feedback";

/** One in-memory Postgres per test file, wired in as the app's database. */
export async function startTestDb() {
  const pg = new PGlite();
  const db: Db = pgliteDb(pg);
  await ensureSchema(db);
  setDbForTests(db);
  // The M9 conversation path is off in tests by default: episode tests script only the narration model.
  // The conversation module is tested directly in tests/conversation.test.ts.
  setConversationEnabledForTests(false);
  // M11 afterglow is off in tests by default too (same reason: episode tests script only the narration
  // model). The afterglow module is tested directly in tests/afterglow.test.ts.
  setAfterglowEnabledForTests(false);
  setMixerVoiceEnabledForTests(false);
  // A new match's opening chat (lib/swipes.ts) is the swipe tests' to drive, with their own model.
  setMatchChatEnabledForTests(false);
  // The swipe gate (lib/swipe-gate.ts) is off in tests by default, so the suites written before it keep asking
  // characters out by name. tests/swipe-gate.test.ts turns it on.
  setSwipeGateForTests(false);
  // create_character's look-alike gate (#1154) is off in tests by default too: suites make several characters from one
  // sheet (validCharacter). tests/loop-1154.test.ts and tests/originality-twins.test.ts turn it on.
  setLookAlikeGateForTests(false);
  // The post-date reflection path is off in tests by default too (same reason). The reflection module is
  // tested directly in tests/reflection.test.ts.
  setReflectionEnabledForTests(false);
  // M10 part 2: run generation inline (no Next after() lifecycle in unit tests), so an episode is ready
  // by the time POST returns — the same observable behaviour the suite was written against.
  setInlineGenerationForTests(true);
  // The whole house roster is "on the season" in tests, so a suite that dates a particular house character
  // doesn't depend on which week it runs. tests/season-cast.test.ts exercises the real rotation.
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  // The analytics count people from the public launch (lib/our-traffic.ts PUBLIC_LAUNCH_DAY); in tests they count from
  // any day, so the fixtures can sit before it. tests/insights.test.ts turns the launch day on for its own test.
  setPublicLaunchDayForTests(null);
  // After Dark's regional rules (lib/jurisdiction.ts): tests connect from an open place unless they say otherwise.
  setPlaceForTests({ country: "US", region: "CA" });
  // The output check's waits between Hive retries (lib/adult/check.ts) don't hold up the suite.
  setCheckSleepForTests(async () => {});
  // The welcome experiment (lib/welcome.ts) is off in tests by default: a person's character would otherwise get likes
  // from any house-run bot in the suite. tests/house-crowd.test.ts turns it on.
  setWelcomeFromForTests("2099-01-01T00:00:00Z");
  return {
    db,
    async reset() {
      resetCheckerLogForTests();
      // The recent ending mix is cached per database (lib/endings-lately.ts): a reset starts it over.
      clearEndingsLatelyForTests();
      for (const table of [
        // The data plan's tables: rows between two house characters would otherwise outlive a reset.
        "ml_consents",
        "matchmaker_picks",
        "scheduled_dates",
        "met_notes",
        "date_invite_accepts",
        "date_invites",
        "group_night_seats",
        "group_nights",
        "relationship_events",
        "swipe_impressions",
        "choice_history",
        "turn_drafts",
        "episode_variations",
        "language_seen",
        // Site engagement (lib/engagement.ts) and After Dark's invite requests (lib/adult/invites.ts).
        "web_events",
        // Tonight's situation (lib/situations.ts): the house cast outlives a reset, so its nights would too.
        "situation_votes",
        "situation_nights",
        // This season's cast secrets (lib/cast-secrets.ts) hang off the house cast, which outlives a reset.
        "cast_secrets",
        "adult_invites",
        "adult_monologues",
        "adult_short_calls",
        "adult_short_views",
        "adult_shorts",
        "adult_rejections",
        "adult_presence",
        "adult_talks",
        "adult_picture_briefs",
        "place_sounds",
        // Exports (lib/media-tools/export.ts): a person's packed downloads, kept a day.
        "media_exports",
        // Favorites (the Studio's ⭐).
        "media_favorites",
        // Profile photos (lib/studio/profile-photos.ts).
        "profile_photos",
        "date_photos",
        // The spend tracker (lib/spend.ts).
        "money_entries",
        "spend_snapshots",
        // The showcase (lib/showcase.ts).
        "showcase_consents",
        "showcase_likes",
        "creator_follows",
        "showcase_thumbs",
        "show_portrait_tries",
        "showcase_retwins",
        "showcase_posts",
        "showcase_loops",
        "creator_profiles",
        // Identity packs' views (lib/studio/identity-pack.ts), in both Studios.
        "identity_views",
        "adult_usage",
        "adult_switches",
        "adult_entitlements",
        "adult_billing_events",
        "adult_billing_orders",
        "adult_billing_flags",
        "adult_access_requests",
        "adult_media_thumbs",
        "adult_media_ratings",
        "adult_face_refs",
        "adult_nude_refs",
        "adult_steer_resets",
        "adult_light_picks",
        "adult_images",
        "adult_characters",
        // Turn-ons are kept per character, and the house cast outlives a reset: their rows (and the consent on them) would too.
        "adult_profiles",
        "adult_scenes",
        "adult_nights",
        "adult_reels",
        "adult_steps",
        "adult_memories",
        "adult_facts",
        "adult_eval_spend",
        "adult_settings",
        "adult_settings_history",
        "adult_media_cooldowns",
        "agent_feedback",
        "user_feedback",
        "content_reports",
        // Connections (lib/connections.ts): a person's own keys, and the jobs that use them (cascaded), and their spend.
        "user_connection_usage",
        "user_connections",
        "agent_links",
        "agent_status_cursors",
        "thread_reads",
        // While they're away (lib/activity.ts): when owners were last here, and what their agents were told.
        "owner_activity",
        "away_reports",
        "agent_link_codes",
        "mcp_calls",
        "sim_ratings",
        "quality_runs",
        "line_feedback",
        "scene_requests",
        "place_sets",
        "scene_suggestions",
        "watch_message_reports",
        "watch_poll_votes",
        "watch_reactions",
        "watch_presence",
        "watch_messages",
        "watch_parties",
        "character_assets",
        "character_ratings",
        "character_reviews",
        "season_casts",
        "season_cast_rotations",
        "season_candidates",
        "character_memory",
        "memory_forgets",
        "badges",
        "seasons",
        "free_episode_usage",
        "pack_episode_usage",
        "league_members",
        "leagues",
        "blocks",
        "reports",
        "reports_reviewed",
        "rate_hits",
        "paid_usage",
        "embed_usage",
        "server_errors",
        "identity_consents",
        "afterglow_consents",
        "relationships",
        "profiles",
        "orders",
        "waitlist",
        "mcp_sessions",
        "analytics_events",
        "character_embeddings",
      ]) {
        await db.query(`delete from ${table}`);
      }
      await db.query("delete from predictions");
      await db.query("delete from episodes");
      await db.query("delete from characters where not is_house");
      // Generated house characters (lib/season-gen.ts); the code-defined cast stays.
      await db.query("delete from characters where is_house and id <> all($1)", [ALL_HOUSE_CHARACTERS.map((c) => c.id)]);
      setModelForTests(null);
      setEngineForTests(null);
    },
    async close() {
      setDbForTests(null);
      setModelForTests(null);
      setEngineForTests(null);
      await pg.close();
    },
    async count(table: Table, where = "true") {
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`);
      return rows[0].n;
    },
  };
}

/** A fake showrunner model that returns (or throws) the scripted outputs in order and records every call. */
export function scriptedModel(outputs: Array<string | Error>) {
  const queue = [...outputs];
  const calls: ChatMessage[][] = [];
  setModelForTests({
    async complete(messages) {
      calls.push(messages);
      const next = queue.shift();
      if (next === undefined) throw new Error("scripted model ran out of outputs");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { calls };
}

export function newUserCookie(): string {
  return `${USER_COOKIE}=${randomUUID()}`;
}

/** Built from parts so no literal secret sits in the repo (GitGuardian scans every commit). */
export const TEST_SESSION_SECRET = ["helpers", "test", "secret", "abcdefghij0123456789"].join("-");

/** A signed-in session for `userId`. Stub SESSION_SECRET with TEST_SESSION_SECRET first (vi.stubEnv). */
export function signedInCookie(userId: string): string {
  const token = signSession({ uid: userId, authenticated: true });
  if (!token) throw new Error('signedInCookie needs SESSION_SECRET: vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET) first');
  return `bz_sess=${token}`;
}

export function jsonRequest(
  path: string,
  body: unknown,
  opts: { cookie?: string; contentType?: string; method?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request(BASE_URL + path, {
    method: opts.method ?? "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getRequest(path: string, cookie?: string): Request {
  return new Request(BASE_URL + path, { headers: cookie ? { cookie } : {} });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

export const api = {
  // Suites make many Mira Quells, so a test's sheet keeps its name unless it says otherwise (tests/name-check.test.ts
  // covers the unique-name rule itself).
  createCharacter: (body: unknown, cookie?: string, contentType?: string) =>
    postCharacter(
      jsonRequest("/api/characters", body && typeof body === "object" && !Array.isArray(body) ? { keep_name: true, ...body } : body, { cookie, contentType }),
    ),
  createEpisode: (body: unknown, cookie?: string) => postEpisode(jsonRequest("/api/episodes", body, { cookie })),
  predict: (body: unknown, cookie?: string) => postPrediction(jsonRequest("/api/predictions", body, { cookie })),
  /** M1: the host "airs the finale" (POST /api/episodes/:id/reveal). */
  reveal: (id: string, cookie?: string) =>
    postReveal(jsonRequest(`/api/episodes/${id}/reveal`, {}, { cookie }), params(id)),
  me: (cookie?: string) => getMe(getRequest("/api/me", cookie)),
  getEpisode: (id: string, cookie?: string) => getEpisodeRoute(getRequest(`/api/episodes/${id}`, cookie), params(id)),
  feed: (cookie?: string) => getFeed(getRequest("/api/episodes", cookie)),
  /** M2: one creator consents to revealing who made the episode (POST /api/reveal). */
  consent: (episodeId: string, cookie?: string) =>
    postIdentityConsent(jsonRequest("/api/reveal", { episode_id: episodeId }, { cookie })),
  /** M11: one owner opens the afterglow (POST /api/episodes/:id/afterglow). */
  openAfterglow: (episodeId: string, cookie?: string) =>
    postAfterglow(jsonRequest(`/api/episodes/${episodeId}/afterglow`, {}, { cookie }), params(episodeId)),
  /** Audience rating: toggle a category on a character (POST /api/characters/:id/ratings). */
  rateCharacter: (characterId: string, category: string, cookie?: string) =>
    postRating(jsonRequest(`/api/characters/${characterId}/ratings`, { category }, { cookie }), params(characterId)),
  setVisibility: (id: string, visibility: string, cookie?: string) =>
    patchVisibilityRoute(jsonRequest(`/api/episodes/${id}/visibility`, { visibility }, { cookie, method: "PATCH" }), params(id)),
  myEpisodes: (cookie?: string, query = "") => getMyEpisodes(getRequest(`/api/me/episodes${query}`, cookie)),
  myCharacters: (cookie?: string) => getMyCharacters(getRequest("/api/me/characters", cookie)),
  editCharacter: (id: string, body: unknown, cookie?: string) =>
    patchCharacterRoute(jsonRequest(`/api/characters/${id}`, body, { cookie, method: "PATCH" }), params(id)),
  deleteCharacter: (id: string, cookie?: string) =>
    deleteCharacterRoute(jsonRequest(`/api/characters/${id}`, {}, { cookie, method: "DELETE" }), params(id)),
  setProfile: (body: unknown, cookie?: string) => postProfile(jsonRequest("/api/profile", body, { cookie })),
  report: (body: unknown, cookie?: string) => postReport(jsonRequest("/api/reports", body, { cookie })),
  block: (episodeId: string, cookie?: string) =>
    postBlock(jsonRequest("/api/blocks", { episode_id: episodeId }, { cookie })),
  unblock: (episodeId: string, cookie?: string) =>
    deleteBlock(jsonRequest("/api/blocks", { episode_id: episodeId }, { cookie, method: "DELETE" })),
  createLeague: (body: unknown, cookie?: string) => postLeague(jsonRequest("/api/leagues", body, { cookie })),
  getLeague: (id: string, cookie?: string) => getLeagueRoute(getRequest(`/api/leagues/${id}`, cookie), params(id)),
  joinLeague: (id: string, cookie?: string) =>
    postJoinLeague(jsonRequest(`/api/leagues/${id}/join`, {}, { cookie }), params(id)),
  /** Start buying one catalog item: a pending order, and the Stripe Payment Link to pay it on (M3, M4). */
  checkout: (body: unknown, cookie?: string) => postCheckout(jsonRequest("/api/checkout", body, { cookie })),
  /** M3: deliver a raw Stripe event, exactly as Stripe would (the signature covers the raw text). */
  stripeWebhook: (payload: string, signature?: string | null) =>
    postStripeWebhook(
      new Request(BASE_URL + "/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...(signature ? { "stripe-signature": signature } : {}),
        },
        body: payload,
      }),
    ),
  joinWaitlist: (body: unknown, cookie?: string) => postWaitlist(jsonRequest("/api/waitlist", body, { cookie })),
  guessDealbreaker: (body: unknown, cookie?: string) => postDealbreaker(jsonRequest("/api/dealbreaker-guesses", body, { cookie })),
  proposeMatch: (body: unknown, cookie?: string) => postMatchmaker(jsonRequest("/api/matchmakers", body, { cookie })),
  myProposals: (cookie?: string) => getMatchmakers(getRequest("/api/matchmakers", cookie)),
  shareConfessionals: (episodeId: string, shared: boolean, cookie?: string) =>
    postConfessionals(jsonRequest(`/api/episodes/${episodeId}/confessionals`, { shared }, { cookie }), params(episodeId)),
  slidingDoors: (episodeId: string, change: string, cookie?: string) =>
    postSlidingDoors(jsonRequest(`/api/episodes/${episodeId}/sliding-doors`, { change }, { cookie }), params(episodeId)),
  getSoul: (characterId: string, cookie?: string) => getSoulRoute(getRequest(`/api/characters/${characterId}/soul`, cookie), params(characterId)),
  putSoul: (characterId: string, body: unknown, cookie?: string) =>
    putSoulRoute(jsonRequest(`/api/characters/${characterId}/soul`, body, { cookie, method: "PUT" }), params(characterId)),
  deleteSoul: (characterId: string, cookie?: string) =>
    deleteSoulRoute(jsonRequest(`/api/characters/${characterId}/soul`, {}, { cookie, method: "DELETE" }), params(characterId)),
  // M8: watch parties.
  createWatchParty: (episodeId: string, body: unknown = {}, cookie?: string) =>
    postWatchParty(jsonRequest(`/api/episodes/${episodeId}/watch-party`, body, { cookie }), params(episodeId)),
  lobby: (cookie?: string) => getLobbyRoute(getRequest("/api/watch-parties", cookie)),
  getRoom: (id: string, cookie?: string) => getRoomRoute(getRequest(`/api/watch-parties/${id}`, cookie), params(id)),
  syncRoom: (id: string, cookie?: string) => postSync(jsonRequest(`/api/watch-parties/${id}/sync`, {}, { cookie }), params(id)),
  chat: (id: string, body: string, cookie?: string) =>
    postChat(jsonRequest(`/api/watch-parties/${id}/chat`, { body }, { cookie }), params(id)),
  reportMessage: (id: string, messageId: string, cookie?: string) =>
    postChatReport(jsonRequest(`/api/watch-parties/${id}/report`, { message_id: messageId }, { cookie }), params(id)),
  react: (id: string, emoji: string, cookie?: string) =>
    postReaction(jsonRequest(`/api/watch-parties/${id}/reactions`, { emoji }, { cookie }), params(id)),
  vote: (id: string, poll: string, choice: string, cookie?: string) =>
    postVote(jsonRequest(`/api/watch-parties/${id}/votes`, { poll, choice }, { cookie }), params(id)),
};

/**
 * A fake webhook signing secret, built at runtime so no credential-shaped literal sits in the repo.
 * Tests set it as STRIPE_WEBHOOK_SECRET with vi.stubEnv.
 */
export const FAKE_WEBHOOK_SECRET = ["whsec", "A1b2C3d4".repeat(4)].join("_");
export const OTHER_WEBHOOK_SECRET = ["whsec", "Z9y8X7w6".repeat(4)].join("_");

/**
 * A Stripe-Signature header for `payload`. Uses Web Crypto, a different implementation from the
 * app's node:crypto, so the test and the code don't share a bug.
 */
export async function stripeSignature(
  payload: string,
  secret = FAKE_WEBHOOK_SECRET,
  timestamp = Math.floor(Date.now() / 1000),
  scheme = "v1",
): Promise<string> {
  return `t=${timestamp},${scheme}=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Buffer.from(signature).toString("hex");
}

/**
 * A sample test-mode Stripe Payment Link and the id Stripe gives it (the owner's real one lives only in
 * the environment). Tests set the link as STRIPE_PAYMENT_LINK with vi.stubEnv.
 */
export const FAKE_PAYMENT_LINK = "https://buy.stripe.com/test_botchelorSamplePack";
export const FAKE_PAYMENT_LINK_ID = "plink_botchelorSamplePack";

/** Opens the shop for a test file: the Payment Link and the webhook secret, as the owner set them in Vercel. */
export function openPayments(stubEnv: (name: string, value: string) => unknown) {
  stubEnv("STRIPE_PAYMENT_LINK", FAKE_PAYMENT_LINK);
  stubEnv("STRIPE_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
}

/** A session id like the one Stripe creates each time someone opens the Payment Link. */
export const newSessionId = () => `cs_test_${randomUUID().replace(/-/g, "")}`;

/** A Stripe event wrapping a Checkout Session; `session` overrides the paid defaults. */
export function checkoutEvent(session: Record<string, unknown>, type = "checkout.session.completed"): string {
  return JSON.stringify({
    id: `evt_test_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type,
    data: {
      object: {
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        currency: CURRENCY,
        payment_link: FAKE_PAYMENT_LINK_ID,
        ...session,
      },
    },
  });
}

/**
 * Starts buying `sku` the way the shop does: POST /api/checkout, which answers with the Payment Link
 * carrying our order id as client_reference_id. Returns that order, the url, and the paid event Stripe
 * would send once the buyer pays on the link (one Stripe session; pass another `id` for a new payment).
 */
export async function startCheckout(sku: string, cookie: string) {
  const res = await api.checkout({ sku, attest: true }, cookie);
  if (res.status !== 200) throw new Error(`checkout failed with ${res.status}`);
  const { url } = (await res.json()) as { url: string };
  const orderId = new URL(url).searchParams.get("client_reference_id");
  if (!orderId) throw new Error(`no client_reference_id on ${url}`);
  const sessionId = newSessionId();
  const price = catalogItem(sku)?.price_cents;
  const paidEvent = (overrides: Record<string, unknown> = {}, type?: string) =>
    checkoutEvent({ id: sessionId, client_reference_id: orderId, amount_total: price, ...overrides }, type);
  return { orderId, url, sessionId, paidEvent };
}

/** Buys `sku` end to end: checkout, then the signed webhook. Needs openPayments(vi.stubEnv) first. */
export async function buy(sku: string, cookie: string): Promise<string> {
  const { orderId, paidEvent } = await startCheckout(sku, cookie);
  const payload = paidEvent();
  const res = await api.stripeWebhook(payload, await stripeSignature(payload));
  if (res.status !== 200) throw new Error(`webhook failed with ${res.status}`);
  return orderId;
}

/**
 * Gives `sku` to a user the way BUILD.md tells David to restore a purchase by hand: a paid order row.
 * The only way to own an item that is off sale (premium characters and frames: one Payment Link sells
 * one thing). Returns the order id.
 */
export async function grantByHand(db: Db, cookie: string, sku: string): Promise<string> {
  const item = catalogItem(sku);
  if (!item) throw new Error(`no such sku ${sku}`);
  const id = randomUUID();
  await db.query(
    `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, episodes, paid_at)
     values ($1, $2, $3, $4, $5, $6, 'paid', $7, clock_timestamp())`,
    [id, userIdOf(cookie), item.sku, item.kind, item.price_cents, CURRENCY, item.episodes ?? null],
  );
  return id;
}

/** Gives a user a display name (with the 18+ attestation) and returns their cookie. */
export async function named(cookie: string, name: string): Promise<string> {
  const res = await api.setProfile({ name, attest: true }, cookie);
  if (res.status !== 200) throw new Error(`profile setup failed with ${res.status}`);
  return cookie;
}

export function validCharacter(overrides: Record<string, unknown> = {}) {
  return {
    name: "Mira Quell",
    age: 27,
    bio: "A cartographer who maps cities that only exist on Tuesdays.",
    traits: ["curious", "stubborn", "warm"],
    want: "Someone who can read a map upside down",
    dealbreaker: "People who hate surprises",
    attest: true,
    ...overrides,
  };
}

/**
 * A valid *narration* draft: the model no longer decides the ending (the engine does, lib/engine.ts).
 * It writes the scenes, one best line and one confessional per character.
 */
export function validEpisodeDraft(overrides: Record<string, unknown> = {}) {
  return {
    setting: "A rooftop dumpling stall in a thunderstorm, run by a chef who narrates every order.",
    goals: [
      "Mira wants to find out whether her date can read a map upside down.",
      "Rafe wants a date who will taste-test his cake honestly.",
    ],
    scenes: [
      "Mira arrives early and redraws the menu as a map. Rafe arrives late, soaked, holding a cake box like a newborn.",
      "The power flickers and they argue about whether dumplings count as cake. The chef takes sides, loudly, then switches.",
      "They split the last dumpling and decide, between the two of them, how the night ends.",
    ],
    twist: "The power goes out and the only light left is the candle on Rafe's cake.",
    finale: "They split the last dumpling and agree never to agree about cake.",
    best_line: "Dumplings are just cake that gave up on being sweet.",
    confessionals: [
      "I came for a map-reader and left thinking about the candlelight.",
      "She insulted my cake and I have never felt more seen.",
    ],
    ...overrides,
  };
}

export function episodeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(validEpisodeDraft(overrides));
}

/** The episode fields that count toward the word cap (not best_line / confessionals, which are extras). */
const CAPPED_FIELDS = ["setting", "goals", "twist", "finale"] as const;

/** An otherwise valid episode whose *capped* text totals exactly `totalWords` words (spread over 4 scenes). */
export function episodeWithWordCount(totalWords: number, overrides: Record<string, unknown> = {}) {
  const base = validEpisodeDraft({ ...overrides, scenes: [] });
  const fixed = CAPPED_FIELDS.reduce((n, f) => n + countStringWords(base[f as keyof typeof base]), 0);
  const filler = totalWords - fixed;
  if (filler < 3) throw new Error("target too small");
  const per = Math.floor(filler / 3);
  const sizes = [per, per, filler - per * 2];
  return { ...base, scenes: sizes.map((n) => Array.from({ length: n }, () => "lantern").join(" ")) };
}

/** Counts whitespace-separated words across every string anywhere inside a JSON value. */
export function countStringWords(value: unknown): number {
  if (typeof value === "string") return value.trim().split(/\s+/).filter(Boolean).length;
  if (Array.isArray(value)) return value.reduce<number>((sum, v) => sum + countStringWords(v), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce<number>((sum, v) => sum + countStringWords(v), 0);
  }
  return 0;
}

export const HOUSE_PARTNER_ID = HOUSE_CHARACTERS[0].id;

/** Forces the engine's outcome, the way scriptedModel forces the model. Clears with setEngineForTests(null). */
export function scriptOutcome(partial: Partial<Outcome> & { ending: Ending }) {
  setEngineForTests(fixedEngine(partial));
}

/** Creates a creator, their character and one episode: the engine is forced to `ending`, the model scripted. */
export async function setupEpisode(ending: Ending = "friends", outcome: Partial<Outcome> = {}, draft: Record<string, unknown> = {}) {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), creator)).json();
  scriptOutcome({ ...outcome, ending });
  scriptedModel([episodeJson(draft)]);
  const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator);
  if (res.status !== 200) throw new Error(`episode setup failed with ${res.status}`);
  const episode = await res.json();
  return { creator, character, episode };
}

/**
 * Two creators, one OC each, and a blind date requested by the host. Call it when no other user OC
 * exists (right after reset), so the blind match can only pick the partner's character.
 */
export async function setupPairedEpisode(opts: { host?: string; partner?: string; ending?: Ending } = {}) {
  const host = opts.host ?? newUserCookie();
  const partner = opts.partner ?? newUserCookie();
  const partnerCharacter = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
  const hostCharacter = await (await api.createCharacter(validCharacter(), host)).json();
  scriptOutcome({ ending: opts.ending ?? "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host);
  if (res.status !== 200) throw new Error(`paired episode setup failed with ${res.status}`);
  const episode = await res.json();
  return { host, partner, hostCharacter, partnerCharacter, episode };
}

export const userIdOf = (cookie: string) => cookie.split("=")[1];

/**
 * A valid director plan (lib/beats.ts) for scripted models. Since M15 a date with the conversation on calls the
 * director FIRST (plan → turns → recap), so a script for one reads [planJson(), ...turns, episodeJson()].
 * Unparseable plan outputs ("{}") make planDate fall back to the deterministic rules plan after two tries.
 */
export function planJson(overrides: Record<string, unknown> = {}): string {
  const act = (scene: string) => ({ scene, a: "You stay curious and ask what you actually want to know.", b: "You warm up slowly, in your own way." });
  return JSON.stringify({
    spine: "Two strangers find out whether a small shared joke can carry a whole evening.",
    acts: [act("They meet and size each other up."), act("A small crisis tests them."), act("They decide how the night ends.")],
    ...overrides,
  });
}
