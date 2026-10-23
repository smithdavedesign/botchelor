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
 * from a picture that already passed both, and its frames go through moderation again.
 * The check FAILS CLOSED: no key, an error, or an unreadable reply is a refusal.
 * Self-serve Hive doesn't include its CSAM classifier (Enterprise only); add it before anyone but the admin uses this.
 */

export type CheckResult = { ok: true } | { ok: false; reason: string };

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

async function hive(key: string, endpoint: string, payload: unknown): Promise<unknown> {
  const res = await doFetch(endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Hive answered ${res.status}`);
  return res.json();
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
    return { ok: false, reason: `the check couldn't run (${err instanceof Error ? err.message : "error"})` };
  }
}

/** A file to check: fal's URL, or the bytes themselves (Venice returns them, with no URL). */
export type Checkable = string | { base64: string; mime: string };

/** Checks a file a provider returned. Never throws: any failure is a refusal. */
export async function checkOutput(key: string | null, media: Checkable, kind: "image" | "video" = "image"): Promise<CheckResult> {
  if (!key) return { ok: false, reason: "the output check isn't set up (no Hive key)" };
  const url = typeof media === "string" ? media : `data:${media.mime};base64,${media.base64}`;
  const input = typeof media === "string" ? { media_url: media } : { media_base64: media.base64 };
  try {
    const [mod, vlm] = await Promise.all([
      hive(key, HIVE_MODERATION, { input: [input], processing_mode: "sync_with_fallback" }),
      kind === "image" ? hive(key, HIVE_VLM, ageCheckRequest(url)) : Promise.resolve(null),
    ]);
    const modScores = classScores(mod);
    if (!modScores.some((s) => s.cls === "no_child_present" || s.cls === "yes_child_present")) return { ok: false, reason: "moderation reply had no child scores" };
    const child = modScores.find((s) => MODERATION_CHILD.includes(s.cls) && s.score >= CHILD_SCORE);
    if (child) return { ok: false, reason: `moderation: ${child.cls} ${child.score.toFixed(2)}` };
    if (kind === "image") {
      const answer = vlmAnswer(vlm);
      if (answer !== "ADULTS") return { ok: false, reason: `age check: ${answer || "no answer"}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `the check couldn't run (${err instanceof Error ? err.message : "error"})` };
  }
}
