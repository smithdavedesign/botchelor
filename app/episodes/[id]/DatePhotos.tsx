"use client";

import Link from "next/link";
import { useState } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import type { DatePhoto, DatePhotoState } from "@/lib/studio/date-photos";

/**
 * 📸 Date photos (lib/studio/date-photos.ts): a PG picture of the two of them from this date, for the owner of one of
 * them. Kept with the date; the newest is the date's photo in their texts (lib/text-chain.ts), and the panel says where
 * that is and who sees it (David, 2026-11-16: "I took an image of the post date, I think it should show in the text
 * messages").
 */
export default function DatePhotos({ episodeId, state, styles }: { episodeId: string; state: DatePhotoState; styles: readonly { id: string; label: string }[] }) {
  const [photos, setPhotos] = useState<DatePhoto[]>(state.photos);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean; made?: boolean } | null>(null);
  const first = (name: string) => name.split(/\s+/)[0];
  const thread = state.thread;
  // Where the newest photo shows, in words: their texts, and who reads them there.
  const where = !thread
    ? "It stays with the date"
    : thread.public
      ? `It stays with the date, and the newest one is the photo of this date in ${first(state.mine)} and ${first(state.partner)}'s texts, where anyone watching the two of them sees it`
      : `It stays with the date, and the newest one is the photo of this date in ${first(state.mine)} and ${first(state.partner)}'s texts, where only their owners see it`;

  async function make(style: string) {
    setBusy(true);
    setNote({ text: "Taking it… about half a minute." });
    const res = await requestJson(`/api/episodes/${episodeId}/photos`, { style }, "POST", { timeoutMs: 200_000 }).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    const made = (res.data.photos as DatePhoto[]) ?? [];
    setPhotos((p) => [...p, ...made]);
    if (!made.length) return setNote({ text: String(res.data.message ?? "Nothing came through."), error: true });
    const texted = res.data.texted === true ? ` ${first(state.mine)} texted it to you too.` : "";
    setNote({ text: `📷 ${made.length === 1 ? "It's" : "They're"} here${thread ? `, and ${made.length === 1 ? "it's" : "the newest is"} now the photo of this date in their texts` : ""}.${texted}`, made: true });
  }

  return (
    <section className="card date-photos" aria-label="Date photos">
      <h2>📸 Date photos</h2>
      <p className="muted">
        A photo of {first(state.mine)} and {first(state.partner)} from this date, {state.tokens_note} each. {where}; it never goes on a profile or the showcase.
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
          {note.made && thread?.href && (
            <>
              {" "}
              <Link href={thread.href}>See it in their texts</Link>
            </>
          )}
        </p>
      )}
      {!note?.made && photos.length > 0 && thread?.href && (
        <p className="small">
          <Link href={thread.href}>📷 See the newest in their texts</Link>
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
