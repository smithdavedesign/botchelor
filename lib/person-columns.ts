/**
 * Every column that holds a person's id, and what happens to it (the connected model, stage 7; docs/data-plan.md
 * "Adding a table with a person column").
 *
 * A person is an id: a browser's anonymous id, an account's (the anonymous id it adopted) or an agent's. There is no
 * users table and no foreign key, and the id sits in columns with some thirty different names, so nothing in the
 * database says which rows are someone's. This list does. For each column it says three things:
 *
 *  - `export`: where the account export (lib/account.ts exportAccount) puts it, or why it isn't there;
 *  - `delete`: what deleting the account does (deleteAccount): the rows go, the id is cleared, or the row is kept and why;
 *  - `move`: what claiming an anonymous identity into an account does: `reassign` (the id is rewritten), `merge` (the
 *    same, except where the account already has the row a unique key allows once: the account's row wins), or `skip`.
 *
 * tests/person-columns.test.ts reads the schema in lib/db.ts and fails on a person-named column that isn't here, checks
 * every entry against lib/account.ts, and then proves it: it puts a row in each of these columns, deletes and exports
 * the account, and compares what happened with what the entry says.
 *
 * After Dark's own tables are listed in lib/adult/person-columns.ts, beside the code that owns them.
 *
 * How `move` was decided: what a person MADE follows them (their characters, the dates they booked and everything
 * hanging off those, their Studio pictures, their conversations). What is ONE PER PERSON stays where it is (a vote, a
 * prediction, a rating, a free allowance, a balance, a setting, a consent), so an account never gets a second helping
 * and no tally changes. Money and After Dark never move.
 */

/** Where the export puts a column's rows (a key of AccountExport, dotted for a nested one), or why it leaves them out. */
export type ExportRule = { key: string } | { no: string };

/** What deleting the account does to a column's rows. */
export type DeleteRule =
  /** The rows are removed: by this column, or (`via`) by the database when that table's row goes (on delete cascade). */
  | { does: "rows"; via?: string }
  /** The row stays and the id is cleared or replaced. */
  | { does: "anonymise"; to: string }
  /** The row and the id stay. */
  | { does: "keep"; why: string };

/** What claiming an anonymous identity into an account does to a column's rows. */
export type MoveRule =
  | { does: "reassign" }
  /**
   * Reassign, except where it would break a rule that allows one row a person: `key` is the rest of that unique key
   * (with the person column), `when` the rows the rule covers if not all. The account's own row always wins; `loser`
   * says what becomes of the claimed identity's clashing row: it stays under the old id, or it is changed (`set`) so
   * that it no longer clashes and then moves.
   */
  | { does: "merge"; key: readonly string[]; when?: string; loser: "stays" | { set: string } }
  | { does: "skip"; why: string };

export type PersonColumn = { table: string; column: string; export: ExportRule; delete: DeleteRule; move: MoveRule };

/** A column whose name reads like a person's id and isn't one: what it does hold. */
export type LookAlike = { table: string; column: string; holds: string };

/** The column names that hold a person's id somewhere in the schema. */
export const PERSON_ID_NAMES: readonly string[] = [
  "user_id", "owner_id", "agent_id", "reporter_id", "creator_id", "proposed_by", "voter_id", "visitor", "viewer_id", "used_by",
  "reviewer_id", "recipient_id", "rater_id", "proposer_id", "host_id", "holder", "follower_id", "by_user", "booker", "blocker_id",
  "blocked_id", "answerer_user", "from_user", "to_user", "proposer_user", "actor", "created_by", "taken_by", "granted_by",
  "reviewed_by", "decided_by", "updated_by", "consented_by", "invite_to", "alias_id",
];

/**
 * A wider net for a name that isn't on the list yet: someone's role, with or without `_id`, or anything "by" someone.
 * A new column it catches has to be listed (as a person's, or as a look-alike with what it holds).
 */
const PERSON_NAME_PATTERN =
  /(^|_)(user|owner|agent|viewer|visitor|voter|reporter|reviewer|rater|follower|blocker|blocked|creator|proposer|answerer|recipient|booker|host|holder|actor|member|person|account)(_id|_user)?$|_by$|^by_|_user$/;

