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

- **The footer** has a fourth group, Company, then a row of the show's accounts (`app/SocialLinks.tsx`: X, Bluesky,
  Discord once `DISCORD_INVITE_URL` is set, GitHub), then a © line with the support address. No accounts on After Dark's
  host.
- **The Organization JSON-LD** (`lib/seo.ts` `organizationJsonLd`) lists the accounts as `sameAs`, the founder, and the
  support address as a `ContactPoint` once `CONTACT_EMAIL` is set.
- **The 18+ gate** lets the company pages through (`middleware.ts` `UNGATED_PAGES`): a journalist, a card processor's
  reviewer or a security researcher reads them without ticking a box. They hold nothing adult, and nothing about After
  Dark.
- **Failed sign-ins** are held (`lib/login-guard.ts`): 10 wrong passwords for a handle, or 30 from one visitor, in 15
  minutes. Only failures count.
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
5. **More addresses** (press@, security@) as Cloudflare Email Routing rules to the same inbox. Free, but it's his
   Cloudflare account. Until then every page uses support@ with a subject line.
6. **An outside status page** (UptimeRobot or Better Stack, both have free plans). It means a new account, so it's his
   call.
