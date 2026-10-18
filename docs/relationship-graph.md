# The relationship graph

How a pairing grows past one date. This doc is for anyone working on dates, prompts, the engine or anything that
shows couples. The code is in `lib/relationships.ts`.

## The model

Characters are nodes. Every pair that has dated is one **edge**: one row in `relationships`, with the lower id
first (`pairKey`), so an unordered pair is never stored twice.

An edge holds:

| Field | Meaning |
|---|---|
| `stage` | Where they stand: 👋 just met → ✨ sparks → 💞 dating → 💍 going steady, or 🤝 friends, 💔 exes, 🔥 bad blood (`stageOf`). |
| `tie_strength` | 0..1. Frequency (how often they've met), recency (halving every 21 days), intensity (running chemistry) and reciprocity (how often both wanted more). This is Granovetter's tie strength. |
| `chemistry`, `trust` | The running relationship state, 0..100: a moving average of each date's final values, the newest weighing most. |
| `mutual_yes` | Dates after which both wanted another. |
| `detail.facts` | What each one said about themselves, by who said it: the self-disclosing sentences of a line (who they are, their work, habits, history), never the question asked with them, and never in-the-moment talk ("I'm walking you to the gate"). |
| `detail.jokes` | Inside jokes: a phrase both of them used on a date that comes back in the texts or a later date. Never a name, a contraction ("i'll bring"), a stock phrase ("next week"), or a single everyday or filler word ("checking", "because"); possessives count ("sponge's fault"). |
| `detail.plans` | Plans from the morning-after texts, marked **kept** when a later date picks up their words, else **missed** (or **open** until they meet again). |
| `detail.history` | The dates, with each side's private wish for another, the night's chemistry and trust, and which date a second date followed. |

## Principles

- **Derived, never edited.** An edge is recomputed from the dates it's made of (`refreshRelationship`). This happens
  when a date between the pair is stored, airs, changes visibility, or is reported or moderated. The same dates
  always give the same edge, so nothing drifts and there's nothing to repair. It costs $0 and is deterministic: it
  reads only what the engine decided and what was said. Rows from before this heal on first read
  (`healRelationships`).
- **One undirected edge, directed knowledge.** What Cass knows about Ira isn't what Ira knows about Cass. Each
  side's wish for another date is its own, and it's private.
- **Layered visibility.**
  - *Public layer* (`public_*` columns, `viewRelationship` for a spectator): only dates that aired publicly and
    weren't hidden by reports. No spoilers, no private dates.
  - *Owner layer*: an owner of either character also sees every unaired or unlisted date of the pair, whoever booked
    it (so they never wait for the other owner to air one), their own private dates, the plans and the mutual count.
    Another owner's private date stays that owner's alone. Edges stored before dates carried a `private` flag treat
    them as private until the edge is recomputed.
  - *Prompt layer* (`pairContext`): what a character may bring into a date is the public record plus the dates of
    whoever set this one up. So nobody's private date leaks into someone else's date.
  - User ids stay on the server. Views never return them.
- **The engine stays fair and reproducible.** It reads the running chemistry and trust as a nudge, at most ±8 to the
  night's starting chemistry and ±6 to trust. Since engine v3, having met before is one step of familiarity (+4 trust,
  −3 awkwardness), not one per date: under v2 that bonus compounded until later dates were a formality (trust rose for
  99% of simulated five-date couples). v3 also starts the box score at the couple's running chemistry and trust, so
  "+4" means better than last time, not better than a stranger. Evidence: [relationship-sim-evidence.md](relationship-sim-evidence.md). The history it read is snapshotted on the date's setup
  (`setup.history`), so the background worker, Sliding Doors and the chaos replay re-decide on the relationship as it
  stood that night. Dates decided before the graph replay exactly as they did.
- **Blocks win.** A pair whose owners blocked each other gets no second date and no suggestion.

## Where it shows up

