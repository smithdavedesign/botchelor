# After dark: the adult season (admin only)

David's call (2026-10-18). This season's house cast, played without the show's content limits, in private. It is for
the admin's own use, and it might become a paid season one day. Nobody's own characters take part.

## The lines that never move

- **Nobody under 18.** No minors, no "young-looking", no ages under 18 mentioned in passing, and no steer that makes
  someone younger (`checkAdultText` in `lib/safety.ts`, which is stricter on age than the show).
- **No real, identifiable people**, in text or in images.

Everything else between the fictional adults is allowed. Every line the model writes and every steer goes through
the check. A line that fails is dropped, and the admin is told how many.

## Where it runs (built)

**Two ways in.** Either way it's for a signed, signed-in admin session only. An old unsigned `bz_uid` cookie never
opens it, and everyone else gets a 404, so the pages don't reveal that they exist.
- **On the site (M2):** an admin turns it on at `/admin/after-dark/settings` and saves an OpenRouter key.
  - Text runs on OpenRouter (default `mistralai/mistral-large`, changeable).
  - Pictures and clips run on fal.ai (`fal-ai/flux/dev`, `fal-ai/wan-i2v` by default) with fal's own safety checker
    off. Our two lines still apply to every prompt.
  - Keys are sealed like BYOK keys (`sealSecret` in `lib/keys.ts`) and only their last four are shown again. Set a
    spend limit with each provider when you create the key.
- **Locally:** run with `ADULT_MODE=1`. With no OpenRouter key saved, text runs on Ollama on your Mac
  (`dolphin-mistral`, or `ADULT_LLM_BASE_URL` / `ADULT_LLM_MODEL`). This mode never switches on through the flag on
  Vercel.

**Who's in:**
- this season's house cast, always;
- any of the admin's own characters they switch on, and the house characters those characters date;
- never another person's character (`lib/adult/characters.ts`).

**Kept apart:** `adult_scenes`, `adult_images` (bytes served only by `/api/admin/after-dark/media/[id]`, `private,
no-store`), `adult_characters`, `adult_settings` and `adult_access_requests`. Nothing is written to episodes, texts,
memory, the graph, the feed, search or the sitemap. A test checks this.

**MCP:**
- **The admin's own agents:** send `x-frontier-key` and they get `after_dark_pairs`, `after_dark_scene`,
  `after_dark_write` and `after_dark_switch`.
- **Every other agent:** those tools aren't listed, and calling one returns "unknown tool". The only after-dark tool
  they see is `request_after_dark`. It records the request, notifies every admin and lists it on the settings page.
  Nothing opens for that agent.

**Run it locally:**
1. `ollama serve`
2. `ADULT_MODE=1 npm run dev`
3. Sign in, claim admin on `/admin`, and open `/admin/after-dark`.

## How a scene works (built)

1. Pick two of the characters who are in.
2. The scene picks up from their latest date, or starts as they meet.
3. **Write the next lines** writes 6 lines at a time in each character's voice. You can steer it, or **Start over**.
4. Each reply also says whether the scene has turned explicit, and whether a picture was asked for and agreed to.

**Pace and place (David, 2026-10-18: "they jump straight into sexual action", "at a cafe… not the right scenario").**
- Each scene keeps where the two of them are now (`place`) and how far it's gone (`stage`). The stages are talking and flirting, tension, kissing, undressing, then sex (`lib/adult/stages.ts`).
- Unless steered, a stage lasts at least 12 lines (two steps), and then the scene moves at most one stage. The server enforces this (`stage_from`), so a model that rushes ahead doesn't move the stage on. A steer can jump. The scene opens where the date ended, and they don't leave in the first lines.
- In a public place they flirt and at most kiss. Going further means they leave for somewhere private, and the lines show it.
- The page shows "Now: <place>. So far: <stage>."
- Why the last picture didn't come stays on the scene and shows in the gallery until a picture comes through.

## Pictures and clips (built, on fal.ai)

- **One baseline explicit picture per character**, made the first time a scene turns explicit, and reused after that.
- **A new picture only when the story asks:** one character asks the other for one and the other agrees, in the lines
  just written.
