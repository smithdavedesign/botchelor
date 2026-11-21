"use client";

import { useEffect, useState } from "react";
import ThreadMenu from "@/app/couples/[a]/[b]/ThreadMenu";
import { requestJson } from "@/app/request";
import Icon from "@/app/Icon";

type Note = { kind: "ok" | "error"; text: string };

/**
 * Follow / Following, the compact toggle beside Text in a character's header (lib/character-follows.ts). One tap:
 * they hear when something public happens to the character and, where they may text it, its texts are on for them.
 * What the tap did is said once, under the row, because it switched texts on: nobody is texted who wasn't told.
 * The state is kept here: the page is not read again for it.
 */
export function FollowToggle({ characterId, name, following: initial, texts }: { characterId: string; name: string; following: boolean; /** Following will switch this character's texts on for them. */ texts: boolean }) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  async function toggle() {
    setBusy(true);
    setNote(null);
    const res = await requestJson(`/api/characters/${encodeURIComponent(characterId)}/follow`, {}, following ? "DELETE" : "POST").catch(() => null);
    setBusy(false);
    if (!res) return setNote({ kind: "error", text: "Network error. Try again." });
    if (!res.ok) return setNote({ kind: "error", text: res.message });
    const now = res.data.following === true;
    setFollowing(now);
    setNote({
      kind: "ok",
      text: now
        ? res.data.texts === true
          ? `You'll hear when something happens to ${name}, and ${name} can text you first now. Unfollow stops both.`
          : `You'll hear when something happens to ${name}.`
        : res.data.texts_off === true
          ? `Unfollowed: no more news, and ${name} won't text you first. Your conversation stays in Chat.`
          : `Unfollowed: no more news about ${name}.`,
    });
  }
  return (
    <>
      <button
        type="button"
        className={following ? "button-ghost small" : "secondary small"}
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={following}
        title={following ? `Stop following ${name}` : texts ? `Hear when something happens to ${name}, and let ${name} text you` : `Hear when something happens to ${name}`}
        data-track="character-follow"
        data-track-to={following ? "off" : "on"}
      >
        {following ? (
          <>
            <Icon name="check" /> Following
          </>
        ) : (
          <>
            <Icon name="bell" /> Follow
          </>
        )}
      </button>
      {note && (
        <p className={note.kind === "error" ? "error small" : "muted small"} role={note.kind === "error" ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </>
  );
}

/**
 * ⋯ at the end of the header's row: what is rarely used there, folded away (the owner's standing rule: rarely used
 * controls stay off the main surface). The link to share or copy, which was a row of its own under the header, and how
 * many follow (a count, never who). The menu is the thread page's (app/couples/[a]/[b]/ThreadMenu.tsx).
 */
export function HeaderMore({ path, title, name, followers }: { path: string; title: string; name: string; followers: number }) {
  const [done, setDone] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => null);
      return;
    }
    setDone(await navigator.clipboard.writeText(url).then(() => true).catch(() => false));
  }
  return (
    <ThreadMenu label={`More for ${name}`}>
      <button type="button" role="menuitem" className="thread-menu-item" onClick={() => void share()} data-track="character-share">
        <span aria-hidden="true">🔗</span>
        {done ? "Link copied ✓" : canShare ? "Share" : "Copy link"}
      </button>
      {followers > 0 && (
        <p className="muted small thread-menu-note">
          {followers === 1 ? "1 person follows" : `${followers} people follow`} {name}.
        </p>
      )}
    </ThreadMenu>
  );
}
