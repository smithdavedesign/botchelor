# After Dark: the business setup (LLC, EIN, bank, CCBill)

David's picks (2026-10-30): **an LLC in his home state** and **CCBill** as the first processor (Segpay and Verotel stay
wired as backups). The code side is done (CCBill is built and off: `lib/adult/billing-ccbill.ts`, docs/after-dark.md
"Billing"). Everything below is David's to do. Each step needs his identity, a signature or a payment, which agents
never handle (no card, no SSN, no financial data).

Order matters: the LLC first, then the EIN, then the bank account, then CCBill. Each one asks for the one before it.

## 1. The LLC (home state)

- **Where:** the home state's Secretary of State (or Division of Corporations) online filing. File there directly: the
  "LLC service" sites charge for the same form.
- **What it asks for:**
  - The name, ending in "LLC". Suggested: **Botchelor LLC**. Search the state's business name database first.
  - A registered agent with an address in the state. You can be your own, at your home address. A paid agent ($50–$150
    a year) keeps your home address off the public record.
  - The organizer (you) and the management type: **member-managed**, one member.
  - The fee: typically $50–$300 depending on the state, by card.
- **After filing:**
  - Save the approved Articles of Organization (a PDF). CCBill and the bank both ask for it.
  - Write a one-page operating agreement. A free template is fine. Banks often ask for it.
  - Diary the state's annual or biennial report and its fee.
  - **No BOI report:** FinCEN's rule (in effect 2026-08-14) exempts US-formed companies
    ([fincen.gov/boi](https://www.fincen.gov/boi)).

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
> 4. Can a single-member US LLC apply, and what documents do you need?
> 5. What are the rates, reserve and payout schedule for this category?
>
> Thank you,
> David Smith
> Botchelor LLC (in formation)

## 5. Still open (not part of this list)

- **Age verification:** a provider in the subscribe flow (Yoti, Persona or Veriff), with counsel on the state matrix.
  This is docs/after-dark.md "#4".
- **The terms:** `GOVERNING_STATE` in `lib/legal-entity.ts` is still a Delaware placeholder. It becomes the LLC's state,
  and the operator name becomes the LLC's.
- **A lawyer's flat-fee review** of the terms (the six questions in docs/after-dark-legal-review.md).
