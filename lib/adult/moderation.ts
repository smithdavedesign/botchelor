/**
 * Which checker checks (docs/PRDs/studio.md section 9; David, 2026-10-24: "Hive is a bottleneck atm, so it might be worth
 * adding an alternative too. Everything should be configurable"). Every picture and video still passes a check before
 * it's kept, and every check still fails closed; what's configurable is who checks, in `adult_settings.moderation`.
 *
 * The checkers:
 *  - **Hive** (lib/adult/check.ts): moderation (its child classifier) and its vision model's age question, behind its
 *    circuit breaker (lib/adult/hive-limit.ts). Self-serve allows 100 moderation requests a day, shared with the show.
 *  - **venice_vlm:** the same age question (AGE_QUESTION, held to three answers by AGE_FORMAT) to a vision model on
 *    Venice (`vlm_model`, `qwen3-vl-235b-a22b` by default: run by Venice, no daily cap, about $0.0003 a check). It reads
 *    generated faces, which face-age models don't. Only ADULTS passes.
 *  - **sightengine:** its `face-age` model's minor probability per face (`sightengine_minor_max`). Its docs say it gives
 *    no age for "artificial" faces, so a generated picture can come back unscored: that refuses (UNSURE).
 *  - **endpoint:** a URL of our own (an in-house age model later), POSTed the picture, answering
 *    {"answer": "ADULTS" | "MINOR" | "UNSURE"}.
 *
 * The modes (`mode`): `hive` (as before), `hive_then_alt` (Hive; when it's paused or can't run, the alternatives),
 * `both` (Hive and the alternatives must all pass), `alt` (the alternatives only). In the alternatives, any refusal
 * refuses, and at least `min_sources` of them must have run and passed. The show's own checks (place sets, look tiles,
 * season portraits) go to Hive or, with `pg_via: "alt"`, to the alternatives asked the show's question (no nudity,
 * everyone an adult), which leaves Hive's 100 for After Dark. Videos stay on Hive: the alternatives don't read video.
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { AGE_FORMAT, AGE_QUESTION, checkOutput, checkSet, vlmAnswer, type Checkable, type CheckKind, type CheckResult } from "./check";
import { hiveGate, underHiveLimit, type HiveGate } from "./hive-limit";
import { DEFAULT_ADMIN_CHECKER, type AdminChecker, type AltChecker, type ModerationConfig } from "./moderation-config";
import { adultKeys, getAdultSettings } from "./settings";

/** What's being checked: an After Dark picture or keyframe (the age question), a video, or one of the show's own (PG). */
export type MediaKind = CheckKind | "set" | "pg_image";
const isPg = (k: MediaKind) => k === "set" || k === "pg_image";

/** The show's question, for a place set or a PG picture: no nudity, and everyone (if anyone) an adult. */
export const PG_QUESTION =
  'Look at this image. Answer SAFE if it shows no nudity and no sexual content, and every person shown (if any) clearly appears to be 18 or older; UNSAFE if there is any nudity or sexual content or anyone could be under 18; UNSURE if you can\'t tell. Reply with JSON only: {"answer": "SAFE" | "UNSAFE" | "UNSURE"}.';
const PG_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "pg_check",
    schema: { type: "object", properties: { answer: { type: "string", enum: ["SAFE", "UNSAFE", "UNSURE"] } }, required: ["answer"], additionalProperties: false },
    strict: true,
  },
} as const;

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
/** Tests stub the alternatives' calls. */
export function setModerationFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

export const VENICE_CHAT = "https://api.venice.ai/api/v1/chat/completions";
export const SIGHTENGINE_CHECK = "https://api.sightengine.com/1.0/check.json";

/** A checker's answer: passed, refused (a verdict), or couldn't run (no verdict at all). */
type Alt = { checker: AltChecker; result: "pass" | "refuse" | "error"; reason: string };

const dataUri = (m: Checkable) => (typeof m === "string" ? m : `data:${m.mime};base64,${m.base64}`);

