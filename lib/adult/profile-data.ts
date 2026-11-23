/**
 * A person's After Dark profile as data they can take or wipe (GDPR Arts. 15, 17, 20; docs/after-dark-legal-review.md
 * "Privacy"): the turn-ons they saved for their characters (adult_profiles) and their limits for each pair (adult_scenes:
 * the hard nos and the intensity), with when they consented to each being stored (lib/adult/profile.ts). And their Step
 * in scenes (lib/adult/step-in.ts): each scene's set-up, its limits, and every line of it, theirs and the character's.
 *
 *  - Download: everything of it as JSON (app/api/admin/after-dark/profile, the privacy card's "Download it").
 *  - Delete: their own characters' turn-ons, and every pair's and every Step in scene's hard nos and intensity, gone; the
 *    consent goes with them (it's kept on those rows), so the box is asked again before anything is stored. A house
 *    character's turn-ons that an admin set are the show's, shared with every viewer: they're in the download, and stay,
 *    but the admin's consent on them is cleared. Account deletion (lib/account.ts) runs the same delete. A Step in
 *    scene itself is deleted from its own list (/after-dark/step-in), or with the account.
 */
import { exportMemory, setMemory } from "./step-in-memory";
import type { Db } from "../db";
import { HAS_HARD_NOS_SQL, PROFILE_CONSENT_TEXT, storedTurnOns, TURN_ONS } from "./profile";
import { storedHardNos } from "./limits";

const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
const label = (id: string) => TURN_ONS.find((t) => t.id === id)?.label ?? id;

/** One Step in scene in the download: how it was set up, its limits, its recap, and its lines as they stand. */
export type StepInSceneExport = {
  id: string;
  character_id: string;
  character_name: string | null;
  place: string;
  roleplay: unknown;
  opening: string | null;
  intensity: string | null;
  hard_nos: { chips: string[]; own: string[] };
  hard_nos_consented_at: string | null;
  recap: string | null;
  started_at: string | null;
  ended_at: string | null;
  messages: { who: "you" | "character" | "system"; text: string; at: string | null }[];
};

export type AdultProfileExport = {
  exported_at: string;
  about: string;
  consent_text: string;
  turn_ons: { character_id: string; character_name: string; house: boolean; turn_ons: string[]; consented_at: string | null; updated_at: string | null }[];
  limits: { pair: [string, string]; names: [string, string]; intensity: string | null; hard_nos: { chips: string[]; own: string[] }; hard_nos_consented_at: string | null }[];
  step_in: StepInSceneExport[];
  /** What the characters they step in with remember about them (lib/adult/step-in-memory.ts): when they turned it on, and every fact. */
  memory: Awaited<ReturnType<typeof exportMemory>>;
};

/** Everything of the person's After Dark profile, for "Download it". */
export async function exportAdultProfile(db: Db, viewer: string): Promise<AdultProfileExport> {
  const profiles = await db.query<{ character_id: string; name: string; is_house: boolean; turn_ons: unknown; consented_at: string | Date | null; updated_at: string | Date | null }>(
    `select p.character_id, c.name, c.is_house, p.turn_ons, p.consented_at, p.updated_at
       from adult_profiles p join characters c on c.id = p.character_id
      where (c.owner_id = $1 and not c.is_house) or p.updated_by = $1 or p.consented_by = $1
      order by c.name`,
    [viewer],
  );
  const scenes = await db.query<{ character_a: string; character_b: string; a_name: string | null; b_name: string | null; intensity: string | null; hard_nos: unknown; hard_nos_consented_at: string | Date | null }>(
    `select s.character_a, s.character_b, ca.name as a_name, cb.name as b_name, s.intensity, s.hard_nos, s.hard_nos_consented_at
       from adult_scenes s left join characters ca on ca.id = s.character_a left join characters cb on cb.id = s.character_b
      where s.owner_id = $1 order by s.updated_at desc`,
    [viewer],
  );
  return {
    exported_at: new Date().toISOString(),
    about: "Your After Dark profile on Botchelor: the turn-ons you saved for characters, your limits for each pair, and your Step in scenes. Only you see this.",
    consent_text: PROFILE_CONSENT_TEXT,
    turn_ons: profiles.rows.map((r) => ({
      character_id: r.character_id,
      character_name: r.name,
      house: r.is_house,
      turn_ons: storedTurnOns(r.turn_ons).map(label),
      consented_at: iso(r.consented_at),
      updated_at: iso(r.updated_at),
    })),
    limits: scenes.rows
      .map((r) => ({
        pair: [r.character_a, r.character_b] as [string, string],
        names: [r.a_name ?? r.character_a, r.b_name ?? r.character_b] as [string, string],
        intensity: r.intensity,
        hard_nos: storedHardNos(r.hard_nos),
        hard_nos_consented_at: iso(r.hard_nos_consented_at),
      }))
      .filter((l) => l.intensity !== null || l.hard_nos.chips.length + l.hard_nos.own.length > 0),
    step_in: await exportStepIn(db, viewer),
    memory: await exportMemory(db, viewer),
  };
}

