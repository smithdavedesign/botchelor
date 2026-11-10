# The Sunday letter

One email a week from the show, after Sunday's reveal: whose secret came out, the week's best dates, the best callers
and when the next vote opens. Anyone can sign up, with or without an account: in the site footer, or on
[/newsletter](https://botchelor.com/newsletter).

Built and half on: with `RESEND_API_KEY` set, sign-ups and confirmations work, but **no letter goes out until
`NEWSLETTER_POSTAL_ADDRESS` is set** (below). Off entirely without `RESEND_API_KEY`, and never on After Dark's host.

The list is `lib/newsletter.ts`; the weekly letter is `lib/newsletter-issue.ts`, run from the hourly lobby job
(`app/api/jobs/lobby/route.ts`, at :20) after the reveal and the Discord posts. Tests: `tests/newsletter.test.ts`.

**PG only, never After Dark.** The letter is built from what a signed-out visitor already sees on the show: the reveal's
result as the Watch card shows it, the dates the Discord digest may post (public, aired, unreported, no After Dark memory,
no private or test character), and the callers board with only the display names people put up.

## How it works

1. **Sign-up** (`POST /api/newsletter`, from `app/NewsletterForm.tsx`): an address and the 18+ box. The address is
   lowercased and checked like the waitlist's. The answer is always `201 {ok: true}`, whether the address was new,
   pending or already confirmed, so the form can't be used to find out who's on the list; the confirmation email goes
   after the answer (`after()`), so the answer's timing doesn't tell either. People only (bots and MCP calls get a 403),
   5 sign-ups an hour and 20 a day from one connection (`rate_hits`, a keyed hash of the IP, kept two days).
2. **Double opt-in**: a new address (or one that had left) is `pending`, and gets a confirmation email with a signed
   link good for 7 days. The link opens `/newsletter/confirm`, whose button confirms it: a button, so a mail scanner that
   opens links can't sign anyone up. An address gets a confirmation at most once a day, and at most 3 in one pending
   spell; signing up again doesn't restart the clock. A sign-up nobody confirms is deleted after 30 days.
3. **Unsubscribe**: every email (the confirmation too) carries a signed unsubscribe link to `/newsletter/unsubscribe`
   (a button again) and the `List-Unsubscribe` / `List-Unsubscribe-Post` headers (RFC 8058), so Gmail and Apple Mail
   show their own one-click button, which posts to `/api/newsletter/optout`. The address is kept as `unsubscribed` with
   when it left: nothing more goes to it until it signs up and confirms again. The unsubscribe link never expires.
4. **The letter**: built once a week, keyed by its ISO week (`2026-W46` for the reveal on Sunday 15 November), in the two
   days after Sunday's reveal airs (19:20 UTC), as soon as the reveal has settled: its date is on or its tries ran out,
   or there was nothing to reveal or no vote that week (then the letter goes without the reveal). By Monday it stops
   waiting. A week with no reveal and no aired date has no letter. Every subscriber gets the same subject and body;
   only the small print differs (their own unsubscribe link). Its links are tagged
   `utm_source=newsletter&utm_medium=email&utm_campaign=2026-W46`, so the engagement log counts what it brings.
5. **Sending**: in batches from the hourly job, each address claimed in `newsletter_sends` (keyed by letter and
   address) before its send, so nobody gets a letter twice even if the job runs twice. A send the provider refuses gives
   its claim back and ends the pass (the next pass tries again, 3 tries an address at most); a pass that dies mid-send
   leaves that address claimed, since it may have gone. A letter goes out over at most six days, so it's done before
   the next one. Sends pause 0.6 s apart (Resend's free plan takes two requests a second), and a pass spends at most
   45 s.

## The caps

- **`NEWSLETTER_DAILY_CAP`** (default 40): the letter's emails in any 24 hours, confirmations included. Letters stop a
  quarter short of it (30 of 40), so a sign-up's confirmation always has room; a confirmation that couldn't go at once
  goes from the hourly job.
- **The show's `EMAIL_DAILY_CAP`** (80, `lib/email.ts`): the letter's emails are logged in `email_sends` (as
  `newsletter_confirm` and `newsletter_letter`), so they count toward it, and the letter only uses what's left of it.
- At 30 letters a day over six days, one letter reaches about **180 confirmed addresses**. Past that, both caps have to
  rise, and Resend's free plan (100 emails a day, 3,000 a month: docs/costs.md) with them: a paid plan is David's call.

## Settings (DigitalOcean, the show's app: `.do/show.yaml`)

| Setting | What it does |
|---|---|
| `RESEND_API_KEY` | Already set for the show's emails. Without it the letter is off: no footer form, the page says it isn't open, the sign-up answers 503. |
| `NEWSLETTER_POSTAL_ADDRESS` | The postal address printed at the bottom of every letter. **No letter goes out until it's set**; until then the hourly job says `newsletter: "waiting for NEWSLETTER_POSTAL_ADDRESS"`. |
| `NEWSLETTER_DAILY_CAP` | The cap above (40). |
| `SESSION_SECRET` | Already set: it signs the confirm and unsubscribe links (with their own context, so the show's email links don't work here). Without it the letter is off too. |

`CHANGE_ME` (the spec's placeholder) counts as unset for both newsletter settings.

## What David decides

- **A postal address for the letter.** US law (CAN-SPAM) asks for a valid physical postal address in every commercial
  email. A PO box or a virtual mailbox (for example a USPS PO box, or a virtual mailbox service that gives a street
  address) is fine and keeps a home address out of people's inboxes. That's the only thing between the letter and its
  first Sunday. Set it as `NEWSLETTER_POSTAL_ADDRESS` on the show's app, on one line. It's the same address
  `docs/company.md` (item 2) asks for /contact and the legal pages.

Until then, sign-ups and confirmations already work: a confirmation is a one-off email someone asked for, with an
unsubscribe link, and it carries the postal address too once it's set. The list that builds up waits for the first letter.

## Watching it

- **The hourly job** (`/api/jobs/lobby`): `newsletter` is `"off"`, `"waiting for NEWSLETTER_POSTAL_ADDRESS"`, or
  `{issue, sent, failed, left, confirmations, pruned, pending, confirmed}`.
- **`GET /api/admin/newsletter`** (the admin password or an admin account): whether it's on, how many addresses are
  pending, confirmed and unsubscribed, today's sends against the caps and the last few letters, never an address.
  `?preview=1` adds the latest week's letter as text: as it went out, or as it would be built now.

## Not built (yet)

- **Bounces and complaints.** Resend's webhooks (a hard bounce, a spam complaint) don't unsubscribe anyone yet. An
  address that bounces keeps being tried each week; worth adding before the list is large.
- **A welcome email** on confirming, and an archive of past letters on the site.
