# After Dark: legal review, payments and hosting (2026-10-24)

> **Update 2026-10-30: the hosting risk below is resolved.** Nothing runs on Vercel now: the show is on DigitalOcean
> App Platform, and After Dark is live on its own DigitalOcean app (`ad.botchelor.com`) with its media on Bunny, whose
> terms allow lawful adult content (`docs/hosting.md`, `docs/after-dark-hosting.md`). The processor applications'
> hosting prerequisite is met. The rest of this review is as written on 2026-10-24.

_Issue-spotting for David and for the lawyer he hires, not legal advice. Researched 2026-10-24 from current sources
(law-firm alerts, regulators' pages, processors' own policies; secondary sources are marked). Two load-bearing claims were
re-read at the source that day: the UK Online Safety Act's text-only exclusion (s.79(4)) and Vercel's acceptable use
policy (updated 2026-04-21). Builds on `docs/after-dark.md` §3 Payments, §4 Age verification and §6 Hosting, and on
`docs/after-dark-moderation-options.md`._

## What's built (2026-10-24, David: "I take all your recommendations")

- **Content lines:** non-consent, bestiality and sexual violence or gore are refused in steers, lines, whispers,
  scenarios and media prompts, as the age lines were (`lib/safety.ts` EXCLUDED_THEMES; blood family and step-family
  already were). The scene prompt says so too.
- **Regional rules:** `lib/jurisdiction.ts` and `lib/place.ts`. Blocked places get the not-available page and no
  teasers, nav link, account card or After Dark looks. Text-only places (the UK, Japan) get the scenes, but every
  picture, video and voice route answers 451 and no automatic picture is drawn for them. An unknown place is blocked.
  Admins, the operator, are exempt.
- **Account deletion** now removes every After Dark record of the person (`lib/account.ts` deleteAfterDarkData).



- **"Every site just asks for 18+" was true in 2024, not now.** Where the laws apply, self-declaring is non-compliant,
  and the bigger AI-companion sites have added real checks: SpicyChat (Persona, in 26 US states plus the UK, France,
  Italy and Australia), JanitorAI (blocked the UK in July 2025, then k-ID checks for the UK, Australia and Brazil from
  2026-06-15), Kindroid and joi.com. Candy.ai, CrushOn and Nomi reportedly still self-declare. Those are the outliers,
  and the reports on them are second-hand.
- **Enforcement is real, and it reaches AI sites.** Ofcom investigated joi.com, an AI companion, until it added age
  checks (case closed 2026-07-31). It fined an AI nudify site £55k, kept low because the site geoblocked the UK, and
  fined porn operators £600k–£1.35m. Texas took $675k from Chaturbate. Florida sued adult sites and the processor
  Segpay itself. Kansas private suits ask a $50k minimum.
- **The cheap way to launch is to block the places that demand real checks, and self-declare elsewhere.** Blocking by
  IP location is what regulators accept as the fix (Ofcom treats a UK block as compliance; Utah's attempt to make VPN
  users count was enjoined 2026-09-24).
- **Payments: Segpay first, Verotel as backup.** Segpay is the only adult processor with a published AI approval
  route, and Verotel takes individuals with no fixed card fees. Both, and every card network, ban some themes *in text
  too*: incest, non-consent, bestiality, anything that reads as underage. That's narrower than "everything between
  fictional adults", so it's a decision for David (below).
- **Hosting: leave Vercel before applying to a processor.** It isn't only Vercel's risk: CCBill's policy says no part
  of the site may sit on a host whose policy it breaks, and other processors check the same thing. The DigitalOcean +
  Bunny split is built and off (`docs/after-dark-hosting.md`).

## Why not Vercel

Vercel's acceptable use policy (updated 2026-04-21) bars content that is "offensive, obscene, graphic or violent" or
"sexually exploitative", and "customers on a non-Enterprise subscription may not: Use a service for an objectionable
purpose". Its terms (updated 2026-10-19, §3) let it remove content "at any time for any reason … or for no reason at
all". It never says adult content is banned, but it never says it's allowed either. A suspension would take the PG show
down with After Dark.

- **DigitalOcean** (policy updated 2026-03-20) bans only "Unlawful Pornography" (child abuse material, or nudity and
  sex shared without consent) plus AI child abuse material and involuntary deepfakes. Lawful adult content is allowed by
  omission.
- **Bunny.net** says so outright: it "accepts our service to be used for providers of 'adult content'", if it's legal
  in Slovenia and every US state.
