/**
 * A person's After Dark profile as data they can take or wipe (GDPR Arts. 15, 17, 20; docs/after-dark-legal-review.md
 * "Privacy"): the turn-ons they saved for their characters (adult_profiles) and their limits for each pair (adult_scenes:
 * the hard nos and the intensity), with when they consented to each being stored (lib/adult/profile.ts).
 *
 *  - Download: everything of it as JSON (app/api/admin/after-dark/profile, the privacy card's "Download it").
 *  - Delete: their own characters' turn-ons, and every pair's hard nos and intensity, gone; the consent goes with them
 *    (it's kept on those rows), so the box is asked again before anything is stored. A house character's turn-ons that
 *    an admin set are the show's, shared with every viewer: they're in the download, and stay, but the admin's consent
 *    on them is cleared. Account deletion (lib/account.ts) runs the same delete.
 */
import type { Db } from "../db";
import { PROFILE_CONSENT_TEXT, storedTurnOns, TURN_ONS } from "./profile";
import { storedHardNos } from "./limits";

const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
const label = (id: string) => TURN_ONS.find((t) => t.id === id)?.label ?? id;

export type AdultProfileExport = {
  exported_at: string;
  about: string;
  consent_text: string;
  turn_ons: { character_id: string; character_name: string; house: boolean; turn_ons: string[]; consented_at: string | null; updated_at: string | null }[];
  limits: { pair: [string, string]; names: [string, string]; intensity: string | null; hard_nos: { chips: string[]; own: string[] }; hard_nos_consented_at: string | null }[];
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
    about: "Your After Dark profile on Botchelor: the turn-ons you saved for characters and your limits for each pair. Only you see this.",
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
  };
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
  return { turn_ons: turnOns.rows.length, limits: limits.rows.length };
}
