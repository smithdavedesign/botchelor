/**
 * After Dark's part of the person-column registry (lib/person-columns.ts has the rules and the show's tables). It lives
 * here because After Dark's tables are named only by After Dark's own code, the schema and the account delete
 * (tests/after-dark-facts.test.ts, tests/after-dark-scenarios.test.ts).
 *
 * All of it is the same three answers:
 *  - export: none. After Dark is left out of the account export on purpose (lib/account.ts); what a person saved about
 *    their characters there has its own download (lib/adult/profile-data.ts).
 *  - delete: everything the person made, chose or was granted goes (lib/account.ts deleteAfterDarkData); billing
 *    orders and the processors' postbacks stay with the id cleared.
 *  - move: nothing. After Dark opens only for a signed-in account (lib/adult/mode.ts), so an identity that can be
 *    claimed has no rows here, and its entitlement, age check and region are a person's own and are never handed on.
 */
import type { DeleteRule, LookAlike, MoveRule, PersonColumn } from "../person-columns";

const NOT_EXPORTED = { no: "After Dark is left out of the account export on purpose (lib/account.ts): its profile has its own download (lib/adult/profile-data.ts)" } as const;
const NEVER_MOVES: MoveRule = { does: "skip", why: "After Dark opens only for a signed-in account, so an identity that can be claimed has no rows here; nothing of After Dark is ever moved" };
const ROWS: DeleteRule = { does: "rows" };
const ADMIN: DeleteRule = { does: "keep", why: "the admin who did it: the record of what was changed, reviewed or granted stays" };

const owned = (table: string, column: string): PersonColumn => ({ table, column, export: NOT_EXPORTED, delete: ROWS, move: NEVER_MOVES });
const with_ = (table: string, column: string, rule: DeleteRule): PersonColumn => ({ table, column, export: NOT_EXPORTED, delete: rule, move: NEVER_MOVES });

export const ADULT_PERSON_COLUMNS: readonly PersonColumn[] = [
  // What they made and kept there.
  owned("adult_scenes", "owner_id"),
  owned("adult_nights", "owner_id"),
  owned("adult_overnights", "owner_id"),
  owned("adult_steps", "owner_id"),
  // Step in (lib/adult/step-in.ts): their scenes with one character, and every message of them. Their own download is
  // After Dark's (lib/adult/profile-data.ts exportAdultProfile, "step_in").
  owned("adult_step_in_scenes", "owner_id"),
  owned("adult_step_in_messages", "owner_id"),
  owned("adult_memories", "owner_id"),
  owned("adult_facts", "owner_id"),
  owned("adult_rejections", "owner_id"),
  owned("adult_characters", "owner_id"),
  owned("adult_switches", "owner_id"),
  owned("adult_images", "owner_id"),
  // A picture's tags go when the picture does (on delete cascade).
  with_("adult_media_tags", "owner_id", { does: "rows", via: "adult_images" }),
  owned("adult_media_thumbs", "owner_id"),
  owned("adult_reels", "owner_id"),
  owned("adult_shorts", "owner_id"),
  owned("adult_beats", "owner_id"),
  owned("adult_monologues", "owner_id"),
  owned("adult_monologues", "created_by"),
  owned("adult_voice_lines", "owner_id"),
  owned("adult_talks", "owner_id"),
  owned("adult_presence", "owner_id"),
  owned("adult_picture_briefs", "owner_id"),
  owned("adult_light_picks", "owner_id"),
  owned("adult_face_refs", "owner_id"),
  owned("adult_nude_refs", "owner_id"),
  owned("adult_identity", "owner_id"),
  owned("adult_steer_resets", "owner_id"),
  owned("adult_studio_shoots", "owner_id"),
  owned("adult_studio_setups", "owner_id"),
  owned("adult_shares", "owner_id"),
  owned("adult_shares", "recipient_id"),
  // What they chose, rated and watched.
  owned("adult_media_ratings", "user_id"),
  owned("adult_short_views", "user_id"),
  owned("adult_short_calls", "user_id"),
  owned("adult_share_prefs", "user_id"),
  owned("adult_prefs", "user_id"),
  owned("adult_privacy", "user_id"),
  owned("adult_tastes", "user_id"),
  // Their turn-ons: the rows of their own characters go (deleteAdultProfile, by the character). A house character's are
  // the show's, shared with every viewer, so they stay: the consent on them is cleared, who last edited them is not.
  with_("adult_profiles", "updated_by", { does: "keep", why: "a house character's turn-ons an admin set are the show's (lib/adult/profile-data.ts); the person's own characters' rows are deleted by the character" }),
  with_("adult_profiles", "consented_by", { does: "anonymise", to: "null" }),
  // Who may come in, and where they are.
  owned("adult_entitlements", "user_id"),
  owned("adult_age_checks", "user_id"),
  owned("adult_viewer_places", "user_id"),
  owned("adult_invites", "user_id"),
  owned("adult_access_requests", "agent_id"),
  // Money: their grants, usage and any chargeback flag go; orders and postbacks stay, unlinked (AFTER_DARK_UNLINKED).
  owned("adult_usage", "owner_id"),
  owned("adult_token_grants", "user_id"),
  owned("adult_token_usage", "user_id"),
  owned("adult_billing_flags", "user_id"),
  with_("adult_billing_orders", "user_id", { does: "anonymise", to: "null" }),
  with_("adult_billing_events", "user_id", { does: "anonymise", to: "null" }),
  // An admin's act, on someone else's row or on the settings.
  with_("adult_token_grants", "granted_by", ADMIN),
  with_("adult_billing_flags", "reviewed_by", ADMIN),
  with_("adult_settings_history", "by_user", ADMIN),
];

export const ADULT_LOOK_ALIKES: readonly LookAlike[] = [
  { table: "adult_images", column: "superseded_by", holds: "the picture that replaced this one after a fix (a picture's id)" },
  { table: "adult_step_in_messages", column: "replaced_by", holds: "the reply showing in this draw's place after a reply was drawn again (a message's id)" },
];
