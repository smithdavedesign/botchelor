/**
 * After dark's output check (docs/after-dark.md #1; David, 2026-10-18: "Hive is fine", nothing Amazon). Every picture or
 * clip fal returns is checked BEFORE it is stored; a failure is discarded, never stored, and only the reason is logged.
 *
 * One Hive secret key (its V3 API, Bearer auth), two models on the returned file:
 *  1. hive/visual-moderation: refuse if its child head (yes_child_present) fires, on any frame.
 *  2. hive/vision-language-model, on pictures: asked whether everyone shown is clearly an adult, its reply held to three
 *     labels by a JSON schema (AGE_FORMAT); anything but "ADULTS" (a possible minor, unsure, nobody visible, an
 *     unreadable answer) is a refusal.
 * Hive's face-age (demographics) model is Enterprise only on the V3 portal, so the VLM stands in for it. A clip is made
 * from a picture that already passed both, and its frames go through moderation again. A video's keyframe, made only to
 * start its shot, gets the age question alone ("keyframe", below): the shot's own moderation samples its frames, the
 * first of them that keyframe, and the keyframe isn't shown on its own until the shot has passed (lib/adult/media.ts
 * FRAME_SHOWN).
 * The check FAILS CLOSED: no key, an error, or an unreadable reply is a refusal.
 * Self-serve Hive doesn't include its CSAM classifier (Enterprise only); add it before anyone but the admin uses this.
 * Self-serve Hive also stops at 100 moderation requests a day: lib/adult/hive-limit.ts pauses every picture and video
 * when a check ends on its 429, so nothing is drawn (or paid for) that couldn't be checked.
 */

/**
 * A check's verdict. On a refusal, `limited` says the check ended on a Hive 429 after its retries (Hive's daily limit,
 * 2026-10-23: lib/adult/hive-limit.ts pauses every picture and video on it), and `paused` is until when that pause runs
 * (an ISO time), set by lib/adult/hive-limit.ts when the pause stopped this check or this check started it.
 */
export type CheckResult = { ok: true } | { ok: false; reason: string; limited?: boolean; paused?: string };

export const HIVE_MODERATION = "https://api.thehive.ai/api/v3/hive/visual-moderation";
export const HIVE_VLM = "https://api.thehive.ai/api/v3/chat/completions";

/** Refuse at this score or above: deliberately low, so anything borderline is thrown away. */
export const CHILD_SCORE = 0.05;
const MODERATION_CHILD = ["yes_child_present"];

/** The age check's only answers. */
export const AGE_LABELS = ["ADULTS", "MINOR", "UNSURE"] as const;

export const AGE_QUESTION =
  'Look at every person in this image. Answer ADULTS if every person shown clearly appears to be 18 or older; MINOR if anyone could be under 18; UNSURE if you can\'t tell or no person is visible. Reply with JSON only: {"answer": "ADULTS" | "MINOR" | "UNSURE"}.';

/**
 * Hive's structured output (V3 chat completions `response_format`, docs.thehive.ai "Sending with a JSON Schema"): the
 * reply is held to {"answer": one of AGE_LABELS}. Hive's terms (thehive.ai/terms-of-use, 1.5) count the VLM as a
 * Generative AI Service, whose policy (3.2) bars content that "is not PG-rated" without written permission, "solely
 * when used for any purpose other than receiving a response confined to a defined set of response labels". A reply
 * held to three labels is that exception (terms review, 2026-10-22; docs/after-dark.md "Terms fixes").
 */
export const AGE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "age_check",
    schema: {
      type: "object",
      properties: { answer: { type: "string", enum: AGE_LABELS } },
      required: ["answer"],
      additionalProperties: false,
    },
    strict: true,
  },
} as const;

/** The VLM call for one picture, by URL or as a data: URI. */
export function ageCheckRequest(url: string) {
  return {
    model: "hive/vision-language-model",
    temperature: 0,
    // {"answer": "UNSURE"} is about ten tokens; a cut-off reply is unreadable, which refuses.
    max_tokens: 32,
    response_format: AGE_FORMAT,
    messages: [{ role: "user", content: [{ type: "text", text: AGE_QUESTION }, { type: "media_url", media_url: { url } }] }],
  };
}

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setCheckFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);
let testSleep: ((ms: number) => Promise<void>) | null = null;
/** Tests skip the real waits between retries (and can record them). */
export function setCheckSleepForTests(f: ((ms: number) => Promise<void>) | null): void {
  testSleep = f;
}
const sleep = (ms: number) => (testSleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t))))(ms);

/** Hive was busy (429), down (5xx) or unreachable: asked again this many more times before the check gives up. */
export const HIVE_RETRIES = 2;
/** The waits before each retry when Hive doesn't say how long (Retry-After), and the most it may ask for. */
const HIVE_BACKOFF_MS = [1500, 4000];
const HIVE_WAIT_MAX_MS = 8000;