async function veniceVlm(key: string, model: string, media: Checkable, pg: boolean): Promise<Alt> {
  const checker: AltChecker = "venice_vlm";
  try {
    const res = await doFetch(VENICE_CHAT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 32,
        response_format: pg ? PG_FORMAT : AGE_FORMAT,
        venice_parameters: { include_venice_system_prompt: false },
        messages: [{ role: "user", content: [{ type: "text", text: pg ? PG_QUESTION : AGE_QUESTION }, { type: "image_url", image_url: { url: dataUri(media) } }] }],
      }),
    });
    if (!res.ok) return { checker, result: "error", reason: `Venice answered ${res.status}` };
    const answer = vlmAnswer(await res.json());
    const pass = pg ? answer === "SAFE" : answer === "ADULTS";
    return { checker, result: pass ? "pass" : "refuse", reason: `${pg ? "the show's check" : "age check"} (Venice): ${answer || "no answer"}` };
  } catch (err) {
    return { checker, result: "error", reason: `Venice couldn't be reached (${err instanceof Error ? err.message.slice(0, 120) : "error"})` };
  }
}

/** Sightengine's face-age: each face's minor probability; a picture with no ageable face refuses (people pictures only). */
async function sightengine(user: string, secret: string, media: Checkable, max: number, kind: MediaKind): Promise<Alt> {
  const checker: AltChecker = "sightengine";
  try {
    let res: Response;
    if (typeof media === "string") {
      const q = new URLSearchParams({ url: media, models: "face-age", api_user: user, api_secret: secret });
      res = await doFetch(`${SIGHTENGINE_CHECK}?${q}`);
    } else {
      const form = new FormData();
      form.append("media", new Blob([Buffer.from(media.base64, "base64")], { type: media.mime }), "picture");
      form.append("models", "face-age");
      form.append("api_user", user);
      form.append("api_secret", secret);
      res = await doFetch(SIGHTENGINE_CHECK, { method: "POST", body: form });
    }
    if (!res.ok) return { checker, result: "error", reason: `Sightengine answered ${res.status}` };
    const body = (await res.json()) as { status?: string; faces?: { attributes?: { age?: { minor?: number } } }[]; artificial_faces?: unknown[]; error?: { message?: string } };
    if (body.status !== "success") return { checker, result: "error", reason: `Sightengine: ${body.error?.message ?? "failure"}` };
    const minors = (body.faces ?? []).map((f) => f.attributes?.age?.minor).filter((x): x is number => typeof x === "number");
    // A place set has nobody in it: no face is the right answer there.
    if (!minors.length) {
      if (kind === "set") return { checker, result: "pass", reason: "no face (a place)" };
      return { checker, result: "refuse", reason: `age check (Sightengine): UNSURE (${(body.artificial_faces ?? []).length ? "only faces it calls artificial" : "no face it could age"})` };
    }
    const worst = Math.max(...minors);
    return { checker, result: worst > max ? "refuse" : "pass", reason: `age check (Sightengine): minor ${worst.toFixed(2)}` };
  } catch (err) {
    return { checker, result: "error", reason: `Sightengine couldn't be reached (${err instanceof Error ? err.message.slice(0, 120) : "error"})` };
  }
}

/** Our own endpoint: POST {image, kind}, answer {"answer": "ADULTS" | "MINOR" | "UNSURE"} (or SAFE for the show's). */
async function endpoint(url: string, key: string | null, media: Checkable, kind: MediaKind): Promise<Alt> {
  const checker: AltChecker = "endpoint";
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ image: dataUri(media), kind }),
    });
    if (!res.ok) return { checker, result: "error", reason: `the endpoint answered ${res.status}` };
    const answer = String(((await res.json()) as { answer?: unknown }).answer ?? "").trim().toUpperCase();
    const pass = isPg(kind) ? answer === "SAFE" || answer === "ADULTS" : answer === "ADULTS";
    return { checker, result: pass ? "pass" : "refuse", reason: `age check (endpoint): ${answer || "no answer"}` };
  } catch (err) {
    return { checker, result: "error", reason: `the endpoint couldn't be reached (${err instanceof Error ? err.message.slice(0, 120) : "error"})` };
  }
}

type Keys = Awaited<ReturnType<typeof adultKeys>>;

/** The alternatives that can run now: configured, with what they need. */
export function readyAlts(m: ModerationConfig, keys: Pick<Keys, "venice" | "sightengine" | "moderation_endpoint">): AltChecker[] {
  return m.alts.filter((a) => (a === "venice_vlm" ? Boolean(keys.venice) : a === "sightengine" ? Boolean(m.sightengine_user && keys.sightengine) : Boolean(m.endpoint_url)));
}

