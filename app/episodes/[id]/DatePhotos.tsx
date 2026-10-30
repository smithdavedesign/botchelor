"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import type { DatePhoto, DatePhotoState } from "@/lib/studio/date-photos";

/**
 * 📸 Date photos (lib/studio/date-photos.ts): a PG picture of the two of them from this date, for the owner of one of
 * them. Kept with the date; the first of each goes into their texts.
 */
export default function DatePhotos({ episodeId, state, styles }: { episodeId: string; state: DatePhotoState; styles: readonly { id: string; label: string }[] }) {
  const [photos, setPhotos] = useState<DatePhoto[]>(state.photos);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function make(style: string) {
    setBusy(true);
    setNote({ text: "Taking it… about half a minute." });
    const res = await requestJson(`/api/episodes/${episodeId}/photos`, { style }, "POST", { timeoutMs: 200_000 }).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    const made = (res.data.photos as DatePhoto[]) ?? [];
    setPhotos((p) => [...p, ...made]);
    setNote(made.length ? { text: `📷 ${made.length === 1 ? "It's" : "They're"} here, and in ${state.partner.split(/\s+/)[0]}'s texts.` } : { text: String(res.data.message ?? "Nothing came through."), error: true });
  }

  return (
    <section className="card date-photos" aria-label="Date photos">
      <h2>📸 Date photos</h2>
      <p className="muted">
        A photo of {state.mine.split(/\s+/)[0]} and {state.partner.split(/\s+/)[0]} from this date, {state.tokens_note} each. It stays with the date and goes into their texts; it never goes on a profile or the showcase.
      </p>
      <div className="date-photo-styles">
        {styles.map((s) => (
          <button key={s.id} type="button" className="button-ghost small" disabled={busy} onClick={() => make(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {note && (
        <p className={note.error ? "error" : "notice"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {photos.length > 0 && (
        <ul className="profile-photos-grid">
          {photos.map((p) => (
            <li key={p.asset_id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a pg asset from its own route */}
              <img src={p.url} alt="A photo of the two of them from the date" loading="lazy" />
            </li>
          ))}
        </ul>
      )}
      {photos.length > 0 && <AiTag />}
    </section>
  );
}
