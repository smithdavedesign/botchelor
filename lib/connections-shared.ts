/**
 * Connections, the parts the page and the server share (docs/PRDs/connections.md): the jobs a key can do, the
 * providers that can do each, how a stored key is shown (its last four, when it was checked) and errors in plain
 * words with the fix. Client-safe and pure: no node imports, no database. The store and the provider calls are in
 * lib/connections.ts.
 */

/** What a key can be used for. Each job has at most one key (one connection) at a time. */
export const JOBS = ["text", "image", "video", "after_dark", "after_dark_video"] as const;
export type Job = (typeof JOBS)[number];
export const isJob = (v: unknown): v is Job => typeof v === "string" && (JOBS as readonly string[]).includes(v);

export type JobInfo = {
  title: string;
  /** What the job is, in a line. */
  what: string;
  /** What runs it with no key of yours: the free model (dates), or nothing (portraits and clips need a key). */
  free: string | null;
  /** The card's anchor on /account/keys. */
  anchor: string;
  /** About what one use costs on the key, when that doesn't depend on the model. */
  costHint: string | null;
};

export const JOB_INFO: Record<Job, JobInfo> = {
  text: {
    title: "Dates & texts",
    what: "Your characters' lines on their dates, and texting between dates whenever you like.",
    free: "Botchelor's free model",
    anchor: "dates",
    costHint: null,
  },
  image: {
    title: "Portraits & pictures",
    what: "A portrait of your own character, made when you ask for one (OpenAI moderates it).",
    free: null,
    anchor: "portraits",
    costHint: "OpenAI's price, a few cents a portrait",
  },
  video: {
    title: "Intro clips",
    what: "A 4-second intro clip from a character's portrait, made when you ask for one (Veo, on Google).",
    free: null,
    anchor: "clips",
    costHint: "about 20¢ a clip on your Google bill",
  },
  // The After Dark Studio's pictures (lib/adult/studio.ts; David, 2026-10-24): shown only to someone After Dark is open to.
  after_dark: {
    title: "After Dark pictures",
    what: "Studio pictures of your own characters, on your own Venice or Replicate key, free of tokens. Every picture is still checked before it's kept.",
    free: "Botchelor's models, for tokens",
    anchor: "after-dark-pictures",
    costHint: "the model's price, about 2–6¢ a picture on your bill",
  },
  // After Dark's videos of the night and clips (lib/adult/reels.ts reelMedia; David, 2026-11-01: "allow people to change
  // with their BYOK"): the whole video, its pictures and the shots, on their own key, with the speaking model they pick.
  after_dark_video: {
    title: "After Dark videos",
    what: "Videos of the night and clips, filmed on your own Venice or Replicate key with the video model you pick, free of tokens. Every shot is still checked before it's kept.",
    free: "Botchelor's models, for tokens",
    anchor: "after-dark-videos",
    costHint: "the model's price, about 11¢–$1.30 a shot on your bill",
  },
};

/** The jobs only someone After Dark is open to sees (the Connections page leaves them out for everyone else). */
export const ADULT_JOBS: readonly Job[] = ["after_dark", "after_dark_video"];

/**
 * Providers whose chat API is OpenAI-compatible at a known base URL. No custom endpoints (SSRF / prompt theft).
 * Each entry declares a short list of recommended models the UI shows: curated so users don't paste an id a
 * provider doesn't have. The `defaultModel` is used when a user picks a provider but doesn't name a model.
 *
 * Adding a provider? Pick one that's genuinely OpenAI-compatible at `/chat/completions`, add it below and to
 * PROVIDER_INFO, and keep the entry a single line. The validate ping and MCP's `set_model` pick it up automatically.
 */
