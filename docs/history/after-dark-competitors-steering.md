# After Dark vs the field: ratings, faces, picking, looks, failed shots

Research date: 2026-10-24. David asked "what other companies do for this" after #765 shipped:
- ratings that steer a viewer's next pictures;
- the face each viewer keeps;
- "Draw three to pick from";
- finer looks;
- the Archive.

Public pages only: no sign-ups, no images opened.
- **Source marks:** **[P]** the company's own docs or blog, **[S]** press or a review, **[U]** not verified.
- **Pages that blocked reading:** Midjourney's docs, Replika's help, OpenAI's blog, CrushOn, Muah and GirlfriendGPT.

## The short version

1. **Taste-steering is personal where it's a product feature. Pooled training is a separate program.**
   - Midjourney builds each user's profile from that user's own pair rankings, and runs separate "rating parties" to train the model.
   - OpenAI and Character.AI pool thumbs and swipes into training.
   - None of the adult or companion products documents per-picture ratings that steer that viewer's next picture. Our 👎 chips that add fixed words are ahead of the adult field, but users can't see them working.
2. **The face moves to a saved, named, multi-image identity with a strength control.**
   - Kling, Runway, Nomi and Higgsfield work this way.
   - A single reference image is the weak case in their own docs.
3. **Mainstream tools show several candidates and make exploring cheap.** Midjourney gives 4 a job plus Draft mode, Luma drafts first, and ChatGPT Images 2.0 gives up to 8 [S]. Companion apps give one.
4. **The safest adult products steer looks with fixed menus and forbid face uploads.**
   - Higgsfield's builder needs no typing.
   - Candy uses tiles.
   - OurDream and Nomi ban reference photos.
   - SoulGen invites lookalike uploads.

   Our no-typed-text rule is the safe end.
