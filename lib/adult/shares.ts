/**
 * Sharing a Studio picture (docs/PRDs/studio.md section 8; David, 2026-10-24: "share your output to the other user or
 * agent so they can see it too, but you pay for it"). A picture of one character alone can go to the owner of a character
 * theirs has dated (a ready date between the two), a person or an agent. The sharer already paid for the picture;
 * sharing costs `studio.prices.share` (none by default).
 *
 * Two kinds, because an explicit picture must never reach someone who didn't ask for it, or who can't open After Dark:
 *  - **after_dark:** a request the recipient accepts first (in After Dark's "Shared with you"), unless they've chosen to
 *    take shares from characters theirs have dated without being asked. Then it shows to them, read-only: never their
 *    face, never animated by them, never shared on. Either side can take it away. An agent's account can't open After
 *    Dark, so it can't be sent one. Whether a person can open After Dark is never told to the sharer: a request to
 *    someone who can't waits, unannounced, until they can.
 *  - **photo:** a dressed Studio picture (a shoot at level 0) whose check scored it clearly non-explicit (Hive's
 *    general_nsfw at most `studio.share.pg_max_nsfw`; with no score, the show's own picture check passes it now) goes
 *    into the two characters' texts as a photo, from the sharer's character: a show asset like a portrait, approved
 *    because it was checked, which an agent reads in read_texts.
 *
 * Only the sharer's own characters' pictures (an admin's, the house cast's too): never a picture of someone else's.
 */
import { isAdmin } from "../admins";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { recordAsset, reviewAsset } from "../assets";
import { insertText } from "../between-dates";
import type { Db } from "../db";
import { notify } from "../notifications";
import { dataColumn, readBytes } from "../object-store";
import { pairKey } from "../relationships";
import { canAfterDark } from "./entitlement";
import { checkMedia } from "./moderation";
import { getAdultSettings } from "./settings";

export type ShareKind = "after_dark" | "photo";
export type ShareFail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): ShareFail => ({ ok: false, status, error, message });

/** Who a character's pictures can go to: each character theirs has dated, whose owner is someone else. */
export type SharePartner = { character_id: string; name: string; agent: boolean };

export async function sharePartners(db: Db, viewer: string, characterId: string): Promise<SharePartner[]> {
  const { rows } = await db.query<{ id: string; name: string; owner_id: string | null; person: boolean }>(
    `select distinct c.id, c.name, c.owner_id, exists (select 1 from accounts a where a.user_id = c.owner_id) as person
       from episodes e
       join characters c on c.id = case when e.character_a = $1 then e.character_b else e.character_a end
      where (e.character_a = $1 or e.character_b = $1) and e.status = 'ready' and c.owner_id is not null and c.owner_id <> $2 and c.owner_id <> 'deleted'
      order by c.name`,
    [characterId, viewer],
  );
  return rows.map((r) => ({ character_id: r.id, name: r.name, agent: !r.person }));
}

type Picture = {
  id: string;
  owner_id: string;
  character_id: string;
  /** The character is the sharer's own (or, for an admin, one of the house cast). */
  mine: boolean;
  character_b: string | null;
  mime: string;
  model: string | null;
  nsfw_score: number | null;
  level: number | null;
  data: Buffer | Uint8Array | null;
  object_key: string | null;
};

/** The sharer's own ready picture of one character alone, with the level of the shoot it came from (null: not a Studio shoot). */
async function ownPicture(db: Db, viewer: string, imageId: string): Promise<Picture | null> {
  return (
    (
      await db.query<Picture>(
        `select i.id, i.owner_id, i.character_id, i.character_b, i.mime, i.model, i.nsfw_score, ${dataColumn("i")}, i.object_key,
                (select (s.choices->>'level')::int from adult_studio_shoots s where s.id = i.shoot_id and s.kind in ('shoot', 'variations', 'upscale')) as level,
                (c.owner_id = $2 or (c.is_house and exists (select 1 from admins a where a.user_id = $2))) as mine
           from adult_images i join characters c on c.id = i.character_id
          where i.id = $1 and i.owner_id = $2 and i.status = 'ready' and i.kind in ('scene', 'baseline')`,
        [imageId, viewer],
      )
    ).rows[0] ?? null
  );
}

export type ShareResult = { ok: true; share: { id: string; kind: ShareKind; status: string; to_character: string } } | ShareFail;

