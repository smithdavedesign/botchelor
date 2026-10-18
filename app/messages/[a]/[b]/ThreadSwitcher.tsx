"use client";

import { useRouter } from "next/navigation";

/**
 * Switch to another of this character's chats, like a dating app's (David, 2026-10-18). Switching characters is
 * one screen back, on Matches. Shown only when there's another chat to switch to.
 */
export default function ThreadSwitcher({ chats, current }: { chats: { href: string; name: string }[]; current: string }) {
  const router = useRouter();
  if (chats.length < 2) return null;
  return (
    <label className="character-picker thread-switcher">
      <span className="sr-only">Switch chat</span>
      <select value={current} onChange={(e) => router.push(e.target.value)}>
        {chats.map((c) => (
          <option key={c.href} value={c.href}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