5. **Everyone refunds technical failures; nobody handles quality failures.** "Charged for a bad result" is the standing complaint. Fixing one shot exists only in pro video tools (LTX Retake [U], Google Flow's Scenebuilder). I found no restorable archive of a removed shot anywhere.

## Ratings that steer

- **Midjourney**
  - **Profiles:** built from pairwise "rank" picks. 40 to start, "fairly stable by 200". Several named profiles can be set as default. Moodboards are made from images the user adds (2024-12-16 [P] https://updates.midjourney.com/profiles-and-moodboards/).
  - **V7:** personalization is on by default and can be toggled off. Draft mode is half the cost at 10× speed (2025-04-04 [P] https://updates.midjourney.com/v7-alpha/).
  - **Pooled, separately:** the V7 and V8 rating parties ask users to pick the "more beautiful" of two to train the model (2025-03-30, 2026-02-14 [P] https://updates.midjourney.com/v7-rating-party, https://updates.midjourney.com/v8-rating-party).
- **ChatGPT:** thumbs, and sometimes "which do you prefer" side-by-sides. Feedback "may be used to train our models", even after opting out [P] https://help.openai.com/en/articles/5722486.
- **Character.AI:** 1–4 stars and swipes. "Everyone's feedback will improve the system, but feedback on a particular character will begin to shape that character": pooled, and shared per character [P] https://book.character.ai/character-guide/training-a-character.
- **Replika:** votes and reactions, and "your AI learns and adapts". Personal, chat only [P] https://help.replika.com/hc/en-us/articles/115001095972.
- **Kindroid:** reactions the AI can see, switched on per chat. Personal, text only (2026-09-23 [P] https://kindroid.ai/v2/docs/update-log/).
- **Leonardo**
  - **Flow State:** steers by picking ("More Like This") plus style types (Vibe, Lighting, Shot Type, Color Theme). No like or dislike (2026-02-18 [P] https://intercom.help/leonardo-ai/en/articles/10002805-flow-state).
  - **Per-image feedback:** a "what was wrong" form that a reviewer says "gives nothing in return" [U].
- **Adult products:** none documents image ratings that steer: Candy, OurDream, Nomi, SpicyChat, Promptchan, SoulGen and DreamGF all lack them. Nomi steers only through prompts, anchors and a fidelity slider.

## The face

- **Nomi** is the nearest thing to "Use this face".
  - "Any solo image can be a reference image": tap "Turn Image into Anchor".
  - An **Anchor Fidelity** slider sets the strength: 100–140% is typical, and above 150% risks "image burning".
  - No uploads (2026-04 [P] https://nomi.ai/nomi-knowledge/guide-customizing-appearance-with-the-v5-ai-image-system/).
- **Kindroid:** the avatar is the anchor, and the "Vignette" selfie model "keeps faces more consistent" (2026-10-12 [P]).
- **SpicyChat:** a LoRA "trained on only one picture", scale 0.8 by default [P] https://docs.spicychat.ai/product-guides/premium-features/conversation-images.md.
- **Uploads:**
  - **OurDream** allows none, "due to possible deepfakes and other legal problems" [P] https://help.ourdream.ai/en/articles/11104449.
  - **SoulGen** invites lookalike uploads [P] https://www.soulgen.ai/.
- **Candy.ai:** "visual consistency" is its "biggest differentiator" per a review, with drift complaints (2026-10-04 [S] https://www.startuphub.ai/ai-news/reviews/2026/candy-ai-review-2026). How it works isn't documented.
- **Kling**
  - **Element Library:** a main image plus 1–3 more, extra views generated from one, a bound voice, kept private (2026-02-05 [P] https://kling.ai/quickstart/klingai-element-library-3-user-guide).
  - **Negative prompts:** its guide recommends listing what must not change (2026-07-28 [P] https://kling.ai/blog/ai-character-consistency-guide).
- **Runway:** up to 3 references per generation, tagged and reused with @ [P] https://help.runwayml.com/hc/en-us/articles/40042718905875-Gen-4-Image-References-Guide.
- **Midjourney Omni Reference:** one image, weight 0–1,000 (about 400 keeps a face). Two characters are "somewhat untested" (2025-05-01 [P] https://updates.midjourney.com/omni-reference-oref/).
- **Leonardo Character Reference:** one image, Low/Mid/High strength [P] https://intercom.help/leonardo-ai/en/articles/8497988-image-guidance.
- **Higgsfield Soul ID:** trained on 20–80 photos of a consenting real person. An invented character is built in its menu builder, then trained on 20+ of the portraits it draws (2026-09 [P]).
- **Sora** (app closed in 2026 [S]):
  - Its cameos were the consent model for likeness: the owner controls who uses a cameo, sees every draft others make with it, and can revoke access.

## Several to pick from

- **Midjourney:** 4 images a job. Video gives 4 five-second clips, each extendable to 21 s (2025-06-18 [S]).
- **Luma:** drafts first, then a full-quality master of the keeper [S].
- **Google ImageFX:** 4 variations, plus "expressive chips" that swap words in the prompt [S].
- **Nomi selfies:** 1, sometimes a free second [P].
- **A light test like ours:** nobody documents one. The nearest are Leonardo's user-set "Lighting" and Midjourney's pairwise picks.

## Looks before the first picture

- **Candy.ai:** ethnicity, age, eyes, hairstyle and colour, body, personality, voice and hobbies, then outfits, backgrounds and poses for pictures [P] https://candy.ai/.
- **Higgsfield AI Influencer:** "Every attribute is configured from menus… no prompt writing required": skin colour, skin conditions, age, and Face, Body and Style tabs. Typed text appears only as a paid "Edit" (2026-09-01 [P]).
- **Typed text:** Nomi's appearance traits are typed, and SpicyChat, Promptchan and SoulGen take typed prompts.
- **Where we stand:** our detail chips are at or beyond Candy and Higgsfield. Higgsfield adds face parts and height or proportions.

## Failed shots

- **Technical failures are refunded:**
  - Kling: "If the generation fails, the corresponding Credits will be refunded" [P] https://kling.ai/docs/point-policy.
  - OurDream refunds automatically [P].
  - Nomi refunds too.
  - Higgsfield refunds technical failures, with complaints about paying for low-quality results [S].
- **Fixing one shot:**
  - Google Flow's Scenebuilder arranges and trims, and Extend continues a clip (2025-10 [S]).
  - LTX's "Retake" reshapes a moment inside a shot [U], and characters are @-tagged across a storyboard [P].
- **Removing:**
  - OurDream bulk-deletes [P].
  - Midjourney "Hide" puts an image in Archive, where it can be unhidden [U].
- **Nobody has** a removed shot that keeps its place and can be put back.

## Side by side

"–" means not documented.

| | Ratings steer the next one | Personal or pooled | Face kept | Several to pick | Fixed-choice looks | Failed outputs |
|---|---|---|---|---|---|---|
| **After Dark** | 👍/👎 + fixed chips → fixed words | Personal | Picked face, then fallbacks | Draw three, one per light | Tiles + chips, nothing typed | Restorable Archive; refunds on refusals |
| Candy.ai | – | – | Strong per reviews | – | Tiles | – |
| OurDream | – | – | No uploads | – | – | Auto refund, bulk delete |
| Nomi | Not for images | – | Anchor + fidelity slider | 1, sometimes 2 | Typed traits | Auto refund |
| Kindroid | Reactions (chat) | Personal | Avatar anchor | – | Prompted avatar | – |
| Character.AI | Stars, swipes (chat) | Pooled, per character | – | Swipes | – | – |
| SpicyChat | – | – | One-picture LoRA | – | Typed | – |
| Midjourney | Rankings → profiles | Personal; rating parties pooled | One image + weight | 4 a job, Draft | Moodboards | Hide [U] |
| Leonardo | Picks (Flow State) | Personal | One image + strength | More Like This | Style chips | – |
| ChatGPT | Thumbs, side-by-sides | Pooled | Chat context | Up to 8 [S] | Typed | – |
| Higgsfield | – | – | Soul ID (20+ photos) | – | Menus, no typing | Tech-fail refund |
| Kling | – | – | Main + 3 views + voice | – | – | Tech-fail refund |
| Runway | – | – | Up to 3 tagged refs | – | – | – |
| Google Flow | – | – | Several refs | ImageFX 4 | Expressive chips | Scenebuilder, Extend |

## What it means for After Dark

Ranked by impact against cost. **S**, **M** = effort. M items draw extra pictures, so a live test's spend is David's OK.

1. **Never start a video from a picture the viewer 👎'd (S). Done (2026-10-24).** `beatPictureFor` (lib/adult/beats.ts, #763) started a night's shot from the latest beat picture without looking at ratings. A shot is about $0.65 on Venice; a fresh keyframe is about $0.04.
2. **Show the steering, let the viewer reset it, and say it never trains (S). Done (2026-10-24).**
   - What others show: Midjourney names and toggles profiles, and Nomi shows the anchor and fidelity.
   - Our version: a line per character ("Avoiding: odd poses, blur"), a reset, and "Your ratings only change your pictures. They never train a model." That last line is a real difference from OpenAI and Character.AI.
3. **"Doesn't look like them" should tighten the face, not only add words (S–M).** Every leader has a strength control. Map the tag to a stronger face reference where the provider takes one, capped. We haven't checked which of fal, Venice and Replicate expose one.
4. **Count "Draw three" in the light test (S). Done (2026-10-24).** Picking one of three lights is a ranking, the way Midjourney learns. The two not picked count half a loss each.
5. **A face set, not one face (M).** After "Use this face", draw a three-quarter and a full-length view in fixed framing, checked, kept per viewer. That's 2 pictures from the cap.
6. **"Three more like this", as drafts (M).** Close variations of a picked face in the same framing. Drafts at lower resolution if Venice charges less.
7. **"Redo this shot" from the Archive (M).**
   - What it does: the same line again, with a fresh steered keyframe and that shot's 👎 tags as negative words, put in the archived shot's place.
   - A free redo for shots tagged extra limbs, morphing or wrong person would stand out, since everyone else refunds only technical failures. That's David's pricing call.
8. **Don't copy.**
   - Face uploads: OurDream and Nomi ban them for deepfake reasons.
   - A typed "tweak" box: it breaks the no-typed-text rule.
   - A pooled rating program: the privacy page rules it out.
   - Also keep tags as fixed codes. Muah's 2024 breach exposed 1.9M emails along with prompts (https://haveibeenpwned.com/breach/Muah).