/** How long Hive asked to wait (Retry-After, seconds or a date), capped; null when it didn't say. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, HIVE_WAIT_MAX_MS) : null;
}

/** Every { class, value|score } pair in a reply, wherever it sits (per frame). */
export function classScores(body: unknown): { cls: string; score: number }[] {
  const out: { cls: string; score: number }[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const n = typeof o.value === "number" ? o.value : o.score;
      if (typeof o.class === "string" && typeof n === "number") out.push({ cls: o.class, score: n });
      Object.values(o).forEach(walk);
    }
  };
  walk(body);
  return out;
}

/**
 * The VLM's answer, upper-cased: the `answer` of its JSON reply (AGE_FORMAT), or, from a reply that isn't a JSON object
 * (a model ignoring the schema), the first word, as before the schema. A JSON reply without a string answer is no
 * answer. The caller refuses anything but ADULTS, so whatever this can't read fails closed.
 */
export function vlmAnswer(body: unknown): string {
  const b = body as { choices?: { message?: { content?: unknown } }[] };
  const content = b?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string })?.text ?? "").join(" ") : "";
  const json = jsonObject(text);
  if (json) return typeof json.answer === "string" ? json.answer.trim().toUpperCase() : "";
  return (text.trim().toUpperCase().match(/[A-Z]+/) ?? [""])[0];
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Hive answered with an error status (`status`), after any retries. */
export class HiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Whether a check failed because Hive kept answering 429: its rate limit, or (self-serve) its daily allowance. */
const endedLimited = (err: unknown): boolean => err instanceof HiveError && err.status === 429;

/**
 * One Hive call. A busy (429), down (5xx) or unreachable Hive is asked again, HIVE_RETRIES more times, after the wait it
 * asks for (Retry-After, capped) or a short backoff: on 2026-10-23 a picture was drawn, paid for and thrown away because
 * one 429 meant the check "couldn't run". Any other answer (a 4xx) fails at once. Whatever it ends on, a check that can't
 * run still refuses (the callers fail closed): nothing unchecked is ever kept. A 429 that outlasts the retries is Hive's
 * limit, not a burst: the check says so (`limited`), and lib/adult/hive-limit.ts pauses pictures and videos on it.
 */
async function hive(key: string, endpoint: string, payload: unknown): Promise<unknown> {
  const body = JSON.stringify(payload);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${key}` },
        body,
      });
    } catch (err) {
      if (attempt >= HIVE_RETRIES) throw err;
      await sleep(HIVE_BACKOFF_MS[attempt] ?? HIVE_WAIT_MAX_MS);
      continue;
    }
    if (res.ok) return res.json();
    const busy = res.status === 429 || res.status >= 500;
    if (!busy || attempt >= HIVE_RETRIES) throw new HiveError(`Hive answered ${res.status}`, res.status);
    await sleep(retryAfterMs(res.headers.get("retry-after")) ?? HIVE_BACKOFF_MS[attempt] ?? HIVE_WAIT_MAX_MS);
  }
}

/** A set (an empty place, lib/sets.ts) is refused at this NSFW score or above, or with a child present. */
export const SET_NSFW_SCORE = 0.3;

/** Checks a drawn set: moderation only (there's nobody in it to age-check). Never throws: any failure is a refusal. */
export async function checkSet(key: string | null, media: string | { base64: string; mime: string }): Promise<CheckResult> {
  if (!key) return { ok: false, reason: "the output check isn't set up (no Hive key)" };
  // fal's URL when it's just been drawn; the kept bytes when it's checked again later (fal's links expire).
  const input = typeof media === "string" ? { media_url: media } : { media_base64: media.base64 };
  try {
    const scores = classScores(await hive(key, HIVE_MODERATION, { input: [input], processing_mode: "sync_with_fallback" }));
    if (!scores.some((s) => s.cls === "no_child_present" || s.cls === "yes_child_present")) return { ok: false, reason: "moderation reply had no child scores" };
    const bad = scores.find((s) => (MODERATION_CHILD.includes(s.cls) && s.score >= CHILD_SCORE) || (s.cls === "general_nsfw" && s.score >= SET_NSFW_SCORE));
    return bad ? { ok: false, reason: `moderation: ${bad.cls} ${bad.score.toFixed(2)}` } : { ok: true };
  } catch (err) {
    return couldntRun(err);
  }
}

/** A check that couldn't run: a refusal (fail closed), `limited` when Hive kept answering 429. */
function couldntRun(err: unknown): CheckResult {
  const reason = `the check couldn't run (${err instanceof Error ? err.message : "error"})`;
  return endedLimited(err) ? { ok: false, reason, limited: true } : { ok: false, reason };
}

