# Hosting

**Since 2026-10-30, botchelor runs on DigitalOcean App Platform, not Vercel.** David moved the Vercel team to the free
(Hobby) plan, which can't deploy this app: it allows at most 12 functions per deployment (botchelor has hundreds of
routes), only daily cron jobs, and no commercial use. So the show moved to DigitalOcean, next to After Dark's own host.

| | What | Spec | Cost |
|---|---|---|---|
| The show | `botchelor.com`, `www.botchelor.com` | [`.do/show.yaml`](../.do/show.yaml) | $12 a month (1 vCPU, 1 GiB) |
| After Dark | `ad.botchelor.com` | [`.do/app.yaml`](../.do/app.yaml), runbook [after-dark-hosting.md](after-dark-hosting.md) | $10 a month |
| Scheduled jobs | the lobby (hourly), the showcase check (hourly, which also cuts a first-frame still for each new clip: lib/showcase-posters.ts), the daily job | a job on After Dark's app (`.do/app.yaml` `jobs`) | at most $5 a month |
| After Dark's media | `media.botchelor.com` | Bunny (runbook) | about $1–6 a month |

The database (Neon) and the show's media bucket (Neon Object Storage) didn't move.

**Both apps run in San Francisco (`sfo`) since 2026-11-04**, next to the database in Oregon (Neon `aws-us-west-2`).
They started in New York, so every query crossed the country (~40–70 ms each; heavy pages wait on several in a row).
The move was `region` in each app's spec, at the same price; Bunny's storage zone stayed in New York.

## What changed in the code

- **Production is `DEPLOY_ENV=production`** off Vercel (`lib/deploy.ts`), as `VERCEL_ENV=production` was on Vercel:
  live Stripe links only, test events never grant, IndexNow pings, the funnel beacon, Hive always on.
- **The site's address is `SITE_URL`** (`lib/site.ts`): links in guides, the MCP discovery file and sitemaps name
  botchelor.com, never the server's internal address.
- **Vercel Web Analytics and Speed Insights** are gone, packages and all (2026-10-31), with `@vercel/functions`'
  metrics. Google Analytics and the `track()` analytics log lines are unchanged.
- **Where a visitor is** (`lib/place.ts`): Vercel's location headers are gone. Without them a visitor's country is
  unknown, which is safe on both sides: the EU consent banner shows to everyone who hasn't chosen, and After Dark
  stays closed to everyone but admins. So botchelor.com sits behind our own Cloudflare zone (free) with the "Add visitor
  location headers" managed transform on, and the show has `GEO_HEADERS=cloudflare`: `cf-ipcountry` and
  `cf-region-code` give the country and the US state (both on since 2026-10-30; checked: a signed-out After Dark hop
  carries `place.v1.US.CA`).
