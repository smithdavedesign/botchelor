"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import CharacterName from "@/app/CharacterName";
import type { Media } from "@/lib/adult/media";
import { PICTURE_PRESETS, PICTURE_TAGS, VIDEO_TAGS, type RatingTag } from "@/lib/adult/rating-tags";
import type { SteerSummary } from "@/lib/adult/steering";
import type { CharacterRef } from "@/lib/game";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/** A tag as the line under a face says it: "odd pose", "jerky or morphing". */
const tagWords = (t: RatingTag) => ((PICTURE_TAGS as Record<string, string>)[t] ?? (VIDEO_TAGS as Record<string, string>)[t] ?? t).toLowerCase();

/**
 * Each one's faces for this viewer (lib/adult/steering.ts facesFor), and whether they picked them: the face everything
 * keeps, and for a character who wears something, the nude one their undressed moments start from (lib/adult/attire.ts).
 */
export type Faces = Record<string, { image_id: string | null; picked: boolean; nude?: { image_id: string | null; picked: boolean; from_face?: boolean } | null }>;

/**
 * The face each of them keeps (lib/adult/steering.ts): every picture and video of them starts from it. It's the one
 * the viewer picked ("Use this face", here or on any picture of them alone), else their best-rated waist-up picture.
 * "Draw three to pick from" makes three waist-up pictures of one of them, one in each light (lib/adult/media.ts
 * drawBaselineChoices): the framing never changes, so it's the face that's compared. Under each face, what the viewer's
 * ratings of them steer, and "Start fresh" (lib/adult/steering.ts steerSummary, resetSteering).
 */