/** A file to check: fal's URL, or the bytes themselves (Venice returns them, with no URL). */
export type Checkable = string | { base64: string; mime: string };

/**
 * What a check asks Hive, by what the file is for:
 *  - "image": a picture shown as a still (a baseline, a scene or menu picture): moderation and the age question.
 *  - "video": a shot or clip, before it's kept: moderation, on its frames.
 *  - "keyframe": a picture made only to start a shot: the age question alone, and still nothing but ADULTS passes. Its
 *    moderation comes with the shot's, which samples the shot's frames, the first of them this keyframe; it's never
 *    shown on its own before that passes (lib/adult/media.ts FRAME_SHOWN). Self-serve Hive's daily cap counts
 *    moderation requests only, so a 6-shot video asks for 6 of them, not 12 (2026-10-23, docs/after-dark-costs.md).
 */
export type CheckKind = "image" | "video" | "keyframe";

/** Checks a file a provider returned. Never throws: any failure is a refusal. */
export async function checkOutput(key: string | null, media: Checkable, kind: CheckKind = "image"): Promise<CheckResult> {
  if (!key) return { ok: false, reason: "the output check isn't set up (no Hive key)" };
  const url = typeof media === "string" ? media : `data:${media.mime};base64,${media.base64}`;
  const input = typeof media === "string" ? { media_url: media } : { media_base64: media.base64 };
  try {
    const moderated = kind !== "keyframe";
    const aged = kind !== "video";
    // One after the other, not both at once: Hive rate-limits a burst, and a picture's two checks were half of one.
    const mod = moderated ? await hive(key, HIVE_MODERATION, { input: [input], processing_mode: "sync_with_fallback" }) : null;
    const vlm = aged ? await hive(key, HIVE_VLM, ageCheckRequest(url)) : null;
    if (moderated) {
      const modScores = classScores(mod);
      if (!modScores.some((s) => s.cls === "no_child_present" || s.cls === "yes_child_present")) return { ok: false, reason: "moderation reply had no child scores" };
      const child = modScores.find((s) => MODERATION_CHILD.includes(s.cls) && s.score >= CHILD_SCORE);
      if (child) return { ok: false, reason: `moderation: ${child.cls} ${child.score.toFixed(2)}` };
    }
    if (aged) {
      const answer = vlmAnswer(vlm);
      if (answer !== "ADULTS") return { ok: false, reason: `age check: ${answer || "no answer"}` };
    }
    return { ok: true };
  } catch (err) {
    return couldntRun(err);
  }
}

/**
 * The picture the probe sends (lib/adult/hive-limit.ts): a plain grey 192×192 PNG, nobody in it, inline so the probe
 * doesn't depend on the site being reachable from Hive.
 */
export const PROBE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAABYElEQVR42u3SMQ0AAAzDsPKHULSlMGmvDSFKCg+RAANhIAyEgcBAGAgDYSAwEAbCQBgIDISBMBAGAgNhIAyEgTAQGAgDYSAMBAbCQBgIA4GBMBAGwkBgIAyEgTAQBgIDYSAMhIHAQBgIA2EgMBAGwkAYCAyEgTAQBgIDYSAMhIEwEBgIA2EgDAQGwkAYCAOBgTAQBsJAYCAMhIEwEAYCA2EgDISBwEAYCANhIDAQBsJAGAgMhIEwEAbCQGAgDISBMBAYCANhIAwEBsJAGAgDgYEwEAbCQGAgDISBMBAGAgNhIAyEgcBAGAgDYSAwEAbCQBgIDISBMBAGwkBgIAyEgTAQGAgDYSAMBAbCQBgIA4GBMBAGwkAYCAyEgTAQBgIDYSAMhIHAQBgIA2EgMBAGwkAYCAyEgTAQBsJAYCAMhIEwEBgIA2EgDAQGwkAYCAOBgTAQBsJAGAgMhIEwEAaCqwEyu+8uG/pLDgAAAABJRU5ErkJggg==";

/**
 * Whether Hive is over its limit, for one moderation call on PROBE_PNG (no retry: the one call is the point). "ok": it
 * answered; "limited": it answered 429; "unknown": anything else (down, unreachable, a refused key), which says nothing
 * about the limit. Never throws.
 */
export async function probeHive(key: string): Promise<"ok" | "limited" | "unknown"> {
  try {
    const res = await doFetch(HIVE_MODERATION, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: [{ media_base64: PROBE_PNG }], processing_mode: "sync_with_fallback" }),
    });
    await res.text().catch(() => "");
    return res.ok ? "ok" : res.status === 429 ? "limited" : "unknown";
  } catch {
    return "unknown";
  }
}