/** The alternatives' verdict: any refusal refuses; fewer than `min_sources` passes is no verdict (the check couldn't run). */
async function runAlts(m: ModerationConfig, keys: Keys, media: Checkable, kind: MediaKind): Promise<CheckResult & { via?: string[] }> {
  if (kind === "video") return { ok: false, reason: "the check couldn't run (videos are checked by Hive only)" };
  const ready = readyAlts(m, keys);
  if (!ready.length) return { ok: false, reason: "the check couldn't run (no alternative checker is set up)" };
  const pg = isPg(kind);
  const results: Alt[] = [];
  for (const a of ready) {
    results.push(
      a === "venice_vlm"
        ? await veniceVlm(keys.venice!, m.vlm_model, media, pg)
        : a === "sightengine"
          ? await sightengine(m.sightengine_user!, keys.sightengine!, media, m.sightengine_minor_max, kind)
          : await endpoint(m.endpoint_url!, keys.moderation_endpoint, media, kind),
    );
  }
  const refused = results.find((r) => r.result === "refuse");
  if (refused) return { ok: false, reason: refused.reason };
  const passed = results.filter((r) => r.result === "pass");
  const need = Math.min(m.min_sources, ready.length) || 1;
  if (passed.length < need) {
    const err = results.find((r) => r.result === "error");
    return { ok: false, reason: `the check couldn't run (${err?.reason ?? "too few checkers answered"})` };
  }
  return { ok: true, via: passed.map((p) => p.checker) };
}

/** Hive's own check for a kind, held to its breaker. */
const hiveCheck = (db: Db, keys: Keys, media: Checkable, kind: MediaKind): Promise<CheckResult> =>
  underHiveLimit(db, () => (kind === "set" ? checkSet(keys.hive, media) : checkOutput(keys.hive, media, kind === "pg_image" ? "image" : kind)));

/** Hive gave no verdict (paused, busy, down, or no key): the alternatives may stand in, in `hive_then_alt`. */
const noVerdict = (v: CheckResult): boolean => !v.ok && /^(the check couldn't run|the output check isn't set up)/.test(v.reason);

/**
 * Dev only (David, 2026-10-24: "disable it [Hive] when developing so we can be unblocked"). With `MODERATION_DEV_OFF=1`
 * off production, the output check doesn't go to Hive: a ready alternative checks instead (the Venice vision model, no
 * daily cap), and with none set up (or for a video, which the alternatives can't read) it passes without a check. This
 * keeps local and preview work off Hive's 100-a-day limit. It can NEVER fire on production: `VERCEL_ENV === "production"`
 * ignores the flag, so prod always runs the configured mode. Tests don't set the flag, so it's inert there too.
 */
export function devModerationOff(e: Record<string, string | undefined> = process.env): boolean {
  return e.VERCEL_ENV !== "production" && e.MODERATION_DEV_OFF === "1";
}

/** The dev-off check: a ready alternative if there is one (never for a video), else a pass with no check. */
async function devCheck(m: ModerationConfig, keys: Keys, media: Checkable, kind: MediaKind): Promise<CheckResult & { via?: string[] }> {
  if (kind !== "video" && readyAlts(m, keys).length) return runAlts(m, keys, media, kind);
  return { ok: true, via: ["dev"] };
}

/** Whose picture it is, when the caller knows (an admin's own go to `admin_checker`). */
export type CheckFor = { owner?: string | null };

let adminCheckerDefault: AdminChecker = DEFAULT_ADMIN_CHECKER;
/**
 * Tests hold an admin's pictures to the mode (Hive) unless a test sets `admin_checker` itself
 * (tests/setup-no-live-checks.ts); null puts the real default back.
 */
export function setAdminCheckerDefaultForTests(v: AdminChecker | null): void {
  adminCheckerDefault = v ?? DEFAULT_ADMIN_CHECKER;
}
/** Who checks an admin's own pictures: the setting, or the default when it's unset. */
export const adminCheckerOf = (m: ModerationConfig): AdminChecker => m.admin_checker ?? adminCheckerDefault;

/**
 * Whether an admin's own picture is checked by the alternatives instead of Hive (`admin_checker: "alt"`, the default):
 * the owner is an admin and an alternative is ready. Never for a video, nor for the show's own pictures.
 */
async function adminOnAlts(db: Db, m: ModerationConfig, keys: Keys, kind: MediaKind, who: CheckFor): Promise<boolean> {
  if (!who.owner || adminCheckerOf(m) !== "alt" || kind === "video" || isPg(kind)) return false;
  if (!readyAlts(m, keys).length) return false;
  return isAdmin(db, who.owner);
}

/**
 * The check, by the configured mode (an admin's own pictures, by `admin_checker`). Never throws; fails closed. The
 * verdict says which checkers passed it (`via`) when an alternative did.
 */
