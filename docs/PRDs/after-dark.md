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

## If it ever becomes a paid public season

This is a separate project:
- age verification that actually checks (UK Online Safety Act, several US states);
- an adult-friendly payment processor, not Stripe;
- moderation and reporting;
- terms;
- probably its own domain and brand, so botchelor.com's search standing and payments stay safe.