export const TEXT_PROVIDERS = {
  google: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", note: "the free-tier default; cheap and fast" },
      { id: "gemini-3.5-flash", note: "a step up in writing, still cheap" },
      { id: "gemini-3.5-pro", note: "best Gemini writing; more expensive" },
    ],
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    models: [
      { id: "gpt-4.1-mini", note: "the default; cheap, strong at dialogue" },
      { id: "gpt-4.1", note: "flagship; best writing, highest cost" },
      { id: "gpt-5-mini", note: "newer reasoning model" },
    ],
  },
  anthropic: {
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-5-5",
    models: [
      { id: "claude-haiku-5-5", note: "cheap, fast; strong dialogue" },
      { id: "claude-sonnet-5-5", note: "the balanced pick for writing" },
      { id: "claude-opus-5-5", note: "best writing; expensive" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: [
      { id: "deepseek-chat", note: "very cheap; good at English + Chinese" },
      { id: "deepseek-reasoner", note: "reasoning model; more thought, slower" },
    ],
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      { id: "llama-3.3-70b-versatile", note: "fast inference (~500 tok/s)" },
      { id: "llama-3.1-8b-instant", note: "smaller, cheaper, fastest" },
      { id: "openai/gpt-oss-120b", note: "open-weights GPT; largest Groq hosts" },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
    models: [
      { id: "openai/gpt-4.1-mini", note: "route to OpenAI, pay by usage" },
      { id: "anthropic/claude-haiku-5-5", note: "route to Anthropic Claude" },
      { id: "deepseek/deepseek-chat", note: "route to DeepSeek" },
      { id: "x-ai/grok-4", note: "route to xAI Grok" },
    ],
  },
} as const;
export type TextProvider = keyof typeof TEXT_PROVIDERS;
export const isTextProvider = (p: string): p is TextProvider => p in TEXT_PROVIDERS;

/** The providers a person can connect, in the order the connect flow offers them. */
export const USER_PROVIDERS = ["openrouter", "openai", "google", "anthropic", "deepseek", "groq", "venice", "replicate"] as const;
export type UserProvider = (typeof USER_PROVIDERS)[number];
export const isUserProvider = (p: unknown): p is UserProvider => typeof p === "string" && (USER_PROVIDERS as readonly string[]).includes(p);

export type ProviderInfo = {
  label: string;
  /** The letters on its tile: a text mark, not a logo (no outside assets). */
  mark: string;
  /** The jobs a key from here can do. */
  jobs: readonly Job[];
  /** One line on why you'd pick it. */
  blurb: string;
  /** What its keys look like, for the paste field. */
  keyHint: string;
  /** Where to make a key, and where to add credit. */
  keysUrl: string;
  billingUrl: string;
};

export const PROVIDER_INFO: Record<UserProvider, ProviderInfo> = {
  openrouter: {
    label: "OpenRouter",
    mark: "OR",
    jobs: ["text"],
    blurb: "One key for hundreds of models, with a spend limit you set on the key.",
    keyHint: "Starts with sk-or-",
    keysUrl: "https://openrouter.ai/settings/keys",
    billingUrl: "https://openrouter.ai/settings/credits",
  },
  openai: {
    label: "OpenAI",
    mark: "AI",
    jobs: ["text", "image"],
    blurb: "GPT models for dates, and the only key that makes portraits.",
    keyHint: "Starts with sk-",
    keysUrl: "https://platform.openai.com/api-keys",
    billingUrl: "https://platform.openai.com/settings/organization/billing/overview",
  },
  google: {
    label: "Google",
    mark: "G",
    jobs: ["text", "video"],
    blurb: "Gemini for dates (it has a free tier), and Veo for intro clips (billing on).",
    keyHint: "From AI Studio, starts with AIza",
    keysUrl: "https://aistudio.google.com/apikey",
    billingUrl: "https://aistudio.google.com/apikey",
  },
  anthropic: {
    label: "Anthropic",
    mark: "A",
    jobs: ["text"],
    blurb: "Claude for dates: strong, natural dialogue.",
    keyHint: "Starts with sk-ant-",
    keysUrl: "https://console.anthropic.com/settings/keys",
    billingUrl: "https://console.anthropic.com/settings/billing",
  },
  deepseek: {
    label: "DeepSeek",
    mark: "DS",
    jobs: ["text"],
    blurb: "Very cheap per date.",
    keyHint: "Starts with sk-",
    keysUrl: "https://platform.deepseek.com/api_keys",
    billingUrl: "https://platform.deepseek.com/top_up",
  },
  venice: {
    label: "Venice",
    mark: "VE",
    jobs: ["after_dark", "after_dark_video"],
    blurb: "After Dark pictures and videos on Venice's own uncensored models; you pay Venice directly.",
    keyHint: "A Venice API key",
    keysUrl: "https://venice.ai/settings/api",
    billingUrl: "https://venice.ai/settings/api",
  },
  replicate: {
    label: "Replicate",
    mark: "RE",
    jobs: ["after_dark", "after_dark_video"],
    blurb: "After Dark pictures and videos on Replicate's open models; you pay Replicate directly.",
    keyHint: "Starts with r8_",
    keysUrl: "https://replicate.com/account/api-tokens",
    billingUrl: "https://replicate.com/account/billing",
  },
  groq: {
    label: "Groq",
    mark: "GQ",
    jobs: ["text"],
    blurb: "Open models, very fast.",
    keyHint: "Starts with gsk_",
    keysUrl: "https://console.groq.com/keys",
    billingUrl: "https://console.groq.com/settings/billing",
  },
};

/** The providers that can do a job, in the connect flow's order. */
export const providersFor = (job: Job): UserProvider[] => USER_PROVIDERS.filter((p) => PROVIDER_INFO[p].jobs.includes(job));

/** The label for any provider id, including one stored before it was offered here. */
export const providerLabel = (p: string): string => (isUserProvider(p) ? PROVIDER_INFO[p].label : p.charAt(0).toUpperCase() + p.slice(1));

/** A model a job can run on a provider, as the model step lists it. */
export type ModelChoice = { id: string; note: string; recommended?: boolean };

/** The portrait model (lib/image.ts DEFAULT_IMAGE_MODEL) and the clip model (lib/video.ts VEO_MODEL). */
export const IMAGE_MODEL = "gpt-image-2";
export const VIDEO_MODEL = "veo-3.1-lite-generate-preview";


/**
 * The After Dark Studio's models on someone's own key (lib/adult/studio-config.ts DEFAULT_STUDIO_MODELS, the edit ones):
 * the job's default is the one a shoot uses unless the Studio's picker says otherwise.
 */
export const AFTER_DARK_MODELS: Partial<Record<string, ModelChoice[]>> = {
  venice: [
    { id: "qwen-edit-uncensored", note: "keeps the face; run by Venice, about 4¢ a picture", recommended: true },
    { id: "qwen-image-2-1-turbo-edit", note: "fast, about 2¢" },
    { id: "qwen-image-2-1-pro-edit", note: "up to 10 references, about 5¢" },
    { id: "seedream-v5-pro-edit", note: "fine detail, about 6¢" },
  ],
  replicate: [{ id: "qwen/qwen-image-edit-2511", note: "keeps the face, about 3¢ a picture", recommended: true }],
};

/**
 * The video models After Dark's videos can be filmed with on someone's own key (lib/adult/reels.ts reelMedia), from the
 * bake-off of 2026-11-01 (every model, one keyframe, one line). Each says a shot's line itself except Wan 2.2, which is
 * silent and has the line said beside it by a stock voice. The keyframes are drawn on the same key.
 */
export const AFTER_DARK_VIDEO_MODELS: Partial<Record<string, ModelChoice[]>> = {
  venice: [
    { id: "wan-3-0-image-to-video", note: "says the line best of all, about $0.65 a 5 s shot", recommended: true },
    { id: "wan-2.6-image-to-video", note: "lip-syncs to a stock voice" },
    { id: "wan-2-7-image-to-video", note: "lip-syncs to a stock voice, newer" },
  ],
  replicate: [
    { id: "wan-video/wan-2.6-i2v", note: "says the line itself, about $0.50 a 5 s shot", recommended: true },
    { id: "wan-video/wan-2.7-i2v", note: "says the line itself, newer, up to 15 s" },
    { id: "wan-video/wan-2.2-i2v-fast", note: "silent, the line said beside it, about 11¢ a shot" },
  ],
};

/** The curated models a job can run on a provider, the recommended one first. Empty: the provider can't do the job. */
export function curatedModels(provider: string, job: Job): ModelChoice[] {
  if (job === "text") {
    if (!isTextProvider(provider)) return [];
    const p = TEXT_PROVIDERS[provider];
    return p.models.map((m) => ({ id: m.id, note: m.note, ...(m.id === p.defaultModel ? { recommended: true } : {}) }));
  }
  if (job === "image") return provider === "openai" ? [{ id: IMAGE_MODEL, note: "OpenAI's current image model", recommended: true }] : [];
  if (job === "after_dark") return AFTER_DARK_MODELS[provider] ?? [];
  if (job === "after_dark_video") return AFTER_DARK_VIDEO_MODELS[provider] ?? [];
  return provider === "google" ? [{ id: VIDEO_MODEL, note: "Veo 3.1 Lite: 4 s at 720p, about $0.20 a clip", recommended: true }] : [];
}

/** The model a job runs when none was picked. */
export function defaultModelFor(provider: string, job: Job): string | null {
  return curatedModels(provider, job).find((m) => m.recommended)?.id ?? null;
}

/** A stored key as it's shown: its last four, never more. */
export const maskKey = (last4: string): string => `•••• ${last4}`;

/** "just now", "2 min ago", "3 hours ago", "yesterday", "Oct 12": how long ago something was, as the cards say it. */
export function ago(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "yesterday";
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/* ------------------------------------------------- errors in plain words ------------------------------------------------- */

/**
 * Why a key didn't work, sorted into what a person can do about it. `unreadable` is ours: the stored key can't be
 * opened here any more (the server's key secret changed), so it has to be pasted again. `over_cap` is the monthly cap.
 */
export const ERROR_KINDS = ["invalid_key", "no_credit", "rate_limited", "model_unavailable", "provider_down", "unreachable", "unreadable", "over_cap", "unknown"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];
export const isErrorKind = (v: unknown): v is ErrorKind => typeof v === "string" && (ERROR_KINDS as readonly string[]).includes(v);

/** An error as the card shows it: what happened, and the one thing to do about it (a link when it's on the provider's site). */
export type PlainError = { kind: ErrorKind; message: string; fix: { label: string; href: string | null } | null };

/**
 * The words for an error from a provider, with its fix. Never the provider's own message: that can carry part of a
 * key, an account id or a model's internals, and none of it is what to do next.
 */
export function plainError(provider: string, kind: ErrorKind, opts: { model?: string | null } = {}): PlainError {
  const name = providerLabel(provider);
  const info = isUserProvider(provider) ? PROVIDER_INFO[provider] : null;
  switch (kind) {
    case "invalid_key":
      return { kind, message: `${name} didn't accept this key.`, fix: { label: "Check you copied all of it, or make a new key", href: info?.keysUrl ?? null } };
    case "no_credit":
      return { kind, message: `${name}: out of credit.`, fix: { label: "Top up", href: info?.billingUrl ?? null } };
    case "rate_limited":
      return { kind, message: `${name} is limiting this key for now (too many requests, or a free tier's quota).`, fix: { label: "Wait a few minutes, or raise the key's limits", href: info?.billingUrl ?? null } };
    case "model_unavailable":
      return { kind, message: `${name} doesn't offer ${opts.model ? opts.model : "that model"} on this key.`, fix: { label: "Pick another model", href: null } };
    case "provider_down":
      return { kind, message: `${name} is having trouble right now.`, fix: { label: "Try again in a few minutes", href: null } };
    case "unreachable":
      return { kind, message: `Couldn't reach ${name}.`, fix: { label: "Try again in a minute", href: null } };
    case "unreadable":
      return { kind, message: "This key can't be read here any more (the server's key secret changed).", fix: { label: "Paste it again", href: null } };
    case "over_cap":
      return { kind, message: "This month's cap is reached.", fix: { label: "Raise the cap", href: null } };
    default:
      return { kind: "unknown", message: `${name} turned the key down.`, fix: { label: "Check the key on its site", href: info?.keysUrl ?? null } };
  }
}

/* --------------------------------------------- After Dark's providers (admins) --------------------------------------------- */

/** The house's After Dark providers, as the admin's status view shows them (lib/adult/provider-status.ts). */
export const HOUSE_PROVIDERS = ["openrouter", "venice", "replicate", "fal", "hive"] as const;
export type HouseProvider = (typeof HOUSE_PROVIDERS)[number];
export const HOUSE_PROVIDER_INFO: Record<HouseProvider, { label: string; mark: string; what: string }> = {
  openrouter: { label: "OpenRouter", mark: "OR", what: "Writes the scenes" },
  venice: { label: "Venice", mark: "V", what: "Pictures, keyframes, videos and voices" },
  replicate: { label: "Replicate", mark: "R", what: "The backup for pictures, keyframes, videos and voices" },
  fal: { label: "fal.ai", mark: "fal", what: "Pictures and clips, when set to fal" },
  hive: { label: "Hive", mark: "H", what: "The safety check every picture and video passes" },
};

/* ------------------------------------------------------ the job cards ------------------------------------------------------ */

/** A stored key as the page sees it (lib/connections.ts ConnectionInfo, without anything sealed). */
export type ConnectionSummary = {
  provider: string;
  last4: string;
  verified_at: string | null;
  last_used_at: string | null;
  last_error: PlainError | null;
  last_error_at?: string | null;
  created_at: string;
  jobs: Job[];
};
export type JobSummary = { job: Job; provider: string; model: string | null; cap_usd?: number | null; on_cap?: OnCap | null } & Partial<Feel>;

/**
 * A job card's state (docs/PRDs/connections.md "Card states"): no key of yours (`unset`), a key that's working
 * (`connected`), one whose last check or call went wrong (`error`), one at this month's cap (`over_cap`), or one that
 * failed while Botchelor's free model stands in for it (`fallback`). "Checking…" is the page's own while a check runs.
 */
export type CardState = "unset" | "connected" | "error" | "over_cap" | "fallback";

export type JobCard = {
  job: Job;
  title: string;
  what: string;
  state: CardState;
  /** The short label in the card's corner. */
  pill: string;
  /** The card's one status line: "Using: Botchelor's free model", "Your OpenRouter key ✓ · openai/gpt-4.1-mini". */
  status: string;
  /** "•••• abcd", "checked 2 min ago", "last used 1 hour ago". */
  meta: string[];
  provider: string | null;
  model: string | null;
  /** Dates & texts' feel (M2): the preset or custom values, as stored. */
  feel: Feel | null;
  /** M3: the cap and what happens at it, and this month's spend against it (the card's meter). */
  cap: CapSettings | null;
  usage: { spent: number; cap: number | null; level: CapLevel; estimated: boolean; unpriced: number; line: string } | null;
  error: PlainError | null;
  /** Keys already connected that could do this job too, to use without pasting again. */
  reusable: { provider: string; label: string; last4: string }[];
};

/** What a job card says with no key of yours. */
const UNSET_STATUS: Record<Job, string> = {
  text: "Using: Botchelor's free model",
  image: "Not set up: portraits need your own OpenAI key.",
  video: "Not set up: clips need your own Google key, with billing on.",
  after_dark: "Using: Botchelor's models, for tokens",
  after_dark_video: "Using: Botchelor's models, for tokens",
};

/**
 * The meta line for a stored key: its last four, when it was last checked (or, when something went wrong since, when it
 * failed), and when it last worked.
 */
export function keyMeta(c: Pick<ConnectionSummary, "last4" | "verified_at" | "last_used_at" | "last_error" | "last_error_at">, now: number = Date.now()): string[] {
  const failed = c.last_error && c.last_error_at && (!c.verified_at || c.last_error_at >= c.verified_at) ? c.last_error_at : null;
  return [
    maskKey(c.last4),
    failed ? `failed ${ago(failed, now)}` : c.verified_at ? `checked ${ago(c.verified_at, now)}` : "not checked yet",
    c.last_used_at ? `last used ${ago(c.last_used_at, now)}` : "not used yet",
  ];
}

/** What waits at the cap for each job, when it isn't the free model standing in. */
const WAITS: Record<Job, string> = { text: "your dates wait", image: "portraits wait", video: "clips wait", after_dark: "Studio pictures on your key wait", after_dark_video: "videos on your key wait" };

/** Every job's card, from a person's connections, assignments and this month's spend. Pure: the page and the tests share it. */
export function jobCards(
  listing: { connections: ConnectionSummary[]; jobs: JobSummary[] },
  now: number = Date.now(),
  spend: Partial<Record<Job, UsageSummary>> = {},
): JobCard[] {
  return JOBS.map((job) => {
    const info = JOB_INFO[job];
    const a = listing.jobs.find((j) => j.job === job);
    const c = a ? listing.connections.find((x) => x.provider === a.provider) : undefined;
    const reusable = listing.connections
      .filter((x) => isUserProvider(x.provider) && PROVIDER_INFO[x.provider].jobs.includes(job) && x.provider !== a?.provider)
      .map((x) => ({ provider: x.provider, label: providerLabel(x.provider), last4: x.last4 }));
    if (!a || !c) {
      // After Dark pictures without a key run on Botchelor's models for tokens: not free, so not "Free model".
      const pill = !info.free ? "Not set up" : job === "after_dark" || job === "after_dark_video" ? "For tokens" : "Free model";
      return { job, title: info.title, what: info.what, state: "unset", pill, status: UNSET_STATUS[job], meta: [], provider: null, model: null, feel: null, cap: null, usage: null, error: null, reusable };
    }
    const model = a.model ?? defaultModelFor(a.provider, job);
    const error = c.last_error;
    const feel: Feel | null =
      job === "text" ? { preset: a.preset ?? null, temperature: a.temperature ?? null, frequency_penalty: a.frequency_penalty ?? null, presence_penalty: a.presence_penalty ?? null } : null;
    const cap: CapSettings = { cap_usd: a.cap_usd ?? null, on_cap: job === "text" && a.on_cap === "pause" ? "pause" : job === "text" ? "fallback" : "pause" };
    const u = spend[job];
    const spent = u?.cost_usd ?? 0;
    const level = capLevel(spent, cap.cap_usd);
    const usage = {
      spent,
      cap: cap.cap_usd,
      level,
      estimated: (u?.estimated_calls ?? 0) > 0,
      unpriced: u?.unpriced_calls ?? 0,
      line: `${money(spent)}${cap.cap_usd !== null ? ` of ${money(cap.cap_usd)}` : ""} this month`,
    };
    const standsIn = job === "text" && cap.on_cap === "fallback";
    const key = `Your ${providerLabel(a.provider)} key`;
    const what = `${model ? ` · ${model}` : ""}${feel ? ` · ${feelLabel(feel)}` : ""}`;
    let state: CardState = error ? (standsIn ? "fallback" : "error") : "connected";
    let pill = error ? (standsIn ? "On the free model" : "Needs attention") : level === "warn" ? `${Math.floor(WARN_AT * 100)}% of cap` : "✓ Connected";
    let status = `${key}${error ? "" : " ✓"}${what}`;
    if (level === "over") {
      state = "over_cap";
      pill = "Cap reached";
      status = `Cap reached: ${standsIn ? "Botchelor's free model stands in" : WAITS[job]} until ${resetDay(now)}`;
    } else if (state === "fallback") {
      status = `${key} failed, so Botchelor's free model stands in${what}`;
    }
    return {
      job,
      title: info.title,
      what: info.what,
      state,
      pill,
      status,
      meta: [...keyMeta(c, now), `${usage.line}${usage.estimated ? " (estimated)" : ""}`],
      provider: a.provider,
      model,
      feel,
      cap,
      usage,
      error,
      reusable,
    };
  });
}

/* ------------------------------------------------- M2: models, tags, prices ------------------------------------------------- */

/** What a model is good for at a glance, as the model step's chips say it (OpenRouter's and Cursor's pickers). */
export const MODEL_TAGS = ["recommended", "free", "fast", "vision"] as const;
export type ModelTag = (typeof MODEL_TAGS)[number];
export const TAG_LABEL: Record<ModelTag, string> = { recommended: "Recommended", free: "Free", fast: "Fast", vision: "Vision" };

/** A model the step offers: its id, a name or note, its tags, and what it costs (USD per 1M tokens) when we know. */
export type ModelOption = {
  id: string;
  /** OpenRouter's name for it ("DeepSeek: DeepSeek V3.1"), or the curated note. */
  note: string | null;
  tags: ModelTag[];
  price: { input: number; output: number } | null;
  /** "≈ 1¢ a date", "free", or null when the price isn't known. */
  perDate: string | null;
};

/**
 * What a date takes on a person's key, for the price hint: their character's lines and a house partner's (a soulless side
 * rides the creator's key, lib/keys.ts buildKeyForSide), the critic's rewrites, the texts after and the reflections, but
 * never the plan or the recap. About 30k tokens in and 1.5k out (docs/upgrade-cost.md measured ~26k / ~2.2k for a whole
 * date with the plan and recap on the show's model). Reasoning models think on top, billed as output.
 */
export const DATE_TOKENS = { input: 30_000, output: 1_500 } as const;

/** "≈ 1¢ a date" from a price per 1M tokens; "free" for a zero price. */
export function perDateHint(price: { input: number; output: number } | null): string | null {
  if (!price) return null;
  const usd = (DATE_TOKENS.input * price.input + DATE_TOKENS.output * price.output) / 1e6;
  if (usd <= 0) return "free";
  const cents = usd * 100;
  if (cents < 0.95) return `≈ ${Math.max(0.1, Math.round(cents * 10) / 10)}¢ a date`;
  if (cents < 99.5) return `≈ ${Math.round(cents)}¢ a date`;
  return `≈ $${usd.toFixed(2)} a date`;
}

/**
 * List prices (USD per 1M tokens, in / out) for the curated models of the providers whose model lists carry no prices,
 * as each provider published them around 2026-10. A hint, never a bill: OpenRouter's own prices replace these live, and M3
 * counts what each provider actually reports where it does.
 */
export const CURATED_PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "claude-haiku-5-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 3, output: 15 },
  "claude-opus-5-5": { input: 5, output: 25 },
  "deepseek-chat": { input: 0.28, output: 0.42 },
  "deepseek-reasoner": { input: 0.28, output: 0.42 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.75 },
};

/** Models with a free tier on their provider (Google gives the show's own model one). */
const FREE_TIER = new Set(["gemini-3.5-flash-lite"]);
/** Families that take images as well as text, by id (OpenRouter says so itself, in its list). */
const VISION = /^(gpt-4\.1|gpt-4o|gpt-5|o3|o4|gemini|claude|gemma-3|llama-4)/;

/** The tags a model gets from its id and provider (OpenRouter's list adds free and vision from its own data). */
export function tagsFor(provider: string, id: string, extra: { free?: boolean; vision?: boolean; recommended?: boolean } = {}): ModelTag[] {
  const tags: ModelTag[] = [];
  if (extra.recommended) tags.push("recommended");
  if (extra.free || FREE_TIER.has(id) || /:free$/.test(id)) tags.push("free");
  if (provider === "groq" || /(flash|mini|haiku|instant|lite|nano|turbo)/.test(id.replace(/^[\w-]+\//, ""))) tags.push("fast");
  if (extra.vision ?? VISION.test(id.replace(/^[\w-]+\//, ""))) tags.push("vision");
  return tags;
}

/**
 * Whether a listed model is one the job can run: a chat model for dates (not an embedding, speech, image, moderation or
 * realtime model), a current image model for portraits (retired ones run gpt-image-2 anyway, lib/image.ts), Veo for clips.
 */
export function modelFitsJob(job: Job, id: string): boolean {
  if (job === "image") return /^gpt-image/.test(id) && !/^gpt-image-1$/.test(id);
  if (job === "video") return /^veo/.test(id);
  if (job === "after_dark") return Object.values(AFTER_DARK_MODELS).some((ms) => ms?.some((m) => m.id === id));
  if (job === "after_dark_video") return Object.values(AFTER_DARK_VIDEO_MODELS).some((ms) => ms?.some((m) => m.id === id));
  return !/(embed|tts|whisper|dall-e|gpt-image|imagen|veo|moderation|realtime|audio|transcribe|speech|guard|aqa|search-preview|computer-use|instruct$|^babbage|^davinci)/i.test(id);
}

/** A curated or listed model as an option, with its tags and price hint. */
export function modelOption(provider: string, job: Job, id: string, opts: { note?: string | null; price?: { input: number; output: number } | null; free?: boolean; vision?: boolean } = {}): ModelOption {
  const curated = curatedModels(provider, job).find((m) => m.id === id);
  const price = opts.price !== undefined ? opts.price : (CURATED_PRICES[id] ?? null);
  return {
    id,
    note: opts.note ?? curated?.note ?? null,
    tags: job === "text" ? tagsFor(provider, id, { free: opts.free, vision: opts.vision, recommended: curated?.recommended }) : curated?.recommended ? ["recommended"] : [],
    price,
    perDate: job === "text" ? perDateHint(price) : null,
  };
}

/**
 * The models the step offers for a job on a provider: what the key listed (filtered to the job), the curated ones always,
 * Recommended first, then the rest of the curated list, then everything else by id. With no list, the curated ones.
 */
export function modelOptions(provider: string, job: Job, listed: string[] | null): ModelOption[] {
  const curated = curatedModels(provider, job);
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(modelOption(provider, job, id));
  };
  for (const m of curated) add(m.id);
  if (job === "video" || job === "after_dark" || job === "after_dark_video") return out; // clips are tuned to Veo 3.1 Lite (lib/video.ts); the Studio has its own list
  for (const id of [...(listed ?? [])].filter((m) => modelFitsJob(job, m)).sort()) add(id);
  return out;
}

/* ------------------------------------------------------ M2: presets ------------------------------------------------------ */

/**
 * A feel instead of raw numbers (SillyTavern's and JanitorAI's presets), for Dates & texts. Lively is the show's own
 * sampling (TURN_TEMPERATURE, lib/conversation.ts, and no penalties), so a key with no choice sounds like the show.
 */
export const PRESETS = {
  steady: { label: "Steady", blurb: "Calm and consistent: true to the sheet, fewer surprises.", temperature: 0.7, frequency_penalty: 0.1, presence_penalty: 0 },
  lively: { label: "Lively", blurb: "The show's own: varied and warm.", temperature: 1.0, frequency_penalty: 0, presence_penalty: 0 },
  wild: { label: "Wild", blurb: "Surprising and talkative; it can wander off the sheet.", temperature: 1.25, frequency_penalty: 0.3, presence_penalty: 0.3 },
} as const;
export type PresetId = keyof typeof PRESETS;
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
export const DEFAULT_PRESET: PresetId = "lively";
/** The show's dialogue temperature (lib/conversation.ts TURN_TEMPERATURE): a preset's temperature is what date lines run at. */
export const DIALOGUE_TEMPERATURE = 1.0;

/** Advanced's bounds: temperature 0 to 1.5 (Anthropic's API stops at 1), penalties 0 to 1 (a negative one rewards repeats). */
export const BOUNDS = { temperature: { min: 0, max: 1.5 }, penalty: { min: 0, max: 1 } } as const;
/** The providers whose APIs take OpenAI's frequency and presence penalties (Anthropic's and Google's don't). */
export const TAKES_PENALTIES: readonly string[] = ["openai", "deepseek", "groq", "openrouter"];
const maxTemperature = (provider: string) => (provider === "anthropic" ? 1 : BOUNDS.temperature.max);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** A number kept inside its bounds, to two decimals; null for anything that isn't a finite number. */
export function clampSetting(v: unknown, kind: "temperature" | "penalty", provider = ""): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const max = kind === "temperature" ? maxTemperature(provider) : BOUNDS.penalty.max;
  return Math.round(clamp(n, kind === "temperature" ? BOUNDS.temperature.min : BOUNDS.penalty.min, max) * 100) / 100;
}

/** A job's feel as stored: a preset (or "custom") and the raw values Advanced set (null: the preset's). */
export type Feel = { preset: PresetId | "custom" | null; temperature: number | null; frequency_penalty: number | null; presence_penalty: number | null };

/** What a key's calls run at: the preset's values, Advanced's where set, clamped, and penalties only where the provider takes them. */
export type Sampling = { temperature: number; frequencyPenalty?: number; presencePenalty?: number };
export function samplingFor(provider: string, feel: Partial<Feel> = {}): Sampling {
  const p = PRESETS[feel.preset && feel.preset !== "custom" ? feel.preset : DEFAULT_PRESET];
  const temperature = clampSetting(feel.temperature ?? p.temperature, "temperature", provider) ?? p.temperature;
  if (!TAKES_PENALTIES.includes(provider)) return { temperature };
  const frequency = clampSetting(feel.frequency_penalty ?? p.frequency_penalty, "penalty") ?? 0;
  const presence = clampSetting(feel.presence_penalty ?? p.presence_penalty, "penalty") ?? 0;
  return { temperature, ...(frequency ? { frequencyPenalty: frequency } : {}), ...(presence ? { presencePenalty: presence } : {}) };
}

/** A feel's name for the card: "Lively", "Wild", or "Custom (0.9)". */
export function feelLabel(feel: Partial<Feel>): string {
  if (feel.preset === "custom" || (feel.preset == null && feel.temperature != null)) return `Custom (${feel.temperature ?? PRESETS[DEFAULT_PRESET].temperature})`;
  return PRESETS[feel.preset ?? DEFAULT_PRESET].label;
}

/* -------------------------------------------------- M3: caps and usage -------------------------------------------------- */

/** The month a call counts in: UTC, "2026-10". */
export const monthOf = (at: number | Date = Date.now()): string => new Date(at).toISOString().slice(0, 7);
/** When this month's spend resets: the 1st of next month, UTC. */
export function nextMonthStart(at: number | Date = Date.now()): Date {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
/** "Nov 1": the day a cap resets, as the cards say it. */
export const resetDay = (at: number | Date = Date.now()): string =>
  nextMonthStart(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "$1.20", "$0.04", "$10": dollars as the cards write them. */
export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/** The largest monthly cap a job takes (a cap is a promise to the person, not a budget we hold). */
export const CAP_MAX_USD = 1000;
/** When the card turns amber and the heads-up goes: this share of the cap. */
export const WARN_AT = 0.8;
/** What happens when a key hits its cap or can't be used: Botchelor's free model stands in, or the dates booked wait. */
export const ON_CAP = ["fallback", "pause"] as const;
export type OnCap = (typeof ON_CAP)[number];
export const DEFAULT_ON_CAP: OnCap = "fallback";

/**
 * What a portrait costs on the key, for its monthly spend: OpenAI's list price for one high-quality 1024² image (lower
 * quality costs less, so this errs high). A clip is lib/video.ts CLIP_PROVIDER_COST_USD. Both are counted as estimates.
 */
export const PORTRAIT_ESTIMATE_USD = 0.17;

/** A job's spend this month. */
export type UsageSummary = { cost_usd: number; calls: number; estimated_calls: number; unpriced_calls: number };
export type CapSettings = { cap_usd: number | null; on_cap: OnCap };

/** Where a job's spend stands against its cap: no cap, under, past WARN_AT, or at it. */
export type CapLevel = "none" | "ok" | "warn" | "over";
export function capLevel(spent: number, cap: number | null): CapLevel {
  if (cap === null) return "none";
  if (spent >= cap) return "over";
  return spent >= cap * WARN_AT ? "warn" : "ok";
}

/** A cap as stored: a positive number of dollars up to CAP_MAX_USD, to the cent; null (no cap) for anything else. */
export function clampCap(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(CAP_MAX_USD, n) * 100) / 100;
}