export default function FacesPanel({
  characters,
  faces,
  gallery,
  onFace,
  steer = {},
  onSteerReset,
  onPictures,
  paused = null,
}: {
  characters: [CharacterRef, CharacterRef];
  faces: Faces;
  gallery: Media[];
  /** Picks a face (null: back to the default, the nude one's with `nude`), with the others it was picked from; resolves to what went wrong, or null. */
  onFace: (characterId: string, imageId: string | null, rivals?: string[], opts?: { nude?: boolean }) => Promise<string | null>;
  steer?: Record<string, SteerSummary>;
  onSteerReset?: (characterId: string, next: SteerSummary) => void;
  onPictures: (pictures: Media[]) => void;
  paused?: string | null;
}) {
  return (
    <section className="ad-faces">
      <h2>Their faces</h2>
      <p className="muted small">
        Every picture and video of them keeps this face. Pick the one most like them; your 👍 and 👎 on their pictures steer the rest. Your ratings only
        change your own pictures: they never train a model.
      </p>
      <ul className="ad-faces-list">
        {characters.map((c) => (
          <li key={c.id}>
            <FaceCard
              character={c}
              face={faces[c.id] ?? { image_id: null, picked: false }}
              gallery={gallery}
              onFace={onFace}
              steer={steer[c.id] ?? { avoid: [], light: null }}
              onSteerReset={onSteerReset}
              onPictures={onPictures}
              paused={paused}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FaceCard({
  character,
  face,
  gallery,
  onFace,
  steer,
  onSteerReset,
  onPictures,
  paused,
}: {
  character: CharacterRef;
  face: Faces[string];
  gallery: Media[];
  onFace: (characterId: string, imageId: string | null, rivals?: string[], opts?: { nude?: boolean }) => Promise<string | null>;
  steer: SteerSummary;
  onSteerReset?: (characterId: string, next: SteerSummary) => void;
  onPictures: (pictures: Media[]) => void;
  paused: string | null;
}) {
  const [drawing, setDrawing] = useState<"dressed" | "nude" | null>(null);
  const [choices, setChoices] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Shown when the viewer can open it: one of theirs (another's, the show's own, is used but not shown).
  const canOpen = (id: string | null | undefined) => (id && gallery.some((m) => m.id === id) ? id : null);
  const shown = canOpen(face.image_id);
  const nudeShown = canOpen(face.nude?.image_id);

  /** Three to pick from: dressed (their outfit), or nude for the face of their undressed moments. */
  async function draw(nude = false) {
    setDrawing(nude ? "nude" : "dressed");
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/baselines", { character_id: character.id, ...(nude ? { nude: true } : {}) }).catch(() => null);
    setDrawing(null);
    if (!res) return setNote("That didn't reach the server. Check your connection and try again.");
    if (!res.ok) return setNote(res.message);
    const pictures = (res.data.pictures as Media[] | undefined) ?? [];
    setChoices(pictures);
    onPictures(pictures);
    const failed = Number(res.data.failed ?? 0);
    if (failed) setNote(`${failed} of the three didn't come through.`);
  }

  /** Keeps a face; picked from the three, the other two tell the light test which lights were passed over. */
  async function use(id: string | null, opts: { nude?: boolean } = {}) {
    setBusy(true);
    setNote(null);
    const rivals = id && choices.some((m) => m.id === id) ? choices.filter((m) => m.id !== id).map((m) => m.id) : [];
    const error = await onFace(character.id, id, rivals, opts);
    setBusy(false);
    if (error) return setNote(error);
    if (id) setChoices([]);
  }

  /** "Start fresh": what their ratings of this character steer is set aside (nothing is deleted). */
  async function startFresh() {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/steer", { character_id: character.id, reset: true }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote(res?.message ?? "That didn't reach the server. Check your connection and try again.");
    onSteerReset?.(character.id, (res.data.steer as SteerSummary | undefined) ?? { avoid: [], light: null });
  }
  const light = PICTURE_PRESETS.find((p) => p.id === steer.light);

  return (
    <div className="ad-face">
      <p className="ad-face-name">
        <CharacterName character={character} link={false} size={24} strong />
      </p>
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ad-face-pic" src={mediaUrl(shown)} alt={`The face kept for ${character.name}`} loading="lazy" />
      ) : (
        <p className="muted small">
          {face.image_id ? "The show's own picture of them, until you pick one of yours." : "No picture of them yet: one is drawn the first time it's needed."}
        </p>
      )}
      {face.image_id && <p className="muted small">{face.picked ? "You picked this face." : "Picked for you: your best-rated picture of them, else the newest."}</p>}
      {/* What their ratings steer (lib/adult/steering.ts steerSummary): a viewer sees it working, and can set it aside. */}
      <p className="muted small ad-face-steer">
        {steer.avoid.length ? `Your ratings steer away from: ${steer.avoid.map(tagWords).join(", ")}.` : "Nothing for your ratings to steer yet."}
        {light ? ` Light that suits them: ${light.label.toLowerCase()}.` : ""}
      </p>
      <div className="ad-face-actions">
        <button
          type="button"
          className="secondary small"
          disabled={Boolean(drawing) || Boolean(paused)}
          title={paused ?? "Three waist-up pictures, one in each light. Uses three of this month's pictures."}
          onClick={() => void draw()}
        >
          {drawing === "dressed" ? "Drawing three (about a minute)…" : "Draw three to pick from"}
        </button>
        {face.picked && (
          <button type="button" className="button-ghost small" disabled={busy} onClick={() => void use(null)}>
            Let it pick for me
          </button>
        )}
        {(steer.avoid.length > 0 || light) && (
          <button
            type="button"
            className="button-ghost small"
            disabled={busy}
            onClick={() => void startFresh()}
            title="Set aside what your ratings of them have steered so far. Nothing is deleted."
          >
            Start fresh
          </button>
        )}
      </div>
      {face.nude && (
        // Wearing something, they have a nude face too: undressed moments (the night at sex) start from it, since a
        // picture made from the dressed one keeps what it wears (lib/adult/attire.ts).
        <div className="ad-face-nude">
          <p className="muted small">
            <strong>In intimate scenes:</strong> {nudeLine(face.nude)}
          </p>
          {nudeShown && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ad-face-pic is-nude" src={mediaUrl(nudeShown)} alt={`The face kept for ${character.name} in intimate scenes`} loading="lazy" />
          )}
          {face.nude.image_id && !face.nude.from_face && (
            <p className="error small" role="status">
              This one wasn&apos;t made from the face above, so it may not look like them. Draw three from their face, or let it pick (it uses only ones made from
              their face).
            </p>
          )}
          <div className="ad-face-actions">
            <button
              type="button"
              className="secondary small"
              disabled={Boolean(drawing) || Boolean(paused) || !face.image_id}
              title={paused ?? (face.image_id ? "Three nude pictures made from the face above, one in each light. Uses three of this month's pictures." : "They need a face first.")}
              onClick={() => void draw(true)}
            >
              {drawing === "nude" ? "Drawing three (about a minute)…" : "Draw three from this face, undressed"}
            </button>
            {face.nude.picked && (
              <button type="button" className="button-ghost small" disabled={busy} onClick={() => void use(null, { nude: true })}>
                Let it pick for me
              </button>
            )}
          </div>
        </div>
      )}
      {choices.length > 0 && (
        <ul className="ad-face-choices">
          {choices.map((m) => (
            <li key={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(m.id)} alt={`A face to pick for ${character.name}`} />
              <button type="button" className="secondary small" disabled={busy || face.image_id === m.id || face.nude?.image_id === m.id} onClick={() => void use(m.id)}>
                {face.image_id === m.id || face.nude?.image_id === m.id ? "✓ Their face" : "Use this face"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="error small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/** What the intimate-scenes face is: always one made from the face above, unless they picked another themselves. */
function nudeLine(nude: { image_id: string | null; picked: boolean; from_face?: boolean }): string {
  if (!nude.image_id) return "made from the face above the first time one is needed. Until then their pictures keep the face above, clothes and all.";
  if (nude.picked) return nude.from_face ? "the nude picture you picked, made from the face above." : "the nude picture you picked.";
  return "made from the face above.";
}