/** Their Step in scenes, the newest first, each with its lines as they stand (a redrawn reply's earlier draws left out). */
async function exportStepIn(db: Db, viewer: string): Promise<StepInSceneExport[]> {
  type Row = {
    id: string; character_id: string; name: string | null; place: string; roleplay: unknown; opening: string | null; intensity: string | null;
    hard_nos: unknown; hard_nos_consented_at: string | Date | null; recap: string | null; created_at: string | Date; ended_at: string | Date | null;
  };
  const { rows } = await db.query<Row>(
    `select s.id, s.character_id, c.name, s.place, s.roleplay, s.opening, s.intensity, s.hard_nos, s.hard_nos_consented_at, s.recap, s.created_at, s.ended_at
       from adult_step_in_scenes s left join characters c on c.id = s.character_id
      where s.owner_id = $1 order by s.created_at desc`,
    [viewer],
  );
  if (!rows.length) return [];
  const messages = await db.query<{ scene_id: string; role: string; text: string; created_at: string | Date }>(
    `select scene_id, role, text, created_at from adult_step_in_messages where owner_id = $1 and replaced_by is null order by created_at asc, id asc`,
    [viewer],
  );
  return rows.map((r) => ({
    id: r.id,
    character_id: r.character_id,
    character_name: r.name,
    place: r.place,
    roleplay: r.roleplay ?? null,
    opening: r.opening,
    intensity: r.intensity,
    hard_nos: storedHardNos(r.hard_nos),
    hard_nos_consented_at: iso(r.hard_nos_consented_at),
    recap: r.recap,
    started_at: iso(r.created_at),
    ended_at: iso(r.ended_at),
    messages: messages.rows
      .filter((m) => m.scene_id === r.id)
      .map((m) => ({ who: m.role === "viewer" ? ("you" as const) : m.role === "character" ? ("character" as const) : ("system" as const), text: m.text, at: iso(m.created_at) })),
  }));
}

/** Wipes the person's After Dark profile (see the header for what stays). What was removed, as counts. */
export async function deleteAdultProfile(db: Db, viewer: string): Promise<{ turn_ons: number; limits: number }> {
  const turnOns = await db.query(`delete from adult_profiles p using characters c where c.id = p.character_id and c.owner_id = $1 and not c.is_house returning p.character_id`, [viewer]);
  await db.query(`update adult_profiles set consented_at = null, consented_by = null where consented_by = $1`, [viewer]);
  const limits = await db.query(
    `update adult_scenes set hard_nos = '{}'::jsonb, intensity = null, hard_nos_consented_at = null, updated_at = now()
      where owner_id = $1 and (intensity is not null or hard_nos_consented_at is not null or hard_nos <> '{}'::jsonb)
      returning id`,
    [viewer],
  );
  // A Step in scene's limits are the same kind of data (lib/adult/step-in.ts): back to After Dark's defaults, the consent with them.
  const stepIn = await db.query(
    `update adult_step_in_scenes set hard_nos = '{"chips":[],"own":[]}'::jsonb, intensity = null, hard_nos_consented_at = null
      where owner_id = $1 and (intensity is not null or hard_nos_consented_at is not null or ${HAS_HARD_NOS_SQL})
      returning id`,
    [viewer],
  );
  // What the characters they step in with remember about them (lib/adult/step-in-memory.ts): all of it, and the switch
  // with it (the consent goes with what it covered, so it's asked again).
  await setMemory(db, viewer, false);
  return { turn_ons: turnOns.rows.length, limits: limits.rows.length + stepIn.rows.length };
}
