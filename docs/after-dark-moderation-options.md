# Getting past Hive's daily cap: options, in-house, and what to ask

Research date: 2026-10-24. David asked: "is there alternatives that don't have a limit on them? So we don't get blocked
all the time? Can we bring Hive in house? Can we build what they do?" The context is in docs/after-dark.md: "Hive's
daily limit" and "Hive's circuit breaker". Vendor facts come from their own pages on that date. Anything not confirmed
is marked unverified. Legal points are questions for David and counsel, not conclusions.

## The short answer

**Why everything stops.** Hive's self-serve plan caps Visual Moderation at 100 requests a day. The pricing page marks
the higher-limit versions "Contact Sales". Hive's FAQ says sustained volume moves you to "an Enterprise plan and
project with custom rate limits and pricing". The vision-language model (VLM), which asks our age question, isn't on
the 100-a-day list (to confirm with one call while capped).

**Don't open extra accounts.** Hive's terms (revised 2026-09-15) ban creating multiple accounts by script (§3.4(g)), keep
credits in "a single Hive Credit account" (§4.1), and let Hive set usage limits (§3.6). Credits aren't refundable, so a
ban would also lose the $111 prepaid. Sightengine's terms ban getting around capacity limits too (§4.5(l)).

**The quickest unblock (days, no new spend):**
1. **Stop the PG show spending the same 100.** Place sets, look tiles and portraits, and season portraits all call Visual
   Moderation:
   - `lib/sets.ts` `checkSet`;
   - `lib/looks-draw.ts` `checkOutput(…, "image")`;
   - `lib/season-gen.ts` `checkOutput(…, "image")`.

   On 2026-10-21, 48 of 57 failed sets were Hive 429s (`lib/sets.ts`). Moving these PG checks to VLM label questions
   ("anyone visible?", "explicit?", "everyone an adult?") would leave all 100 for After Dark, at $0.001 a check
   instead of $0.003. It changes a safety check, so it's David's call. We'd build it.
2. **Pause until the daily reset on a cap 429,** instead of probing every 5 to 60 minutes. We don't know when Hive's
   day resets: midnight UTC, 24 hours after the first call, or rolling (docs/after-dark.md). Ask Hive.
3. **Email Hive Sales.** It's the only approved way to raise the cap. Done: see "Hive Sales answered" below.

**The best medium-term setup:**
- **Hive Enterprise,** which brings higher limits plus two things already on the launch checklist: Hive's CSAM
  classifier (built with Thorn) and face-age "Demographics".
- **Plus one age check that isn't Hive's:** our own MiVOLO v2 age model on a $24–48/mo DigitalOcean droplet, or
  Sightengine's `face-age`.
- **The rule:** any refusal blocks, and a pass needs at least two independent sources to have run and passed. So a Hive
  cap or outage no longer stops everything, and in normal running there are three signals instead of two.

**In-house: as a replacement for Hive, no. As a second opinion and auditor, yes.**
- We can't lawfully obtain the data to build or test a CSAM classifier.
- Open age models misjudge many minors near 18.
- Hive's terms (§3.2) ban using its outputs to build a competing model.

## Hive Sales answered (2026-10-30)

- **Visual Moderation beyond the 100 a day:** $1,500 a month minimum on a 12-month commitment, so $18,000 a year. Usage counts toward the minimum at $3 per 1,000 frames.
- **The vision-language model:** pay as you go, at $0.50 per million input tokens and $2.50 per million output tokens. Hive says it "should be able to accommodate your volume as you scale".
- **Our reply** (sent 2026-10-30): we decline the commitment while we're pre-launch and stay on the Playground for Visual Moderation. We asked whether the VLM has a self-serve cap and when the 100-a-day limit resets.
- **What follows:**
  - Move the regular show's picture checks (sets, look tiles, portraits, season portraits) to VLM label questions. That leaves all 100 for After Dark. The PG Studio plan already uses the VLM.
  - Revisit Enterprise once subscriptions bring in about $1,500 a month. It also adds the Thorn CSAM classifier and Demographics.

## The options

