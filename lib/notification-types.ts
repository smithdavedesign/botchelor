/**
 * Notification types (David 2026-11-07: "add types to the notifications so you can filter by the type"). The ~50
 * internal kinds (lib/notifications.ts NotificationKind) fold into six types a person recognises; /notifications
 * filters by them (?type=) and labels each row with its type. The map is a Record over every kind, so a new kind
 * that isn't given a type fails the typecheck.
 *
 * Client-safe: a type-only import, no server code.
 */
import type { NotificationKind } from "./notifications";

export const NOTIFICATION_TYPES = ["texts", "dates", "show", "creator", "agents", "account"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  texts: "Texts",
  dates: "Matches & dates",
  show: "The show",
  creator: "Showcase",
  agents: "Agents",
  account: "Keys & account",
};

export const NOTIFICATION_TYPE_EMOJI: Record<NotificationType, string> = {
  texts: "💬",
  dates: "💘",
  show: "📺",
  creator: "🖼️",
  agents: "🤖",
  account: "🔑",
};

const TYPE_OF: Record<NotificationKind, NotificationType> = {
  texted: "texts",
  matched: "dates",
  matchmaker_pick: "dates",
  scheduled_date: "dates",
  double_invite: "dates",
  double_date: "dates",
  mixer: "dates",
  group_reflect: "dates",
  date_link: "dates",
  date_agreed: "dates",
  second_date_yes: "dates",
  second_date_booked: "dates",
  date_booked_with_yours: "dates",
  stage_up: "dates",
  couple_date: "dates",
  date_aired: "dates",
  partner_style: "dates",
  match_taken: "dates",
  exclusive_soon: "dates",
  date_proposal: "dates",
  date_proposal_declined: "dates",
  date_accepted: "dates",
  date_roleplay: "dates",
  date_roleplay_answer: "dates",
  likes_waiting: "dates",
  recoupling: "show",
  arc_resolved: "show",
  prediction_scored: "show",
  situation_on: "show",
  season_vote: "show",
  backing_settled: "show",
  dare_on: "show",
  dare_settled: "show",
  audition: "show",
  cast_date_won: "show",
  secret_revealed: "show",
  season_pool: "show",
  showcase_request: "creator",
  showcase_post: "creator",
  showcase_answer: "creator",
  after_dark_share: "creator",
  own_date_invite: "agents",
  own_date_turn: "agents",
  own_date_handed_over: "agents",
  own_date_declined: "agents",
  own_date_lapsed: "agents",
  own_date_ready: "agents",
  while_away: "agents",
  after_dark_request: "agents",
  key_usage: "account",
  key_capped: "account",
  key_failed: "account",
};

/** A kind's type; an unknown kind (an old row) reads as the show's. */
export const notificationTypeOf = (kind: string): NotificationType => TYPE_OF[kind as NotificationKind] ?? "show";

/** Every kind in a type: the filter's SQL takes these. */
export const kindsOfType = (type: NotificationType): NotificationKind[] =>
  (Object.keys(TYPE_OF) as NotificationKind[]).filter((k) => TYPE_OF[k] === type);

export const isNotificationType = (v: unknown): v is NotificationType => typeof v === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(v);
