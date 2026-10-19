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

- **Local only.** It works only with `ADULT_MODE=1`, and it is always off on Vercel (`VERCEL` / `VERCEL_ENV`), so the
  public site has no way in.
- **Admin only.** It needs a signed, signed-in admin session. An old unsigned `bz_uid` cookie never opens it, and
  everyone else gets a 404, so the pages don't even reveal that they exist.
- **Kept apart.** Scenes live in `adult_scenes` and nowhere else: not in episodes, texts, memory, the relationship
  graph, the feed, search, MCP or the sitemap. A test checks that.
- **On an open-weight model on the admin's Mac.** It never touches the Gemini or Claude keys or budgets.
  - Default: Ollama at `http://localhost:11434/v1` running `dolphin-mistral`, an open model that writes adult
    fiction.
  - `ADULT_LLM_BASE_URL` / `ADULT_LLM_MODEL` / `ADULT_LLM_API_KEY` point it at another OpenAI-compatible endpoint.
  - The client asks for JSON, so the model replies `{"lines": [...]}`. `parseSceneLines` also reads the shapes small
    models fall back to.

**Run it:**
1. `ollama serve`
2. `ADULT_MODE=1 npm run dev`
3. Sign in, claim admin on `/admin` with the admin password, and open `/admin/after-dark`.

## How a scene works (built, M1)

1. Pick two of this season's cast (`/admin/after-dark`, all pairs).
2. The scene picks up from their latest date if they've had one, otherwise from their first meeting.
3. **Write the next lines** writes 6 lines at a time, alternating, in each character's voice. You can steer it
   ("they go back to hers"). **Start over** clears the scene.
4. Scenes have a 400-line cap. A local 7B model answers in about 2–8 seconds on a 16GB Mac.

## Next: images (M2, not built)

David's design:
- **One baseline explicit image per cast member**, made the first time a scene turns sexual, and reused after that.
- **A new image only when the story asks for it:** one character asks for something specific and the other agrees,
  in the scene. No images otherwise, so we aren't generating dozens up front.
- **A private gallery per character**, stored with the scenes and never served publicly, to reuse in later scenes.

Needs:
- **A local image model.** The Mac has none today.
  - On 16GB, SDXL-class open models with an adult-capable fine-tune run in ComfyUI or Draw Things at about
    30–90 seconds an image.
  - Quality goes up a lot on a rented GPU (below).
- **Image prompts built from the character's `appearance`**, with the same two lines enforced. The prompt always says
  "adult" and never takes an age under 18. Each image also needs a check before it's saved.
- **Storage:** a local folder or private bucket, with paths only in an `adult_images` table, never a public URL.

## Quality upgrades (David approved paid options for the proof of concept; he signs up and pays)

| What | Option | Rough cost |
|---|---|---|
| Better text | A larger open model (30–70B) on a rented GPU (RunPod, Vast.ai, Modal) behind a private endpoint, via `ADULT_LLM_*` | about $0.50–2 an hour, only while in use |
| Images | ComfyUI on a rented GPU with an open adult-capable image model | a few cents an image |
| Video | Open video models are heavy (24GB+ of GPU memory) and slow; a rented A100/H100 by the hour | about $2–4 an hour |

The agents don't sign up for or pay for any of these. For each one, I propose the service and what it buys, and
David creates the account, sets a spend cap and stores the key in the keychain (`~/ai-stack/bin/secrets add`).

## If it ever becomes a paid public season

This is a separate project:
- age verification that actually checks (UK Online Safety Act, several US states);
- an adult-friendly payment processor, not Stripe;
- moderation and reporting;
- terms;
- probably its own domain and brand, so botchelor.com's search standing and payments stay safe.