/** Shares one of the viewer's pictures of a character alone with the owner of a character theirs has dated. */
export async function sharePicture(db: Db, viewer: string, input: { image_id: string; to_character: string; kind: ShareKind }): Promise<ShareResult> {
  const config = (await getAdultSettings(db)).studio;
  if (input.kind === "after_dark" ? !config.share.after_dark : !config.share.photos) return fail(403, "off", "That kind of sharing is switched off in the settings.");
  const pic = await ownPicture(db, viewer, input.image_id);
  if (!pic) return fail(404, "not_found", "Pick one of your own pictures.");
  if (!pic.mine) return fail(403, "not_yours", "Only pictures of your own characters can be shared.");
  if (pic.character_b) return fail(422, "pair", "Only a picture of one of them alone can be shared.");
  const partner = (await sharePartners(db, viewer, pic.character_id)).find((p) => p.character_id === input.to_character);
  if (!partner) return fail(404, "not_a_partner", "Pick someone they've been on a date with.");
  const to = (await db.query<{ owner_id: string }>(`select owner_id from characters where id = $1`, [partner.character_id])).rows[0]!.owner_id;
  if (input.kind === "after_dark" && partner.agent) return fail(422, "agent", "An agent's account can't open After Dark: send a dressed picture as a photo in their texts instead.");
  let photoBytes: Buffer | null = null;
  if (input.kind === "photo") {
    if (pic.level !== 0) return fail(422, "not_dressed", "Only a dressed Studio picture can go in their texts.");
    const unclean = () => fail(422, "not_clean", "The check didn't find that picture clearly non-explicit, so it can't go in their texts.");
    if (pic.nsfw_score !== null && pic.nsfw_score > config.share.pg_max_nsfw) return unclean();
    photoBytes = await readBytes(pic);
    if (!photoBytes) return fail(404, "not_found", "That picture's file is missing.");
    if (pic.nsfw_score === null) {
      // No score (an alternative checked it, not Hive): the show's own picture check, now, before it's in anyone's texts.
      const v = await checkMedia(db, { base64: photoBytes.toString("base64"), mime: pic.mime }, "pg_image");
      if (!v.ok || (v.nsfw !== undefined && v.nsfw > config.share.pg_max_nsfw)) return unclean();
    }
  }
  // The share's price (none by default), taken first and given back if it doesn't go.
  const price = config.prices.share;
  const pays = price > 0 && !(await isAdmin(db, viewer));
  if (pays && !(await spendBoughtTokens(db, viewer, price))) return fail(402, "needs_tokens", `Sharing costs ${price} token${price === 1 ? "" : "s"}.`);
  try {
    const id = crypto.randomUUID();
    if (input.kind === "photo" && photoBytes) {
      const bytes = photoBytes;
      const assetId = await recordAsset(db, {
        character_id: pic.character_id,
        kind: "photo",
        source_type: "generated",
        source_model: pic.model ?? "after-dark-studio",
        prompt: "A dressed Studio picture, shared as a photo",
        url: `data:${pic.mime};base64,${bytes.toString("base64")}`,
        // Only a level-0 shoot under pg_max_nsfw gets here (above).
        content_rating: "pg",
      });
      await reviewAsset(db, assetId, "approved", `studio photo: a dressed shoot, checked (general_nsfw ${pic.nsfw_score === null ? "n/a, the show's check passed it" : pic.nsfw_score.toFixed(2)})`);
      const [lo, hi] = pairKey(pic.character_id, partner.character_id);
      const names = (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[pic.character_id, partner.character_id]])).rows;
      const from = names.find((n) => n.id === pic.character_id)?.name ?? "They";
      await insertText(db, lo, hi, pic.character_id === lo ? "lo" : "hi", "📷", "photo", new Date(), assetId);
      await notify(db, to, { kind: "texted", title: `📷 ${from} sent ${partner.name} a photo`.slice(0, 125), link: `/messages/${lo}/${hi}` });
      await db.query(
        `insert into adult_shares (id, item_id, owner_id, from_character, recipient_id, to_character, kind, status, photo_asset) values ($1, $2, $3, $4, $5, $6, 'photo', 'sent', $7)
         on conflict (item_id, recipient_id, kind) do update set status = 'sent', photo_asset = excluded.photo_asset, updated_at = now()`,
        [id, pic.id, viewer, pic.character_id, to, partner.character_id, assetId],
      );
      return { ok: true, share: { id, kind: "photo", status: "sent", to_character: partner.character_id } };
    }
    const auto = (await db.query<{ auto_accept: boolean }>(`select auto_accept from adult_share_prefs where user_id = $1`, [to])).rows[0]?.auto_accept ?? false;
    const status = auto ? "accepted" : "pending";
    const row = (
      await db.query<{ id: string; status: string }>(
        `insert into adult_shares (id, item_id, owner_id, from_character, recipient_id, to_character, kind, status) values ($1, $2, $3, $4, $5, $6, 'after_dark', $7)
         on conflict (item_id, recipient_id, kind) do update set status = case when adult_shares.status = 'accepted' then 'accepted' else excluded.status end, updated_at = now()
         returning id, status`,
        [id, pic.id, viewer, pic.character_id, to, partner.character_id, status],
      )
    ).rows[0];
    // Neutral words (a notice can show on a lock screen or in an email), and only to someone After Dark is open to: the
    // sharer hears the same either way.
    if ((await canAfterDark(db, { userId: to, authenticated: true })).ok) {
      await notify(db, to, { kind: "after_dark_share", title: "Something was shared with you", body: "Open it from your private area.", link: "/after-dark#shared" });
    }
    return { ok: true, share: { id: row.id, kind: "after_dark", status: row.status, to_character: partner.character_id } };
  } catch (err) {
    if (pays) await refundBoughtTokens(db, viewer, price);
    return fail(502, "not_shared", `It couldn't be shared (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`);
  }
}