- **A gallery per pair.** "Make it move" turns a picture into a clip on fal's queue; the page polls until it's ready.
- Picture prompts are built from the characters' own sheets. They always say the people are adults, and they go
  through the two lines before anything is generated.

**What fal can't promise:** the check runs on our prompts, not on fal's output. Nothing in our prompts can ask for
anyone under 18, and the characters are adults on their sheets. Checking the output image itself would be an extra
step later.

## The output check (built, Hive)

No picture or clip is stored or served until the file fal returned passes Hive's checks (`lib/adult/check.ts`), on
one V3 secret key from Hive's Service API Keys page. A fail is discarded, never stored, and only its reason is logged
in `adult_rejections`.
1. **`hive/visual-moderation`** ($3 per 1,000 images): refuse if `yes_child_present` scores 0.05 or more on any frame.
2. **`hive/vision-language-model`**, on pictures: asked whether everyone shown is clearly 18 or older; anything but
   a plain `ADULTS` (`MINOR`, `UNSURE`, nobody visible, an unreadable answer) is a refusal. Hive's face-age
   (Demographics) model is Enterprise only on the V3 portal, so the VLM stands in for it. A clip is made from a
   picture that already passed both, and its frames go through moderation again.

It fails closed: a missing key, a Hive error or an unreadable reply all count as a refusal. Pictures stay off until
the Hive key is saved in settings.

## Who it opens for (built)

- **`canAfterDark`** (`lib/adult/entitlement.ts`) is checked on every page, route and generation.
  - An admin always gets in.
  - Anyone else needs a signed-in account with an active subscription and a passed age check (`adult_entitlements`).
  - A lapsed subscription, or a period that has ended, closes it again.
  - Nothing writes those rows yet, so today it's admin-only.
- **Switches are per person** (`adult_switches`). Each person switches in their own characters and the house
  characters they bring along, never anyone else's. One person's switches never change another person's after dark.
- **Margin guard** (`adult_usage`): monthly caps on scene steps, pictures and clips per person. The defaults are 300,
  30 and 5, stored in `adult_settings`. Admins aren't capped.
- **The mode:** the pages live at `/after-dark` with their own night look and a 🌙 badge. A 🌙 After Dark link appears
  in the nav and an After Dark card in Account, only for someone it's open to. Settings stay at
  `/admin/after-dark/settings`, admin only.

## Before anyone but the admin uses it

The full reasoning is in `docs/after-dark.md`. Everything below is needed, and everything except the last item needs
David to sign up, pay or decide.

1. **An adult payment processor** (CCBill or Segpay, never Stripe). Its webhook writes `adult_entitlements`
   (status and period end). Then add the "Subscribe to unlock" row in Account.
2. **An age-verification provider** (Yoti, Persona or Veriff) in the subscribe flow. It writes `age_verified_at`
   only; the ID is never stored.
3. **Hive's CSAM classifier** (built with Thorn), Enterprise only, as a third check on every image, alongside the two
   self-serve checks. Demographics (face age) is Enterprise too, and is worth adding then as well.
4. **Hosting:** confirm with Vercel (registration@vercel.com) and move explicit image storage to adult-permissive
   storage. Right now it's bytes in Neon, served through Vercel to the admin only.
5. **Model terms:** confirm the text provider (Venice, for `dolphin-mistral-24b-venice-edition`) and the image and
   clip models allow adult content. Swap `fal-ai/flux/dev`, which is Stability-based and doesn't allow it.
6. **Legal:** counsel on the state-by-state age-verification rules, plus terms and a privacy update for the adult tier.
7. **Product, which we can build:** the subscribe flow and processor webhook, the "Subscribe to unlock" row, an
   age-check expiry, per-subscriber cost reporting, and moderation and reporting for subscribers' scenes.

## If it ever becomes a paid public season

This is a separate project:
- age verification that actually checks (UK Online Safety Act, several US states);
- an adult-friendly payment processor, not Stripe;
- moderation and reporting;
- terms;
- probably its own domain and brand, so botchelor.com's search standing and payments stay safe.
