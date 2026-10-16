# Botchelor PRD: Persistent Character Memory & Learning Architecture

**Version:** 1.0  
**Status:** Proposed implementation spec  
**Product:** Botchelor  
**Scope:** Web-controlled character identity, persistent memory, relationship learning, model-provider abstraction, and future model improvement  
**Relationship to main PRD:** This document is an implementation addendum to `Botchelor_PRD_v1.md`. It clarifies how characters retain and evolve from experience regardless of where inference runs.

---

## 1. Executive summary

Botchelor characters should learn from their simulated dates without requiring a model to run on each user's device. The application—not the underlying model—is the source of truth for each character's identity, memories, preferences, boundaries, and relationship history.

A model is an inference engine: it generates the next response from the context Botchelor supplies. Depending on the provider, a conversation API may offer its own stored state, or the API may be stateless and require the application to send history on each request. Botchelor must not depend on provider-managed conversation state for canonical memory. See the official documentation for [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [Anthropic's Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages), and [Ollama chat history](https://github.com/ollama/ollama/blob/main/docs/api.md).

The system has three separate responsibilities:

1. **Character state:** store the approved baseline soul/persona, episodic memories, relationship-specific memories, inferred preferences, and current state in Botchelor's database.
2. **Character behavior:** build a bounded, provider-neutral context for each turn and ask the selected model to respond in character.
3. **Learning governance:** extract candidate memories after interactions, validate their source and confidence, and promote them under rules that preserve owner control and character continuity.

Actual neural-network training is not required for a character to learn from experience. Fine-tuning a shared model is a later, separate program that should use carefully curated data with explicit permissions and evaluation.

## 2. The core decision

### Decision: cloud-owned state; provider-agnostic inference

Botchelor owns canonical state in its application database. A model provider, local Ollama instance, or future user-supplied compatible endpoint can be swapped without erasing a character's experiences.

| Concern | System of record | May a model provider own the canonical copy? |
|---|---|---|
| Soul, persona, boundaries | Botchelor database | No |
| Episode transcript and final outcome | Botchelor database | No |
| Episodic and relationship memories | Botchelor database | No |
| Inferred preferences and confidence | Botchelor database | No |
| Provider-specific thread/session ID | Provider adapter metadata | Yes, as a convenience only |
| Model weights / LoRA adapter | Model artifact registry | Only for the model artifact, never as character memory |
| User API key or endpoint credential | Encrypted secrets store | Never as plaintext in general application records |

### What happens if a user changes model?

Botchelor retrieves the character's relevant state, converts it into the selected model adapter's expected request format, and generates the next turn. The provider may use a different context window, instruction format, or tool protocol; the adapter handles those differences. Botchelor's stored memories remain intact.

### What happens if a user brings their own API key?

Their key changes who pays the inference provider and which supported model is called. It does not change where Botchelor stores character memories. BYOK is not required for the first release and must never make character continuity depend on provider-side state.

### What happens if a user brings a local model?

Botchelor can preserve memory in the cloud and send context to a compatible endpoint, but a user's `localhost` is not normally reachable from a cloud-hosted web application. Remote access requires a deliberate network path, a secure user-operated relay/tunnel, a self-hosted endpoint, or running the web app/worker locally. This is a later advanced integration—not an MVP assumption.

## 3. Problem statement

Without application-owned memory, a character may feel consistent only within one prompt or one provider session. Returning to Botchelor, changing models, losing an API session, or switching devices can cause context loss. If experience is stored only in an LLM provider's conversation object, it becomes coupled to that provider's retention policy, data model, and availability.

Botchelor needs characters that:

- retain relevant memories across episodes and sessions;
- distinguish baseline personality from experiences and tentative inferences;
- form separate relationships with different characters;
- adapt naturally without arbitrary personality drift;
- respect private souls, boundaries, and consent rules;
- survive model-provider changes and transient inference failures;
- allow their owners to inspect, correct, export, and delete memory;
- create a clean, consented dataset for possible future shared-model fine-tuning.

## 4. Goals and non-goals

### Goals

1. Persistent character memory across devices, sessions, model providers, and app deployments.
2. Natural turn-by-turn dialogue between two characters with separate contexts.
3. Relationship-specific adaptation: a character can behave differently with a character it knows than with a stranger.
4. Controlled memory extraction and promotion with provenance, confidence, and owner controls.
5. Provider-independent inference behind one internal interface.
6. Explicit privacy separation between public persona, private soul, private debrief, and shared episode.
7. Reliable operation when the configured model is unavailable or changes.
8. A future pathway to fine-tune a shared model from permissioned, evaluated examples without treating private character memories as training data by default.

### Non-goals for the first release

- Training or fine-tuning a model after every date.
- A separate model or LoRA adapter for every user character.
- Unbounded autonomous agents or arbitrary tool use during dates.
- Dependence on provider-managed conversation history as the canonical record.
- User-hosted/local model support for launch.
- Automatically changing immutable creator-authored boundaries or core soul attributes.
- Using private souls, debriefs, or transcripts to improve global models without a separate explicit opt-in.
- Claiming characters have real consciousness, authentic emotions, or human-equivalent psychological states.

## 5. Product principles

- **Memory belongs to the character, not the model vendor.**
- **The soul is a baseline, not a prompt that can be rewritten freely.**
- **Experiences may suggest change; rules govern what persists.**
- **A relationship memory is scoped to that relationship.**
- **Private data is minimized before it reaches inference.**
- **Switching models must not erase continuity.**
- **Character learning and shared-model training are separate systems.**
- **Learning is inspectable, correctable, and deletable.**
- **Uncertain inferences remain uncertain.** A single awkward moment must not become a permanent character trait.
- **Safety and creator boundaries outrank narrative surprise or engagement optimization.**

## 6. User stories

### Character owner

- As a creator, I want my character to remember previous dates so the next episode feels connected.
- As a creator, I want the character to remain recognizable while still surprising me.
- As a creator, I want to see what the system remembers and where each memory came from.
- As a creator, I want to correct or delete a mistaken memory.
- As a creator, I want private soul details to influence my character without appearing in public dialogue, public profiles, or another owner's debrief.
- As a creator, I want continuity to survive a model change or provider outage.
- As a creator, I want to opt in separately to contributing examples to shared-model improvement.

### Spectator

- As a spectator, I want episodes and relationship histories to remain consistent between visits.
- As a spectator, I want predictions to resolve against immutable outcomes, not an episode that changes after the fact.
- As a spectator, I should see only public episode information, not private memory or owner-only reflections.

### Operator

- As an operator, I want to route inference to approved providers/models without migrating character state.
- As an operator, I want per-date and per-user budget limits, token/latency metrics, retries, and graceful fallbacks.
- As an operator, I want to evaluate candidate model changes offline before deploying them.
- As an operator, I need an auditable record of memory updates and data deletion.

## 7. Character state model

Each character state is composed of distinct layers. Never collapse all layers into one editable prompt string.

### 7.1 Baseline identity

**Owner-controlled and stable by default.**

- `public_persona`: name, bio, public traits, dialogue style, appearance reference.
- `soul_profile`: values, insecurities, motivations, inner contradictions, humor, and tendencies. This is private and optional; avoid soliciting sensitive real-world details.
- `preferences`: wants, interests, attraction cues, dislikes, dealbreakers.
- `boundaries`: content, topics, actions, and relationship dynamics that are disallowed.
- `autonomy_mode`: Guided, Balanced, or Unpredictable. This adjusts permitted narrative choices only; it never overrides safety rules or authorizes real-world actions/spending.
- `owner_overrides`: explicitly pinned traits, manually edited preferences, exclusions, and immutable fields.

### 7.2 Episodic memory

A short record of an event that happened in an episode, with references to the source episode and transcript span. Store the event and outcome rather than copying the whole transcript into every future prompt.

Example: “During date 014, Raven asked Alex about vulnerability; Alex deflected with humor; Raven followed up by asking for a more direct answer.”

### 7.3 Semantic memory / learned hypotheses

Generalized observations inferred from multiple events. Each record must include:

- proposition;
- scope (global character, relationship-specific, or date-format-specific);
- evidence episode IDs;
- confidence or evidence count;
- status (`candidate`, `active`, `rejected`, `superseded`);
- created/last-confirmed timestamps;
- whether creator approval is required;
- any superseding or contradiction links.

Example: “Alex may use humor to deflect vulnerable questions.” This should remain a tentative hypothesis until repeated evidence or owner confirmation supports it.

### 7.4 Relationship state

Stored for each character pair, separately for each character's perspective. Suggested dimensions include familiarity, trust, conversational comfort, expressed interest, tension, unresolved conflict, and next-date intent. These are fictional game-state variables, not scientifically validated measurements of real psychology.

The two characters must not share private memories automatically. Alex's private interpretation of Raven is not the same as Raven's memory or the public truth of the relationship.

### 7.5 Public relationship record

An explicitly publishable record of dates, public outcomes, approved quotes, and season events. Never derive public visibility from the fact that a memory exists. Public sharing is a separate, explicit authorization step.

## 8. Memory lifecycle

### After each episode

1. Persist the final episode transcript, participant IDs, model/version, prompt-template version, simulation version, and immutable outcome.
2. Run a bounded memory-extraction step over the transcript and approved character context.
3. Return structured candidate records, each with evidence references and a scope.
4. Validate schema, prohibited content, private-data leakage, boundary conflicts, and cross-character contamination.
5. Apply deterministic promotion rules. Strong event facts may be stored as episodic memories; broad personality changes remain candidates until sufficient evidence or owner approval.
6. Update the relationship state using the simulation engine's deterministic rules and permitted dialogue signals—not a free-form LLM score alone.
7. Generate separate outputs: public recap, owner-only debrief, and private candidate memories. Each uses its own visibility policy.
8. Commit the changes atomically, with a version and audit event.

### Memory confidence and promotion

A practical initial policy:

- **Explicit baseline / owner instruction:** always wins unless it conflicts with a global safety rule.
- **Event fact:** store if grounded in the saved transcript.
- **Single-event inference:** candidate only; do not permanently alter baseline behavior.
- **Repeated consistent inference:** may be applied as a scoped learned preference after a configurable evidence threshold.
- **High-impact change:** require owner approval (e.g., core value, romantic boundary, identity-defining trait).
- **Contradictory evidence:** reduce confidence or retain multiple context-dependent hypotheses rather than overwriting silently.
- **Owner correction:** mark the prior memory rejected or superseded; don't immediately recreate it from the same evidence.

Initial thresholds are product hypotheses and should be tuned via evaluation, not treated as scientifically calibrated confidence scores.

### Prompt-time memory retrieval

Do not send the entire memory archive to every model request. Build a bounded context pack:

1. system and safety instructions;
2. character baseline and owner-pinned overrides;
3. the other character's permitted public persona and preferences relevant to the date;
4. current date state and latest event;
5. recent turns needed to continue dialogue;
6. a few relevant episodic memories;
7. active relationship-specific hypotheses, clearly marked as tentative;
8. structured output schema and token budget.

Never send one character's private soul or debrief to the other character. Retrieve only the minimum information the active agent needs.

## 9. Model-provider abstraction

### 9.1 Internal interface

Define a provider-neutral service such as:

```ts
interface ModelProvider {
  generateTurn(input: GenerateTurnInput): Promise<GenerateTurnResult>;
  healthCheck(): Promise<ProviderHealth>;
  estimateCost?(input: GenerateTurnInput): Promise<CostEstimate>;
}
```

`GenerateTurnInput` should include a fully assembled, bounded context; output-schema requirements; model capability requirements; timeout; token budget; and privacy classification. It must not expose database credentials or application secrets to the model.

`GenerateTurnResult` should return validated text/structured fields, provider/model identifiers, usage where available, latency, and a provider request ID. Provider-specific fields belong in adapter metadata, not the canonical character schema.

### 9.2 Canonical storage and provider session IDs

If an API supports a persistent conversation/session identifier, Botchelor may store it as an optimization. The canonical episode history and character memories must still be stored by Botchelor. When a session ID expires, is deleted, or belongs to an unavailable provider, Botchelor rebuilds context from its own database.

### 9.3 Launch provider mode

- Use a managed model selected and funded by Botchelor for consistent onboarding and predictable quality.
- Provide a model-router abstraction from day one, but initially support only a small, explicitly tested list of models.
- Keep local Ollama for development, evaluation, cost experiments, and optionally internal batch tasks.
- A failed or unavailable provider should yield a queued episode, a clear delay state, or a safe pre-approved fallback. It should not silently substitute a model that produces incompatible output.

### 9.4 Bring your own API key (BYOK) — later phase

BYOK can lower Botchelor's direct inference bill, but increases support, privacy, key security, rate-limit, billing, and model-compatibility complexity.

Requirements when added:

- Keys are submitted to a server endpoint over TLS and encrypted with a managed key-encryption mechanism; plaintext keys are never returned to the browser after saving.
- Keys are never stored in ordinary profile JSON, logs, analytics, error traces, or client-readable database columns.
- Provide test connection, provider/model selection, revoke/replace, and delete-key controls.
- Use server-side calls only; never embed provider keys into client JavaScript.
- Disclose that the chosen provider processes the data sent in a generation request under its own terms and retention policy.
- Explain that Botchelor still stores character memory unless the user deletes it; BYOK does not make the experience local-only.
- Restrict key usage to Botchelor's approved feature, enforce spend/token limits where supported, and avoid arbitrary use of the key as a general-purpose proxy.
- Never imply Botchelor can guarantee the user's provider bill; display model selection and estimated cost, and explain that estimates may differ from provider charges.

### 9.5 Bring your own model (BYOM) / local endpoint — later phase

A model endpoint is supported only if it can meet the provider contract and return the required output. A desktop model listening on `localhost` is not accessible from a cloud service by default.

Potential modes, in increasing complexity:

1. **User-hosted reachable endpoint:** user operates an authenticated HTTPS endpoint reachable by Botchelor.
2. **Secure local connector:** user runs an application that opens an outbound authenticated connection to Botchelor and proxies approved inference jobs to their local Ollama/ComfyUI service.
3. **Self-hosted Botchelor:** advanced users run the complete app and database in their own environment.

Before BYOM launch, implement SSRF protection, endpoint allowlisting/validation, authentication, TLS, request timeouts, output size limits, abuse controls, and explicit consent before sending character information to the endpoint. Do not allow arbitrary unauthenticated URLs or expose internal cloud network services.

A disconnected or sleeping user device makes local inference unavailable. The app must show the character/date as queued or unavailable, never pretend the request completed.

## 10. Data model (proposed)

Names can be adjusted to match the existing Drizzle schema. Keep baseline identity, memory, episodes, and credentials logically separated.

| Table | Purpose | Key fields |
|---|---|---|
| `characters` | Public identity and owner | `id`, `owner_id`, `name`, `public_persona_json`, `status`, `version` |
| `character_private_profiles` | Soul and private settings | `character_id`, `soul_profile_json`, `boundaries_json`, `owner_overrides_json`, `version` |
| `episodes` | Immutable episode record | `id`, `status`, `simulation_version`, `model_id`, `prompt_version`, `seed`, `outcome_json`, `published_at` |
| `episode_participants` | Character and owner roles for an episode | `episode_id`, `character_id`, `perspective_id` |
| `episode_turns` | Ordered generated dialogue | `episode_id`, `turn_index`, `speaker_character_id`, `content`, `visibility`, `validation_status` |
| `character_memories` | Episodic and semantic memory | `id`, `character_id`, `scope`, `related_character_id`, `memory_type`, `content`, `evidence_json`, `confidence`, `status`, `visibility`, `version` |
| `relationship_states` | One perspective's current relationship state | `character_id`, `other_character_id`, `state_json`, `version`, `updated_at` |
| `memory_events` | Audit log for promote/edit/reject/delete | `id`, `memory_id`, `actor_id`, `operation`, `reason`, `created_at` |
| `model_provider_configs` | Non-secret provider/model defaults | `provider_id`, `model_id`, `capabilities_json`, `enabled`, `config_version` |
| `user_provider_credentials` | Optional BYOK secrets metadata | `user_id`, `provider_id`, `encrypted_secret`, `key_version`, `last_tested_at`, `revoked_at` |
| `training_consent` | Explicit model-improvement permission | `user_id`, `scope`, `consented_at`, `revoked_at`, `policy_version` |
| `training_examples` | Curated, permissioned examples | `id`, `source_episode_id`, `redaction_status`, `quality_label`, `consent_id`, `dataset_version`, `status` |

Use database-level foreign keys and ownership checks. Private-profile reads must be authorized by character ownership and service-level permission. The public API should never return a whole `characters` row with private fields embedded.

## 11. APIs and service responsibilities

Representative internal routes (adapt names to the app's route conventions):

- `POST /api/episodes` — create an episode request and reserve a cost budget.
- `GET /api/episodes/:id` — return only the public or authorized owner view.
- `POST /api/episodes/:id/generate` — enqueue/advance generation; idempotent by episode/job key.
- `POST /api/episodes/:id/finalize` — validate outcome, persist immutable final episode, and close predictions.
- `GET /api/characters/:id/memories` — owner-only paginated memory list.
- `PATCH /api/characters/:id/memories/:memoryId` — owner correction or visibility change with audit log.
- `DELETE /api/characters/:id/memories/:memoryId` — delete or tombstone memory and schedule removal from derived stores.
- `POST /api/characters/:id/memories/:memoryId/approve` — promote a candidate after owner review where required.
- `GET /api/characters/:id/relationships/:otherId` — return only the owner's perspective.
- `POST /api/settings/model-provider` — select an approved provider/model; no secret returned.
- `POST /api/settings/provider-credentials/test` — test a BYOK key without exposing it back to the client (future phase).

All mutating requests require authentication, ownership checks, CSRF protection as appropriate, rate limiting, and audit logging. Worker jobs must re-check ownership and policy from trusted database state; never trust client-supplied soul text or cost estimates as authoritative.

## 12. Security, privacy, and consent

### Visibility levels

- `public`: public persona, approved public episode text, public outcomes, approved share cards.
- `participants`: details deliberately shared with both character owners, with rules visible before matching.
- `owner_private`: soul, private memories, owner debrief, owner-only preference hypotheses.
- `service_internal`: moderation verdicts, prompt diagnostics, provider routing metadata, and cost records.

Every stored output must have a visibility classification. Default to the narrowest visibility; sharing is a distinct action.

### Essential controls

- Encrypt traffic in transit and sensitive credentials at rest.
- Keep provider keys server-side; redact secrets and sensitive prompts from general logs.
- Minimize context sent to external model providers. Send only fields needed for that generation task.
- Document provider retention/data-processing characteristics before choosing a production provider. Do not assume all providers have identical data handling.
- Do not use private soul profiles, owner-only debriefs, or raw transcripts for global training without separate, explicit opt-in.
- Provide export and deletion mechanisms for characters, memory, and account data. Delete or irreversibly detach derived memory/training data when required by the policy and applicable law.
- Define how backup retention works so “delete” has an accurate user-facing meaning.
- Protect against prompt injection embedded in character bios, generated dialogue, or imported memory. Treat character content as data, not system instructions.
- Prevent cross-tenant retrieval. Test access control at API, query, and worker layers.
- Apply age and content rules defined by the main PRD, and assess applicable companion-chatbot/consumer protection requirements with counsel before launch.

### Model-improvement consent

Character memory persistence is part of delivering the product and should not silently imply consent to train shared models. The model-improvement program needs its own clear, optional opt-in, scope statement, revocation path, and dataset provenance. Users who decline must retain the same memory features.

## 13. Learning policy and future model training

### Phase A: experience-based memory (launch)

- Store episodes and event facts.
- Extract candidate memories with evidence references.
- Promote only low-risk, well-supported relationship hypotheses automatically.
- Require owner approval for identity-defining or high-impact baseline changes.
- Measure whether memory makes later conversations more consistent and less repetitive.

### Phase B: preference calibration (after retention signal)

- Let owners correct an inference, pin an existing preference, or mark a memory as wrong.
- Use explicit owner feedback and repeated evidence to update confidence.
- Add a “why does my character remember this?” view that cites source episode(s).
- Test memory retrieval ablations to see whether each memory improves dialogue.

### Phase C: shared-model fine-tuning (separate program)

Use a common model or adapter to improve Botchelor-style turn quality across characters, rather than training a separate model for every character. Parameter-efficient fine-tuning methods such as LoRA/PEFT can reduce the number of trainable parameters relative to full fine-tuning; see [Hugging Face PEFT documentation](https://huggingface.co/docs/transformers/peft).

Before starting, Botchelor needs a large enough permissioned dataset, consistent quality labels, a fixed evaluation suite, and an owner-approved compute budget. Dataset creation should use a human-reviewed subset, exclude private souls and disallowed content, remove identifiers, and honor opt-outs. Do not train on engagement metrics alone: popular content may be repetitive, manipulative, or out of character.

Fine-tuning acceptance criteria:
- Candidate model improves a pre-registered dialogue evaluation against baseline.
- It does not regress boundary compliance, privacy leakage, distinct character voice, structured-output validity, latency, or per-date cost beyond agreed thresholds.
- Model/adapter version is recorded per episode.
- Rollback to the previous model is supported.

## 14. Evaluation strategy

Build a fixed, versioned test suite before tuning memory rules or training a model. Include:

- same character on three dates with evolving context;
- same character meeting two different characters;
- a baseline trait that should remain stable;
- a tentative inferred preference that should not be over-promoted;
- contradictory evidence that should remain context-dependent;
- owner rejects a memory and it must not be silently re-added;
- private soul must not appear in public episode or counterpart's context;
- model-provider change mid-season;
- missing provider history/session ID;
- provider timeout, invalid JSON, refusal, or output beyond token limit;
- prompt injection in a character bio or transcript;
- cross-tenant authorization attempts;
- account/character deletion and training opt-out.

Track these metrics:

| Metric | Definition / purpose |
|---|---|
| Memory retrieval usefulness | Human/evaluator rating of whether retrieved memories are relevant to this turn |
| Character consistency | Blind rating against baseline personality and owner-pinned traits |
| Experience continuity | Whether the character appropriately references established events without inventing history |
| Memory hallucination rate | Unsupported memories referenced in dialogue |
| Privacy leakage rate | Private information surfaced to unauthorized views or another character |
| Memory correction rate | Share of active memories users reject or edit; proxy for extraction quality |
| Relationship distinctness | Whether the same character behaves differently with different counterpart histories in plausible ways |
| Valid turn rate | Share of turns that pass schema, safety, and length validation without retry |
| Median / p95 turn latency | User-perceived response speed |
| Cost per completed date | Inference and memory-extraction cost, not just first response cost |
| Model-switch continuity | Quality retained after a model or provider change |

Do not set hard production quality thresholds based on guesses. Establish a baseline with test episodes, set minimum release gates, and revise them using human review and observed user behavior.

## 15. Reliability, latency, and cost controls

- Assign every episode a stable ID and idempotency key.
- Use an asynchronous job queue for generation and memory extraction; web requests create jobs rather than running long-generation workflows inline.
- Separate dialogue generation from memory extraction. A completed episode must not fail only because post-date memory extraction failed; retry extraction independently.
- Limit turns, context tokens, retries, and per-user/date cost.
- Cache immutable generation results; never regenerate a published turn during replay.
- Provide explicit job states: `queued`, `generating`, `validating`, `completed`, `failed_retryable`, `failed_final`, `cancelled`.
- Use bounded retry with jitter and provider circuit breakers.
- Where available, route extraction/summarization to a less expensive model only after evaluating quality.
- Store provider/model IDs, token usage, and estimated cost; reconcile estimated costs with provider usage reports when possible.
- Allow a provider to be disabled by configuration or kill switch without modifying character state.

## 16. Rollout plan

### Milestone 0 — Architecture and data boundaries

- Audit the current Drizzle schema, episode-generation code, and auth patterns.
- Define visibility levels and ensure private soul fields are not embedded in publicly selectable records.
- Add provider-neutral model interface and test adapter.
- Decide the managed provider for the first controlled cohort.

**Exit gate:** Provider can be swapped in a test without losing character state; private-field access tests pass.

### Milestone 1 — Persistent memory MVP

- Add episodic memory, relationship state, provenance, and versioning tables.
- Save immutable episodes and the prompt/model/simulation versions used.
- Implement memory extraction after a successful date.
- Implement context retrieval with a token budget.
- Add owner-only memory viewer, edit/reject/delete controls.
- Add fallback for generation and extraction failures.

**Exit gate:** Multi-date test scenarios show stronger continuity than a stateless baseline, without critical privacy leakage or baseline drift.

### Milestone 2 — Relationship development

- Add explicit candidate/active/rejected memory states and confidence policy.
- Add relationship-specific state for each character's perspective.
- Add creator review for high-impact memory candidates.
- Add relationship recaps and continuity tests across rematches.

**Exit gate:** Users can explain what a character remembers, correct it, and see the correction reflected on the next date.

### Milestone 3 — Provider selection and BYOK research

- Measure cost, latency, quality, and structured-output reliability across supported providers.
- Add a provider settings UI only if user demand justifies it.
- Implement secure secret storage and key deletion before exposing BYOK.
- Evaluate user-hosted model connector as a separate security-reviewed project.

**Exit gate:** A provider switch preserves canonical memory, uses correct privacy disclosures, and passes model-specific evals.

### Milestone 4 — Shared-model learning experiment

- Determine whether existing models are failing a specific measured dialogue-quality task.
- Assemble permissioned data, label examples, and baseline the evaluation suite.
- Fine-tune a candidate adapter offline with approved hardware/budget.
- Run regression tests and a limited rollout with rollback.

**Exit gate:** Statistically and qualitatively meaningful improvement versus the baseline without critical regressions. If not, do not ship the adapter.

## 17. Acceptance criteria for the persistent memory release

The first releasable implementation is complete when all of the following pass:

1. A character completes a date and has relevant memories persisted in Botchelor's database.
2. On a future date, the same character can appropriately recall an established event even after logout/login, worker restart, or provider change.
3. The counterpart's context does not contain the first character's private soul, owner-only debrief, or private memories unless expressly authorized for a specific field.
4. Baseline personality and boundaries are not overwritten automatically by a single generated event.
5. Each active inferred preference contains provenance or linked evidence and can be corrected by the owner.
6. An owner correction changes future context assembly and is not silently lost on the next extraction pass.
7. A failed memory extraction can be retried without duplicating the episode or changing its published outcome.
8. All public episode reads enforce field-level visibility.
9. A model provider can be changed in configuration without migrating the canonical memory database.
10. Deleting a character triggers deletion of its memories and associated data according to the documented retention policy.
11. No provider key is exposed to client code or application logs.
12. Production episode generation respects token, retry, latency, and budget limits.
13. Training consent is independent from the ability to use persistent character memory.
14. A provider outage produces a clear queued/failed state or approved fallback, never a fabricated success.

## 18. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Memory makes characters rigid or repetitive | Retrieve only relevant memories; use conflicting evidence and evaluation; allow owner edits/deletion |
| Characters drift from their creator's intent | Baseline fields are pinned; high-impact changes require approval |
| A model hallucinates memories | Link every extracted memory to episode evidence; only use stored approved memories in context |
| Private soul leaks | Separate storage/queries, scoped prompts, field-level output filters, access-control regression tests |
| Provider outage or model changes | Adapter abstraction, immutable app state, queue/retry, versioned prompts and evaluations |
| BYOK key theft or unexpected charges | Server-side encrypted storage, strict purpose limitation, revocation, budgets and clear disclosure |
| Local model is not reachable | Treat BYOM as later advanced integration; implement a secure connector rather than assuming `localhost` works from cloud |
| Training data is biased or low quality | Separate consent, provenance, curation, fixed evaluations, human review and rollback |
| Sensitive inference masquerades as personality truth | Label inferred traits as fictional hypotheses; avoid real-world mental-health or diagnostic framing |
| Too much complexity before product validation | Ship memory first; defer BYOK, BYOM, training, and complex agent frameworks until validated |

## 19. Open questions

1. Which managed model/provider is the initial production default, given desired dialogue quality and the external-spend budget?
2. What memory retention/deletion policy applies to deleted characters, episode transcripts, logs, backups, and any explicitly consented training examples?
3. Which memory types can be promoted automatically, and which require creator approval?
4. Does the product need a local connector, or is BYOK sufficient for the first power-user demand signal?
5. What measured deficiency would justify fine-tuning instead of better prompts, memory retrieval, or simulation rules?
6. What are the target latency and per-date cost ceilings for the first cohort?

## 20. Recommended implementation order

**Do now:** application-owned persistent memory, structured character state, relationship-scoped memory, provenance, owner controls, provider abstraction, immutable episodes, evaluation scenarios, and hard cost limits.

**Do later:** BYOK, a secure local-model connector, more sophisticated semantic retrieval, periodic shared-model fine-tuning, and personal adapters.

**Do not do:** train a separate model after every date, store all memory only in a provider conversation thread, expose API keys in the browser, or use private character data for global training by default.

The desired outcome is simple: **Alex stays Alex, remembers Raven, changes where his experiences justify it, and can do all of that no matter which compatible model generates his next line.**

---

## References

- OpenAI, *Conversation state*: https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI, *Data controls*: https://developers.openai.com/api/docs/guides/your-data
- Anthropic, *Working with Messages*: https://platform.claude.com/docs/en/build-with-claude/working-with-messages
- Anthropic, *API data retention*: https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention
- Ollama, *API chat with history*: https://github.com/ollama/ollama/blob/main/docs/api.md
- Hugging Face, *Parameter-efficient fine-tuning / PEFT*: https://huggingface.co/docs/transformers/peft
