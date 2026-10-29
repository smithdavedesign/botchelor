"use client";

import Link from "next/link";
import { useState } from "react";
import { requestJson } from "@/app/request";

type PostState = { id: string; status: string } | null;
type Profile = { handle: string; display_name: string; bio: string | null };

/**
 * 📣 Publish (lib/showcase.ts): one of their pictures or clips on the showcase under their creator handle, with a caption
 * if they like, or taken down again. The first time, they pick the handle here. It says plainly who will see it: an
 * explicit one admins only for now; one with someone else's character once that owner says yes.
 */
export default function PublishButton({ source, mediaId, post = null }: { source: "after_dark" | "pg"; mediaId: string; post?: PostState }) {
  const [now, setNow] = useState<PostState>(post);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [form, setForm] = useState({ handle: "", display_name: "", bio: "", caption: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  async function start() {
    setOpen(true);
    setNote(null);
    if (profile !== undefined) return;
    const res = (await fetch("/api/creator-profile").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { profile?: Profile | null } | null;
    setProfile(res?.profile ?? null);
  }
  async function saveProfile() {
    setBusy(true);
    const res = await requestJson("/api/creator-profile", { handle: form.handle, display_name: form.display_name, bio: form.bio || null }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't save.", error: true });
    setProfile(res.data.profile as Profile);
    setNote(null);
  }
  async function go() {
    setBusy(true);
    const res = await requestJson("/api/showcase/posts", { source, media_id: mediaId, caption: form.caption || null }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't reach the server.", error: true });
    const status = String(res.data.status);
    setNow({ id: String(res.data.post_id), status });
    setOpen(false);
    setNote({ text: status === "pending" ? "Waiting for the other character's owner to say yes: it goes up once they do." : source === "after_dark" ? "Published. Explicit posts are seen by admins only for now, until the show opens them." : "Published on the showcase." });
  }
  async function takeDown() {
    if (!now) return;
    setBusy(true);
    const res = await requestJson(`/api/showcase/posts/${now.id}`, undefined, "DELETE").catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setNow(null);
      setNote({ text: "Taken down." });
    }
  }

  return (
    <div className="showcase-publish">
      {now ? (
        <p className="small">
          {now.status === "pending" ? "📣 Waiting for their OK" : <><Link href="/showcase">📣 On the showcase</Link></>}{" "}
          <button type="button" className="linklike" disabled={busy} onClick={() => void takeDown()}>
            {now.status === "pending" ? "cancel" : "unpublish"}
          </button>
        </p>
      ) : !open ? (
        <button type="button" className="button-ghost small" onClick={() => void start()} title="Share it on the showcase, under your creator handle">
          📣 Publish
        </button>
      ) : profile === undefined ? (
        <p className="muted small">One moment…</p>
      ) : profile === null ? (
        <fieldset className="showcase-form">
          <legend className="small">Your creator page first</legend>
          <input type="text" maxLength={24} placeholder="handle (letters, numbers, _)" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} aria-label="Handle" />
          <input type="text" maxLength={40} placeholder="Name on your page" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} aria-label="Name on your page" />
          <textarea rows={2} maxLength={300} placeholder="A line about you (optional)" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} aria-label="Bio" />
          <p className="muted small">It&apos;s public, and never shows your login name or email.</p>
          <button type="button" className="primary small" disabled={busy || !form.handle || !form.display_name} onClick={() => void saveProfile()}>
            Make my page
          </button>{" "}
          <button type="button" className="button-ghost small" onClick={() => setOpen(false)}>
            Not now
          </button>
        </fieldset>
      ) : (
        <fieldset className="showcase-form">
          <legend className="small">Publish as @{profile.handle}</legend>
          <textarea rows={2} maxLength={300} placeholder="A caption (optional)" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} aria-label="Caption" />
          <p className="muted small">
            {source === "after_dark" ? "Explicit posts are seen by admins only for now. " : ""}With someone else&apos;s character, it goes up once their owner says yes. You can unpublish any time.
          </p>
          <button type="button" className="primary small" disabled={busy} onClick={() => void go()}>
            {busy ? "Publishing…" : "📣 Publish"}
          </button>{" "}
          <button type="button" className="button-ghost small" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </fieldset>
      )}
      {note && (
        <p className={`small ${note.error ? "error" : "muted"}`} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}
