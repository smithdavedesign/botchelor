"use client";

import { useState } from "react";
import type { Post } from "@/lib/showcase";

/**
 * 🎨 Shoot like this (David's call: menu picks only, never their typed words or their characters): pick one of your own
 * characters and its Studio opens with this post's picks, ready to shoot.
 */
export default function RemixButton({ post }: { post: Post }) {
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const studio = post.source === "after_dark" ? "after_dark" : "pg";
  async function open() {
    const res = await fetch(`/api/showcase/remix-targets?studio=${studio}`).catch(() => null);
    if (!res || res.status === 401) return setNote("Sign in to shoot one like it.");
    const data = (await res.json().catch(() => ({}))) as { characters?: { id: string; name: string }[] };
    setList(data.characters ?? []);
  }
  const href = (id: string) => (studio === "after_dark" ? `/after-dark/studio/${id}?remix=${post.id}` : `/characters/${id}/studio?remix=${post.id}`);
  if (!post.remixable) return null;
  return (
    <div className="showcase-remix">
      {list === null ? (
        <button type="button" className="button-ghost small" onClick={() => void open()} title="Its menu picks, on a character of yours">
          🎨 Shoot like this
        </button>
      ) : list.length ? (
        <p className="small">
          With{" "}
          {list.map((c, i) => (
            <span key={c.id}>
              {i ? ", " : ""}
              <a href={href(c.id)}>{c.name}</a>
            </span>
          ))}
          : its picks, your character, never their own words.
        </p>
      ) : (
        <p className="muted small">{studio === "after_dark" ? "None of your characters is in your After Dark yet." : "Make a character first."}</p>
      )}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}
