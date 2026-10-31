# After Dark: the business setup (sole proprietor, EIN, bank, CCBill)

David's picks (2026-10-30): **start as a sole proprietor** (David Smith, trading as Botchelor) and form a California
LLC later, once subscriptions pay for its $800 yearly tax; and **CCBill** as the first processor (Segpay and Verotel stay
wired as backups). The code side is done (CCBill is built and off: `lib/adult/billing-ccbill.ts`, docs/after-dark.md
"Billing"). Everything below is David's to do. Each step needs his identity, a signature or a payment, which agents
never handle (no card, no SSN, no financial data).

Order matters: the business name, then the EIN, then the bank account, then the processor. Each one asks for the one
before it. If CCBill says it needs an LLC (question 4 of the inquiry, sent 2026-10-30), it's Verotel first instead
(it takes individuals), or the LLC in section 1b.

## Where it stands (2026-10-30)

| Step | Status |
|---|---|
| EIN (sole proprietor, dba Botchelor) | Done. The letter is in David's "business" folder |
| Marin County fictitious business name | Signed. Mailed with a $42 check and a stamped return envelope |
| Newspaper notice | Next, within 45 days of filing (Marin IJ or a paper on the county's approved list) |
| Business bank account | After the filed statement comes back. Ask the bank whether it banks adult merchants |
| CCBill inquiry | Sent. Mili (MiliT@ccbill.com) answered the same day |
| CCBill follow-up answers | Sent. Country and entity, owner, ID, $12.99 a month, how content is made, the controls, the service |
| CCBill reviewer login | Sent. Account `ccbill_review`, with a reviewer pass until 2026-11-29 (docs/after-dark.md "Reviewer pass", #994) |
| CCBill AI Guidelines (PDF) | Not read: the Gmail connector can't download attachments. Our reply maps our controls to the card-network rules and asks Mili to flag any gap |
| CCBill application | After the bank account. Then FlexForms, the webhook, the `CCBILL_*` settings and one test purchase |

**What CCBill said** (2026-10-30):
- A sole trader may apply. The LLC and the owner must both be in the US.
- They need a US business bank account and the owner's US ID (ccbill.com/doc/acceptable-identification-for-accounts).
- The card statement can show the site name, "Botchelor", but David's name then goes on the Contact Us page and the payment form.
- AI-generated content is reviewed case by case.

**Open:**
- **The support address.** The legal pages show David's Gmail (`CONTACT_EMAIL`). A support@botchelor.com address needs the Cloudflare nameserver switch first, for free email routing.
- **David's name on the contact page.** CCBill requires it for a sole trader. Add it to the contact details when the application goes in.

## 1. The business name (a fictitious business name statement, your county)

California requires one when you trade under a name that doesn't include your surname, and "Botchelor" doesn't. Banks
ask for it before opening an account in the business name.
- **Where:** your county clerk-recorder's office. Most counties file online; the form is the "Fictitious Business Name
  Statement". About $25–$100.
- **What to answer:**
  - Business name: **Botchelor**.
  - Registrant: you, David Smith, an **individual**.
  - Business address: where you run it from.
  - Date first used: the date Botchelor first took money, or "not yet".
- **Within 30 days of filing:** publish it once a week for four weeks in a newspaper the county approves, often
  $30–$100; many papers file the proof for you.
- It's good for five years.
- **Also check your city:** many cities want a business license for a home business. It's usually small; your city's
  website says.

## 1b. Later: the LLC (California)



**What it costs, before deciding.** California charges every LLC an **$800 annual tax** (FTB Form 3522), whether it
earns anything or not.
- The first payment is due by the 15th day of the 4th month after the Articles are filed. For example, Articles filed
  on June 19 are due September 15 ([FTB 3556](https://www.ftb.ca.gov/forms/misc/3556.html)).
- The 2021–2023 first-year waiver has ended. One commercial site says formations from 2027 to 2029 get a reduced first
  year, but I couldn't confirm that with the FTB, so ask an accountant.
- With the $70 filing and the $20 Statement of Information, year one is about **$890**. That's above the $300 a
  product owner budget, so it's David's call.

**The cheaper way to start:** apply as a sole proprietor (David Smith, trading as Botchelor) and form the LLC once
subscriptions pay for it.
- Verotel takes individuals. Ask CCBill in the inquiry email whether it does too (question 4).
- The legal review found an LLC "likely needed" for liability. A sole proprietor carries the business's risks
  personally. Ask the lawyer.

**Filing, once decided:**
- **Where:** [bizfile Online](https://bizfileonline.sos.ca.gov) (California Secretary of State). Sign in with a
  bizfile account, then file Form **LLC-1, Articles of Organization**: $70 by Visa or Mastercard. File there directly:
  the "LLC service" sites charge for the same form.
- **What it asks for:**
  - The name, ending in "LLC". Suggested: **Botchelor LLC**. Search the name on bizfile first.
  - An agent for service of process with a California address. You can be your own, at your home address, but it goes
    on the public record. A paid agent ($50–$150 a year) keeps your home address off it.
  - Management: **one manager or more**, or **all members**. Pick all members: it's you.
- **Within 90 days:** Form **LLC-12, Statement of Information**, $20. It's due again every two years. Since 2026-08-01
  it needs bizfile "User Access" set up first. Ignore mailed "Statement of Information" offers that charge more: the
  Secretary of State warns about them.
- **After filing:**
  - Save the filed Articles (a PDF). CCBill and the bank both ask for it.
  - Write a one-page operating agreement; a free template is fine.
  - Diary the $800 tax (Form 3522) and the yearly Form 568 return.
  - No BOI report: FinCEN's rule (in effect 2026-08-14) exempts US-formed companies
    ([fincen.gov/boi](https://www.fincen.gov/boi)).
- **Then the terms:** set `OPERATOR` in `lib/legal-entity.ts` to "Botchelor LLC, a California limited liability
  company". `GOVERNING_STATE` is already California.

## 2. The EIN (free, about 10 minutes)

- **Where:** [IRS: Get an EIN](https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number),
  only on irs.gov. It is free: never pay a site for one.
- **Hours (Eastern):**
  - Monday to Friday, 6 a.m. to 1 a.m.
  - Saturday, 6 a.m. to 9 p.m.
  - Sunday, 6 p.m. to midnight.
- **What to answer:**
  - Entity type: **sole proprietor** (later, an LLC gets its own new EIN).
  - Reason: started a new business.
  - Responsible party: you, with your SSN.
  - Business: online subscription entertainment; trade name Botchelor.
- **Why bother as a sole proprietor:** processors and banks get the EIN, not your SSN.
- **Afterwards:** download the confirmation letter (CP 575) as soon as it's shown. Banks and CCBill ask for it, and it
  can't be downloaded again.

## 3. A business bank account

- A business checking account in your name "dba Botchelor". It needs the filed fictitious business name statement, the
  EIN letter and your ID. Keep the business's money in it only: it's what keeps the books, and later the LLC, clean.
- Ask the bank for a **bank letter** (or use a voided check). CCBill asks for it to pay out.
- Ask the bank, before you open the account, whether it banks adult-entertainment merchants. Some banks close accounts
  that receive payouts from adult processors.

## 4. CCBill

1. **Send the inquiry first** (below). It gets CCBill's answer on AI-made content in writing before you apply.
2. **Apply:** CCBill's merchant sign-up at [ccbill.com](https://ccbill.com). Expect these questions (from
   docs/after-dark-legal-review.md "Payments"):
   - The fictitious business name statement (or the LLC's Articles, later), the EIN letter, your ID and the bank letter.
   - The site: `https://ad.botchelor.com`, with its terms, privacy, refunds and cancellation (`/cancel`), the content
     policy, complaints and takedowns, the 2257 exemption statement, a support email and the age gate.
   - A one-page moderation write-up (the output checks, the text filters, the logs and the monthly report) and a test
     login for their reviewers.
3. **Once approved:**
   - Set up the FlexForms payment flow and the webhook, exactly as docs/after-dark.md "Billing" says.
   - Put the five `CCBILL_*` settings in the keychain (`~/ai-stack/bin/secrets add botchelor …`) and on After Dark's
     DigitalOcean app.
   - Run one test purchase and watch `/admin/after-dark/providers` → Subscriptions.

### The inquiry email (sent 2026-10-30)

> **To:** CCBill merchant sales (the contact form on ccbill.com)
> **Subject:** New merchant: AI-generated adult fiction subscription, policy question before applying
>
> Hello,
>
> I'm preparing a merchant application for Botchelor After Dark (https://ad.botchelor.com), a $12.99 monthly
> subscription to interactive adult fiction. All characters are fictional adults, written and illustrated by AI. There
> are no real people, no uploads of real photos, and no user-to-user content.
>
> Before I apply, could you confirm in writing:
> 1. Does CCBill accept AI-generated adult text, images and short video for fictional adult characters?
> 2. Which themes does CCBill prohibit in text as well as images, so our content policy matches yours?
> 3. Which age-verification and moderation steps do you require from an AI content merchant (we check every picture and
>    video after it's generated, and refuse anything that suggests a minor or a real person)?
> 4. Can a US sole proprietor apply, or does it have to be an LLC? And which documents do you need?
> 5. What are the rates, reserve and payout schedule for this category?
>
> Thank you,
> David Smith
> Botchelor (a California business; an LLC in formation)

## 5. Still open (not part of this list)

- **Age verification:** a provider in the subscribe flow (Yoti, Persona or Veriff), with counsel on the state matrix.
  This is docs/after-dark.md "#4".
- **The terms:** `GOVERNING_STATE` is California since 2026-10-30. The operator becomes the LLC once it's formed.
- **A lawyer's flat-fee review** of the terms (the six questions in docs/after-dark-legal-review.md).

**Processor comparison (2026-10-31):** `docs/after-dark-processor-research.md`. CCBill primary, Segpay backup, Verotel last resort; ask CCBill whether the Visa/Mastercard registration fees are paid up front.
