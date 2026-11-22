/**
 * The PG Studio's captions (lib/studio/captions.ts): for one of the owner's own PG pictures, three captions in their
 * character's voice from the menu picks it was made from (lib/studio/pg-catalog.ts labels; their own words, which were
 * checked when they shot), every line held to the show's PG words. The show's free model, so it costs nothing; a rate
 * limit instead of a monthly cap. Kept on the picture.
 */
import type { Db } from "../db";
import { overLimit } from "../limits";
import { getModel } from "../model";
import { checkPgPictureText } from "../safety";
import { sceneCharacter, voiceKitLines } from "../adult/voice";
import { captionMessages, holdCaptions, parseCaptions, type CaptionResult, type Captions } from "./captions";
import { IDENTITY_VIEWS } from "./identity-views";
import { PG_GROUPS, type PgChoices, type PgTag } from "./pg-catalog";

const fail = (status: number, error: string, message: string): CaptionResult => ({ ok: false, status, error, message });

/** What a PG shoot's picks show, as labels: "Candid · Beach · Summer dress · Golden hour". */
export function pgShows(choices: PgChoices | null | undefined): string {
  const labels: string[] = [];
  for (const g of PG_GROUPS) {
    const picked = choices?.[g.id];
    for (const id of Array.isArray(picked) ? picked : picked ? [picked] : []) {
      const label = g.options.find((o) => o.id === id)?.label;
      if (label) labels.push(label);
    }
  }
  if (choices?.own_place?.name) labels.push(choices.own_place.name);
  return labels.slice(0, 8).join(" · ");
}

/**
 * What a picture's own tags say it shows, for one no menu picks were kept with: an identity view (the angle it was drawn
 * at, on the plain studio backdrop) or a carousel's angle of a shoot (the shoot's picks, carried on its tags).
 */
export function pgTagShows(tags: readonly PgTag[] | null | undefined): string {
  const labels: string[] = [];
  // A carousel's angles aren't the view's own, so only its backdrop carries over.
  const carousel = (tags ?? []).some((t) => t.kind === "made" && t.value === "carousel");
  for (const t of tags ?? []) {
    const view = t.kind === "view" ? IDENTITY_VIEWS.find((v) => v.id === t.value) : undefined;
    if (view) labels.push(`a studio portrait on a plain light-grey backdrop${carousel ? "" : `: ${view.words}`}`);
    const label = PG_GROUPS.find((g) => g.id === t.kind)?.options.find((o) => o.id === t.value)?.label;
    if (label) labels.push(label);
  }
  return labels.slice(0, 8).join(" · ");
}

export async function pgCaptions(db: Db, ownerId: string, pictureId: string, opts: { fresh?: boolean } = {}): Promise<CaptionResult> {
  const row = (
    await db.query<{ id: string; character_id: string; captions: Captions | null; choices: PgChoices | null; tags: PgTag[] | null }>(
      `select p.id, p.character_id, p.captions, s.choices, p.tags from studio_pg_pictures p left join studio_pg_shoots s on s.id = p.shoot_id
        where p.id = $1 and p.owner_id = $2`,
      [pictureId, ownerId],
    )
  ).rows[0];
  if (!row) return fail(404, "not_found", "There's no picture of yours with that id.");
  if (row.captions && !opts.fresh) return { ok: true, captions: row.captions };
  if (await overLimit(db, "pg-captions", ownerId, { perHour: 30, perDay: 150 })) return fail(429, "rate_limited", "That's a lot of captions for now. Try again in a while.");
  const c = await sceneCharacter(db, row.character_id);
  if (!c) return fail(404, "not_found", "That picture's character isn't there any more.");
  const ok = (t: string) => checkPgPictureText({ t }).ok;
  const custom = typeof row.choices?.custom === "string" && ok(row.choices.custom) ? `, ${row.choices.custom.slice(0, 160)}` : "";
  // An identity view or a carousel keeps no menu picks of its own: its tags say what it shows. Nothing known, and the
  // captions are told so rather than left to invent a scene.
  const shows = `${pgShows(row.choices) || pgTagShows(row.tags) || "a photo of them (nothing more is known about it)"}${custom}`;
  const model = getModel(undefined, false);
  let held: ReturnType<typeof holdCaptions> = null;
  for (const note of [undefined, "The last reply couldn't be used: reply with the JSON object only, every caption within the rules."]) {
    const raw = await model.complete(captionMessages({ name: c.name, voice: voiceKitLines(c), shows, together: false, spicy: false, note }), { temperature: 0.8, maxTokens: 500 }).catch(() => "");
    const parsed = parseCaptions(raw);
    held = parsed ? holdCaptions(parsed, ok, ok, `New one of ${c.name} ✨`) : null;
    if (held) break;
  }
  if (!held) return fail(422, "not_written", "No captions came out that hold to the lines. Try again.");
  const captions: Captions = { ...held, voice: c.id, written_at: new Date().toISOString() };
  await db.query(`update studio_pg_pictures set captions = $2::jsonb where id = $1`, [row.id, JSON.stringify(captions)]);
  return { ok: true, captions };
}
