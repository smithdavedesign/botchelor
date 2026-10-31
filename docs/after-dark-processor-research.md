# After Dark: which payment processor (research, 2026-10-31)

Research only. Nothing was signed up for, emailed or submitted. Every claim has a date and a source. "Primary" means the
processor's or card network's own page. "Secondary" means a review site, a broker or a news report. "Unverified" means I
could not confirm it.

## Recommendation

**Keep CCBill as the primary and make Segpay the backup. Use Verotel only if both say no.** CCBill has already told you
in writing that a US sole proprietor may apply and that it reviews AI content case by case (Mili, 2026-10-30). It is
US-based, pays weekly with a $25 minimum, has a month-to-month contract and publishes its rules. Segpay is the only
adult processor that has said in public how it underwrites AI sites. It treats them like user-content sites: everything
is reviewed before it's shown, and users can't upload. That is exactly what After Dark already does.

**The "sketchy" worry is mostly wrong about Segpay and partly right about Verotel.**
- **Segpay:** its marks are typical for the industry. Florida's attorney general sued it in September 2025 because a
  site it billed for skipped Florida's age checks. An advocacy source says the state dropped that suit in December 2025
  (unverified). Its public reviews come mostly from confused cardholders.
- **Verotel:** the worry has some basis. It pays out only into its sister company's account (Yoursafe), runs under
  Dutch law, and holds funds in a Dutch escrow. Merchant reviews repeat the same complaints: late payouts and support
  that doesn't answer. On the other hand, its prices are the most open of the four, it charges no chargeback fees, and
  it takes individuals.
- **CCBill:** it has its own baggage. It was named with Epoch in an October 2025 trafficking class action over
  GirlsDoPorn. Every big adult processor carries this kind of history.

Stripe, Paddle, Lemon Squeezy and Coinbase all ban this content. A crypto gateway (NOWPayments) can be a later add-on,
but not the main way to bill.

## Comparison

At $12.99 a month. "Cost at 50 subs" is a rough estimate of what the processor takes from $650 a month, with yearly
fees spread across the months.