/** Whether a column's name says it may hold a person's id. */
export const personNamed = (column: string): boolean => PERSON_ID_NAMES.includes(column) || PERSON_NAME_PATTERN.test(column);

/** Whether a column's type could hold an id at all (a boolean `account` or a jsonb `people` can't). */
export const idTyped = (definition: string): boolean => /^(text|uuid|varchar|character varying)\b(?!\s*\[)/i.test(definition.trim());

/* ------------------------------------------------ the rules, named ------------------------------------------------ */

const at = (key: string): ExportRule => ({ key });
const out = (no: string): ExportRule => ({ no });
const ROWS: DeleteRule = { does: "rows" };
const via = (table: string): DeleteRule => ({ does: "rows", via: table });
const cleared = (to: string): DeleteRule => ({ does: "anonymise", to });
const kept = (why: string): DeleteRule => ({ does: "keep", why });
const REASSIGN: MoveRule = { does: "reassign" };
const merge = (key: readonly string[], loser: "stays" | { set: string } = "stays", when?: string): MoveRule => ({ does: "merge", key, loser, ...(when ? { when } : {}) });
const skip = (why: string): MoveRule => ({ does: "skip", why });

/** Why a row stays put on a claim. */
const ONE_VOTE = skip("one a person: the account keeps its own vote, and the old id's stays where it was cast, so no tally changes");
const FOLLOW = skip("one a person: the account keeps its own follows, and the old id's stay, so no follower count changes");
const POINTS = skip("the prediction game is scored per identity (lib/game.ts getPoints): moving a call would move its points");
const ALLOWANCE = skip("an allowance or a balance: the account keeps its own and gets no second helping");
const MONEY = skip("a payment record stays with the id that paid; buying needs an account, so an identity with no sign-in has none");
const SETTING = skip("one a person: the account's own setting stands");
const CONSENT = skip("a consent is the identity's that gave it: it is never carried to another");
const LOG = skip("a log of what an id did, not something made: it stays as it was written");
const AGENT = skip("an agent's id is never claimed: only a browser's signed anonymous session can be (lib/account-claim.ts)");
const NEEDS_ACCOUNT = skip("only an account can have one, and an identity that can be claimed never had a sign-in");
const ADMIN_ACT = skip("names the admin who did it, not whose row it is");
const SAID_AS = skip("what the old id said or flagged stays under the id that said it");

/** Why a row isn't in the export. */
const ADMINS_ID = out("the admin who did it: the row is about someone else, and is exported to them");
const OPERATIONS = out("a working row with nothing the person wrote or chose; it goes when the account is deleted");
const SHARED_DATE = "the row is part of a date other people's characters were in, which stays: the id is a random one that points at nothing once the account is gone";

/* ------------------------------------------------ the registry ------------------------------------------------ */

export const PERSON_COLUMNS: readonly PersonColumn[] = [
  // Who someone is.
  { table: "accounts", column: "user_id", export: at("account"), delete: ROWS, move: skip("the sign-in itself: the claim moves things INTO this account, never the account") },
  { table: "profiles", column: "user_id", export: at("profile"), delete: ROWS, move: skip("one a person: the account keeps its own name and 18+ answer") },
  { table: "admins", column: "user_id", export: at("admin"), delete: ROWS, move: skip("an admin's id is never claimed, and admin is never handed on") },
  { table: "user_keys", column: "user_id", export: out("the first key table, since moved into user_connections (exported as provider_keys); a sealed key never leaves"), delete: via("accounts"), move: NEEDS_ACCOUNT },
  { table: "user_connections", column: "user_id", export: at("provider_keys"), delete: via("accounts"), move: skip("a sealed key stays with the id that saved it") },
  { table: "user_connection_jobs", column: "user_id", export: at("provider_keys"), delete: via("user_connections"), move: skip("goes with the key it uses (user_connections)") },
  { table: "user_connection_usage", column: "user_id", export: at("provider_spend"), delete: via("accounts"), move: skip("what a key spent stays with the key") },
  { table: "owner_activity", column: "user_id", export: at("last_seen"), delete: ROWS, move: SETTING },
  { table: "away_reports", column: "owner_id", export: OPERATIONS, delete: ROWS, move: skip("how far an owner has been told what their characters did while they were away: a read marker, the account has its own") },
  { table: "ml_consents", column: "user_id", export: at("ml_consent"), delete: ROWS, move: CONSENT },
  { table: "identity_consents", column: "user_id", export: at("identity_reveals"), delete: ROWS, move: skip("a yes to showing THIS identity's name to the other owner: it is not a yes for the account's name") },
  { table: "afterglow_consents", column: "user_id", export: at("afterglow_consents"), delete: ROWS, move: CONSENT },

  // A claim's record (lib/account-claim.ts): the anonymous id that was claimed, and the account it was claimed into.
  {
    table: "account_aliases",
    column: "user_id",
    export: at("claimed_identities"),
    delete: ROWS,
    move: skip("the record of what an account claimed stays with that account; an account is never itself claimed"),
  },
  {
    table: "account_aliases",
    column: "alias_id",
    export: at("claimed_into"),
    delete: ROWS,
    move: skip("an identity that has been claimed is never claimed again: this row's primary key is what refuses it"),
  },

  // What they made: characters, the dates they booked, and what hangs off those.
  { table: "characters", column: "owner_id", export: at("characters"), delete: ROWS, move: REASSIGN },
  { table: "episodes", column: "creator_id", export: at("dates_booked"), delete: kept(SHARED_DATE), move: REASSIGN },
  {
    table: "generation_jobs",
    column: "creator_id",
    export: OPERATIONS,
    delete: kept("the job is its date's (it goes when the episode does): see episodes.creator_id"),
    move: skip("a date being written finishes for the id that booked it: its model, and the date it gives back if it fails, are that id's"),
  },
  { table: "scheduled_dates", column: "creator_id", export: at("scheduled_dates"), delete: ROWS, move: REASSIGN },
  { table: "watch_parties", column: "host_id", export: at("watch_parties.hosted"), delete: kept(SHARED_DATE), move: REASSIGN },
  { table: "nudges", column: "user_id", export: at("nudges"), delete: ROWS, move: REASSIGN },
  { table: "second_date_requests", column: "user_id", export: at("second_date_yeses"), delete: ROWS, move: merge(["episode_id"]) },
  { table: "thread_reads", column: "user_id", export: at("thread_reads"), delete: ROWS, move: merge(["character_lo", "character_hi"]) },
  { table: "date_proposals", column: "from_user", export: at("date_proposals"), delete: ROWS, move: REASSIGN },
  { table: "date_proposals", column: "to_user", export: at("date_proposals"), delete: ROWS, move: REASSIGN },
  { table: "date_roleplays", column: "proposer_user", export: at("date_roleplays"), delete: ROWS, move: REASSIGN },
  { table: "date_roleplays", column: "answerer_user", export: at("date_roleplays"), delete: ROWS, move: REASSIGN },
  { table: "date_invites", column: "owner_id", export: at("date_links.invites"), delete: ROWS, move: REASSIGN },
  { table: "double_links", column: "created_by", export: at("date_links.doubles_made"), delete: ROWS, move: REASSIGN },
  { table: "double_links", column: "taken_by", export: at("date_links.doubles_taken"), delete: cleared("null"), move: REASSIGN },
  { table: "group_nights", column: "created_by", export: at("double_dates.nights"), delete: kept(SHARED_DATE), move: REASSIGN },
  { table: "group_nights", column: "invite_to", export: at("double_dates.nights"), delete: kept(SHARED_DATE), move: REASSIGN },
  { table: "group_night_seats", column: "booker", export: at("double_dates.seats"), delete: kept(SHARED_DATE), move: REASSIGN },
  {
    table: "cast_auditions",
    column: "owner_id",
    export: at("auditions"),
    delete: ROWS,
    // One audition in play a person a season (cast_auditions_one_each): the account's stands, the claimed one steps back.
    move: merge(["season_id"], { set: "status = 'withdrawn', decided_at = now()" }, "status <> 'withdrawn'"),
  },
  { table: "casting_invites", column: "used_by", export: at("casting_invites_used"), delete: cleared("null"), move: REASSIGN },
  { table: "companion_threads", column: "user_id", export: at("companion_conversations"), delete: ROWS, move: merge(["character_id"]) },

  // The Studio and the Gallery: what they made there.
  { table: "studio_pg_shoots", column: "owner_id", export: at("studio.shoots"), delete: ROWS, move: REASSIGN },
  { table: "studio_pg_pictures", column: "owner_id", export: at("studio.pictures"), delete: ROWS, move: REASSIGN },
  { table: "profile_photos", column: "owner_id", export: at("studio.profile_photos"), delete: ROWS, move: REASSIGN },
  { table: "date_photos", column: "owner_id", export: at("studio.date_photos"), delete: ROWS, move: REASSIGN },
  { table: "creator_prompts", column: "owner_id", export: at("studio.prompts"), delete: ROWS, move: REASSIGN },
  { table: "creator_places", column: "owner_id", export: at("studio.places"), delete: ROWS, move: REASSIGN },
  { table: "creator_roleplays", column: "owner_id", export: at("studio.roleplays"), delete: ROWS, move: REASSIGN },
  { table: "identity_views", column: "owner_id", export: at("studio.identity_views"), delete: ROWS, move: merge(["character_id", "studio", "view"]) },
  { table: "media_exports", column: "owner_id", export: out("a packed download kept a day: a copy of pictures that are exported where they live"), delete: ROWS, move: skip("a download kept a day: made again in a click") },
  { table: "media_favorites", column: "owner_id", export: out("After Dark's stars (the rows point at After Dark pictures), and After Dark is left out of this export"), delete: ROWS, move: skip("After Dark's: nothing of After Dark moves") },
  { table: "showcase_posts", column: "owner_id", export: at("showcase.posts"), delete: ROWS, move: REASSIGN },
  { table: "showcase_loops", column: "owner_id", export: at("showcase.loops"), delete: ROWS, move: REASSIGN },
  { table: "showcase_consents", column: "owner_id", export: at("showcase.consents"), delete: ROWS, move: merge(["post_id", "character_id"]) },
  { table: "creator_profiles", column: "user_id", export: at("showcase.profile"), delete: ROWS, move: NEEDS_ACCOUNT },
  { table: "creator_follows", column: "follower_id", export: at("showcase.following"), delete: ROWS, move: FOLLOW },
  { table: "creator_follows", column: "creator_id", export: out("who follows them is each follower's to keep: the export has the count"), delete: ROWS, move: NEEDS_ACCOUNT },
  { table: "showcase_likes", column: "user_id", export: at("showcase.likes"), delete: ROWS, move: ONE_VOTE },
  { table: "showcase_views", column: "viewer_id", export: out("a seen-it marker that orders the reels: a post id and a time, nothing chosen"), delete: ROWS, move: LOG },

  // Safety: blocks follow the person both ways, so a claim never unblocks anyone.
  { table: "blocks", column: "blocker_id", export: at("blocks"), delete: ROWS, move: merge(["via_episode_id", "blocked_id"]) },
  { table: "blocks", column: "blocked_id", export: out("who blocked them is the blocker's to know"), delete: ROWS, move: merge(["blocker_id", "via_episode_id"]) },
  { table: "reports", column: "reporter_id", export: at("reports.dates"), delete: ROWS, move: SAID_AS },
  { table: "reports_reviewed", column: "reporter_id", export: at("reports.dates_reviewed"), delete: ROWS, move: SAID_AS },
  { table: "watch_message_reports", column: "reporter_id", export: at("reports.watch_messages"), delete: ROWS, move: SAID_AS },
  { table: "house_scene_reports", column: "reporter_id", export: at("reports.house_scenes"), delete: ROWS, move: SAID_AS },
  { table: "content_reports", column: "reporter_id", export: at("content_reports"), delete: cleared("null"), move: SAID_AS },
  { table: "content_reports", column: "decided_by", export: ADMINS_ID, delete: kept("the admin who decided it: the record of what was done stays"), move: ADMIN_ACT },

  // One a person: votes, calls, ratings. They stay where they were cast.
  { table: "predictions", column: "user_id", export: at("predictions"), delete: ROWS, move: POINTS },
  { table: "dealbreaker_guesses", column: "user_id", export: at("dealbreaker_guesses"), delete: ROWS, move: POINTS },
  { table: "matchmaker_proposals", column: "proposer_id", export: at("matchmaker_proposals"), delete: ROWS, move: POINTS },
  { table: "arc_predictions", column: "user_id", export: at("arc_predictions"), delete: ROWS, move: POINTS },
  { table: "cast_backings", column: "user_id", export: at("cast_backings"), delete: ROWS, move: POINTS },
  { table: "dare_votes", column: "user_id", export: at("dare_votes"), delete: ROWS, move: POINTS },
  { table: "situation_votes", column: "user_id", export: at("situation_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "season_format_votes", column: "user_id", export: at("season_format_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "show_idea_votes", column: "user_id", export: at("show_idea_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "show_ideas", column: "proposed_by", export: at("show_ideas_proposed"), delete: ROWS, move: SAID_AS },
  { table: "recoupling_votes", column: "user_id", export: at("recoupling_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "weekly_reveal_votes", column: "user_id", export: at("weekly_reveal_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "ceremony_votes", column: "user_id", export: at("ceremony_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "audition_votes", column: "voter_id", export: at("audition_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "character_ratings", column: "rater_id", export: at("character_ratings"), delete: ROWS, move: ONE_VOTE },
  { table: "character_reviews", column: "reviewer_id", export: at("character_reviews"), delete: ROWS, move: ONE_VOTE },
  { table: "line_feedback", column: "user_id", export: at("line_feedback"), delete: ROWS, move: ONE_VOTE },
  { table: "watch_poll_votes", column: "user_id", export: at("watch_parties.poll_votes"), delete: ROWS, move: ONE_VOTE },
  { table: "watch_reactions", column: "user_id", export: at("watch_parties.reactions"), delete: ROWS, move: ONE_VOTE },
  { table: "watch_messages", column: "user_id", export: at("watch_parties.messages"), delete: ROWS, move: SAID_AS },
  { table: "watch_presence", column: "user_id", export: out("who is in a watch room right now: a heartbeat, gone when they leave"), delete: ROWS, move: LOG },
  { table: "season_pool_entries", column: "user_id", export: at("season_pool_entries"), delete: ROWS, move: POINTS },
  { table: "cast_date_weeks", column: "user_id", export: at("cast_date_weeks"), delete: ROWS, move: POINTS },
  { table: "leagues", column: "owner_id", export: at("leagues_owned"), delete: ROWS, move: POINTS },
  { table: "league_members", column: "user_id", export: at("leagues_joined"), delete: ROWS, move: POINTS },
  { table: "badges", column: "user_id", export: at("badges"), delete: ROWS, move: POINTS },
  { table: "couple_follows", column: "user_id", export: at("couple_follows"), delete: ROWS, move: FOLLOW },
  { table: "character_follows", column: "user_id", export: at("character_follows"), delete: ROWS, move: FOLLOW },
  { table: "choice_history", column: "user_id", export: at("choice_history"), delete: ROWS, move: LOG },

  // Allowances, balances and payments: never doubled, never moved.
  { table: "free_episode_usage", column: "user_id", export: at("usage.free_dates"), delete: ROWS, move: ALLOWANCE },
  { table: "free_second_date_usage", column: "user_id", export: at("usage.free_second_dates"), delete: ROWS, move: ALLOWANCE },
  { table: "pack_episode_usage", column: "user_id", export: at("usage.pack_dates"), delete: ROWS, move: ALLOWANCE },
  { table: "token_grants", column: "user_id", export: at("usage.date_grants"), delete: ROWS, move: ALLOWANCE },
  { table: "token_grants", column: "granted_by", export: ADMINS_ID, delete: kept("the admin who gave it: the grant is the receiver's row and goes with them"), move: ADMIN_ACT },
  { table: "step_in_usage", column: "user_id", export: at("usage.step_in"), delete: ROWS, move: ALLOWANCE },
  { table: "companion_usage", column: "user_id", export: at("usage.companion"), delete: ROWS, move: ALLOWANCE },
  { table: "companion_extras_usage", column: "user_id", export: at("usage.companion_extras"), delete: ROWS, move: ALLOWANCE },
  { table: "companion_credits", column: "user_id", export: at("usage.companion_credits"), delete: ROWS, move: ALLOWANCE },
  { table: "companion_live_calls", column: "user_id", export: at("companion_calls"), delete: ROWS, move: skip("a call's minutes are charged to the id that called; calls need a plan, so an identity with no sign-in has none") },
  { table: "scene_suggestions", column: "user_id", export: at("scene_suggestions"), delete: ROWS, move: skip("a paid suggestion settles, or refunds, to the id that paid for it") },
  { table: "orders", column: "user_id", export: at("orders"), delete: ROWS, move: MONEY },
  {
    table: "plan_entitlements",
    column: "user_id",
    export: at("plans"),
    delete: kept("a plan's billing record stays while Stripe may still renew it: the yearly reminder is owed (lib/paid-plans.ts)"),
    move: MONEY,
  },
  { table: "plan_checkouts", column: "user_id", export: out("a click on Subscribe, counted: the plan it led to is exported"), delete: ROWS, move: MONEY },
  { table: "plan_events", column: "user_id", export: out("Stripe's event ids, each applied once: the plan they led to is exported"), delete: kept("with plan_entitlements: the record of what Stripe sent for a plan that may still renew"), move: MONEY },
  { table: "operator_entitlements", column: "user_id", export: at("operator_pass.entitlement"), delete: ROWS, move: MONEY },
  { table: "operator_date_usage", column: "user_id", export: at("operator_pass.usage"), delete: ROWS, move: ALLOWANCE },
  { table: "operator_pass_events", column: "user_id", export: out("Stripe's event ids, each applied once: the pass they led to is exported"), delete: cleared("null"), move: MONEY },

  // Settings and where to reach them.
  { table: "notifications", column: "user_id", export: at("notifications"), delete: ROWS, move: skip("past notices stay with the id they were sent to; new ones follow the character's owner") },
  { table: "notification_mutes", column: "user_id", export: at("notification_mutes"), delete: ROWS, move: SETTING },
  { table: "push_subscriptions", column: "user_id", export: at("push_subscriptions"), delete: ROWS, move: skip("this browser's push address: turning notifications on in the account registers it again") },
  { table: "email_prefs", column: "user_id", export: at("email"), delete: ROWS, move: SETTING },
  { table: "email_sends", column: "user_id", export: at("email"), delete: ROWS, move: LOG },
  { table: "user_live_face", column: "user_id", export: at("call_renderer"), delete: ROWS, move: SETTING },
  { table: "live_face_compares", column: "user_id", export: at("renderer_compares"), delete: ROWS, move: skip("an admin's renderer test, and an admin's id is never claimed") },

  // What they sent us, and what we logged.
  { table: "user_feedback", column: "user_id", export: at("feedback"), delete: ROWS, move: SAID_AS },
  { table: "plus_interest", column: "user_id", export: at("plus_interest"), delete: ROWS, move: LOG },
  { table: "language_seen", column: "actor", export: at("languages_written"), delete: ROWS, move: LOG },
  { table: "web_events", column: "user_id", export: out("a click log with ids taken out of its paths and nothing typed, kept 400 days: deleted with the account"), delete: ROWS, move: LOG },
  { table: "analytics_events", column: "user_id", export: out("funnel events (a small enum each): deleted with the account"), delete: ROWS, move: LOG },
  { table: "money_entries", column: "created_by", export: ADMINS_ID, delete: kept("the admin who entered a bill: the books stay"), move: ADMIN_ACT },

  // Agents: an agent's id is a person id like any other (it can be deleted and exported), and is never claimed.
  { table: "agent_links", column: "agent_id", export: at("agent.links"), delete: ROWS, move: AGENT },
  { table: "agent_links", column: "user_id", export: at("agent.links"), delete: ROWS, move: NEEDS_ACCOUNT },
  { table: "agent_link_codes", column: "agent_id", export: out("the hash of a one-time link, good for an hour"), delete: ROWS, move: AGENT },
  { table: "agent_handles", column: "agent_id", export: at("agent.handle"), delete: ROWS, move: AGENT },
  { table: "agent_models", column: "agent_id", export: at("agent.model"), delete: ROWS, move: AGENT },
  { table: "episode_models", column: "agent_id", export: at("agent.date_models"), delete: kept(`a date's stamp of the model family that played a side: ${SHARED_DATE}`), move: AGENT },
  { table: "agent_feedback", column: "agent_id", export: at("agent.feedback"), delete: ROWS, move: AGENT },
  { table: "feedback_votes", column: "agent_id", export: at("agent.feedback_votes"), delete: ROWS, move: AGENT },
  { table: "agent_status_cursors", column: "agent_id", export: out("how far my_status has shown its notifications: a read marker"), delete: ROWS, move: AGENT },
  { table: "mcp_sessions", column: "agent_id", export: at("agent.sessions"), delete: ROWS, move: AGENT },
  { table: "mcp_calls", column: "agent_id", export: out("the call log (a tool's name and whether it worked, kept 400 days): the sessions in the export carry the counts"), delete: ROWS, move: AGENT },
  { table: "job_deals", column: "holder", export: out("a half-hour hold on a suggested job, gone in a day"), delete: ROWS, move: AGENT },
];

/** Columns named like a person's id that hold something else. Listed so the name alone never decides. */
export const LOOK_ALIKES: readonly LookAlike[] = [
  { table: "web_events", column: "visitor", holds: "a random id the browser keeps for the click log (app/engagement.ts): never the person's id. Its rows go with the account's (deleteAccount)" },
  { table: "mcp_sessions", column: "visitor", holds: "a keyed hash of the caller's network address (lib/limits.ts visitorKey), for telling one client's sessions apart" },
  { table: "web_events", column: "host", holds: "which of our sites the event came in on (show or after dark)" },
  { table: "date_roleplays", column: "proposed_by", holds: "the character the proposal is from (a character's id); the person is proposer_user" },
  { table: "swipe_impressions", column: "viewer", holds: "the character whose deck it was (a character's id)" },
  { table: "unmatches", column: "by_character", holds: "the character whose side ended the match (a character's id)" },
  { table: "character_opinions", column: "holder_id", holds: "the character who holds the opinion (a character's id)" },
  { table: "character_heard", column: "holder_id", holds: "the character who heard it (a character's id)" },
  { table: "character_heard", column: "told_by", holds: "the character who told them (a character's id)" },
  { table: "character_wants", column: "holder_id", holds: "the character who wants it (a character's id)" },
  { table: "character_wants", column: "set_by", holds: "what set the want: the rules or the producer (an enum)" },
  { table: "episodes", column: "performed_by", holds: "who wrote the lines: the platform or an agent (an enum)" },
  { table: "group_nights", column: "room_opening_by", holds: "what wrote the room's opening: a model's name or the template" },
  { table: "group_nights", column: "room_closing_by", holds: "what wrote the room's closing: a model's name or the template" },
  { table: "season_recaps", column: "narrative_by", holds: "what wrote the finale's narrative: a model's name or the template" },
  { table: "story_beats", column: "logline_by", holds: "what wrote the logline: a model's name or the template" },
  { table: "companion_messages", column: "replaced_by", holds: "the message that replaced this one when a reply was drawn again (a message's id)" },
  { table: "mcp_sessions", column: "user_agent", holds: "the client's user-agent string, cut short" },
  { table: "mcp_calls", column: "user_agent", holds: "the client's user-agent string, cut short" },
  { table: "user_feedback", column: "user_agent", holds: "the browser's user-agent string, sent with the feedback" },
  { table: "content_reports", column: "user_agent", holds: "the browser's user-agent string, sent with the report" },
];
