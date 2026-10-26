-- After Dark's monthly moderation report (docs/after-dark-processor-application.md: the "monthly report" processors ask
-- for). Plain SQL, read-only (it runs in a transaction it rolls back). Counts only: no user ids, names, prompts or
-- pictures leave the database.
--
-- The month: the line below, as its first day ('2026-10-01'); empty means last month.
--   neon psql --profile <profile> --project-id <project> -- -f scripts/after-dark/moderation-report.sql
begin read only;
set local after_dark.report_month = '';

-- 0. The month covered.
with m as (select date_trunc('month', coalesce(nullif(current_setting('after_dark.report_month', true), '')::date, (now() - interval '1 month')::date)) as s)
select s::date as month_start, (s + interval '1 month')::date as month_end from m;

-- 1. Every picture and video is checked before it's kept: what passed (kept) and what was refused (discarded, never
--    stored), by kind.
with m as (select date_trunc('month', coalesce(nullif(current_setting('after_dark.report_month', true), '')::date, (now() - interval '1 month')::date)) as s)
select case when kind = 'audio' then 'kept: voiced line (no picture to check)' else 'kept: passed the output check' end as outcome,
       kind, count(*)::int as n
  from adult_images, m
 where created_at >= m.s and created_at < m.s + interval '1 month' and status = 'ready'
 group by kind
union all
select 'refused and discarded', kind, count(*)::int
  from adult_rejections, m
 where created_at >= m.s and created_at < m.s + interval '1 month'
 group by kind
 order by 1, 2;

-- 2. Why they were refused (the checker's reason, first 60 characters).
with m as (select date_trunc('month', coalesce(nullif(current_setting('after_dark.report_month', true), '')::date, (now() - interval '1 month')::date)) as s)
select left(reason, 60) as reason, count(*)::int as n
  from adult_rejections, m
 where created_at >= m.s and created_at < m.s + interval '1 month'
 group by 1 order by 2 desc limit 15;

-- 3. Complaints and takedown requests (/report), by category and outcome.
with m as (select date_trunc('month', coalesce(nullif(current_setting('after_dark.report_month', true), '')::date, (now() - interval '1 month')::date)) as s)
select category, status, count(*)::int as n
  from content_reports, m
 where created_at >= m.s and created_at < m.s + interval '1 month'
 group by 1, 2 order by 1, 2;

-- 4. How fast reports were decided: 48 hours for intimate images, 7 business days (taken as 9 calendar days) otherwise.
with m as (select date_trunc('month', coalesce(nullif(current_setting('after_dark.report_month', true), '')::date, (now() - interval '1 month')::date)) as s)
select category,
       count(*) filter (where decided_at is not null)::int as decided,
       count(*) filter (where decided_at is null)::int as still_open,
       round((percentile_cont(0.5) within group (order by extract(epoch from decided_at - created_at) / 3600)
             filter (where decided_at is not null))::numeric)::int as median_hours,
       count(*) filter (where decided_at is not null and decided_at - created_at <=
             case when category = 'intimate_image' then interval '48 hours' else interval '9 days' end)::int as within_deadline
  from content_reports, m
 where created_at >= m.s and created_at < m.s + interval '1 month'
 group by 1 order by 1;

-- 5. Billing postbacks by kind (chargebacks and refunds included), and accounts flagged for review.
with m as (select date_trunc('month', coalesce(nullif(current_setting('after_dark.report_month', true), '')::date, (now() - interval '1 month')::date)) as s)
select processor, kind, count(*)::int as n
  from adult_billing_events, m
 where received_at >= m.s and received_at < m.s + interval '1 month'
 group by 1, 2 order by 1, 2;
with m as (select date_trunc('month', coalesce(nullif(current_setting('after_dark.report_month', true), '')::date, (now() - interval '1 month')::date)) as s)
select count(*)::int as accounts_flagged
  from adult_billing_flags, m
 where flagged_at >= m.s and flagged_at < m.s + interval '1 month';

rollback;