| Option | Detects minors / age | Limits | Per image | Adult-content terms | Effort |
|---|---|---|---|---|---|
| Hive self-serve (today) | `yes_child_present` class; VLM age question | 100 moderation/day; VLM not on the cap list | $0.003 + ~$0.001 | Moderation is built for NSFW. VLM: labels only (§1.5, §3.2). Labeling Addendum §2.3 bars "sexually explicit" content without written consent, and AI Addendum §5.1 pulls that addendum in, so get a written OK | In place |
| Hive Enterprise | Adds Demographics (face age), Thorn CSAM classifier, 57M+ known hashes, NCMEC reporting in its dashboard | Custom | Quote | As above | A contract |
| Sightengine (France) | `face-age` gives a "minor" probability. Needs a visible face; returns nothing for "obvious AI-generated faces" and 3D renders | Free 500/day at 1/s; $29 10k/mo; $99 40k/mo; then $0.002 | ~$0.0025 | Adult content not addressed; bans getting around limits and training on outputs | ~1 day |
| WebPurify AIM | "Minors" class; human review $0.02 | Unverified | $0.0026 | Unverified (site blocked) | ~1 day |
| AWS Rekognition / Bedrock | `DetectFaces` AgeRange; moderation has no minors label | Per-second quotas | $0.001 | — | **David ruled out Amazon (2026-10-18)** |
| Azure Content Safety / Google SafeSearch / OpenAI moderation | **No age detection.** Azure says it can't detect child-exploitation images; OpenAI's `sexual/minors` is text-only | High | ≤ $0.0015 | Fine | PG only |
| Thorn Safer, Google Content Safety API, PhotoDNA, Arachnid Shield | CSAM classifiers (Safer, Google), or known hashes only (PhotoDNA, Arachnid), which new images won't match | Vetted access | Quote / free if approved | Built for it | Vetting |
| **In-house MiVOLO v2 (CPU)** | Age from face and/or body | Ours | $24–48/mo flat | DigitalOcean's acceptable use policy (2026-03-20) bans only CSAM, computer-generated CSAM and non-consensual images | 3–5 days |
| In-house Qwen3-VL-8B (GPU) | Age as a question | Ours | ~$555/mo flat | DigitalOcean OK; Replicate OK with conditions | 1–2 weeks |

**Open models**, for in-house use:

| Model | What it detects | Evidence | Licence |
|---|---|---|---|
| **MiVOLO v2** | Age from face and/or body | Best non-VLM model in a Feb 2026 benchmark (mean error 5.1 years) | Apache-2.0. Its YOLO detector is AGPL, so use MediaPipe (Apache-2.0) |
| Qwen3-VL 2B–8B | Age, asked as a question | VLMs led the same benchmark | Apache-2.0 |
| Llama Guard 4 (12B) | Policy labels on images, including S4 child exploitation | Meta's own image test: recall 41%, false positives 9% | Llama 4 Community |
| ShieldGemma 2 (4B) | Sexual, dangerous, violent. **No minors policy** | — | Gemma terms |
| NudeNet | Body parts, no age | — | **AGPL-3.0** |
| InsightFace | Face analysis incl. age | — | Models are **non-commercial only** |

