/**
 * After Dark's agent cast (David, 2026-11-04: "Can we not take agent made characters to after dark? seems like a missed
 * opportunity"): the show's own agent-made characters (lib/recast.ts; made over MCP by our own agents, lib/our-traffic.ts
 * loadOurIds) join every person's After Dark like the house cast, once they pass two checks:
 *  1. Their sheet, read by a model: an adult who reads as one, with a person's body (an alien or a vampire is fine), not based on a real person, and
 *     written so a romantic, adult scene suits them. One cheap call each, run by an admin (/api/admin/after-dark/agent-cast).
 *  2. Their portrait, asked Hive's age question (lib/adult/moderation.ts checkMedia, "keyframe": the question alone),
 *     the same one every After Dark picture gets. Hive self-serve stops at 100 checks a day for all of After Dark, so
 *     After Dark's daily job asks PORTRAITS_PER_DAY at most and the rest wait for the next day.
 * Passing both sets characters.after_dark_open. An outside agent's character never joins: its maker never agreed to it.
 * Every verdict is kept in adult_cast_checks, with why, and a character that fails isn't asked again.
 */
import type { Db } from "../db";
import { companionModel } from "../companion";
import { jsonOf } from "../companion-prompt";
import type { Model } from "../model";
import { loadOurIds } from "../our-traffic";
import { DELETED_OWNER } from "../rules";
import { siteUrl } from "../site";
import { checkMedia } from "./moderation";

/** Portraits asked a day: about a third of Hive's 100, leaving the rest to the people using After Dark. */
export const PORTRAITS_PER_DAY = 30;

/**
 * The show's own agent-made characters, by the same rule companions open them by (lib/companion.ts openOurAgentCast),
 * except the ones drawn in anime (lib/looks.ts isAnime; the show's anime cast, 2026-11-08): After Dark never draws anime,
 * and anime reads young to every age check, so they stay on the show and are never asked about here.
 */
const OURS = `c.created_via = 'mcp' and not c.is_house and c.owner_id = any($1::text[]) and c.owner_id <> $2 and c.visibility <> 'private' and coalesce(c.extras->'looks'->>'style', '') <> 'anime'`;

export type SheetVerdict = { ok: boolean; reason: string };

const SHEET_PROMPT = `You review a fictional character for an adult (18+) romance product, where two characters share explicit scenes.
Answer in JSON only: {"adult": true|false, "humanoid": true|false, "real_person": true|false, "fits": true|false, "reason": "one short sentence"}.
- "adult": they are 18 or older AND nothing in the sheet reads young (no school, no teen or childlike wording, no "girl/boy" for themselves, no childish looks).
- "humanoid": true when their body is a person's: a human, and equally an alien, android, robot, cyborg, AI in a body, vampire, ghost, fae, elf, demigod, djinn, spirit, mermaid or selkie who looks like a person. Being non-human is fine; only the body matters. False only for an animal (a bird, a badger, a fox), an animal hybrid (a minotaur, a centaur, a werewolf, a catgirl), a beast (a dragon, a sasquatch, an ogre), an object or a shapeless being.
- "real_person": based on, named after or obviously modelled on a real, identifiable person (a celebrity, a politician, a public figure).
- "fits": written as someone a grown-up romantic, sexual scene suits; false if they're written purely as a joke, a mascot, or for children.`;

/** The sheet's verdict: a model's read, held to all four, and a refusal on anything unreadable (it fails closed). */
export function sheetVerdict(raw: string): SheetVerdict {
  const v = jsonOf(raw) as { adult?: unknown; humanoid?: unknown; real_person?: unknown; fits?: unknown; reason?: unknown } | null;
  const reason = typeof v?.reason === "string" ? v.reason.trim().slice(0, 200) : "";
  if (!v || typeof v.adult !== "boolean" || typeof v.humanoid !== "boolean" || typeof v.real_person !== "boolean" || typeof v.fits !== "boolean") {
    return { ok: false, reason: "The check's answer couldn't be read." };
  }
  if (!v.adult) return { ok: false, reason: `Not clearly an adult. ${reason}`.trim() };
  if (!v.humanoid) return { ok: false, reason: `Not a person's body. ${reason}`.trim() };
  if (v.real_person) return { ok: false, reason: `Based on a real person. ${reason}`.trim() };
  if (!v.fits) return { ok: false, reason: `Not written for adult scenes. ${reason}`.trim() };
  return { ok: true, reason: reason || "Passed." };
}

type SheetRow = { id: string; name: string; age: number; bio: string; traits: string[]; want: string; dealbreaker: string; appearance: string | null; extras: Record<string, unknown> | null };

let modelForTests: Model | null = null;
/** Tests: the model the sheet check asks (null restores the companion model). */
export function setAgentCastModelForTests(m: Model | null): void {
  modelForTests = m;
}

/**
 * Checks the sheets of the agent cast not checked yet (at most `limit`). A stated age under 18 fails without a call.
 * `dryRun` counts who would be checked; `recheckFailed` asks again of the ones that failed (after the check changes). Returns how many passed and failed (or would be checked).
 */
