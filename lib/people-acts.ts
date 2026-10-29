/**
 * Everything a person does on purpose that has a time, as (id, at): what "first seen", the funnel and retention are read
 * from (lib/insights.ts), and what makes someone first active before the public launch ours (lib/our-traffic.ts, which
 * the insights import: hence its own module). A visit that does nothing leaves no trace (page views aren't stored).
 * Sitting in a watch room isn't counted either: its heartbeat can't tell a person from a crawler that runs the page's
 * scripts (on 2026-10-22, 41 of the 44 watch-room identities had done nothing else). Chatting, reacting or voting in a
 * room is.
 */
export const PEOPLE_ACTS_SQL = `
  select owner_id as id, created_at as at from characters where not is_house and created_via = 'web' and owner_id is not null
  union all select creator_id, created_at from episodes where created_via = 'web'
  union all select user_id, created_at from predictions
  union all select user_id, created_at from arc_predictions
  union all select user_id, created_at from dealbreaker_guesses
  union all select proposer_id, created_at from matchmaker_proposals
  union all select rater_id, created_at from character_ratings
  union all select reviewer_id, created_at from character_reviews where via = 'web'
  union all select user_id, created_at from couple_follows
  union all select user_id, created_at from line_feedback
  union all select user_id, created_at from watch_messages
  union all select user_id, created_at from watch_reactions
  union all select user_id, updated_at from watch_poll_votes
  union all select user_id, created_at from accounts
  union all select user_id, attested_adult_at from profiles
  union all select user_id, joined_at from league_members
  union all select c.owner_id, s.created_at from swipes s join characters c on c.id = s.swiper
            where c.created_via = 'web' and not c.is_house and c.owner_id is not null
  union all select c.owner_id, t.created_at from couple_texts t join characters c on c.id = case when t.who = 'lo' then t.character_lo else t.character_hi end
            where t.via in ('own_key', 'stand_in') and c.owner_id is not null`;