**The accuracy caveat drives everything.**
- In Ren et al. (Feb 2026, https://arxiv.org/abs/2602.07815), specialist age models called 39–100% of minors adults
  with 18 as the cutoff; VLMs called 16–29%.
- No single model is enough. The bar has to sit well above 18, several independent signals must agree, and the
  controls before generation do most of the work.
- How these models behave on our photoreal generations is unverified: they were trained on real faces.

## Monthly cost

A check is one picture or one sampled video frame. List prices, 30-day month.

| Setup | 100/day | 1,000/day | 10,000/day |
|---|---|---|---|
| Hive, both calls | ~$12 (at the cap) | ~$120 | ~$1,200 |
| Hive VLM only | $3 | $30 | $300 |
| Sightengine `face-age` | $29 | $99 | ~$620 |
| MiVOLO on DigitalOcean droplet(s) | $24–48 | $48 | $96–192 |
| Qwen3-VL-8B on a DigitalOcean GPU, 24/7 | ~$555 | ~$555 | ~$555 |
| **Recommended: Hive + MiVOLO** | **~$40–60** | **~$170** | **~$1,300–1,400** (+ the CSAM and Demographics quote) |

- **A GPU VLM** only beats Hive's VLM price above about 18,000 checks a day.
- **Replicate** private deployments bill idle time, and scaling to zero means cold starts.
- **David's Mac** is fine for evaluation, not for production.

## Can we build what Hive does?

**The plumbing, yes. The detector for the worst case, no.**

**What Hive has that we can't build:**
- **Labelled data:** 80M+ human labels (self-reported).
- **Thorn's CSAM classifier:** trained partly on NCMEC data that nobody else can lawfully assemble.
- **Hashes:** 57M+ known ones.
- **NCMEC:** a reporting workflow (the customer still files with its own NCMEC credentials).
- **Retraining:** constant, as image generators change.

**What we can build:**
- the fail-closed gate;
- logs and counters;
- a second age opinion (MiVOLO, Qwen3-VL);
- an admin audit queue.

**What we can't build:**
- a validated CSAM classifier;
- hash matching;
- an honest measure of how many real cases we'd catch.

We must never create or obtain such material to test with. We can only measure wrong refusals on our own adult outputs,
and age accuracy on licensed, non-sexual face sets (FairFace, CC BY 4.0).

**The one real "Hive in house":** Hive announced private deployment through NVIDIA NIM in 2024, for AI-content
detection, with moderation "planned". Ask Sales.

**How established platforms layer their checks:**
- **Runway** (May 2026): hash matching on uploads, a CSAM classifier for new material, classifiers on generation,
  human review of flags, NCMEC reports (516 in 2025), bans, and C2PA labels.
- **OpenAI's developer guidance** says the same: dedicated CSAM tools, a human-review playbook, NCMEC registration,
  evidence kept.

## Recommended setup

```
Prevention (built): adult-only characters, checkAdultText hard lines, excluded themes, negative prompts,
  every shot from an already-checked adult baseline, no photo uploads.
        │
Automated gate (fails closed). Each source answers pass / refuse / couldn't run:
  A  Hive Visual Moderation child class                  Hive
  B  Hive VLM, labels only (anything but ADULTS refuses) Hive
  C  our MiVOLO v2: refuses if anyone reads under the bar, or if no person is found   ours (droplet)
  D  later: Hive's CSAM classifier (Thorn)               Hive Enterprise
  Rule: any refusal blocks. A pass needs at least 2 sources from 2 vendors (B + C while A is capped).
  Fewer than two can run → wait (today's circuit breaker).
        │
Refused → never shown; discard or quarantine and report as counsel advises; counters; switch-off after repeats.
Passed  → shown; the admin audits a random 1–2%.
```

**Next steps:**

| # | Step | Who |
|---|---|---|
| 1 | Move the PG checks to VLM labels, keep a local "N of 100 used" counter, and pause until the reset on a cap 429 | We build it; David OKs the safety-check change |
| 2 | Confirm the VLM isn't capped: one $0.001 call while the cap is in force | We can |
| 3 | Build MiVOLO v2 + MediaPipe and a test harness on the Mac. Measure wrong refusals on our adult outputs and age accuracy on FairFace | We can, $0 |
| 4 | Run it on a DigitalOcean droplet as source C, with the two-source rule | David approves ~$24–48/mo |
| 5 | Try Sightengine `face-age` on ~200 of our outputs on its free tier: does it skip our faces as "artificial"? | David signs up, $0 |
| 6 | Email Hive Sales | We draft; David sends |
| 7 | Policy: the age bar, whether B + C may pass while A is capped, and whether the VLM alone is OK for admin testing | David |
| 8 | Hive Enterprise with CSAM and Demographics, before the first subscriber | David approves the money |
| 9 | NCMEC registration, quarantine and preservation, who may view flags, TAKE IT DOWN process | David and counsel |

For step 7, we'd suggest refusing anyone who reads under 25, with characters designed to read 25+. For step 1, the
counter is our own estimate: Hive sends no remaining-count headers.

## Questions for Hive Sales

1. What raises our cap of 100 Visual Moderation requests a day: Enterprise, or a self-serve tier with higher limits? Is
   there a minimum commitment? Do our ~$111 of prepaid credits carry over?
2. A quote at 3,000, 30,000 and 300,000 images a month for Visual Moderation, the VLM, Demographics and CSAM
   Detection. How does video count: per sampled frame or per request?
3. How soon can the limit rise, and can it rise while a contract is being signed?
4. Does the VLM have its own limits? When does the daily cap reset? Could 429s carry Retry-After or reset headers?
5. Written confirmation that legal, AI-generated explicit images of fictional adults may be sent to Visual Moderation,
   the VLM (labels only) and CSAM Detection, given AI Service Addendum §5.1 and Labeling Addendum §§1.3 and 2.3.
6. Can human review by Hive Workers be switched off in writing? What is retained, for how long, and is any of it used
   for training?
7. CSAM Detection: who's eligible and how are customers vetted? Must we hold our own NCMEC credentials? What does Hive
   do itself if it sees apparent CSAM in what we send?
8. Is a private (NVIDIA NIM) deployment of moderation or age models available?
9. Enterprise uptime and burst limits. Any data on `yes_child_present` and Demographics on photoreal AI-generated
   images?

## Questions for counsel

1. Does 18 U.S.C. 2258A apply to content our system generates? Is an automated flag (a Hive child score, a VLM "MINOR",
   our own age model) "actual knowledge"? Which signals should trigger a report?
2. If it applies: is "discard, never store" lawful, or must flagged items be quarantined and kept (the REPORT Act, 2024)?
   Who may view them, and should a person look before reporting (*United States v. Wilson*, 9th Cir. 2021)?
3. Is a layered, fail-closed check with a 25+ bar a defensible standard of care for images that "appear to" show
   minors (18 U.S.C. 2256(8)(B), §1466A, state AI-CSAM laws)?
4. Sending borderline images to vendors in the US (Hive) and France (Sightengine): any possession, distribution or
   cross-border issue? Which data processing agreements?
5. The TAKE IT DOWN Act (enforced since 2026-05-19): are we a covered platform needing its 48-hour removal process?
6. How much risk in carrying on before Hive's written consent under Labeling Addendum §2.3?
7. AGPL models (NudeNet, YOLO detectors) on our servers: avoid, or acceptable?

## Sources

**Hive**
- Pricing: https://thehive.ai/pricing
- FAQ (updated 2025-11-13): https://docs.thehive.ai/docs/frequently-asked-questions-faq
- Terms (2026-09-15): https://thehive.ai/terms-of-use
- CSAM detection: https://customer-prod.thehive.ai/apis/csam-detection
- NCMEC in the dashboard: https://thehive.ai/blog/streamline-csam-reports-with-moderation-dashboards-ncmec-integration
- NVIDIA NIM: https://blocksandfiles.com/2024/09/26/nvidia-and-hive-alliance-tackles-the-problem-of-rogue-ai-content/

**Sightengine**
- Pricing: https://sightengine.com/pricing
- Face-age and minor detection: https://sightengine.com/docs/face-age-minor-detection
- Terms: https://sightengine.com/terms

**AWS**
- Moderation API: https://docs.aws.amazon.com/rekognition/latest/dg/moderation-api.html
- AgeRange: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_AgeRange.html

**Azure, Google and OpenAI**
- Azure Content Safety overview: https://learn.microsoft.com/en-us/azure/ai-services/content-safety/overview
- Google Vision pricing: https://cloud.google.com/vision/pricing
- OpenAI moderation guide: https://developers.openai.com/api/docs/guides/moderation
- OpenAI CSAM guidance: https://developers.openai.com/api/docs/guides/csam-guidance.md

**CSAM-specific tools**
- Thorn Safer Predict: https://www.thorn.org/press-releases/thorn-launches-safer-predict-a-proactive-ai-detection-solution-to-scale-child-safety-on-content-hosting-platforms/
- Project Arachnid: https://projectarachnid.ca/

**Open models**
- MiVOLO v2: https://huggingface.co/iitolstykh/mivolo_v2 and https://github.com/WildChlamydia/MiVOLO
- Qwen3-VL-8B: https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct
- Llama Guard 4: https://huggingface.co/meta-llama/Llama-Guard-4-12B
- ShieldGemma 2: https://huggingface.co/google/shieldgemma-2-4b-it
- NudeNet: https://github.com/notAI-tech/NudeNet
- InsightFace: https://github.com/deepinsight/insightface
- FairFace: https://github.com/joojs/fairface

**Age-estimation accuracy**
- Ren et al., Feb 2026: https://arxiv.org/abs/2602.07815
- Jun 2025 benchmarks: https://arxiv.org/abs/2506.10117 and https://arxiv.org/abs/2506.10689

**Hosting**
- Replicate pricing: https://replicate.com/pricing
- Replicate acceptable use: https://replicate.com/acceptable-use-policy
- DigitalOcean GPU droplets: https://www.digitalocean.com/pricing/gpu-droplets
- DigitalOcean acceptable use: https://www.digitalocean.com/legal/acceptable-use-policy

**Law and practice**
- REPORT Act: https://www.govinfo.gov/content/pkg/BILLS-118s474enr/html/BILLS-118s474enr.htm
- TAKE IT DOWN enforcement: https://www.ftc.gov/news-events/news/press-releases/2026/05/ftc-begins-enforcing-take-it-down-act
- Runway's approach: https://runway.com/news/safety/our-approach-to-child-safety
