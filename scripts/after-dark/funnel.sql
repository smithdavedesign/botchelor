-- After Dark's funnel, and who to tell when billing opens (2026-11-26, the revenue pass). Plain SQL, read-only (it runs
-- in a transaction it rolls back). Sections 1 to 4 are counts only. Section 5 prints email addresses, so run it only in
-- your own terminal and never paste its output into an issue, a pull request or a chat (the repo is public).
--
--   neon psql --profile <profile> --project-id <project> -- -f scripts/after-dark/funnel.sql
--
-- Our own accounts aren't filtered out here: an admin never needs a pass, so admins rarely appear, but a reviewer pass
-- (provider 'reviewer') is ours and is counted on its own line.
begin read only;

-- 1. The waitlist: "Email me when it opens" on the subscribe page (ref after-dark) and, since 2026-11-26, people whose
--    beta month or subscription ran out (ref after-dark-lapsed).
select coalesce(ref, '(none)') as ref, count(*)::int as emails, max(created_at)::date as newest
  from waitlist where ref like 'after-dark%' group by 1 order by 2 desc;

-- 2. Invite requests, by where they came from (verdict: the show's verdict card; refugees: an outreach post) and status.
select coalesce(source, '(subscribe page)') as source, status, count(*)::int as requests,
       min(requested_at)::date as first, max(requested_at)::date as newest
  from adult_invites group by 1, 2 order by 1, 2;

-- 3. Passes: open now, and ended, by kind.
select coalesce(provider, '(none)') as provider,
       case when (subscription_status = 'active' and (period_end is null or period_end > now()))
              or (subscription_status = 'cancelled' and period_end > now()) then 'open' else 'ended' end as state,
       count(*)::int as people
  from adult_entitlements where provider is not null group by 1, 2 order by 1, 2;

-- 4. Beta passes ending in the next 14 days: the people to reach before they lapse.
select period_end::date as ends, count(*)::int as people
  from adult_entitlements where provider = 'beta' and subscription_status = 'active' and period_end between now() and now() + interval '14 days'
 group by 1 order by 1;

-- 5. The launch list: everyone to tell the day subscriptions open. The After Dark waitlist, every invite request, and
--    every ended beta month or subscription, once an address, leaving out anyone who turned email off (email_prefs).
--    EMAIL ADDRESSES: your terminal only.
with people as (
  select lower(email) as email, 'waitlist:' || coalesce(ref, '') as why from waitlist where ref like 'after-dark%'
  union all
  select lower(email), 'invite:' || status from adult_invites
  union all
  select lower(p.email), 'pass-ended:' || e.provider
    from adult_entitlements e join email_prefs p on p.user_id = e.user_id
   where e.provider is not null and e.provider not in ('reviewer', 'taste')
     and not ((e.subscription_status = 'active' and (e.period_end is null or e.period_end > now()))
           or (e.subscription_status = 'cancelled' and e.period_end > now()))
)
select email, string_agg(distinct why, ', ') as why
  from people
 where email not in (select lower(email) from email_prefs where status = 'off')
 group by email order by email;

rollback;