- **Neon** (the shared database) bars only unlawful content.

So: After Dark runs on `ad.botchelor.com` (DigitalOcean App Platform, media on Bunny, about $16–18 a month), and the
show stays on Vercel, serving no adult content. Switch it on before the processor application, not after.

## Age checks: where they're required

| Where | Rule | Text scenes? | Pictures and video? | Launch answer |
|---|---|---|---|---|
| **27 US states** (AL, AZ, AR, FL, GA, ID, IN, IA, KS, KY, LA, MS, MO, MT, NE, NC, ND, OH, OK, SC, SD, TN, TX, UT, VA, WV, WY; tracker, 2026-10-18) | Upheld by the Supreme Court (*Free Speech Coalition v. Paxton*, 2025). Texas covers a site "more than one-third of which" is harmful material, *including written descriptions*; Kansas uses 25%, and Alabama and South Dakota reportedly have no threshold. Many allow private suits. | Yes | Yes | Block |
| **UK** (Online Safety Act Part 5) | Covers porn the provider publishes, including content generated by an automated tool in response to a prompt, but **not content that "consists only of text"** (s.79(4), re-read at legislation.gov.uk). Needs "highly effective" checks (credit card, face estimate, open banking); self-declaring and debit cards don't count. | **No** | Yes | Block, or text-only for UK users |
| **France** (Arcom) | Certified checks with a double-anonymity option; non-EU sites get ISP-blocked | Yes (no carve-out found) | Yes | Block |
| **Italy** (AGCOM 96/25/CONS) | Certified checks every session; fines to ~€258k | Yes | Yes | Block |
| **Germany** (JMStV) | A closed adult user group | Yes | Yes | Block |
| **Australia** (eSafety codes, since 2026-03-09) | AI companions that can make explicit material must age-check; fines to A$49.5m | Yes | Yes | Block |
| **Everywhere else** | No adult age-check law found | — | — | 18+ self-declaration |

**The subdomain cuts the wrong way.** The one-third tests keep botchelor.com safe, but make `ad.botchelor.com` close
to 100% adult on its own. Whether a paywalled section of one site counts as its own "website" is a question for the
lawyer. Plan on the subdomain being treated as an adult site.

**Opening a blocked region later** needs a real check in the subscribe flow. Store only pass/fail, method and time;
Texas fines keeping identifying data ($10k per instance). Prices found:

- **go.cam:** €0, on-device, AGPL; liveness is in beta.
- **FSC PrivateAV:** $30 a month for 1,000 checks; Free Speech Coalition members only.
- **AgeChecker.Net:** $25 a month plus $0.50 a check.
- **Persona:** from $250 a month on a 12-month term.
- **VerifyMy and Yoti:** quote only.

In the UK a credit-card check counts, so the processor's own card check may cover it (a question for the lawyer and the
processor).

## Other laws that touch After Dark