export async function checkSheets(db: Db, opts: { dryRun?: boolean; limit?: number; recheckFailed?: boolean } = {}): Promise<{ checked: number; passed: number; failed: number }> {
  const ours = await loadOurIds(db);
  const { rows } = await db.query<SheetRow>(
    `select c.id, c.name, c.age, c.bio, c.traits, c.want, c.dealbreaker, c.appearance, c.extras
       from characters c left join adult_cast_checks k on k.character_id = c.id
      where ${OURS} and (k.sheet_checked_at is null or ($4 and k.sheet_ok = false and k.portrait_checked_at is null))
      order by c.created_at limit $3`,
    [ours, DELETED_OWNER, opts.limit ?? 200, opts.recheckFailed === true],
  );
  if (opts.dryRun) return { checked: rows.length, passed: 0, failed: 0 };
  const model = modelForTests ?? (await companionModel(db));
  let passed = 0;
  let failed = 0;
  for (const c of rows) {
    let verdict: SheetVerdict;
    if (!(c.age >= 18)) verdict = { ok: false, reason: `Stated age ${c.age}.` };
    else {
      const sheet = JSON.stringify({ name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, appearance: c.appearance, extras: c.extras ?? {} });
      try {
        verdict = sheetVerdict(await model.complete([{ role: "system", content: SHEET_PROMPT }, { role: "user", content: sheet.slice(0, 6000) }], { temperature: 0, maxTokens: 200 }));
      } catch {
        continue; // the model didn't answer: left unchecked for the next run
      }
    }
    await db.query(
      `insert into adult_cast_checks (character_id, sheet_ok, sheet_reason, sheet_checked_at) values ($1, $2, $3, now())
       on conflict (character_id) do update set sheet_ok = excluded.sheet_ok, sheet_reason = excluded.sheet_reason, sheet_checked_at = now()`,
      [c.id, verdict.ok, verdict.reason],
    );
    if (verdict.ok) passed++;
    else failed++;
  }
  return { checked: passed + failed, passed, failed };
}

/**
 * Asks Hive's age question of the portraits whose sheets passed and that haven't been asked yet, `max` at most, and opens
 * each that passes to After Dark. Stops at the first check that couldn't run (Hive down, paused or out for the day):
 * nothing is recorded for it, so it's asked again on the next run. The portrait is the newest approved one a model drew.
 */
export async function checkPortraits(db: Db, opts: { max?: number } = {}): Promise<{ checked: number; opened: number; failed: number; stopped: string | null }> {
  const ours = await loadOurIds(db);
  const { rows } = await db.query<{ id: string; asset: string | null }>(
    `select c.id,
            (select a.id from character_assets a
              where a.character_id = c.id and a.kind = 'portrait' and a.review_status = 'approved' and a.url is not null
                and a.content_rating = 'pg' and a.source_type = 'generated'
              order by a.created_at desc limit 1) as asset
       from characters c join adult_cast_checks k on k.character_id = c.id
      where ${OURS} and k.sheet_ok and k.portrait_checked_at is null
      order by c.created_at limit $3`,
    [ours, DELETED_OWNER, opts.max ?? PORTRAITS_PER_DAY],
  );
  let opened = 0;
  let failed = 0;
  for (const r of rows) {
    let ok: boolean;
    let reason: string;
    if (!r.asset) {
      ok = false;
      reason = "No approved portrait to check.";
    } else {
      const v = await checkMedia(db, new URL(`/api/assets/${r.asset}`, siteUrl()).toString(), "keyframe");
      if (!v.ok && (v.unavailable || v.paused)) return { checked: opened + failed, opened, failed, stopped: v.reason };
      ok = v.ok;
      reason = v.ok ? "Hive: adults." : v.reason.slice(0, 200);
    }
    await db.query(`update adult_cast_checks set portrait_ok = $2, portrait_reason = $3, portrait_checked_at = now() where character_id = $1`, [r.id, ok, reason]);
    if (ok) {
      await db.query(`update characters set after_dark_open = true where id = $1`, [r.id]);
      opened++;
    } else failed++;
  }
  return { checked: opened + failed, opened, failed, stopped: null };
}

/** Takes one out of After Dark again (an admin's call); its checks stay on record. */
export async function closeAgentCastMember(db: Db, characterId: string): Promise<boolean> {
  return (await db.query(`update characters set after_dark_open = false where id = $1 and after_dark_open returning id`, [characterId])).rows.length > 0;
}

export type AgentCastStatus = {
  ours: number;
  sheets: { waiting: number; passed: number; failed: number };
  portraits: { waiting: number; passed: number; failed: number };
  open: number;
  failures: { id: string; name: string; reason: string }[];
};

/** Where the agent cast stands: who's waiting on which check, who's in, and why each one that failed did. */
export async function agentCastStatus(db: Db): Promise<AgentCastStatus> {
  const ours = await loadOurIds(db);
  const { rows } = await db.query<{ id: string; name: string; open: boolean; sheet_ok: boolean | null; sheet_reason: string | null; portrait_ok: boolean | null; portrait_reason: string | null }>(
    `select c.id, c.name, c.after_dark_open as open, k.sheet_ok, k.sheet_reason, k.portrait_ok, k.portrait_reason
       from characters c left join adult_cast_checks k on k.character_id = c.id
      where ${OURS} order by c.name`,
    [ours, DELETED_OWNER],
  );
  const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  return {
    ours: rows.length,
    sheets: { waiting: n((r) => r.sheet_ok === null), passed: n((r) => r.sheet_ok === true), failed: n((r) => r.sheet_ok === false) },
    portraits: { waiting: n((r) => r.sheet_ok === true && r.portrait_ok === null), passed: n((r) => r.portrait_ok === true), failed: n((r) => r.portrait_ok === false) },
    open: n((r) => r.open),
    failures: rows
      .filter((r) => r.sheet_ok === false || r.portrait_ok === false)
      .map((r) => ({ id: r.id, name: r.name, reason: (r.sheet_ok === false ? r.sheet_reason : r.portrait_reason) ?? "" })),
  };
}