export async function checkMedia(db: Db, media: Checkable, kind: MediaKind, who: CheckFor = {}): Promise<CheckResult & { via?: string[] }> {
  const m = (await getAdultSettings(db)).moderation;
  const keys = await adultKeys(db);
  if (devModerationOff()) return devCheck(m, keys, media, kind);
  if (await adminOnAlts(db, m, keys, kind, who)) return runAlts(m, keys, media, kind);
  if (isPg(kind)) return m.pg_via === "alt" ? runAlts(m, keys, media, kind) : hiveCheck(db, keys, media, kind);
  if (m.mode === "alt") return runAlts(m, keys, media, kind);
  const h = await hiveCheck(db, keys, media, kind);
  if (m.mode === "hive" || kind === "video") return h;
  if (m.mode === "both") {
    if (!h.ok) return h;
    const a = await runAlts(m, keys, media, kind);
    return a.ok ? { ok: true, ...("nsfw" in h ? { nsfw: (h as { nsfw?: number }).nsfw } : {}), via: ["hive", ...(a.via ?? [])] } : a;
  }
  // hive_then_alt: Hive's verdict stands; only when it gave none do the alternatives check.
  if (h.ok || !noVerdict(h)) return h;
  return runAlts(m, keys, media, kind);
}

/**
 * Asked before anything is drawn: Hive's breaker (hiveGate), unless the mode lets the alternatives check while Hive is
 * paused (`hive_then_alt` with one ready), or doesn't use Hive at all (`alt`, the show's `pg_via: "alt"`, or an admin's
 * own picture with `admin_checker: "alt"`). Videos (`video: true`) always need Hive.
 */
export async function mediaGate(db: Db, opts: { pg?: boolean; video?: boolean; probe?: boolean } & CheckFor = {}): Promise<HiveGate> {
  const m = (await getAdultSettings(db)).moderation;
  const keys = await adultKeys(db);
  if (devModerationOff()) return { ok: true };
  const alts = readyAlts(m, keys).length > 0;
  if (await adminOnAlts(db, m, keys, opts.video ? "video" : opts.pg ? "pg_image" : "image", opts)) return { ok: true };
  if (!opts.video && ((opts.pg && m.pg_via === "alt") || (!opts.pg && m.mode === "alt"))) {
    return alts ? { ok: true } : { ok: false, until: new Date(Date.now() + 60_000).toISOString(), message: "No checker is set up: add one in After Dark's settings.", reason: "not drawn: no alternative checker is set up" };
  }
  const g = await hiveGate(db, keys.hive, { probe: opts.probe });
  if (g.ok || opts.video) return g;
  return m.mode === "hive_then_alt" && !opts.pg && alts ? { ok: true } : g;
}

/**
 * Whether a checker can run: Hive's key, or (when the mode uses them) a ready alternative. `pg`: the show's own pictures,
 * by `pg_via`.
 */
export async function checkReady(db: Db, opts: { pg?: boolean } = {}): Promise<boolean> {
  if (devModerationOff()) return true;
  const s = await getAdultSettings(db);
  const keys = await adultKeys(db);
  const alts = readyAlts(s.moderation, keys).length > 0;
  if (opts.pg) return s.moderation.pg_via === "alt" ? alts : Boolean(keys.hive);
  if (s.moderation.mode === "alt") return alts;
  return Boolean(keys.hive) || (s.moderation.mode === "hive_then_alt" && alts);
}

/** A verdict rather than no verdict: the checker looked and refused (a "the check couldn't run" is none). */
export const isVerdict = (v: CheckResult): boolean => !v.ok && !/^(the check couldn't run|the output check isn't set up)/.test(v.reason);

/* ------------------------------------------- the strict PG check ------------------------------------------- */

/**
 * The PG Studio's check (docs: ~/.claude/plans/allow-studio-for-after-memoized-bird.md PR 2; David, 2026-10-25: PG checks
 * on the vision path, never Hive's 100 a day). One call to the Venice vision model with two fixed label questions, held
 * to a JSON schema like the age check: what everyone is wearing, and whether everyone is an adult. It never passes
 * nudity: the PG Studio stores only `pg` and `suggestive`, and anything more is discarded (and its tokens given back).
 *
 *  - CLOTHED → pg; SWIMWEAR → pg at a beach or a pool, suggestive anywhere else; REVEALING → suggestive;
 *  - NUDITY or SEXUAL → refused; anyone not clearly an adult → refused; no answer or an error → refused (fails closed).
 */
