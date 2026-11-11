# The company pages

David, 2026-11-10: "tackle 1-6 and anything else to make this a corporate level business". The pages a real business
has, written from the code so they can't drift from it.

| Page | What it's for | Where its facts come from |
|------|---------------|---------------------------|
| `/contact` | The support inbox and where each kind of question goes | `lib/company.ts` `CONTACT_ROUTES`, `CONTACT_EMAIL` |
| `/faq` | The questions people ask, with FAQPage JSON-LD | `lib/faq.ts` (prices, limits and what's open, read per request) |
| `/pricing` | Everything free and everything on sale | `lib/catalog.ts`, `lib/paid-plans.ts`, `lib/companion-plan.ts` |
| `/press` | The boilerplate, facts, logo, screenshots, colours | `lib/company.ts` `BOILERPLATE`, `public/press/`, docs/brand.md |
| `/security` | How to report a hole, the good-faith promise, what we do | `lib/auth.ts`, `lib/http.ts`, `lib/key-crypto.ts`, `lib/login-guard.ts` |
| `/accessibility` | WCAG 2.2 AA aim, what's done, known gaps | docs/brand.md, the stylesheets |
| `/.well-known/security.txt` | RFC 9116, Expires always 180 days out | `lib/security-policy.ts` |

- **The footer** has a fourth group, Company, then a row of the show's accounts (`app/SocialLinks.tsx`: X, Bluesky, TikTok,
  Discord once `DISCORD_INVITE_URL` is set, GitHub), then a © line with the support address. No accounts on After Dark's
  host.
- **The Organization JSON-LD** (`lib/seo.ts` `organizationJsonLd`) lists the accounts as `sameAs`, the founder, and the
  support address as a `ContactPoint` once `CONTACT_EMAIL` is set.
- **The 18+ gate** lets the company pages through (`middleware.ts` `UNGATED_PAGES`), and `/about` and `/costs` with
  them, since the press kit and the footer link to both: a journalist, a card processor's reviewer or a security
  researcher reads them without ticking a box. None holds anything adult; `/about` and `/costs` name After Dark's
  suppliers in words, as the privacy notice does.
- **Failed sign-ins** are held (`lib/login-guard.ts`): 10 wrong passwords for a handle, or 30 from one visitor, in 15
  minutes. Only failures count.
- **An email address on a page is always the whole text of its own element** (best a `mailto:` link), never words
  inside a sentence. Cloudflare's email obfuscation runs on botchelor.com and on DigitalOcean's edge in front of the
  app, and turning it off on our zone doesn't reach theirs. It rewrites each address in the HTML and its script puts it
  back. An address inside a sentence comes back as a text node of its own, React's hydration then fails (#418), and the
  whole page renders again in the browser: /faq did this until 2026-11-10. A test in `tests/company-pages.test.ts`
  checks the company pages; `npm run screenshots:company-live pages` fails on any page error.
- When a fact on one of these pages changes (a model, a host, a price rule), change the page in the same PR.
  `tests/company-pages.test.ts` holds the parts that can be checked.

## What only David can decide

These would make it more of a company, and each costs money or needs his name on something:

1. **An LLC.** `lib/legal-entity.ts` is ready: set `OPERATOR` to the LLC's name and every legal page follows. In
   California, filing is $70 and the franchise tax is $800 a year.
2. **A business postal address** (a PO box or a virtual mailbox). The newsletter can't send issues without one
   (CAN-SPAM), and it would go on /contact and the legal pages.
3. **The DMCA agent**, registered with the US Copyright Office ($6, renewed every three years). `DMCA_AGENT` in
   `lib/legal-entity.ts` says it isn't registered yet.
4. **A trademark** on "Botchelor" (USPTO, from $350 a class). Optional.
Decided on 2026-11-10: David set the postal address himself (for the newsletter) and gave Claude two keys, kept in the
keychain: `vault/botchelor/CLOUDFLARE_DNS_TOKEN` (DNS and Email Routing on botchelor.com only) and
`vault/botchelor/UPTIMEROBOT_API_KEY`. The LLC, the DMCA agent and the trademark wait.

## Mail and status (set up 2026-11-10)

- **Addresses.** Cloudflare Email Routing forwards support@, press@, security@ and dmarc@ to the same inbox.
  `roleEmail()` in `lib/company.ts` gives /press press@ and /security and security.txt security@, but only when
  `CONTACT_EMAIL` is on botchelor.com.
- **DMARC.** `_dmarc` is `v=DMARC1; p=none; rua=mailto:dmarc@botchelor.com; adkim=r; aspf=r; fo=1`. Resend signs as
  d=botchelor.com, so its mail passes. After about two weeks of clean aggregate reports in the dmarc@ inbox, move to
  `p=quarantine` (ask David first). No CAA record, on purpose: one that leaves out a certificate authority Cloudflare or
  DigitalOcean uses can quietly break certificate renewal.
- **Status page.** UptimeRobot (free plan), https://stats.uptimerobot.com/9FWth2eqBE, `STATUS_PAGE_URL` in
  `lib/company.ts`, linked from the footer and /security. It shows the home page, `/api/health` on both apps (a
  keyword check for `"ok":true`), /pricing and /contact. The account also checks /admin and staging, which stay off the
  public page. A custom status.botchelor.com address is a paid feature.