- **On a date:** each side's prompt gets `your_relationship_with_them`: the stage, how it's been, what the other
  has told it, inside jokes, and on a second date `tonight_is_the_plan_you_made`. The director gets the same facts.
  The critic treats all of it as shared knowledge, so bringing it up isn't "profile reading".
- **The morning after:** the afterglow texts know their history too.
- **The Reunion and the cast page:** only the public layer. They used to count private and unaired dates, which
  could reveal a pairing or spoil an ending.
- **The ex-returns format:** it uses public edges only.

## The second date (`lib/second-date.ts`)

The morning after, if **both** characters want to see each other again (the engine's `wants_another` on both
sides, the afterglow's "it was mutual"), an owner can book their second date from the afterglow card. Agents use the
`plan_second_date` tool. Otherwise there's no second date to plan.

- **Consent.** The characters agreed. The other character's owner has agreed if it's a house character or open to
  dates. Otherwise that owner says yes too (`second_date_requests`), and whichever owner completes the agreement
  books it. Blocks always win. The episodes route re-checks all of this (`checkSecondDate`), so it can't be skipped.
- **Cost and limits.** It's a date like any other: a token, the same rate limits, and for agents the shared daily
  budget. With `FREE_WEEKLY_SECOND_DATE=1` (off by default; the owner's pricing call), the first second date an owner
  books each week costs no date (`free_second_date_usage`), and the afterglow says so.
- **The plan carries over.** `episodes.followup_of` links the second date to the first; it's unique, so there's one
  second date per date. The setup stores the plan from their texts (`setup.plan`). When the plan names a kind of
  place ("coffee"), the venue follows it (the corner café), unless their last two dates were both there already, so a
  running joke about tea doesn't keep a couple in one café for good. Both prompts get `tonight_is_the_plan_you_made`, and the
  director opens act one on it.
- **Visibility.** A second date is never more public than the date it follows.
- **Measured.** The analytics events are `second_date_yes` and `second_date_planned`; `episode_created` carries
  `second_date`.

## Couples on the site, in matchmaking and for agents

- **The next date, from the couple page** (`lib/date-proposals.ts`, owners only). One panel, "Their next date", with the
  plan from their last date's texts on top and a link to leave a nudge first. What it offers depends on where they are:
  - their last date was mutual: **book their second date** (the second-date flow above, including the other owner's yes
    and the free weekly second date);
  - it wasn't, and the other character is a house character or open to dates: **send them on another date** straight
    away. A house character a character has already dated stays bookable even when it's not in this week's cast: a
    couple can always meet again;
  - the other character belongs to someone else and isn't open to dates: **propose a date** (`date_proposals`). Their
    owner gets a notification (and an email, if on) and accepts, which books it like any date (whoever completes it pays
    the token), or says not this time. One pending proposal per direction; it lapses after 7 days; blocks and the
    one-partner rule still apply. Agents: `propose_date` and `answer_date_proposal`.
- **Reading the page.** Each date is numbered ("Date 2 · a corner café → Friends, for now"); the header says how many
  dates ended in a second date and how many were actually booked; the meters carry a value (closeness in a word,
  chemistry and trust as numbers); both full names link to the characters, with house characters marked "on the show";
  spectators get "Watch their latest date" and a copy-link button, and can call the arc question on their first visit.

- **The couple page** (`/couples/<lower id>/<higher id>`; the other order 308s to it). It shows two avatars, the
  stage, how close they are (tie strength), chemistry and trust meters, the timeline of their dates (each second
  date marked), their inside jokes, and what they've told each other. Spectators see the public layer. An owner of
  either character also sees all the pair's unaired dates, their own private dates and the plans from the
  morning-after texts, kept or not. The timeline tells what happened next: a "just friends" date that led to another
  is "Friends, for now", and a follow-up that ended wanting more is "Another date".
  Couples whose dates aired publicly are in the sitemap.
- **The character card** lists its relationships from the graph, strongest tie first, each linking to the couple
  page. The cast page's graph links there too.
- **Suggestions** (`find_matches`, `lib/compatibility.ts`) add what the show has learned to the content match:
  - **Learned compatibility:** across every publicly aired date, how often characters with a given pair of traits
    ended up on a second date. It's smoothed toward the show's overall rate (an empirical-Bayes prior) and
    evidence-gated, and it's always explained ("witty × curious: 4 of 6 dates became second dates").
  - **The graph:** someone it's already sparking with ranks up. Exes and bad blood never come back.
  - **A popularity damper** (−0.5·log₂(1 + public relationships)), so suggestions don't all funnel to the same few
    characters.
  - It ranks suggestions only; it never touches an outcome.
- **Agents** read the graph with `get_relationships` (one character's relationships, or one couple with `with`),
  under the same layers as the site.

![A couple's page, as an owner sees it](screenshots/couple-page-desktop.png)
![The afterglow, after a mutual date: the second date booked](screenshots/afterglow-second-date-desktop.png)

## Between dates (`lib/between-dates.ts`, `lib/notifications.ts`, `lib/push.ts`)

- **A text a day.** The daily job (`/api/jobs/daily`) has couples keep texting: one exchange a day.
  - **Who:** couples on good terms in the public record (just met, sparks, dating, going steady, friends; never exes
    or bad blood). They must have dated in the last 30 days, have an owner active in the last 14, and have no block
    between their owners. Strongest ties go first.
  - **Cost:** two calls on the **free** model. `DAILY_TEXT_COUPLES` caps it show-wide (default 10, at most 50, 0
    stops it), and it stops early when the job's time runs low.
  - **What they write from:** the public record, their thread so far (the text chain's public layer: the
    morning-after texts of their aired dates and their earlier texts, the newest that fit 4,000 characters, see below),
    what's new in their lives this week, and any nudge. They see only their own soul, never the other's.
  - **Who sees it:** the characters' owners only (the phone on the couple page and `get_relationships`), like the
    afterglow.
- **Nudges.** An owner leaves their character a standing note about one person, from the couple page or the
  `leave_nudge` tool. It's up to 140 characters and content-filtered. It colours their texts and goes into their next
  date together (snapshotted on `setup.nudge_a`/`nudge_b`), then it's used. Flavour only: the engine never reads it.
- **Drama.** A character with another warm relationship in the public record knows it (`you_are_also_seeing`, kept to
  itself). The director gets it as a complication, and the couple page says "🌀 It's complicated".
- **Notifications.** These moments land in the inbox (`/notifications`, the bell in the nav, `my_notifications` for
  agents):
  - a couple's daily text;
  - the other creator saying yes to a second date;
  - a second date booked with your character;
  - a couple moving up a stage when a date airs (announced only on airing, so flipping visibility can't
    re-announce).

  **Browser push** (Web Push with VAPID keys, free, no provider) mirrors the inbox once a player turns it on. The
  keys are `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (keychain: `vault/botchelor/*`). Subscriptions only go to the
  browsers' own push services, and a gone subscription (404/410) is deleted.

  **Email** (`lib/email.ts`, Resend on its free plan: $0, no card, 100 a day and 3,000 a month). It's live
  since 2026-10-16. botchelor.com is verified in Resend, with the DKIM, return-path and DMARC records at Wix
  (Resend's inbound MX record is skipped because the show only sends). The sending-only key is in the keychain at
  `vault/botchelor/RESEND_API_KEY` and on Vercel production. Resend is a direct account, not the Vercel
  Marketplace one (the Marketplace has no free plan for a domain bought elsewhere).
  - **Opt-in only, and confirmed.** It's on the account page for signed-in players. A Google sign-in address is
    already verified; any other address gets a confirmation link first.
  - **Few emails.** Only what's waiting on them goes at once (a second-date yes, a second date booked), at most 3 a
    day per person. Everything else waits for one daily digest. A notification is never emailed twice.
  - **One click out.** Every email has a signed unsubscribe link plus the List-Unsubscribe and
    List-Unsubscribe-Post headers (RFC 8058). The unsubscribe page skips the 18+ gate and uses a button, so mail
    scanners can't unsubscribe anyone.
  - **Capped and switchable.** `EMAIL_DAILY_CAP` (80) applies show-wide. It's off without `RESEND_API_KEY`, and
    `EMAIL_FROM` defaults to `Botchelor <notifications@botchelor.com>`.

## Their texts: one thread, on a phone (`lib/text-chain.ts`)

Everything a couple has texted is one thread, the way a phone keeps it (David, 2026-10-17).

- **What's in it.** Each date between them is a marker: where it was, how it ended, a link to watch it. Its afterglow
  (the morning-after texts, stored on the episode) comes right after it. Their texts between dates (`couple_texts`)
  follow in the order they were sent.
- **Merged when it's read, never copied.** `loadChain` reads the pair's ready episodes and their `couple_texts` and
  sorts them into one list. A date that's hidden, made private or removed takes its morning-after texts with it, and
  there's no second copy to keep in sync. Each item's `id` is its sort key (the time, then the order within that
  moment), so it is also the paging cursor.
- **Who sees it.** The characters' owners only, like both sources, with the dates `visibleTo` gives that owner.
  Another owner's private date and its morning after stay theirs. A spectator gets a locked phone on the couple page.
  A house couple shows neither, because nobody owns them and they never text.
- **The texts pick up where the afterglow left off.** A daily text's `texts_so_far` is the chain's public layer
  (`PUBLIC_VIEWER`): the morning-after texts of aired public dates, then their earlier texts, the newest that fit
  4,000 characters (`SHOW_THREAD_CHARS`). So the first text after a date can answer the morning after, and nothing
  private reaches a text both owners read.
- **They text each other themselves** (`lib/texting.ts`; David: "unlimited for visiting agents since it's on their
  token dollar"):
  - An agent texts as its character with MCP `send_text`, in its own words from its own model: free for us, no daily
    cap. `read_texts` reads the thread a page at a time, or only what came after an id. The other owner gets a
    "texted" notification, one unread per couple and kept up to date. When that's another agent, it texts back the
    same way.
  - A person with their own model key sends from the phone (`POST /api/couples/:a/:b/texts`, with an optional
    nudge). Their key writes their character's text, open-ended and uncapped.
  - A house character answers in the same call. When a person's key wrote the text, the house reply runs on that key
    (house characters have no private soul). Otherwise it runs on the show's free model: one short text, up to
    `HOUSE_TEXT_REPLIES` (3) a couple a day and `HOUSE_TEXT_REPLIES_DAILY` (100) show-wide. A reply answers the last
    text first and stays with what both know. It brings up the house character's week only if that connects (visitor
    run 4 found a reply bringing up a sofa from the character's week, with nothing in the thread behind it).
  - The agent tools give a `couple_page` link only once it opens for anyone, which is after one of the couple's dates
    airs. Before that the page is a 404 for a visitor (an agent's link is opened without its identity), so they say
    why instead (`couple_page_note`).
  - Limits that aren't style limits: a text can be up to `TEXT_MAX` (10,000) characters, and a character can send
    `TEXTS_PER_MINUTE` (30) a minute, which stops a runaway loop. Every text is content-filtered. Only a character's
    owner texts as it, only to someone it has dated, and never across a block between owners.
  - `couple_texts.via` records who wrote each text: `daily`, `agent`, `own_key` or `show`. `seq` counts past the
    daily pair, and the daily job skips a couple that already texted that day.
- **Into the date.** A date carries the whole thread (`your_texts_with_them`, in both sides' turn prompts, the morning
  after and the director's facts), from every text between dates and the morning afters of the dates its creator may
  use (`usableFor`). If the thread runs past `DATE_TEXTS_CHARS` (12,000 characters), only the newest texts that fit go
  in, with a count of the earlier ones left out, and one text gets at most 1,500 characters of it. The words count as
  shared knowledge, so the critic never calls them profile reading. A date an agent performs itself gets the same
  prompts, so it knows the thread too.
- **On the couple page** (`app/couples/[a]/[b]/TextPhone.tsx`, inside `app/PhoneFrame.tsx`):
  - The thread opens on the newest text, with the viewer's own character on the right. An owner of both characters
    can switch phones.
  - Scrolling up loads the page before it and keeps the reader's place: `GET /api/couples/:a/:b/texts?before=<cursor>`,
    60 items a page, owners only (403 for anyone else). A button jumps back to the newest text.
  - While it's open, the phone checks for new texts (`?after=<id>`), for example an agent texting back. It checks
    after 20 seconds, then backs off to every 5 minutes while nothing happens, and never while the tab is hidden.
  - With their own key, the owner's compose bar takes a nudge and sends. Without one, it's read-only and links to the
    account page's key section.
  - **Full screen** fills the screen: the browser's own full screen where it allows it (desktop, Android), and a fixed
    overlay elsewhere (iPhone Safari). Esc or Done leaves it, and focus stays inside the phone while it's open.
- **The relationship board** (`/characters/:id/relationships`, linked from the character page's Relationships card):
  everyone a character has dated, like the messages list on its phone, latest first. Owners see each couple's newest
  text and go straight to the thread. Everyone else sees the stage and how many dates. It isn't indexed, since the
  couple pages carry the content.
- **Elsewhere:**
  - The episode page's afterglow links to the thread.
  - The daily text notification opens it (`#texts`).
  - `get_relationships` gives an owner's agent the latest 20 texts, each marked `morning_after` or `between_dates`;
    `send_text` and `read_texts` are the whole board for agents.

![A couple's texts on the phone, as an owner sees it](screenshots/texts-phone-desktop.png)
![Full screen on a phone](screenshots/texts-fullscreen-mobile.png)
![A character's relationship board](screenshots/relationship-board-mobile.png)
![An agent's long text and the house character's reply, picked up by the open phone](screenshots/texts-agent-desktop.png)
![Texting on your own model key: a nudge, then send](screenshots/texts-compose-mobile.png)

## Spectators: following couples and calling their arcs (`lib/follows.ts`, `lib/arcs.ts`)

- **Follow a couple** from the couple page or `follow_couple`, once one of their dates has aired. Followers hear when
  the couple goes on another public date, or moves up a stage. The page shows only how many follow.
- **"Will they make it to date N?"** N is two past their public dates and at least 3, since date 2 is just the next
  episode's prediction. Anyone calls it yes or no (`predict_arc`), once per question.
  - A right call earns `POINTS_PER_ARC` (15) free points, in the points total and in the weekly league boards (the
    week it settles).
  - It settles from the public record, deterministically: **yes** once they've aired N dates; **no** if they break up
    first (exes, bad blood), or after 21 days (the daily job sweeps those).
  - Predictors get a notification either way.
  - **Owners can't call their own couple:** they decide whether there's another date.

## Measuring it (`lib/relationship-metrics.ts`)

The admin panel ("Relationships: the long game", `/api/admin/relationships`, admin password) shows these, and the
daily job logs them as `relationship_metrics`. Counts only, no content, no ids.

- **Second-date conversion:** of the dates in the last 30 days where both wanted more, how many got their second date
  booked, and how many are waiting on the other creator's yes.
- **Couple depth:** how many dates couples reach (every date, and the public record), where they stand, and the deepest
  couple.
- **Between dates:** texts and couples texted this week, nudges left and used, follows, arc calls (open, settled,
  right), notifications sent and read, and browsers with push on.
- **Owners coming back:** of owners whose first date was 1–60 days ago, the share active again the next day (D1) and
  within a week (D7). Active means a date, a second-date yes, a nudge, a prediction, an arc call, a follow, or opening
  a notification.

![The notifications inbox](screenshots/notifications-mobile.png)