export const CLOTHING_LABELS = ["CLOTHED", "SWIMWEAR", "REVEALING", "NUDITY", "SEXUAL"] as const;
export type ClothingLabel = (typeof CLOTHING_LABELS)[number];

export const RATING_QUESTION =
  'Look at this image and answer two questions. "clothing": CLOTHED if everyone shown wears ordinary clothes that cover them (or nobody is shown); SWIMWEAR if anyone is in swimwear; REVEALING if anyone is in underwear, lingerie, see-through or very revealing clothing, or is posed in a sexualised way; NUDITY if any nudity shows (bare breasts, genitals or buttocks); SEXUAL if any sexual act or contact is shown. Pick the most explicit that applies. "age": ADULTS if every person shown clearly appears to be 18 or older (or nobody is shown); MINOR if anyone could be under 18; UNSURE if you can\'t tell. Reply with JSON only: {"clothing": "...", "age": "..."}.';
const RATING_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "rating_check",
    schema: {
      type: "object",
      properties: { clothing: { type: "string", enum: CLOTHING_LABELS }, age: { type: "string", enum: ["ADULTS", "MINOR", "UNSURE"] } },
      required: ["clothing", "age"],
      additionalProperties: false,
    },
    strict: true,
  },
} as const;

/** A PG Studio picture's verdict: kept with its rating, or refused (`checked`: the checker looked, rather than couldn't run). */
export type RatingVerdict = { ok: true; rating: "pg" | "suggestive"; clothing: ClothingLabel; via: string } | { ok: false; reason: string; checked: boolean };

/** How the two answers map to a rating (pure: the tests hold every row of the table). */
export function ratingFromLabels(clothing: string, age: string, opts: { beach?: boolean } = {}): RatingVerdict {
  const c = clothing.trim().toUpperCase();
  const a = age.trim().toUpperCase();
  if (a !== "ADULTS") return { ok: false, reason: `the PG check: ${a === "MINOR" ? "someone could be under 18" : "it couldn't tell everyone is an adult"}`, checked: true };
  if (c === "CLOTHED") return { ok: true, rating: "pg", clothing: c, via: "venice_vlm" };
  if (c === "SWIMWEAR") return { ok: true, rating: opts.beach ? "pg" : "suggestive", clothing: c, via: "venice_vlm" };
  if (c === "REVEALING") return { ok: true, rating: "suggestive", clothing: c, via: "venice_vlm" };
  if (c === "NUDITY" || c === "SEXUAL") return { ok: false, reason: `the PG check: ${c === "NUDITY" ? "nudity" : "sexual content"}`, checked: true };
  return { ok: false, reason: "the PG check gave no answer", checked: false };
}

/**
 * The strict PG check on a picture (bytes or a link). `beach`: the shoot is at a beach or a pool, where swimwear is PG.
 * Never throws. With `MODERATION_DEV_OFF=1` off production and no Venice key, it passes as pg without a call (dev only,
 * like every other check's dev switch).
 */
export async function checkRating(db: Db, media: Checkable, opts: { beach?: boolean } = {}): Promise<RatingVerdict> {
  const m = (await getAdultSettings(db)).moderation;
  const keys = await adultKeys(db);
  if (!keys.venice) {
    if (devModerationOff()) return { ok: true, rating: "pg", clothing: "CLOTHED", via: "dev" };
    return { ok: false, reason: "the PG check couldn't run (no Venice key in After Dark's settings)", checked: false };
  }
  try {
    const res = await doFetch(VENICE_CHAT, {
      method: "POST",
      headers: { authorization: `Bearer ${keys.venice}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: m.vlm_model,
        temperature: 0,
        max_tokens: 48,
        response_format: RATING_FORMAT,
        venice_parameters: { include_venice_system_prompt: false },
        messages: [{ role: "user", content: [{ type: "text", text: RATING_QUESTION }, { type: "image_url", image_url: { url: dataUri(media) } }] }],
      }),
    });
    if (!res.ok) return { ok: false, reason: `the PG check couldn't run (Venice answered ${res.status})`, checked: false };
    const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    let parsed: { clothing?: unknown; age?: unknown } = {};
    try {
      parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as typeof parsed;
    } catch {
      return { ok: false, reason: "the PG check gave no answer", checked: false };
    }
    return ratingFromLabels(String(parsed.clothing ?? ""), String(parsed.age ?? ""), opts);
  } catch (err) {
    return { ok: false, reason: `the PG check couldn't run (${err instanceof Error ? err.message.slice(0, 120) : "error"})`, checked: false };
  }
}
