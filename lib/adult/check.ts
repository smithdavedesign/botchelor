/**
 * After dark's output check (docs/after-dark.md #1; David, 2026-10-18: "Hive is fine", nothing Amazon). Every picture or
 * clip fal returns is checked BEFORE it is stored; a failure is discarded, never stored, and only the reason is logged.
 *
 * One Hive secret key (its V3 API, Bearer auth), two models on the returned file:
 *  1. hive/visual-moderation: refuse if its child head (yes_child_present) fires, on any frame.
 *  2. hive/vision-language-model, on pictures: asked whether everyone shown is clearly an adult; anything but a plain
 *     "ADULTS" (a possible minor, unsure, nobody visible, an unreadable answer) is a refusal.
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

export const AGE_QUESTION =
  "Look at every person in this image. Answer with exactly one word: ADULTS if every person shown clearly appears to be 18 or older; MINOR if anyone could be under 18; UNSURE if you can't tell or no person is visible.";

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

/** The VLM's answer: the chat-completions text, upper-cased, first word only. */
export function vlmAnswer(body: unknown): string {
  const b = body as { choices?: { message?: { content?: unknown } }[] };
  const content = b?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string })?.text ?? "").join(" ") : "";
  return (text.trim().toUpperCase().match(/[A-Z]+/) ?? [""])[0];
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
      kind === "image"
        ? hive(key, HIVE_VLM, {
            model: "hive/vision-language-model",
            temperature: 0,
            max_tokens: 5,
            messages: [{ role: "user", content: [{ type: "text", text: AGE_QUESTION }, { type: "media_url", media_url: { url } }] }],
          })
        : Promise.resolve(null),
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
