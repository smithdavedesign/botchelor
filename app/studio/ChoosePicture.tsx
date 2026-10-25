"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { PictureChoices } from "@/lib/studio/picture-choice";

const src = (source: "studio" | "portrait", id: string) => (source === "studio" ? `/api/studio/pictures/${id}` : `/api/assets/${id}?w=256`);

/**
 * Choose their picture (lib/studio/picture-choice.ts): any picture already made for the character, from their Studio
 * shoots or the portraits drawn before, as their profile picture and, where After Dark is open to them, their After
 * Dark face. No uploads: every choice is one of theirs, already checked.
 */
export default function ChoosePicture({ id, name, onPortrait }: { id: string; name: string; onPortrait?: (path: string) => void }) {
  const [choices, setChoices] = useState<PictureChoices | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const first = name.split(/\s+/)[0];
  const load = () =>
    fetch(`/api/characters/${id}/pictures`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setChoices(d as PictureChoices))
      .catch(() => {});
  useEffect(() => {
    void load();
    // Once, for this character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function use(source: "studio" | "portrait", pid: string, as: "portrait" | "face") {
    setBusy(`${as}:${pid}`);
    setNote(null);
    const res = await requestJson(`/api/characters/${id}/pictures`, { source, id: pid, as }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setNote({ text: res ? res.message : "That didn't reach the server.", error: true });
    if (as === "portrait" && typeof res.data.portrait_path === "string") onPortrait?.(res.data.portrait_path);
    setNote({ text: as === "portrait" ? `That's ${first}'s profile picture now.` : `That's ${first}'s After Dark face now: every After Dark picture and video of them starts from it.` });
    void load();
  }

  if (!choices) return null;
  const tiles = [...choices.studio.map((p) => ({ source: "studio" as const, id: p.id, rating: p.rating, current: false })), ...choices.portraits.map((p) => ({ source: "portrait" as const, id: p.id, rating: "pg" as const, current: p.current }))];
  return (
    <div className="choose-picture">
      <p>
        <strong>🖼 Choose their picture</strong> — any picture made for {first}: their profile picture{choices.after_dark ? ", and the face After Dark keeps" : ""}.
      </p>
      {tiles.length === 0 ? (
        <p className="muted small">
          No pictures of {first} yet. <Link href={`/characters/${id}/studio`}>Shoot some in their Studio</Link> or draw a portrait above, then choose one here.
        </p>
      ) : (
        <ul className="choose-picture-grid">
          {tiles.map((t) => (
            <li key={`${t.source}:${t.id}`} className={t.current ? "is-current" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the owner's own picture, from its route */}
              <img src={src(t.source, t.id)} alt={`A picture of ${first}`} loading="lazy" />
              <span className="choose-picture-tools">
                {t.current ? (
                  <span className="badge">✓ Profile picture</span>
                ) : (
                  <button type="button" className="button-ghost small" disabled={Boolean(busy) || t.rating !== "pg"} title={t.rating !== "pg" ? "Marked suggestive: a profile picture has to be safe for everyone" : undefined} onClick={() => void use(t.source, t.id, "portrait")}>
                    {busy === `portrait:${t.id}` ? "…" : "Profile picture"}
                  </button>
                )}
                {choices.after_dark &&
                  (choices.face_from === t.id ? (
                    <span className="badge">✓ After Dark face</span>
                  ) : (
                    <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void use(t.source, t.id, "face")}>
                      {busy === `face:${t.id}` ? "…" : "🌙 After Dark face"}
                    </button>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className={note.error ? "error small" : "notice small"} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}