| Law | What it asks | Applies? | Cheapest compliant move |
|---|---|---|---|
| **AI child abuse material** (18 U.S.C. 2256(8)(B): a computer-generated image "indistinguishable from" a minor; 28–45 states add their own) | Never make or hold it. Text can be prosecuted as obscenity (*U.S. v. Fletcher*, 2008). | Yes | What's built: fail-closed Hive child + VLM age check, discard on fail, and age words refused in text (`checkAdultText`). |
| **NCMEC reporting** (18 U.S.C. 2258A, REPORT Act) | A provider with *actual knowledge* must report and preserve for a year. There's no duty to scan; fines run to $600k. | **Unresolved:** does a Hive "child present" flag on an image we discard count as knowledge? | The lawyer decides "discard" vs "quarantine and report". Until then, discarding stays. |
| **TAKE IT DOWN Act** (FTC enforcing since 2026-05-19) | Platforms mainly for user content must remove intimate images within 48 h of a valid request | Probably not (we publish our own generated content, with no real people) | A takedown form with a 48-hour promise anyway: $0, and processors want one. |
| **18 U.S.C. 2257** record-keeping | Records for depictions of "actual human beings" | Not for wholly synthetic images (2257A does cover edited images of a real person) | A 2257 exemption statement, as OurDream publishes. |
| **Card-network rules** (Mastercard 5.12.7, extended to AI and synthetic images from Feb 2026; AN 5196; Visa VIRP Tier 1) | Review content before it's shown, answer complaints in 7 business days, let depicted people appeal, ban non-consent, incest, bestiality, child abuse and real people | Yes, through the processor, whatever the law says | See "Content lines" below. |
| **EU AI Act Art. 50** (in force 2026-08-02; systems already on the market have until 2026-12-02) | Machine-readable "AI-generated" marks on images, video, audio and text; a visible label on photoreal images; tell people it's AI | Yes, for EU users, **and for the PG show too** | C2PA/IPTC metadata on every generated file plus a visible badge. Due by 2026-12-02. **Built 2026-10-24:** IPTC `trainedAlgorithmicMedia` XMP in every generated picture, `X-AI-Generated` headers on video and audio, "AI-generated" labels; no C2PA (needs a certificate). See docs/after-dark.md "AI marking, crisis notice and profile consent". |
| **Companion-chatbot laws** (New York since 2025-11-05; California SB 243 since 2026-01-01, $1,000 per violation private suits; Washington and Oregon from 2027) | Tell users it's AI (NY: at the start and every 3 hours), a self-harm protocol with a crisis referral, extra rules for minors | Two AI characters with a user steering may fall outside, but the **show's texting probably doesn't** | An AI notice plus a crisis-line response, on both sites. **Built 2026-10-24:** an always-on AI line in the thread, and crisis resources (988, Samaritans, findahelpline.com) when a person's own words trip `lib/crisis.ts`, MCP included; protocol at /safety (docs/safety-protocol.md). |
| **Privacy** (GDPR Art. 9; Texas TDPSA) | "Sex life" data is special-category: explicit consent | Yes: the stored turn-ons (`adult_profiles`) | An explicit opt-in before saving turn-ons, plus delete and export. **Built 2026-10-24:** a ticked consent before turn-ons or hard nos are stored (`consented_at`), MCP needs `consent: true`, and Download / Delete on the After Dark privacy card. |
| **Subscriptions** (ROSCA; California's auto-renewal law since 2025-07-01; the federal click-to-cancel rule was vacated 2025-07-08, rulemaking reopened 2026-03-11) | Clear recurring price, express consent, an annual reminder, cancel online the way you joined | Yes | Price and renewal stated at checkout, a cancel button, a reminder email. Keep chargebacks under Visa's 1.5%. |
| **Obscenity** (Miller test) | Federal felony; rarely prosecuted | Low risk, highest for extreme themes | The content lines below. |

## Payments: which processor

Stripe, Paddle, Lemon Squeezy ("including NSFW chatbots"), Gumroad and Patreon (no AI sexbots or explicit-image tools)
are all out.

| | Segpay | Verotel | CCBill |
|---|---|---|---|
| AI content | **The only one with a published AI route.** Its banks treat AI sites like user-content sites, so all output must be moderated before it's shown. In the US one bank takes AI, through Segpay's payment-facilitator platform. No user uploads allowed. | Not published: ask before applying | Not published; one unverified report of an AI storytelling site being rejected |
| Who can apply | Company papers expected (secondary: US, UK or EU companies only) | "The individual or business entity", worldwide | Sole proprietors OK, with a US, Canada, EU or UK presence |
| Fees | Not published; secondary: ~10–15% plus $1,450 a year in Visa/Mastercard registration | 15.5% plus 1.5% on renewals; €500 a year, waived above €100 a week; no chargeback fees | 10.8–14.5% plus $1,950 a year in card registration |
| Reserve | ~5% for 6 months (secondary) | 10% rolling, 6 months | 5% for 26 weeks |
| Payouts | Weekly | Daily, free | Weekly, 9 days after the week |
| Statement shows | SEGPAY / SEGPAYCS.COM | VTSUP.COM | CCBILL |

**What the processor takes at $12.99 a month:**

| Processor | 50 subscribers ($650/mo) | 500 subscribers ($6,495/mo) |
|---|---|---|
| Verotel | ~$110 (17%) | ~$1,100 (17%); ~15% on Premium after 6 months |
| Segpay | ~$185–220 (29–34%) | ~$770–1,100 (12–17%) |
| CCBill | ~$233–257 (36–40%) | ~$860–1,100 |

Reserves come on top: cash held back, not lost.

**Recommendation:** apply to Segpay first; its rules match what's built (every picture and video checked before it's
stored, no uploads). Run Verotel as backup, and as the cheaper choice while volume is small. Email both a one-page
description first and get their AI answer in writing. Crypto (NOWPayments, ~0.5%) is an add-on for token packs, not the
main checkout.

What competitors do: none names a processor publicly. They bill under their own companies, probably through EU banks:
Candy.ai is EverAI Limited, Malta; OurDream is Dream Studio USA (Delaware), whose statement reads "DREAMSTUDIOS.CO
Limassol CY". That's their own merchant accounts, a step for later.

