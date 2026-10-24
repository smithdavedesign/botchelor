"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import CharacterName from "@/app/CharacterName";
import type { Media } from "@/lib/adult/media";
import type { CharacterRef } from "@/lib/game";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/** Each one's face for this viewer (lib/adult/steering.ts facesFor), and whether they picked it. */
export type Faces = Record<string, { image_id: string | null; picked: boolean }>;

/**
 * The face each of them keeps (lib/adult/steering.ts): every picture and video of them starts from it. It's the one
 * the viewer picked ("Use this face", here or on any picture of them alone), else their best-rated waist-up picture.
 * "Draw three to pick from" makes three waist-up pictures of one of them, one in each light (lib/adult/media.ts
 * drawBaselineChoices): the framing never changes, so it's the face that's compared.
 */
export default function FacesPanel({
  characters,
  faces,
  gallery,
  onFace,
  onPictures,
  paused = null,
}: {
  characters: [CharacterRef, CharacterRef];
  faces: Faces;
  gallery: Media[];
  /** Picks a face (null: back to the default); resolves to what went wrong, or null. */
  onFace: (characterId: string, imageId: string | null) => Promise<string | null>;
  onPictures: (pictures: Media[]) => void;
  paused?: string | null;
}) {
  return (
    <section className="ad-faces">
      <h2>Their faces</h2>
      <p className="muted small">
        Every picture and video of them keeps this face. Pick the one most like them; your 👍 and 👎 on their pictures steer the rest, for you alone.
      </p>
      <ul className="ad-faces-list">
        {characters.map((c) => (
          <li key={c.id}>
            <FaceCard character={c} face={faces[c.id] ?? { image_id: null, picked: false }} gallery={gallery} onFace={onFace} onPictures={onPictures} paused={paused} />
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
  onPictures,
  paused,
}: {
  character: CharacterRef;
  face: Faces[string];
  gallery: Media[];
  onFace: (characterId: string, imageId: string | null) => Promise<string | null>;
  onPictures: (pictures: Media[]) => void;
  paused: string | null;
}) {
  const [drawing, setDrawing] = useState(false);
  const [choices, setChoices] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Shown when the viewer can open it: one of theirs (another's, the show's own, is used but not shown).
  const shown = face.image_id && gallery.some((m) => m.id === face.image_id) ? face.image_id : null;

  async function draw() {
    setDrawing(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/baselines", { character_id: character.id }).catch(() => null);
    setDrawing(false);
    if (!res) return setNote("That didn't reach the server. Check your connection and try again.");
    if (!res.ok) return setNote(res.message);
    const pictures = (res.data.pictures as Media[] | undefined) ?? [];
    setChoices(pictures);
    onPictures(pictures);
    const failed = Number(res.data.failed ?? 0);
    if (failed) setNote(`${failed} of the three didn't come through.`);
  }

  async function use(id: string | null) {
    setBusy(true);
    setNote(null);
    const error = await onFace(character.id, id);
    setBusy(false);
    if (error) return setNote(error);
    if (id) setChoices([]);
  }

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
      <div className="ad-face-actions">
        <button
          type="button"
          className="secondary small"
          disabled={drawing || Boolean(paused)}
          title={paused ?? "Three waist-up pictures, one in each light. Uses three of this month's pictures."}
          onClick={() => void draw()}
        >
          {drawing ? "Drawing three (about a minute)…" : "Draw three to pick from"}
        </button>
        {face.picked && (
          <button type="button" className="button-ghost small" disabled={busy} onClick={() => void use(null)}>
            Let it pick for me
          </button>
        )}
      </div>
      {choices.length > 0 && (
        <ul className="ad-face-choices">
          {choices.map((m) => (
            <li key={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(m.id)} alt={`A face to pick for ${character.name}`} />
              <button type="button" className="secondary small" disabled={busy || face.image_id === m.id} onClick={() => void use(m.id)}>
                {face.image_id === m.id ? "✓ Their face" : "Use this face"}
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
