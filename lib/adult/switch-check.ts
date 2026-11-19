/**
 * The age check when a person switches one of their own characters into After Dark (David, 2026-11-18: "if they are
 * flagged as too young then we can call it out to the user and this way we gate characters from this"). The same two
 * questions the show's agent cast answers before it opens (lib/adult/agent-cast.ts), asked of this one character:
 *  1. Their sheet, read by a model: 18 or older, and nothing in it reads young. A stated age under 18 fails without a call.
 *  2. Their portrait, asked Hive's age question (lib/adult/moderation.ts checkMedia, "keyframe"), the one every After
 *     Dark picture gets. A character with no approved portrait is judged on the sheet alone: every picture After Dark
 *     later draws of them is asked the same question before anyone sees it.
 * A verdict is kept (adult_switch_checks) with a signature of the sheet and the portrait it read, so it's asked again
 * only when one of them changes. When a check can't run (the model didn't answer, Hive is out for the day or paused,
 * or this person has asked too many times today) nothing is kept and the switch stays off with "pending": try later.
 * The house cast and the agent cast After Dark already opened are curated, and pass without a check.
 */
import { createHash } from "node:crypto";
import { companionModel } from "../companion";
import { jsonOf } from "../companion-prompt";
import type { Db } from "../db";
import { overLimit } from "../limits";
import type { Model } from "../model";
import { siteUrl } from "../site";
import { checkMedia } from "./moderation";

/** Checks a person may start an hour and a day: each can cost one of Hive's 100 a day, shared by all of After Dark. */
export const SWITCH_CHECK_LIMITS = { perHour: 6, perDay: 12 };

export type SwitchAgeCheck = { state: "passed" } | { state: "too_young"; message: string } | { state: "pending"; message: string };

const AGE_PROMPT = `You check one fictional character before an adult (18+) romance product may use them.
Answer in JSON only: {"adult": true|false, "reason": "one short sentence"}.
"adult" is true only when they are 18 or older AND nothing in the sheet reads young: no school or school year, no teen
or childlike wording, no "girl", "boy" or "kid" for themselves, no childish looks, body or behaviour.`;

let modelForTests: Model | null = null;
/** Tests: the model the sheet check asks (null restores the companion model). */
export function setSwitchCheckModelForTests(m: Model | null): void {
  modelForTests = m;
}

type Row = {
  name: string;
  age: number;
  bio: string;
  traits: unknown;
  want: string;
  dealbreaker: string;
  appearance: string | null;
  voice: string | null;
  extras: unknown;
  is_house: boolean;
  after_dark_open: boolean;
  portrait: string | null;
};

/** What the verdict was read from: the sheet's words and the portrait asked about. A change to either asks again. */
export const switchSignature = (r: Row): string =>
  createHash("sha256")
    .update(JSON.stringify([r.name, r.age, r.bio, r.traits, r.want, r.dealbreaker, r.appearance, r.voice, r.extras, r.portrait]))
    .digest("hex");

const tooYoung = (name: string, why: string): SwitchAgeCheck => ({ state: "too_young", message: `${name} ${why} After Dark is for characters who are clearly grown adults, so they stay out.` });
const SHEET_WHY = "reads too young in their profile. Make it plain they're a grown adult (their age, how they're described), then try again.";
const PORTRAIT_WHY = "looks too young in their portrait. Give them a portrait where they clearly look like an adult, then try again.";

/**
 * Whether this character may be switched on: passed, too young (with what to change), or pending (try later). Only
 * call it for a character the person may switch (their own, or a house one); it spends a model call and a Hive check
 * the first time and after each change, and nothing when a kept verdict still fits.
 */
export async function switchAgeCheck(db: Db, ownerId: string, characterId: string): Promise<SwitchAgeCheck> {
  const r = (
    await db.query<Row>(
      `select c.name, c.age, c.bio, c.traits, c.want, c.dealbreaker, c.appearance, c.voice, c.extras, c.is_house, c.after_dark_open,
              (select a.id from character_assets a
                where a.character_id = c.id and a.kind = 'portrait' and a.review_status = 'approved' and a.url is not null and a.content_rating = 'pg'
                order by a.created_at desc limit 1) as portrait
         from characters c where c.id = $1`,
      [characterId],
    )
  ).rows[0];
  if (!r) return { state: "pending", message: "No such character." };
  if (r.is_house || r.after_dark_open) return { state: "passed" };
  const sig = switchSignature(r);
  const kept = (await db.query<{ ok: boolean; reason: string }>(`select ok, reason from adult_switch_checks where character_id = $1 and sig = $2`, [characterId, sig])).rows[0];
  if (kept) return kept.ok ? { state: "passed" } : tooYoung(r.name, kept.reason === "portrait" ? PORTRAIT_WHY : SHEET_WHY);
  const keep = async (ok: boolean, reason: "passed" | "sheet" | "portrait") => {
    await db.query(
      `insert into adult_switch_checks (character_id, sig, ok, reason, checked_at) values ($1, $2, $3, $4, now())
       on conflict (character_id) do update set sig = excluded.sig, ok = excluded.ok, reason = excluded.reason, checked_at = now()`,
      [characterId, sig, ok, reason],
    );
  };
  // A stated age under 18 needs no call (the table refuses one anyway; this is the belt to its braces).
  if (!(r.age >= 18)) {
    await keep(false, "sheet");
    return tooYoung(r.name, SHEET_WHY);
  }
  if (await overLimit(db, "after_dark_switch_check", ownerId, SWITCH_CHECK_LIMITS)) {
    return { state: "pending", message: "That's a lot of age checks today. Try switching them in again tomorrow." };
  }
  const sheet = JSON.stringify({ name: r.name, age: r.age, bio: r.bio, traits: r.traits, want: r.want, dealbreaker: r.dealbreaker, appearance: r.appearance, voice: r.voice, extras: r.extras ?? {} });
  let adult: boolean;
  try {
    const model = modelForTests ?? (await companionModel(db));
    const v = jsonOf(await model.complete([{ role: "system", content: AGE_PROMPT }, { role: "user", content: sheet.slice(0, 6000) }], { temperature: 0, maxTokens: 150 })) as { adult?: unknown } | null;
    if (typeof v?.adult !== "boolean") throw new Error("unreadable");
    adult = v.adult;
  } catch {
    return { state: "pending", message: "The age check didn't answer just now. Try switching them in again in a minute." };
  }
  if (!adult) {
    await keep(false, "sheet");
    return tooYoung(r.name, SHEET_WHY);
  }
  if (r.portrait) {
    const v = await checkMedia(db, new URL(`/api/assets/${r.portrait}`, siteUrl()).toString(), "keyframe");
    if (!v.ok && (v.unavailable || v.paused)) {
      return { state: "pending", message: "Their portrait's age check can't run right now (it's limited each day). Try switching them in again tomorrow." };
    }
    if (!v.ok) {
      await keep(false, "portrait");
      return tooYoung(r.name, PORTRAIT_WHY);
    }
  }
  await keep(true, "passed");
  return { state: "passed" };
}