- **Scheduled jobs** call `https://<host>/api/jobs/<name>` with `Authorization: Bearer $CRON_SECRET`, as Vercel
  Cron did: `lobby` and `daily` on botchelor.com, `after-dark-daily` and `showcase-check` on ad.botchelor.com, where
  After Dark's media is (`.do/app.yaml`). The daily job goes one part per request (`?part=upkeep|show|people|growth`, 45 s apart), and each part's
  answer streams newlines until it's done, so the next part never starts while one is still running. Run whole, it held
  the show's one instance for minutes and botchelor.com answered 504 for ~5 and ~9 minutes on 2026-11-11. Each part's
  time, memory peak and longest event-loop stall go to `job_runs` (`lib/job-meter.ts`) and show in the monitor's
  `/api/health` (`daily_job`, with the instance's memory under `process`).
- **Long requests:** App Platform has no `maxDuration`. Its edge (Cloudflare) ends a response that sends nothing for
  100 seconds, so streams keep sending, and slow work runs in `after()` once the response is out, as before.
  MCP waits (`wait_seconds`) still sometimes got a bare `error code: 504` from it at 50 seconds, though 40 or less never
  did (#1057), so a wait is capped at 30 (`WAIT_MAX_SECONDS`), and the cheatsheets say a bare 504 on a wait is safe to retry.

## Deploys

Both apps build `main` on every push (`deploy_on_push`). A deploy is live when its app's deployment is `ACTIVE`:
DigitalOcean dashboard → Apps → the app → Activity, or the API (`GET /v2/apps/<id>/deployments`). Pull requests get no
preview deployment any more: merge on the local checks (`tsc`, the full test suite) and GitGuardian, then watch the
deploy and check `https://botchelor.com/api/health`. Since 2026-10-31 the Vercel project skips every build (Settings →
Git → Ignored Build Step is `exit 0`), so it no longer fails on Hobby; if a "Vercel" check still shows on a pull request,
ignore it.

## Settings and logs

- **Environment variables** live in each app's settings: DigitalOcean → Apps → the app → Settings → App-Level (or the
  component's) Environment Variables, or the API (`PUT /v2/apps/<id>` with the spec). Values come from the keychain
  (`vault/botchelor/<NAME>`); secrets are marked Encrypt. Not `vercel env` any more. The show's Discord
  (`DISCORD_WEBHOOK_URL`, `DISCORD_WEBHOOK_DROPS`, `DISCORD_WEBHOOK_VOTES`, `DISCORD_WEBHOOK_BOARD`,
  `DISCORD_INVITE_URL`) goes on the show's app, `botchelor-show`: the hourly job is scheduled from After Dark's app,
  but it calls `botchelor.com/api/jobs/lobby`, which the show serves ([discord.md](discord.md)).
- **`FIRST_DATE_FORMAT`** (the show's app, not a secret; default `speed_date`): the format a newcomer's instant first
  date plays in (`lib/first-date.ts` `firstDateFormat`). The builder's "Start the date now" card sends it with the
  booking, so the first verdict comes in about a minute (6 lines) instead of the classic date's two-plus. Set it to
  another free format's id (`classic`, `meet_the_parents`, `ex_returns`) to change the first date without a deploy; a
  premium or unknown id falls back to `speed_date`. Commented in `.do/show.yaml` beside the other switches.
- **`FAST_FIRST_LINE`** (the show's app, not a secret; default: speed dates): which formats start fast
  (`lib/fast-date.ts`): no director call in front of the first line, a 2.5 s limit on a new character's hot takes
  (`HOT_TAKES_WAIT_MS`), and the recap, texts and reflections written side by side. `0` or `off` makes no date fast;
  `all` starts every format fast ([date-quality.md](date-quality.md), "Round: the fast first date", has the
  measurements and the query to check the result). Since `DATE_PLAN_AT_NIGHT` (below, on by default) no format asks the
  director before its first line, fast or not, so the classic no longer waits 50 s on a plan that wasn't arriving; the
  old plan-first order needs `DATE_PLAN_AT_NIGHT=0` as well. **`SPEED_DATE_MODEL`** and **`SPEED_DATE_REASONING`** (both unset: the show's model as
  it is) put a speed date's lines, answers, texts and reflections on another model id at the show's paid endpoint, or
  on another thinking level (`minimal`, `low`, `medium`, `high`); the measurements there say leave them unset.
  Commented in `.do/show.yaml`.
- **`PRODUCER`** (the show's app, not a secret; on unless `0`): the producer (`lib/producer.ts`,
  [seasons.md](seasons.md), "The producer"). The hourly job's 23:20 UTC pass picks the next day's beat from the story
  state, overwrites the wants of the two or three cast members it is about, offers the day's vote two or three twists of
  it and writes the day's "Previously" / "Tonight" lines and logline. `0` writes none of it and reads none: the dealt
  roleplays are the ballot again, and the lines disappear. `STORY_STATE=0` turns it off too (it has nothing to read).
  To skip one day without touching the switch: `/admin/season` → The producer → Skip tomorrow's beat.
- **`DATE_PLAN_AT_NIGHT`** (the show's app, not a secret; on unless `0`): no date of any format asks the director for a
  plan in front of its first line (`lib/night-plans.ts`, [date-quality.md](date-quality.md), "Round: the plan at
  night"). A house date reads the plan the producer stored for it the night before when there is one and it still fits;
  every other date plays from the rules plan at once. `generated_with.plan` on the episode says which (`producer` |
  `rules`). `0` restores the old order exactly: the classic and the other non-fast formats ask the director first again
  (`generated_with.plan` is then `director` | `rules`), and no stored plan is read or written. With it on,
  `FAST_FIRST_LINE` only decides the hot-takes wait and whether the recap, texts and reflections are written side by
  side. **`PRODUCER_PLANS`** (off unless `1`): the night's writing of those plans, one small call on the show's free model
  for the next day's house date (the voted date, or else the lobby's room). Off by default because the measurement did
  not show a stored plan reading better than the rules plan overall (it earns the ending better and sounds less
  natural: the numbers and the dates are in that round); `1` turns it on without a deploy, and `/admin/season` → The
  producer lists each plan and whether its date used it. All three are commented in `.do/show.yaml`.
- **`EARNED_ENDINGS`** (the show's app, not a secret; on unless `0`): a date played from the rules plan carries the
  moment its decided ending comes from, a third of the way in (`lib/date-turn.ts`, [date-quality.md](date-quality.md),
  "Round: endings the dialogue earns"): a disaster turns on a tripped dealbreaker, something heard, a missed agenda,
  two opinions or an unmet want; "just friends" on a friend's line; a second date with a missed agenda gets a wobble
  that is met. No model call, and nothing the engine decided changes. `generated_with.turn` on the episode says which
  kind. `0` plays every date from its beats alone, as before. Commented in `.do/show.yaml`.
- **`EXPRESS_CREATE`** (the show's app, not a secret; on unless `0`): one-sentence create, the one-box first screen of
  `/create` for a first character (`lib/express-create.ts`, [flows.md](flows.md)). `0` restores the form as the first
  step and `POST /api/characters/draft` answers 404.
- **`HOME_OPEN`** (the show's app, not a secret; on unless `0`): a first visit's home is one screen with one job
  (`app/HomeOpen.tsx`, `lib/home-open.ts`; 2026-11-21): the stage, the promise, the sentence box and the day's clip, then
  a real date to call the ending of, what just aired, how it works and three questions. `0` brings back the page as it
  was before: a hero of its own, the tonight band, the situation vote, the cast and the map. An owner's home is the
  same either way. `HOME_HERO_CLIP=0` plays the show's own loop in place of the day's clip, and `HOME_EXPRESS_BOX=0`
  puts a plain "Make your character" button where the sentence box is.
- **`IMPORT_HISTORY_MODEL`** (the show's app, not a secret; unset in production): a pasted history is read by the paid model (`FRONTIER_LLM_*`) and by nothing when there is none; `free` puts the reading on the free model, for a local setup without a paid key. Never set it to `free` in production: a history is a private chat log.
- **`IMPORT_MEMORIES`** (the show's app, not a secret; on unless `0`): "Bring their history" on `/import`
  (`lib/import-history.ts`, [flows.md](flows.md), "Bringing a character from another app"). `0` removes the second box,
  `POST /api/characters/import/history` and `POST /api/characters/:id/import-history` answer 404, and the import pages
  say again that history stays behind.
- **`CHARACTER_QUESTIONS`** (the show's app, not a secret; on unless `0`): the daily job's `character_questions` step, a
  character asking its opted-in owner about its own sheet (`lib/character-questions.ts`, [companions.md](companions.md)).
  `0` sends none; an answer box already in a thread still saves.
- **`CHARACTER_LESSONS`** (the show's app, not a secret; on unless `0`): the characters' weekly lessons
  (`lib/character-lessons.ts`, [character-depth.md](character-depth.md) §12): the daily job's `character_lessons` step
  (up to 40 characters a day on the free model, the paid default as the fallback, then a template), the lessons block in
  a character's own date prompt and its owner's companion prompt, the lines on the owner's memory page and in Sunday's
  recap, and the one weekly text. `0` turns all of it off without a deploy of code; rows already written stay and come
  back with the switch.
- **`LIFE_DATES_PER_DAY`** (the show's app, not a secret; default `30`): how many life dates the daily job books a day
  (`lib/character-life.ts weeklyLifeDates`): the house takes each owned character out once a week, house-paid, on the
  show's model (~1¢ each). `0` turns them off without a deploy; nothing books while `BOTCHELOR_PAUSE` is on or the paid
  model's daily date cap (`FRONTIER_DAILY_DATE_CAP`) is spent. Commented in `.do/show.yaml`; the rules are in
  [companions.md](companions.md), "Your character lives without you".
- **`OPEN_CASTING`** (the show's app, not a secret; on unless it is `0`): open casting (`lib/casting.ts`), where a
  person's new character's first date goes to the Botchelor's lead and walk-ons get roses on Sunday. On, it still does
  nothing until a lead format is picked on `/admin/season` (this season's, or next season's with its lead); `0` closes
  it without a deploy: first dates are the usual ones again and no roses are handed out. Commented in `.do/show.yaml`;
  the rules are in [seasons.md](seasons.md), "Open casting".
- **`NAV_CHAT`** (the show's app, not a secret; on unless it is `0`): the navigation of 2026-11-15 (`lib/nav-chat.ts`):
  Watch · Chat · Characters · Studio · Account in the header and the phone's tab bar, and Watch · House · Season · Shows as the
  show's tabs. `0` brings back the header, tab bar and show tabs as they were, without a deploy of code; `/chat` still
  works. Commented in `.do/show.yaml`; described in [flows.md](flows.md), "Navigation".
- **`HOUSE_SCENES`** (the show's app, not a secret; on unless it is `0`): the daily house scene
  (`lib/house-scenes.ts`): a few of the cast talk over a date that aired, and what they retell becomes something the
  others heard. One call a day on the free model (0.07 cents at paid list prices) or a template. `0` writes no scene
  and `/house` says the house is quiet. `HOUSE_SCENE_HOUR_UTC` (default `18`) is the hour from which the hourly job
  writes the day's. Commented in `.do/show.yaml`; the rules are in [seasons.md](seasons.md), "The house".
- **`HOUSE_TEXTS`** (the show's app, not a secret; on unless it is `0`): what the house does reaches the chat
  (`lib/house-texts.ts`): a character a public house scene or the day's line names texts the threads that turned its
  texts on, holds what it texted about, and its companion prompt carries the last public things said about it.
  Templates and rows: no model call. `0` sends nothing, holds nothing and removes the prompt block, without a deploy.
  Commented in `.do/show.yaml`; the rules are in [companions.md](companions.md), "When the house talks about them".
- **`ACCOUNT_CLAIM`** (the show's app, not a secret; on unless it is `0`): claiming what a browser made before signing in
  (`lib/account-claim.ts`): the offer cookie set at sign-in, the card on `/account` and `POST /api/me/claim`. `0`: no
  offer is made, no card shows and the route answers 404; signing in works as before. Commented in `.do/show.yaml`;
  the rules are in [accounts-and-byok.md](accounts-and-byok.md), "Claiming what you made before signing in".
- **`STORY_MAP`** (the show's app, not a secret; on unless it is `0`): this week's story map (`lib/story-map.ts`) on
  `/house` and at the top of `/graph`, and the circle component. Reads only; no model calls. `0` leaves both pages as
  they were. Commented in `.do/show.yaml`; the rules are in [relationship-graph.md](relationship-graph.md), "The story map".
- **`RELATIONSHIP_STAGES_V2`** (the show's app, not a secret; on unless it is `0`): the fuller reading of where a
  couple stands (`lib/relationship-stages.ts`): didn't click, keeping it casual, official, moved in together, engaged,
  married, broke up, back together, divorced, and bad blood only where there was cause. Derived from the dates'
  endings and the public record; no model call, and no rule reads it (suggestions, the one-partner rule, arcs and
  their points, backing, overnight offers and who texts all keep reading the seven base stages). `0` shows exactly
  those seven everywhere (pages, notices, prompts, MCP), names nobody at a season's finale, and stops writing the
  shown columns, without a deploy of code; the hourly job fills them again when it is back on. Commented in
  `.do/show.yaml`; the rules are in [relationship-graph.md](relationship-graph.md), "Stages".
- **`CONFRONTATIONS`, `CHALLENGES`** (the show's app, not secrets; each on unless it is `0`): the two other kinds of
  house scene (`lib/house-conflict.ts`). A confrontation is staged when the story state holds a tension hot enough
  between two in the house (two a week at most); the challenge is held on Wednesdays, and its winner gets the next
  one-on-one. Each result is decided by seeded rules, never a vote, and no date's ending changes. About 0.06 and 0.09
  cents a scene at paid list prices. `0` stops new ones without a deploy (a prize already won is still honoured);
  `HOUSE_SCENES=0` stops both. Commented in `.do/show.yaml`; the rules are in [seasons.md](seasons.md),
  "Confrontations and challenges".
- **`CHARACTER_TALK`** (the show's app, not a secret; on unless it is `0`): the character page's Talk of the house
  tab (`lib/character-talk.ts`): what the house said about them, their friction and who is after them, from public
  sources only, with the ratings in the page's header. `0` puts the Audience tab back without a deploy. No model call.
  Commented in `.do/show.yaml`; the rules are in [character-depth.md](character-depth.md), section 13.
- **`CHARACTER_FOLLOW`** (the show's app, not a secret; on unless it is `0`): follow a character
  (`lib/character-follows.ts`): the Follow toggle in a character page's header, the notices its followers get when a
  date of theirs airs or the house talks about them, and the character's texts switched on for a follower who may
  text it. Rows and templates: no model call. `0` hides the control, refuses the route and sends no follower a notice,
  without a deploy; the follows stay, and texts a follow switched on stay on the thread's own switch. Commented in `.do/show.yaml`; the rules are in
  [character-depth.md](character-depth.md), section 14.
- **`CHARACTER_NOW`** (the show's app, not a secret; on unless it is `0`): the "Right now" lines under a character
  page's header (`lib/character-now.ts`), shaped from what the page already reads for everyone. `0` hides them without
  a deploy. No read of its own, no model call. Commented in `.do/show.yaml`; section 14 as well.
- **`WRITING_STYLES`** (both apps, not a secret; [writing-styles.md](writing-styles.md)): who the Narrated style and
  new stories are open to. Unset or `members`: the plan's members and admins on the
  show (After Dark's side opens by its own "narrated" rollout switch). `admins`: admins only. `0`: off for everyone on
  both sides; stories already made still read.
- **Step in, After Dark** has no environment switch: it opens by After Dark's **"companion"** rollout switch
  (`lib/adult/rollout.ts`, Settings → Rollout), `admins` until flipped to `everyone`
  ([after-dark.md](after-dark.md), "Step in"). Tell the card processors before flipping it.
- **`COMPANION_STORY_MODE`** (the show's app, not a secret; on unless it is `0`; [companions.md](companions.md), "Story
  mode"): a companion's scene reply written as prose in one call, for someone on the Narrated style. `0`: every scene
  reply is the script line again, for everyone, without a deploy of code. Who has Narrated at all is `WRITING_STYLES`.
  Commented in `.do/show.yaml`.
- **`SCENE_PERSONA`** (the show's app, not a secret; on unless it is `0`; [companions.md](companions.md), "Who you are
  in scenes"): a person's saved persona for scenes (`lib/persona.ts`). `0`: no scene's prompt reads one (companion
  scenes, step-in dates), the card on `/account` and the scene picker's line go, and `POST /api/persona` answers not
  found. What's stored stays, in the export and deletable. Commented in `.do/show.yaml`.
- **`STEP_IN_OPEN`, `STEP_IN_GUESTS`, `STEP_IN_GUEST_DAILY_MAX`** (the show's app, not secrets): step into the date is
  open to everyone since 2026-11-15, guests included. `STEP_IN_OPEN=0` puts it back to admins only; `STEP_IN_GUESTS=0`
  asks a visitor without an account to sign in first; `STEP_IN_GUEST_DAILY_MAX` (default `300`) is the guest dates a day
  across the show, the bound on what guests can cost (about $2 a day at the default). Commented in `.do/show.yaml`; the
  caps and the cost are in [step-into-the-date.md](step-into-the-date.md), "What stops a flood".
- **`MODEL_LEAGUE`** (the show's app, not a secret; default on): the model league, `/agents/league` and
  `/api/league/models` (`lib/model-league.ts`; [agents-and-people.md](agents-and-people.md)). `0` takes the page, its
  JSON, its sitemap entry and the links to it (`/agents`, `llms.txt`) away without a deploy; agents' `model` is still
  kept and dates are still stamped, so turning it back on loses nothing. Commented in `.do/show.yaml`.
- **`MCP_HOUSE`** (the show's app, not a secret; default on): the four house tools on the MCP server,
  `get_house_scene`, `get_house_talk`, `get_story_so_far` and `my_story_state` (`lib/mcp/house.ts`;
  [agents-and-people.md](agents-and-people.md)). `0` takes them out of every tool list, refuses a call
  (`code: "not_available"`), and drops `get_episode`'s `house_talk` pointer, their `/llms.txt` paragraph and their rows
  on `/agents/tools`. They only read, so turning it back on loses nothing. Commented in `.do/show.yaml`.
- **`HOME_HERO_CLIP`**, **`HOME_EXPRESS_BOX`** (the show's app, not secrets; both on unless `0`): the day's clip in a
  stranger's home hero (`lib/home-clip.ts`; `0`: the hero as it was, and `POST /api/admin/home-clip` answers 404) and the
  one-sentence box under the hero's headline (`0`: "Make your character" is the main button again; it is also off
  whenever `EXPRESS_CREATE` is). [flows.md](flows.md), "The home page, for a stranger".
- **`COLD_OPEN`** (the show's app, not a secret; on unless `0`): the card before a date's first line in the theater
  (`lib/cold-open.ts`; `0`: the theater starts playing as it opens, as before). The short version beside it needs no
  switch: a date shows it only once a cut was uploaded. [flows.md](flows.md), "A date's first minute".
- **`DATE_PHOTO_TEXTS`**, **`COMPANION_DATE_OPENER`**, **`HOME_PHONE`** (the show's app, not secrets; all on by
  default, `0` turns one off without a deploy of code): a photo from the date in the character's texts
  (`lib/date-photo.ts`; off: texts go without one, the photos already sent stay), a cast character's opener written from
  its last aired date (`lib/cast-opener.ts`; off: the model writes the hello and the cast's prompt has no last-date
  block), and the owner's home opening on their character's phone (`lib/character-phone.ts`; off: the home page as it
  was). The rules are in [companions.md](companions.md) and [flows.md](flows.md).
- **`DATE_PHOTO_IN_CHAIN`**, **`CHARACTER_GIFTS`** (the show's app, not secrets; both on by default, `0` turns one
  off without a deploy of code): what two characters send each other besides texts. `DATE_PHOTO_IN_CHAIN`: each date's
  photo in the couple's thread, the real one an owner made or the show's snapshot (`lib/text-chain.ts`,
  `lib/date-photo.ts`; off: the thread and the couple page's phone are as they were, and making a date photo writes a
  📷 text again). `CHARACTER_GIFTS`: small gifts between characters after some aired public dates
  (`lib/character-gifts.ts`; off: none is written, shown, told to an owner or handed to the house scene; the rows
  stay). **`CHARACTER_GIFTS_RATE`** (a number, 1 when unset) multiplies how often a gift comes: 0.5 halves the chances,
  2 doubles them; it never makes one where the rules say never, and the one-a-week cap still holds. Neither calls a
  model. The rules are in [relationship-graph.md](relationship-graph.md), "What they send each
  other". Commented in `.do/show.yaml`.
- **`SEASON_KEYS`** and **`CHARACTER_CREDITS`** (the show's app, not secrets; both on unless
  `0`): the connected model ([data-model.md](data-model.md)). `SEASON_KEYS=0` stops stamping a date's season when it
  airs and stops the hourly backfill (the season registry is still kept; the columns stay null and nothing that reads
  them lacks a fallback). `CHARACTER_CREDITS=0` hides a character's credits everywhere they show (the character page,
  Gallery cards, a creator's page, MCP `get_character`). No model call, no cost. `GET /api/admin/model-health` says
  how many aired dates carry their season. (`GALLERY_SHOW_CLIPS`, the Gallery's "From the show" row, went with the row
  on 2026-11-18; a leftover value on the app does nothing.)
- **`SHOW_IDEAS`** and **`SHOW_IDEAS_PROPOSE`** (the show's app, not secrets; both on by default): `/shows`, the list of
  shows Botchelor might make next, with its answers, proposals and three MCP tools ([show-ideas.md](show-ideas.md)).
  `SHOW_IDEAS=0` closes the page, its routes and the tools; `SHOW_IDEAS_PROPOSE=0` keeps the page and its votes and
  stops new proposals. No model call, no cost.
- **`SOCIAL_TIES`** and **`SOCIAL_DECLARE`** (the show's app, not secrets; both on unless `0`): the social network's
  ties, off-screen people and places ([PRDs/social-network.md](PRDs/social-network.md), `lib/social/`).
  `SOCIAL_TIES=0` stops every social write and read: nothing is declared, derived from what aired or backfilled, the
  shared world isn't seeded, and the social routes and pages close; rows already written stay. `SOCIAL_DECLARE=0`
  keeps what aired derives and stops owners' and agents' declarations and proposals. No model call, no cost.
- **`SOCIAL_METRICS`** (the show's app, not a secret; on unless `0`, and off whenever `SOCIAL_TIES` is): the social
  network's daily numbers (`lib/social/metrics-job.ts`, PRD §5.5 and §10). A step of the daily job's `growth` part
  measures the public ties between public characters, within 45 seconds, and writes `social_metrics` and
  `social_network_daily`; the hourly job finishes a day it left short. `/admin/social` reads them. Off: no new day is
  measured, the days already written stay and the admin page says so. No model call, no cost.
- **`SOCIAL_DYNAMICS`** (the show's app, not a secret; on unless `0`, and off whenever `SOCIAL_TIES` is): the living
  network (`lib/social/dynamics.ts`, PRD §7). A step of the daily job's `growth` part, before the metrics, lifts a tie's
  closeness with each aired contact and decays it by its kind's half-life; a friendship that fades below 0.15 ends
  (`decayed`) and the pair become old friends. One in four of the lobby's fallback deals sets up two of the cast who
  share a friend (`met_via: "introduced"`, `lib/social/introductions.ts`), and an unbalanced public triangle is a
  producer tension (`unbalanced_triangle`). Off: closeness stays where it is, no introductions, no triangle tension.
  No model call, no cost.
- **`SOCIAL_PEOPLE_IN_PROMPTS`** (the show's app, not a secret; on unless `0`, and off whenever `SOCIAL_TIES` is): the
  people in a character's life in its own date prompt (`lib/social/people-lines.ts`, PRD §7 "Dialogue"). Each actor
  reads one or two lines: someone both of them know first, else one of its own off-screen people, from what its own
  owner may see (public, plus the owner's own; never another owner's owner-only or private rows). The engine never
  reads it. Off: the prompts are as before. No model call, no cost.
- **`HOUSE_ROOM_TEXTS`** (the show's app, not a secret; on by default, `0` turns it off without a deploy of code): a
  house room on Watch writes morning-after texts like a booked date does (`lib/watch.ts`, `lib/afterglow.ts`; a few
  short model calls a room, about a cent on the paid model), and a house couple's page shows each aired date's texts to
  anyone (`lib/text-chain-shared.ts` `publicHouseThread`). Off: rooms write none and the couple page shows photos and
  gifts only; texts already written stay stored. A date made before the switch has none until
  `POST /api/admin/afterglow {"episode_id"}` writes them. [relationship-graph.md](relationship-graph.md), "Who sees it".
- **`COMPANION_MESSAGE_DELETE`** (the show's app, not a secret; on by default, `0` turns it off without a deploy of
  code): deleting one message of a companion conversation (`lib/companion-message-delete.ts`). Off: "Delete messages…"
  leaves the thread's Settings menu, `/companion/<id>/messages` and `DELETE /api/companion/:id/messages/:messageId`
  answer not-found, and the privacy notice and the FAQ say only the whole conversation can be deleted (they read the
  same switch). Deleting the conversation is unaffected. [companions.md](companions.md), "Deleting one message, and the
  export". Commented in `.do/show.yaml`.
- **`AD_BRIDGE`** (the show's app, not a secret; default on): the After Dark bridge, one line on the creator's verdict
  card when their character's date ended in a second date, linking the invite request with `source=verdict`
  (`lib/adult/bridge.ts`; [after-dark.md](after-dark.md), "The bridge from the show's verdict card"). `0` takes the
  line away without a deploy. It never touches After Dark's own `public_door` switch, and the invite page still takes
  `?source=` either way. Commented in `.do/show.yaml`.
- **`PAST_PG_DOOR`** (the show's app, not a secret; default on): the past-PG door on `/create`, a refusal for going
  past PG offering "Keep them PG" or After Dark with `source=past_pg` (`lib/adult/past-pg.ts`; [after-dark.md](after-dark.md),
  "The past-PG door on /create"). `0` takes it away without a deploy; the refusal is then the plain sentence again.
- **`OVERNIGHT_DATES`** (both apps, not a secret; default on): overnight dates
  ([relationship-graph.md](relationship-graph.md), "Overnight dates"). `0` turns them off without a deploy: no offer in a
  character's texts or on a couple's page, no house booking, no closing card, and nothing recorded or texted when one
  airs. **`OVERNIGHT_AFTER_DARK`** (both apps; default on): "Continue the night in After Dark" on an overnight date, for
  a viewer After Dark already admits who owns one of the two ([after-dark.md](after-dark.md), "The night continues"). `0`
  removes the button on the show and its page and route on After Dark's host; set it on both. Neither touches
  `public_door`. Commented in `.do/show.yaml` and `.do/app.yaml`.
- **`LOCKED_PICTURE_TEXTS`** (the show's app, not a secret; default on): a character's text about a picture it kept
  from a night, with a locked, blurred tile that opens in After Dark for an entitled adult and leads everyone else to
  the way in (`lib/locked-picture.ts`; [companions.md](companions.md), "A picture they kept, locked";
  [after-dark.md](after-dark.md), "A picture they kept, locked in the show's texts"). `0` sends nothing, shows the ones
  already in a thread as plain texts, and 404s the tile, without a deploy. The show's side holds PG pixels only (the
  character's own PG portrait, blurred), and nothing here touches `public_door`. Commented in `.do/show.yaml`.
- **`CHAT_DATE_LINKS`** (the show's app, not a secret; default on): the two reads of the date a text is about
  (`companion_messages.episode_id`; [companions.md](companions.md), "A text knows its date"): the "About your date with
  …" link under such a text in a thread, and "… texted you about this" on the date's page for the owner of a side. `0`
  hides both without a deploy of code; the column is still written and backfilled. Commented in `.do/show.yaml`.
- **`EVENT_KEYS`**, **`CREATOR_JOURNEY`** (the show's app, not secrets; both on unless `0`; [analytics.md](analytics.md)):
  the character and the date an engagement event is about, kept in `web_events.character_id` / `episode_id`
  ("Which character, which date"; `0`: the columns stay empty), and the creator journey with the Studio split of
  "Came back for their character" in the admin's Real use (`0`: both are left out of the page and not read). Neither
  is visible to a visitor. Commented in `.do/show.yaml`.
- **The packs' Payment Links** (the show's app; the links aren't secret, the webhook secret is). One link sells one
  thing in Stripe, so each pack has its own ([pricing-and-byok.md](pricing-and-byok.md)):

  | Env | What | Default |
  |---|---|---|
  | `STRIPE_PAYMENT_LINK` (or `STRIPE_LINK_PACK_5`) | pack_5's link, "5 more dates" for $4 | unset: the shop says "purchases open soon" |
  | `STRIPE_PRICE_LABEL` (or `STRIPE_PRICE_LABEL_PACK_5`) | pack_5's Buy button text | "Buy 5 more dates for $4" |
  | `STRIPE_LINK_PACK_15` | pack_15's link, "15 more dates" for $10 (make it in Stripe: a $10 one-time Payment Link). Once set it is the pack the shop leads with: first, with the page's one loud button | unset: the tile isn't shown and checkout answers 503 for it |
  | `STRIPE_PRICE_LABEL_PACK_15` | pack_15's Buy button text | "Buy 15 more dates for $10" |
  | `STRIPE_WEBHOOK_SECRET` | the one webhook endpoint both links' sessions report to | required for any grant |

  The webhook grants a pack only when the session's amount covers the pack's list price and its link isn't one already
  known to sell another pack (`lib/payments.ts grantOrder`), so a mixed-up env can't hand out the bigger pack for the
  smaller price.
- **`OPERATOR_PASS_SALE=1`** (the show's app; unset since 2026-11-21) offers the agents' operator pass again: its card
  and stat chip on `/agents/pricing`, its line in `/llms.txt`, and its mention in a capped agent's refusal. It needs
  `OPERATOR_PASS_LINK` beside it. Unset, the link still works for whoever has it and a pass already held keeps its
  reserved dates; nothing on the site points at it (`lib/operator-pass.ts operatorPassOffered`).
- **Logs:** each app's Runtime Logs in the dashboard (Apps → the app → Runtime Logs). Everything that used to go to
  Vercel's runtime logs (`episode_generated` with `cost_usd`, the `"log":"analytics"` lines) goes there now.

## DNS: Cloudflare (from 2026-10-30)

Wix is only the registrar now. DNS moved off Wix to DigitalOcean's DNS on 2026-10-30, then to **Cloudflare** the same
day (free plan; nameservers `kolton.ns.cloudflare.com` and `nucum.ns.cloudflare.com`). Records are edited in
Cloudflare's dashboard: botchelor.com → DNS → Records. botchelor.com itself moved from Vercel to the show app at about
18:58 UTC on 2026-10-30.

**Adding a proxied name (the lesson of 2026-10-30).** DigitalOcean only accepts a custom domain once it sees a CNAME
pointing at the app, and the orange cloud hides that CNAME. So add the record as **DNS only** first, add the domain to
the app (Settings → Domains, "you manage your domain"), wait until it answers on its own (can take up to an hour; the
dashboard's status lags), and only then switch it to Proxied. A name switched to Proxied before DigitalOcean has it gets
Cloudflare's 526 for every visitor, which is what botchelor.com did for ~5 minutes that evening.

| Host | Proxy | Points to |
|---|---|---|
| `@` | **Proxied** (orange cloud) | CNAME (flattened) → `botchelor-show-t9g76.ondigitalocean.app` |
| `www` | DNS only | the show app's `ondigitalocean.app` address |
| `ad` | DNS only | After Dark's app's (`clownfish-app`) `ondigitalocean.app` address |
| `media` | DNS only | `botchelor-ad-media.b-cdn.net` |
| `staging` | DNS only | the show app's `ondigitalocean.app` address (reaches the show without www's redirect) |

Resend's records (`send`, `rsend`, `resend._domainkey`, `_dmarc`) and Glama's TXT record (`_glama-claim.www`) stay as
they are. Cloudflare's "Add visitor location headers" managed transform is on (Rules → Settings) and the show app has
`GEO_HEADERS=cloudflare` ("Where a visitor is", above).

At DigitalOcean the show app lists `botchelor.com` (primary), `www.botchelor.com` and `staging.botchelor.com`, all as
"you manage your domain" (no zone): DigitalOcean's own DNS zone for botchelor.com is no longer used. The `edge` test name
was removed from the app on 2026-10-31.

## botchelor.vercel.app

Gone: David deleted the Vercel project on 2026-10-31, and the old address answers 404 (`DEPLOYMENT_NOT_FOUND`, checked
2026-11-04). Agents still set up with `botchelor.vercel.app/api/mcp` have to move to botchelor.com.

Stripe's webhooks never used it: every live endpoint points at botchelor.com (`/api/webhooks/stripe` for packs,
`/api/webhooks/stripe-operator` for the operator pass, `/api/webhooks/stripe-plans` for the Companion Plan), so they
reach the show app. None pins an API version, so each gets the account's default (2026-09-30.endive on 2026-11-04);
`lib/stripe.ts` reads the fields that moved in 2025-03-31 from both places.

## Going back to Vercel

Re-upgrade the Vercel team to Pro, restore `vercel.json`'s crons from git history, point `@` and `www` back at Vercel's
records in Cloudflare (`216.150.1.1`, `216.150.16.1`, `www` → `3213a098f8021dad.vercel-dns-017.com`, DNS only), and
remove the scheduled job from `.do/app.yaml`. The code runs on either: on Vercel, `VERCEL_ENV` and Vercel's headers
take over again.