| | CCBill | Segpay | Verotel | Epoch | NOWPayments (crypto) | Stripe / Paddle / Lemon Squeezy / Coinbase |
|---|---|---|---|---|---|---|
| Takes AI adult content | Case by case (in writing to David, 2026-10-30). Its policy doesn't mention AI | Yes, published: underwritten like user-content sites, every output reviewed before it's shown, no uploads | Not published. Ask | Not published. Ask | Markets itself to adult sites. Says nothing about AI | **No.** All four ban it |
| Sole proprietor | Yes, if the owner and business are in the US (CCBill, 2026-10-30) | Expects company papers (our 2026-10-25 notes). Unconfirmed | Yes. The agreement covers an "individual or business entity" | Unknown | Claims "KYB-free" sign-up | n/a |
| Setup fee | $0 | Unknown | $0 (Basic) | $0, but a $1,000 card registration fee up front | $0 | n/a |
| Rate | Not published. Secondary: 10.8–14.5% on its high-risk plan | Not published. Secondary: ~10–15% | 15.5% on the first charge, 17% on renewals (Basic) | 15% under $5k a month, falling to 13.25% | 1% (0.5% claimed for one coin, no conversion) | n/a |
| Yearly card-network fees | Visa $950 + Mastercard $1,000 (CCBill's own page) | Secondary: ~$1,450 | €500 a year, waived at renewal if you do €100+ a week; €0 on Premium | $1,000 a year | None | n/a |
| Rolling reserve | Secondary: 5% for 26 weeks | Unknown | 10% for 26 weeks | Secondary: "no reserve" (doubtful) | None | n/a |
| Payouts | Weekly, Mondays. $25 ACH minimum | Unknown | Daily, free, but only into a Yoursafe account | Unknown | You hold the crypto. Fiat payout through partners | n/a |
| Chargeback fee | Not published (secondary: $25 on low-risk plans, none on the high-risk plan) | Unknown | None. +2.5% if chargebacks reach 1% or more | Unknown | No chargebacks (crypto can't be reversed) | n/a |
| Recurring billing | Yes (FlexForms; already built) | Yes (already built) | Yes (FlexPay; already built) | Yes | No | n/a |
| Contract | Month to month, 10 days' notice. Funds held ≥6 months after you leave. No CCBill banks for 1 year | Unknown | Either side may end it any time. Funds paid 6 months after the last invoice. Dutch law | Unknown | Ends any time | n/a |
| Reputation | Mostly consumer complaints. Named in the 2025 GirlsDoPorn suit | Trustpilot 3/5, mostly consumers. Florida suit (2025), reportedly dropped | Merchant reviews: late payouts, no support. No regulatory action found | Trustpilot 1.7, BBB 1, G2 4.4. Named in the 2025 GirlsDoPorn suit | Not assessed | n/a |
| Cost at 50 subs (~$650/mo) | ~$80 + ~$160 registration = **~$240 (37%)** | ~$65–100 + ~$120 = **~$185–220** | ~$110 (17%), + ~$45 in year one = **~$110–155** | ~$97 + ~$83 = **~$180 (28%)** | **~$7 (1%)** | n/a |
| Cost at 500 subs (~$6,500/mo) | **~$850–1,100** | **~$770–1,100** | **~$1,100 (17%)** | **~$1,000** | **~$65** | n/a |

**What the table means.** At 50 subscribers the yearly card-network fees, not the percentage, are the biggest cost.
Ask each processor whether those fees come out of payouts or have to be paid up front. Paid up front, they are above
the $300 owner budget (CCBill's add up to $1,950 a year).

## Rules that apply whoever you pick

- **Mastercard rule 5.12.7.** Since 2026-02-24, Mastercard's "unacceptable content" rule covers AI-generated and other
  synthetic images. It names non-consent, child sexual abuse material, bestiality and unauthorized fakes of real people.
  Bulletin GLB 13267. Source: Austreme, a secondary write-up from 2026-02-27; the rule manual is behind Mastercard
  Connect.
- **Mastercard's 2021 adult-content rules** (in force 2021-10-15, via CCBill's blog). Content is reviewed before it's
  published. Complaints are handled within seven office days. People may ask for content to be removed. Uploaders need
  consent and ID. Merchants sign a self-attestation. After Dark has no uploads, so the consent and ID parts mostly fall
  away; the review, complaints and removal parts still apply.
- **Visa VIRP, Tier 1 (MCC 5967).** Visa replaced its old program (GBPP) with VIRP in May 2023. The application fee went
  from $500 to $950 on 2024-04-01. There is an extra $0.10 plus 0.10% per transaction. Complaints must be resolved within
  7 business days, and illegal content removed at once. Source: CCBill's VIRP page.
- **Mastercard merchant monitoring.** Secondary: merchants onboarded from 2026-01-01 get a website scan before their
  first transaction, including gated and member-only pages. The reviewer login (`ccbill_review`) covers this.
- **18 U.S.C. 2257.** It covers depictions of real people. Wholly AI-made images are exempt, and the `/2257` exemption
  statement is already live. Corepay lists 2257 records only "if human engagement is offered".
- **Age verification.** After Florida sued Segpay over a merchant's missing age check, expect processors to ask how
  age-check laws are handled. After Dark blocks the 27 states with such laws, which is a strong answer. Secondary:
  self-declaration alone may not pass underwriting in 2026 (a vendor's claim). Plan for Yoti, Persona or Veriff.
- **CCBill's own rules (AUP v.15, July 2026).** No incest, extreme violence or bestiality. No marketing that suggests
  anyone is under 18, including in the URL and meta tags. No part of the site on a host whose rules it breaks (done:
  DigitalOcean and Bunny). **Section 4.17 bans any wording that says the credit card is used to verify age.** I searched
  `app/` and `lib/` for such wording on 2026-10-30 and found none. Keep it that way.

## Notes on each

### CCBill (primary)
- **Where it stands:** The inquiry was answered on 2026-10-30. A sole trader may apply. CCBill needs a US business bank
  account and US ID. David's name goes on the Contact Us page and the payment form. AI content is reviewed case by case.
  The AI Guidelines PDF it sent hasn't been read yet (repo `docs/after-dark-business-setup.md`).
- **Fees:** No setup or monthly fee. The percentage isn't published. Annual high-risk registration is Visa $950 and
  Mastercard $1,000 ([ccbill.com/pricing](https://ccbill.com/pricing), read 2026-10-30). Secondary: the "Blue"
  high-risk plan is 10.8–14.5% with a 5% reserve held 26 weeks, and $5 per ACH payout
  ([Cardfellow](https://www.cardfellow.com/blog/ccbill-review), undated, ©2026).
- **Payouts:** weekly on Mondays for the Sunday–Saturday week. $25 ACH minimum, $100 for ACH Express, $20 return fee
  ([CCBill Merchant Accounting FAQ](https://ccbill.com/doc/merchant-accounting-faqs/)).
- **Contract:** month to month with 10 days' written notice, sent on CCBill's form. CCBill may end it at once for a
  serious breach. After cancelling, funds are held at least 6 months, and you may not use CCBill's banks for a year
  ([Merchant Maverick](https://www.merchantmaverick.com/reviews/ccbill-review), updated 2026-07-22).
- **Policy:** [Acceptable Use Policy v.15, July 2026](https://ccbill.com/cs/client/policies/ccbill/acceptable_use.html).
- **Reputation:** Merchant Maverick counts 16 BBB complaints in three years, mostly from consumers. G2: 2.5/5 from 4
  reviews ("contract terms not disclosed"). Named with Epoch, First Data and TSYS in a GirlsDoPorn trafficking class
  action ([404 Media, 2025-10-16](https://www.404media.co/girlsdoporn-victims-sue-major-payment-processors-ccbill-epoch/)).
  Outcome unknown.
- **Onboarding:** our notes estimate 3–10 business days once all the papers are in. The bank account is the blocker.

### Segpay (backup)
- **AI:** Segpay's own blog says it underwrote AI programs "as if they were user generated content sites", with "controls
  in place to moderate all AI generated content and review it prior to posting". Banks ask how training images were
  obtained and how consent was given (segpay.com/?p=11273, quoted in search results; the page returned 403 to my
  fetch). Its help center says "User uploads are prohibited on AI sites"; content must be reviewed before it goes live;
  documents must be produced within 48 hours; reports go monthly
  ([Segpay UGC rules](https://gethelp.segpay.com/docs/Content/ComplianceDocs/UserGeneratedContent.htm)). Banned themes:
  [Segpay prohibited content](https://gethelp.segpay.com/docs/Content/ComplianceDocs/ProhibitedContent.htm).
- **Fees, reserve, payouts, contract:** not published. **Unverified.** Ask in writing.
- **Reputation:** Trustpilot ~3/5, mostly consumers. A partner of the Internet Watch Foundation (IWF). Florida AG
  complaint under HB3, about a site it billed for that lacked age checks
  ([404 Media, 2025-09-23](https://www.404media.co/florida-lawsuit-nutaku-spicevids-segpay/)). A change.org update dated
  2025-12-24 says the AG agreed to drop the Segpay claim. **Not confirmed** by a court docket or the AG. Nothing found on
  held merchant payouts.
- **Verdict on "sketchy":** not supported. Its risk is the same legal exposure every adult processor has. Its AI rules
  are the clearest of the four.

### Verotel (last resort)
- **Fees (primary, [price chart](https://verotel.com/en/pricechart.html), read 2026-10-30):** Basic is 15.5% flat, plus
  1.5% on renewals. €500 annual registration, waived at renewal with €100+ a week. No chargeback or refund fees, but
  +2.5% if chargebacks reach 1% or more (counted only past 50 transactions in 4 weeks). Reserve: 10% for 6 months.
  Free daily payouts, into a Yoursafe Business Account. Premium (14% falling to 13%, €25 a week under €1,000) needs 6
  months of processing statements, so it isn't open to you yet.
- **Agreement (primary, [merchant agreement](https://verotel.com/en/merchantagreement.html)):** the contract is with
  Yoursafe B.V. Funds sit in an escrow run by Stichting Geldbeheer Verotel. Either side can end it; Verotel can end it
  without cause, or at once on any breach. The holdback is paid 6 months after the last invoice. A suspended holdback
  must be claimed within 12 weeks, or it is lost. Uncashed checks expire after 30 weeks. You indemnify Verotel for all
  fines. Dutch law, Dutch courts. AI isn't mentioned.
- **Regulation:** a Dutch central bank (DNB) payment institution since 2011 and an e-money institution since 2019
  (Verotel's own timeline; not checked against the DNB register).
- **Reputation:** about 13 Trustpilot reviews, almost all 1-star, mostly merchants: "have not paid me for over a month",
  support "very unusefull and difficult" (de/dk/no.trustpilot.com/review/verotel.com; one is dated 2025-08-14). One
  aggregator lists fund holds as the most common complaint and found no class actions or FTC complaints
  ([cardpaymentoptions](https://cardpaymentoptions.com/credit-card-processors/verotel)). The Yoursafe app is rated 1.7/5.
- **Verdict on "sketchy":** partly justified. The terms are open, but you would depend on a Dutch e-money account and a
  thin support team, with no US recourse. Use it only if both CCBill and Segpay refuse a sole proprietor.

### Epoch
- US, since 1996. The site publishes no prices or AI policy (epoch.com, read 2026-10-30). Sign-up:
  epoch.com/business_services/contract_initiation.html.
- Secondary ([Merchant Machine](https://merchantmachine.co.uk/high-risk/epoch), updated 2026-01-08): 15% under $5k a
  month, falling to 13.25%. $1,000 card registration up front and again at each renewal. "Does not withhold any
  reserve". I doubt that for a new high-risk merchant: verify. Trustpilot 1.7 (54), BBB 1 (13), Sitejabber 1.4, G2 4.4.
- Named in the same GirlsDoPorn suit as CCBill. A credible fourth option, but it adds nothing over CCBill and Segpay.

### High-risk brokers (ISOs) and direct merchant accounts
- Example: Corepay, an ISO/MSP (a reseller) of North American Banking Company. It markets to AI adult chatbots. No
  rates published; "no application, setup, or annual fees"; decisions in 24–72 hours. It asks for incorporation papers,
  a voided check, financial history and earlier processing statements
  ([Corepay](https://corepay.net/industries/ai-adult-chatbot-payment-processing-experts/), ©2026). Centrobill (an EU
  biller) says AI-adult sites need specialists, but gives no terms
  ([Centrobill, 2026-04-03](https://centrobill.com/blog/subscription-billing-for-ai-image-generators/)).
- A direct MCC 5967 merchant account makes you register with Visa and Mastercard yourself, pay the reserve, and run your
  own chargeback work. It suits a business with processing history and a company, not a pre-revenue sole proprietor.
  Revisit at a few hundred subscribers, when the 10–15% all-in rate starts to cost real money.

### Crypto: NOWPayments (add-on only)
- It has an adult-industry page: fees from 1%, as low as 0.3% on custom deals, sign-up "KYB-free" in under a minute,
  fiat payouts through partners ([nowpayments.io adult page](https://nowpayments.io/all-solutions/adult),
  [pricing](https://nowpayments.io/pricing), read 2026-10-30). Civitai moved to crypto through NOWPayments after its
  card processor dropped it in May 2025.
- Downsides: no recurring billing (each month is a manual payment), few subscribers will use it, and no card company
  checks you, so all the legal rules fall on you. A cheap second button later. It doesn't replace a card processor.

### Mainstream: ruled out (all checked 2026-10-30)
- **Stripe:** bans "pornography and other mature audience content (including literature…)" and "any
  artificial-intelligence generated content that meets the above criteria"
  ([Stripe restricted businesses](https://stripe.com/legal/restricted-businesses)). Keep After Dark fully separate from
  botchelor's Stripe account.
- **Paddle:** bans "adult and other age-restricted content… sexually-oriented or pornographic products"; AUP updated
  2026-04-13 ([Paddle](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)).
- **Lemon Squeezy:** bans sexually oriented or pornographic content of any kind, naming "NSFW chatbots"
  ([Lemon Squeezy prohibited products](https://docs.lemonsqueezy.com/help/getting-started/prohibited-products)).
- **Coinbase (Commerce):** Coinbase's prohibited-use policy (effective 2022-01-31) bans pornography and adult services
  ([Coinbase prohibited use](https://www.coinbase.com/legal/prohibited_use)). I couldn't load the Commerce-specific
  terms (403). Treat it as banned.

## Could not verify
- Segpay's rates, reserve, payout terms, and whether it takes a sole proprietor.
- CCBill's actual rate and reserve for this category. Only secondary sources give them.
- Epoch's AI policy, and its "no reserve" claim.
- Whether Florida's suit against Segpay was really dropped.
- The exact text of Mastercard's 2026 AI rule, which is behind Mastercard Connect.
- Verotel's AI policy and its license status in the DNB register.
- How the GirlsDoPorn processor suit turned out.

## Next steps for David
1. **Read CCBill's AI Guidelines PDF** from the Gmail thread with Mili (download it by hand). Check each line against
   the moderation write-up in `docs/after-dark-processor-application.md`.
2. **Reply to Mili with four questions, in writing:** (a) the rate and any per-transaction fee for this category;
   (b) the reserve, as a percentage and for how long; (c) whether the $950 Visa and $1,000 Mastercard fees are paid up
   front or come out of payouts, and when; (d) chargeback and refund fees. If (c) means paying up front, that's above the
   $300 owner budget: your call.
3. **Finish the bank steps:** the newspaper notice, then the business account. Ask the bank whether it accepts payouts
   from adult processors. Get the bank letter, then submit the CCBill application.
4. **Send the Segpay email now, as the backup** (drafted in `docs/after-dark-processor-application.md`). Add two
   questions: does it take a US sole proprietor, and what are its rate, reserve and payout terms? The code is already
   built, so a second "yes" costs nothing.
5. **Hold off on Verotel.** Email it only if CCBill and Segpay both refuse a sole proprietor. If you use it, withdraw
   from Yoursafe every week; don't leave a balance there.
6. **Plan the age check (Yoti, Persona or Veriff).** Every processor now asks how age laws are handled. Geoblocking is
   the answer for now. A real check is what lets those states and the UK open later.
7. **Later, optional:** add NOWPayments as a one-off crypto purchase (token packs), not a subscription, once card
   billing is live. Revisit a direct merchant account through a broker at a few hundred subscribers.
