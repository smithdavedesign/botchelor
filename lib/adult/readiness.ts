/**
 * Whether a character is set up for After Dark's pictures (David, 2026-10-25: "force the user to go to the studio and
 * set up the baseline face and body images, so when we go after dark it is not guessing for new characters … creation
 * → image bases → after dark, because if we miss any step it really will screw up good images for the date").
 *
 * A person's own character is ready once they've picked its face (adult_face_refs: "Use this face", in the Studio or
 * the night's Set up) and given it a body reference (adult_identity.body_image_id: the Studio's "Use as body"). Until
 * then no picture or video of a night they're in is drawn: nothing is guessed from words. The house cast is curated: it's
 * always ready (its first baseline is drawn the first time it's needed, then picked from in the admin's Set up). Pure
 * reads.
 */
import type { Db } from "../db";
import { SETUP_NOTE_PREFIX } from "./picture-notes";
import { faceReferenceId } from "./steering";

export type Readiness = {
  id: string;
  name: string;
  /** The viewer's own character (the house cast isn't anyone's). */
  own: boolean;
  /** A face picked for them (theirs) or drawn (the house cast's), and a body reference (theirs only; the cast needs none). */
  face: boolean;
  body: boolean;
  ready: boolean;
  /** Where to set them up. */
  studio: string;
  /** "Set up for pictures" (#1207): what one tap would do for them, when the Studio is theirs to use (studio.ts setupOffer). */
  setup?: SetupOffer;
};

/** What "Set up for pictures" would do for a character not ready yet (lib/adult/studio.ts setupOffer), for its button. */
export type SetupOffer = {
  /** This character's first setup: included, on us (David, 2026-11-01). */
  free: boolean;
  /** What it costs them otherwise: the Recast and Body reference prices, for the parts it draws (0 for an admin). */
  tokens: number;
  /** The model pictures it draws: faces when there's none to use, then body references. */
  pictures: number;
  /** A face already drawn for them and not picked: the setup uses it, and "Use this face" picks it without drawing. */
  baseline: string | null;
  /** A setup of theirs started a moment ago is still drawing. */
  drawing: boolean;
};

export async function readinessOf(db: Db, viewer: string, characterId: string): Promise<Readiness | null> {
  const c = (await db.query<{ id: string; name: string; is_house: boolean; owner_id: string | null }>(`select id, name, is_house, owner_id from characters where id = $1`, [characterId])).rows[0];
  if (!c) return null;
  const studio = `/after-dark/studio/${encodeURIComponent(c.id)}`;
  if (c.is_house || c.owner_id !== viewer) {
    const face = Boolean(await faceReferenceId(db, viewer, c.id));
    return { id: c.id, name: c.name, own: false, face, body: true, ready: true, studio };
  }
  const row = (
    await db.query<{ face: boolean; body: boolean }>(
      `select exists (select 1 from adult_face_refs f join adult_images i on i.id = f.image_id and i.status = 'ready' where f.owner_id = $1 and f.character_id = $2) as face,
              exists (select 1 from adult_identity d join adult_images i on i.id = d.body_image_id and i.status = 'ready' where d.owner_id = $1 and d.character_id = $2) as body`,
      [viewer, c.id],
    )
  ).rows[0];
  const face = Boolean(row?.face);
  const body = Boolean(row?.body);
  return { id: c.id, name: c.name, own: true, face, body, ready: face && body, studio };
}

/** Both of a pair, in order. */
export async function pairReadiness(db: Db, viewer: string, a: string, b: string): Promise<Readiness[]> {
  return (await Promise.all([readinessOf(db, viewer, a), readinessOf(db, viewer, b)])).filter((r): r is Readiness => Boolean(r));
}

/**
 * What's missing, as the owner reads it, each part named for the step that sets it (#1207: a visitor couldn't tell
 * whether a character was ready, or what to do): "Sweet needs a face picked in the Studio", "… a body reference set in
 * the Studio", or both; null when everyone is ready. The page links each to its step (picture-notes.ts setupStep).
 */
export function missingNote(rs: readonly Readiness[]): string | null {
  const out = rs
    .filter((r) => !r.ready)
    .map((r) => {
      const first = r.name.split(/\s+/)[0];
      if (!r.face && !r.body) return `${first} needs a face and a body reference set in the Studio`;
      return !r.face ? `${first} needs a face picked in the Studio` : `${first} needs a body reference set in the Studio`;
    });
  return out.length ? `${SETUP_NOTE_PREFIX} ${out.join("; ")}.` : null;
}

/** The pair's refusal for any picture or video of their night, or null when both are ready. */
export async function picturesBlocked(db: Db, viewer: string, a: string, b: string): Promise<string | null> {
  return missingNote(await pairReadiness(db, viewer, a, b));
}
