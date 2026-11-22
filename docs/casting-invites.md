# Creator invites for casting

2026-11-15. Fifteen days before December's The Botchelor (lead Nell, five suitors' places, people's characters first),
/casting had one applicant. The cause was friction: an audition asks for three public dates first
(`AUDITION_MIN_DATES`, lib/audition-words.ts), and a creator the owner invites by hand should not be told to come back
after three dates. A creator invite is a code that lifts exactly that, for one character. The rules are
[`lib/casting-invites.ts`](../lib/casting-invites.ts); the open casting they build on is
[seasons.md, "Open casting"](seasons.md#open-casting-the-season-is-the-first-date).

## What applying with a code does

`POST /api/casting/invite/<code>` with `{ "character_id": "...", "consent": true }` (the page puts the terms above
its button, so pressing it is the consent, as an audition's is):

- **The checks are an audition's** (`auditionBlocks`, lib/auditions.ts) **without "dates"**, and only on this path:
  the owner's own character made on the site, an account signed in (we must reach them), public, open to dates, PG,
  a portrait, one audition a person a season, not one turned down this season. The usual audition still asks for its
  three dates.
- **Pre-approved**: one statement claims the code (still unused, still in date) and writes the `cast_auditions` row as
  `approved` for `auditionSeasonId` (next month's season). Both happen or neither does: a second audition of theirs
  that season (`cast_auditions_one_each`) undoes the claim too. An open audition of the same character becomes approved
  (its date kept); a withdrawn one comes back. The admin can still turn it down on `/admin/season`, as any audition.
- **The audition date** with the casting lead (`castingLead`: next month's lead in the preseason, this month's in
  season) is booked at once through the ordinary booking route, the way a Sunday rose's date is: as the owner, on a
  show-paid request (`markShowPaidRequest`: none of their dates are spent), marked with `markLeadRequest(req, {
  audition: true })` (lib/casting.ts) so the lead is booked by name and the date is the character's **casting date**
  (`setup.met_via = 'casting'`): Sunday's roses judge it like any walk-on's. The first-date format, public.
- **Not booked again** when the character already has a casting date with that lead in this casting (from the month
  before the lead's season on), filming or done: the builder's instant first date, say. The answer says which date
  counts.
- **A date that can't be booked** (no lead picked, the show paused, it's on that season's cast already, the booking
  refused) leaves the application standing and says why. The invite page then shows its owner a "Book the date"
  button: the same POST again, which only tries the date (the response has `again: true`). Nobody else can use it.
- **The owner hears**: a notification (`audition`: "🌹 {Name} is shortlisted for {Month Year}", linking the date), and,
  when they opted in to the character's texts, its own short text from templates (tagged `casting_invite:<code>`, once).
- **During the season** (from the 1st) the application is for the next season, and the date with this season's lead
  is still booked: a walk-on. The page's words follow the phase.
- One code, one character: a used code refuses anyone else (409 `invite_used`), an expired one says so (410
  `invite_expired`), an unknown one 404 `invite_not_found`.

An invite never touches points, odds, pairings or endings: the date's ending is the engine's.

## The page: `/casting/invite/<code>`

Public and PG, no 18+ wall (proxy.ts `UNGATED_PREFIXES` has `/casting/invite/`), `noindex`, never in the sitemap:
codes are private. Reading it changes nothing.

- **Open code**: "You're invited to {Month}'s The Botchelor" (in season: "You're invited to The Botchelor"), the lead's
  face and name, the format's suitors' places, the rose ceremony every Sunday and the audience's votes, and the offer:
  no three-date wait, straight onto an audition date with the lead. Then the terms, then one next step:
  - signed in with characters that can apply: pick one, "Apply with {Name}" (and, without a creator name yet, two
    optional fields for one: the credit);
  - signed in, none can apply: why, per character, and make or bring one;
  - signed out with characters: "Sign in to apply" (`/account?next=` the invite);
  - no character: **Make your character** (`/create?next=` the invite) and **Bring your character** (`/import`, the
    Character.AI importer).
- **Used by this person**: how the application stands (shortlisted, withdrawn, turned down) and the date with the lead,
  or its retry button.
- **Closed, unknown, expired, or used by someone else**: one friendly line and a link to /casting.

**The detour.** The page keeps the code in a cookie (`bz_cast_invite`, not HttpOnly, 30 days or the code's own end,
whichever is sooner; applying clears it). With it, `/create` with no `?next=` (the importer's way in) ends with "Back to
your casting invite", and the owner's own character page shows one quiet line, "🌹 Apply {Name} to {Month}'s Botchelor
→", while the character isn't auditioning or on the cast. Nobody else sees anything.

**The terms**, as shown (`INVITE_TERMS`, lib/casting-invite-shared.ts): the owner's paragraph, adjusted where the code
says otherwise:

> Your character stays yours, and we credit you by your creator name wherever it appears. By applying you let
> Botchelor feature your character, its dates and clips of them on the show and on Botchelor's social accounts while
> it's on the show. You can withdraw it at any time, and it leaves the casting at once; delete it, and nothing new is
> made with it after that. It must be your own original character: a fictional adult, nothing taken from someone
> else's work, no real people. On the show it stays PG.

- "by your creator name": the site credits a person through their creator page (`creator_profiles`, lib/showcase.ts:
  opt-in, public, never a login name or email). The invite form sets one when they have none. The credit shows on the
  character's page ("by {name}", linked) and on its casting card.
  - On the socials, the clips credit it themselves. The episode JSON gives a person's character a `credit` ({handle,
    name}) on an aired public date when its owner has a visible creator name (lib/game.ts `CharacterRef.credit`).
  - The daily clip's caption and an episode cut's caption add "{Character} is by {name}:
    botchelor.com/creators/{handle}" (scripts/clips/post-kit.mjs `creditLines`). The marketing loop posts the caption
    as written, so Shorts and Reels carry it, and so does TikTok when David pastes it.
  - Owners' real names still appear only with every owner's consent, as before. The credit is the public persona
    their own page already shows.
- "it leaves the casting at once; delete it, and nothing new is made with it": withdrawing (its page's audition panel)
  takes it out of the auditions and off the cast, but a public character still gets the house's life dates
  (lib/character-life.ts), and a casting date it already had is still judged on Sunday (a rose books one more date).
  Deleting it stops everything new. The owner's original read "You can withdraw it at any time, and nothing new is
  made with it after that."

## Making codes (admin)

`/admin/season` → the **Creator invites** fold: the list (open, used by which character, expired, with the note) and
"Make N invites" with a note. Or the route, with the admin password or a signed-in admin account:

```
POST https://botchelor.com/api/admin/casting-invites
content-type: application/json
x-frontier-key: <the admin password>

{"count": 10, "note": "who they're for", "days": 30}
```

→ `201 { "switched_on": true, "invites": [{ "code", "url": "https://botchelor.com/casting/invite/<code>", "expires_at" }] }`.
`count` 1 to 20, `days` 1 to 90 (30 when left out), `note` the admin's own (never shown on the page). `GET` the same
path lists every invite, newest first, with its status and the character that used it. A code is 10 url-safe
characters (60 random bits); each is for the season auditions are open for when it's made, and applies to the season
auditions are open for when it's used.

## The switch

`CASTING_INVITES`, on unless it is `0`. Off, every invite page says invites are closed and every application is
refused (403 `invites_closed`); the admin can still make codes (`switched_on: false` says so). Documented in
`.do/show.yaml`.

## What's counted

- The page's view, as one page `/casting/invite` (the code never reaches analytics: app/funnel.ts `beaconPath`,
  lib/engagement.ts `normalizePath`), and a visit that starts there has the source **invite** (its own tag,
  `casting_invite`, app/funnel.ts `BEACON_REFS`; the RepoHQ beacon carries it too).
- In the engagement log: `casting_invite_applied` / `casting_invite_retry` (`booked`), the buttons' `data-track`
  clicks, and `date_started` (`mode: casting_invite`) when the audition date was booked.
- In the system log (lib/analytics.ts): `audition` with `source: invite`, `casting_invite_used` (the code, the
  character, the season, `applied` or `date_retry`, whether the date booked), `casting_invites_made` (how many), and
  the booking route's own `casting_date`.

## Table

`casting_invites` (lib/db.ts): `code` (primary key), `season_id`, `note`, `created_at`, `expires_at` (30 days by
default), `used_at`, `used_by` (the owner), `character_id` (set null if the character is deleted).

Tests: `tests/casting-invites.test.ts`.