**What David prepares to apply:**

1. **An LLC and an EIN.** Segpay and most AI-adult banks expect company papers, and an LLC keeps the adult business's
   liability and bank account apart from David. This costs a filing fee; it's his call, with the lawyer.
2. After Dark live on `ad.botchelor.com`, off Vercel. (Done 2026-10-30.)
3. Site pages: terms, privacy, refunds and cancellation, a content policy naming the banned themes, a complaint and
   takedown page (7 business days; 48 hours for intimate images), the 2257 exemption statement, a support email, and
   the age gate. **Drafted 2026-10-24:** `/terms`, `/privacy`, `/content-policy`, `/report` (stored in
   `content_reports`, emailed to the admins, reviewed on `/admin/reports`), `/cancel` and `/2257`, all past the 18+ gate.
   Who runs it and the governing state are one constant each in `lib/legal-entity.ts` (`OPERATOR`, `GOVERNING_STATE`,
   a placeholder "Delaware" until David picks his state or his LLC's). A lawyer should read them before any money.
4. A one-page moderation write-up: the output checks, the text filters, logs and a monthly report. Plus a test login
   for their reviewers.
5. Government ID and a bank letter.

Apply at: Segpay https://segpay.com/verticals/high-risk/ · Verotel https://verotel.com/en/productchoice.html ·
CCBill https://ccbill.com/doc/?p=4443

## Content lines: David's decision

Today's hard lines (`checkAdultText`, `lib/adult/acts.ts` `excludedTheme`) refuse minors and anything suggesting them,
real people, step-family, teacher/student, school and age-play. Every processor and card network also bans, **in text as
well as pictures**:

- **non-consent** (rape, coercion, drugged or asleep);
- **incest by blood**, not just step-family;
- **bestiality**;
- extreme violence or mutilation in a sexual context.

David's rule of 2026-10-18 was "everything between fictional adults". To get a processor, these four have to be refused
in steers, scenes and media, the way age words are now. That's his call, but no processor will accept the site without
it.

## The launch shape, cheapest first

1. **Block at launch** (IP location plus a stated "not available here"): the UK, France, Italy, Germany, Australia and
   the 27 US states above. $0.
2. **18+ self-declaration everywhere else**, plus the $0 pieces: the content lines, the AI Act marks and label, an AI
   and crisis notice, the takedown form, the 2257 statement, and an explicit opt-in for turn-ons.
3. **Later, open blocked regions with a real check** (go.cam, AgeChecker.Net or FSC PrivateAV first, for price).
4. **Optional for the UK:** text-only scenes are outside Part 5, if UK users can be kept away from every picture,
   video and voiced line.

## Questions for a licensed lawyer

1. Is After Dark a 2258A "provider", and does an automated Hive or VLM flag count as actual knowledge? Discard, or
   quarantine and report?
2. Is `ad.botchelor.com` one "website" for the one-third tests, and does a paywall change that?
3. Do IP blocks plus self-declaration count as reasonable efforts in the states with private suits?
4. Does the processor's card check satisfy Texas's "transactional data" method and the UK's credit-card method?
5. Do SB 243 and New York's law cover two-AI scenes, and the show's texting?
6. Should David form the LLC before applying, and in which state?

**Where to find one:** Walters Law Group (firstamendment.com) does age-verification compliance work. The Free Speech
Coalition's age-verification toolkit comes with membership (a shorter free version exists). Ask for a flat fee on a
scoped memo answering the six questions.

## Sources

- Competitors: [SpicyChat](https://www.roborhythms.com/spicychat-age-verification-state-blocks/) · [JanitorAI](https://help.janitorai.com/en/article/age-verification-for-australia-brazil-and-the-uk-t4opjk/) · [CompanionHunt (secondary)](https://companionhunt.com/guides/ai-chatbot-age-verification/)
- Enforcement: [Ofcom, joi.com](https://www.ofcom.org.uk/online-safety/protecting-children/investigation-into-novi-ltds-compliance-with-the-duty-to-prevent-children-from-encountering-pornographic-content-through-the-use-of-age-assurance) · [Ofcom fine, £1.35m](https://www.ofcom.org.uk/online-safety/protecting-children/ofcom-fines-porn-company-1.35-million-for-not-having-age-checks) · [Undress.cc fine](https://www.theregister.com/2025/11/21/ofcom_osa_fine_undress/) · [Texas AG](https://www.texasattorneygeneral.gov/news/releases/texas-secures-settlement-operator-major-pornography-website-ensuring-compliance-texas-law) · [Florida vs Segpay](https://www.404media.co/florida-lawsuit-nutaku-spicevids-segpay/) · [Kansas suits](https://www.freespeechcoalition.com/blog/kansas-av-lawsuits-explainer)
- US: [state tracker](https://www.recordinglaw.com/us-laws/age-verification-laws/) · [FSC v. Paxton](https://www.scotusblog.com/cases/free-speech-coalition-inc-v-paxton/) · [Texas HB 1181](https://capitol.texas.gov/tlodocs/88R/billtext/html/HB01181F.htm) · [Utah VPN rule enjoined](https://www.kpcw.org/state-regional/2026-09-25/federal-judge-blocks-utahs-vpn-update-to-its-online-porn-age-verification-law)
- UK: [OSA s.79](https://www.legislation.gov.uk/ukpga/2023/50/section/79) · [s.80](https://www.legislation.gov.uk/ukpga/2023/50/section/80) · [Ofcom age-check guidance](https://www.scl.org/ofcom-publishes-final-guidance-on-age-checks-to-protect-children-online/)
- EU and Australia: [Arcom](https://www.franceinfo.fr/societe/pornographie/l-arcom-sanctionne-une-trentaine-de-sites-pornographiques-qui-n-ont-pas-mis-en-place-de-systeme-de-verification-d-age-de-leurs-utilisateurs_8127671.html) · [AGCOM](https://www.biometricupdate.com/202511/italys-regulator-releases-list-of-adult-platforms-covered-by-age-verification-law) · [AI Act Art. 50](https://www.paulweiss.com/insights/client-memos/eu-finalises-transparency-rules-for-ai-generated-content) · [eSafety](https://esafety.gov.au/newsroom/media-releases/new-industry-codes-seek-to-take-on-ai-chatbots-that-encourage-suicide-and-engage-in-sexually-explicit-conversations-with-aussie-kids)
- Child safety, takedowns, 2257: [18 U.S.C. 2256](https://www.law.cornell.edu/uscode/text/18/2256) · [2258A](https://www.law.cornell.edu/uscode/text/18/2258A) · [FTC, TAKE IT DOWN](https://www.ftc.gov/news-events/news/press-releases/2026/05/ftc-begins-enforcing-take-it-down-act) · [DOJ 2257 guide](https://www.justice.gov/sites/default/files/criminal-ceos/legacy/2012/03/19/2257compliance.pdf)
- Companion laws, privacy, subscriptions: [NY and CA](https://www.mofo.com/resources/insights/251120-new-york-and-california-enact-landmark-ai) · [WA and OR](https://www.mayerbrown.com/en/insights/publications/2026/04/oregon-and-washington-join-california-in-enacting-companion-chatbot-laws) · [GDPR Art. 9](https://gdpr-info.eu/art-9-gdpr/) · [California auto-renewal](https://btlaw.com/en/insights/alerts/2025/california-expands-automatic-renewal-law-new-requirements-now-in-effect) · [click-to-cancel vacated](https://www.fenwick.com/insights/publications/eighth-circuit-vacates-ftcs-click-to-cancel-rule)
- Payments: [Segpay prohibited content](https://gethelp.segpay.com/docs/Content/ComplianceDocs/ProhibitedContent.htm) · [Segpay UGC](https://gethelp.segpay.com/docs/Content/ComplianceDocs/UserGeneratedContent.htm) · [Verotel prices](https://verotel.com/en/pricechart.html) · [Verotel agreement](https://verotel.com/en/merchantagreement.html) · [CCBill AUP](https://ccbill.com/cs/client/policies/ccbill/acceptable_use.html) · [CCBill pricing](https://ccbill.com/pricing) · [Mastercard 2026 (secondary)](https://www.austreme.com/en/mastercard-standard-brand%E2%80%91damaging-transaction/) · [Visa VIRP (secondary)](https://paymentcloudinc.com/blog/visa-integrity-risk-program-high-risk-merchants-guide/) · [Payments Edge (secondary)](https://thepaymentsedge.com/payments/processor-showdown-2025/)
- Hosting: [Vercel AUP](https://vercel.com/legal/acceptable-use-policy) · [Vercel terms](https://vercel.com/legal/terms) · [DigitalOcean AUP](https://www.digitalocean.com/legal/acceptable-use-policy) · [Bunny AUP](https://bunny.net/acceptable-use)
