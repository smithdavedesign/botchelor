# After Dark: the business setup (LLC, EIN, bank, CCBill)

David's picks (2026-10-30): **an LLC in his home state, California**, and **CCBill** as the first processor (Segpay and Verotel stay
wired as backups). The code side is done (CCBill is built and off: `lib/adult/billing-ccbill.ts`, docs/after-dark.md
"Billing"). Everything below is David's to do. Each step needs his identity, a signature or a payment, which agents
never handle (no card, no SSN, no financial data).

Order matters: the LLC first, then the EIN, then the bank account, then CCBill. Each one asks for the one before it.

## 1. The LLC (California)

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

## 2. The EIN (free, about 10 minutes, after the LLC is approved)

- **Where:** [IRS: Get an EIN](https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number),
  only on irs.gov. It is free: never pay a site for one.
- **Hours (Eastern):**
  - Monday to Friday, 6 a.m. to 1 a.m.
  - Saturday, 6 a.m. to 9 p.m.
  - Sunday, 6 p.m. to midnight.
- **What to answer:**
  - Entity type: limited liability company, 1 member, in your state.
  - Reason: started a new business.
  - Responsible party: you, with your SSN.
  - Business: online subscription entertainment.
- **Afterwards:** download the confirmation letter (CP 575) as soon as it's shown. Banks and CCBill ask for it, and it
  can't be downloaded again.

## 3. A business bank account

- A business checking account in the LLC's name. It needs the Articles, the EIN letter, the operating agreement and
  your ID.
- Ask the bank for a **bank letter** (or use a voided check). CCBill asks for it to pay out.
- Ask the bank, before you open the account, whether it banks adult-entertainment merchants. Some banks close accounts
  that receive payouts from adult processors.

## 4. CCBill

1. **Send the inquiry first** (below). It gets CCBill's answer on AI-made content in writing before you apply.
2. **Apply:** CCBill's merchant sign-up at [ccbill.com](https://ccbill.com). Expect these questions (from
   docs/after-dark-legal-review.md "Payments"):
   - The LLC and EIN, your ID, the bank letter.
   - The site: `https://ad.botchelor.com`, with its terms, privacy, refunds and cancellation (`/cancel`), the content
     policy, complaints and takedowns, the 2257 exemption statement, a support email and the age gate.
   - A one-page moderation write-up (the output checks, the text filters, the logs and the monthly report) and a test
     login for their reviewers.
3. **Once approved:**
   - Set up the FlexForms payment flow and the webhook, exactly as docs/after-dark.md "Billing" says.
   - Put the five `CCBILL_*` settings in the keychain (`~/ai-stack/bin/secrets add botchelor …`) and on After Dark's
     DigitalOcean app.
   - Run one test purchase and watch `/admin/after-dark/providers` → Subscriptions.

### The inquiry email (draft: David sends it)

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