/** The recipient's answer to a request: accept (it shows) or decline. */
export async function answerShare(db: Db, viewer: string, shareId: string, accept: boolean): Promise<boolean> {
  const { rows } = await db.query(
    `update adult_shares set status = $3, updated_at = now() where id = $1 and recipient_id = $2 and kind = 'after_dark' and status = 'pending' returning id`,
    [shareId, viewer, accept ? "accepted" : "declined"],
  );
  return rows.length > 0;
}

/** Takes a share away: the recipient removes it (declined), or the sharer takes it back (revoked). A photo already in their texts stays. */
export async function removeShare(db: Db, viewer: string, shareId: string): Promise<boolean> {
  const { rows } = await db.query(
    `update adult_shares set status = case when recipient_id = $2 then 'declined' else 'revoked' end, updated_at = now()
      where id = $1 and kind = 'after_dark' and status in ('pending', 'accepted') and (recipient_id = $2 or owner_id = $2) returning id`,
    [shareId, viewer],
  );
  return rows.length > 0;
}

/** Whether someone takes After Dark shares from characters theirs have dated without being asked. */
export async function setAutoAccept(db: Db, viewer: string, on: boolean): Promise<void> {
  await db.query(
    `insert into adult_share_prefs (user_id, auto_accept) values ($1, $2) on conflict (user_id) do update set auto_accept = excluded.auto_accept, updated_at = now()`,
    [viewer, on],
  );
}

export type IncomingShare = { id: string; status: "pending" | "accepted"; from_name: string; to_name: string; image_id: string | null; created_at: string };

/** What's been shared with the viewer in After Dark: requests (no picture until accepted) and accepted pictures. */
export async function sharedWithMe(db: Db, viewer: string): Promise<{ shares: IncomingShare[]; auto_accept: boolean }> {
  const { rows } = await db.query<{ id: string; status: "pending" | "accepted"; from_name: string; to_name: string; item_id: string; created_at: string | Date }>(
    `select s.id, s.status, f.name as from_name, t.name as to_name, s.item_id, s.created_at
       from adult_shares s join characters f on f.id = s.from_character join characters t on t.id = s.to_character
       join adult_images i on i.id = s.item_id and i.status = 'ready'
      where s.recipient_id = $1 and s.kind = 'after_dark' and s.status in ('pending', 'accepted')
      order by s.created_at desc limit 100`,
    [viewer],
  );
  const auto = (await db.query<{ auto_accept: boolean }>(`select auto_accept from adult_share_prefs where user_id = $1`, [viewer])).rows[0]?.auto_accept ?? false;
  return {
    shares: rows.map((r) => ({ id: r.id, status: r.status, from_name: r.from_name, to_name: r.to_name, image_id: r.status === "accepted" ? r.item_id : null, created_at: new Date(r.created_at).toISOString() })),
    auto_accept: auto,
  };
}

export type OutgoingShare = { id: string; kind: ShareKind; status: string; to_name: string };

/** Who a picture of the viewer's went to, for their gallery. */
export async function sharesOf(db: Db, viewer: string, imageIds: string[]): Promise<Record<string, OutgoingShare[]>> {
  if (!imageIds.length) return {};
  const { rows } = await db.query<OutgoingShare & { item_id: string }>(
    `select s.id, s.item_id, s.kind, s.status, c.name as to_name from adult_shares s join characters c on c.id = s.to_character
      where s.owner_id = $1 and s.item_id = any($2) and s.status in ('pending', 'accepted', 'sent') order by s.created_at`,
    [viewer, imageIds],
  );
  const out: Record<string, OutgoingShare[]> = {};
  for (const { item_id, ...r } of rows) (out[item_id] ??= []).push(r);
  return out;
}

/** SQL on an unaliased adult_images: the viewer (`$n`) was shared this picture and accepted it. */
export const sharedWith = (n: number) =>
  `exists (select 1 from adult_shares s where s.item_id = adult_images.id and s.recipient_id = $${n} and s.kind = 'after_dark' and s.status = 'accepted')`;
