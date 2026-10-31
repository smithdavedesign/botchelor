"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import { DATE_ACTS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { placeAt, type PlaceId } from "@/lib/venues";
import CharacterName from "@/app/CharacterName";

type Props = {
  /** For the 👍/👎 on each line (lib/line-feedback.ts): line i is transcript[i], and playback shows them from the top. */
  episodeId: string;
  characters: [CharacterRef, CharacterRef];
  venue: PlaceId | null;
  transcript: Turn[];
  endingLabel: string;
  /** Open straight into the playback (the creator arriving from sending the date, `?play=1`). */
  autoOpen?: boolean;
  /** Lines the creator already watched live while it was filmed (`?from=`): playback carries on from there. */
  startAt?: number;
  /** The roleplay the two played (lib/date-roleplays.ts): a chip in the header, so the lines read as their roles'. */
  roleplay?: { icon: string; title: string } | null;
};

function lastOf(turns: Turn[], side: "a" | "b"): string | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
}

/**
 * M13 — the episode's cinematic replay. The same immersive scene as the live theater (characters in the
 * venue, persistent bubbles, the conversation as a messaging thread beside it), played back line by line,
 * paced like it aired. The readable thread stays on the page as the record; this is the experience on top.
 */
export default function EpisodeTheater(props: Props) {
  const [open, setOpen] = useState(props.autoOpen ?? false);
  const router = useRouter();
  const pathname = usePathname();
  if (!open) {
    return (
      <button type="button" className="primary" onClick={() => setOpen(true)}>
        🎬 Watch in theater
      </button>
    );
  }
  return (
    <Playback
      {...props}
      onExit={() => {
        setOpen(false);
        // Leaving drops ?play=1, so a reload shows the episode rather than starting over.
        if (props.autoOpen) router.replace(pathname, { scroll: false });
      }}
    />
  );
}

function Playback({ episodeId, characters, venue, transcript, endingLabel, autoOpen, startAt, roleplay, onExit }: Props & { onExit: () => void }) {
  const replay = useReplay(transcript, true, { startAt });
  const [convo, setConvo] = useState(true);
  const shown = replay.shown;
  const [a, b] = characters;
  const actLabel = shown.length ? DATE_ACTS[shown[shown.length - 1].act] ?? null : null;

  return (
    <div className="theater theater-clean">
      <div className={`theater-stage${convo ? " with-convo" : ""}`}>
        <div className="theater-scene-area">
          <Scene
            characters={characters}
            venue={placeAt(shown, venue)}
            lineA={lastOf(shown, "a")}
            lineB={lastOf(shown, "b")}
            actLabel={actLabel}
            placeholder="The date begins…"
          />
        </div>
        <div className="theater-convo">
          <ChatThread characters={characters} turns={shown} typing={replay.typing} tone="dark" follow empty="The conversation appears here, line by line." feedback={{ kind: "episode", refId: episodeId }} />
        </div>

        <header className="theater-hud">
          <div className="theater-id">
            <strong>
              <CharacterName character={a} /> <span className="vs">×</span> <CharacterName character={b} />
            </strong>
            <span className="chip">{autoOpen ? "Just filmed" : "Replay"}</span>
            {roleplay && (
              <span className="chip" title="A roleplay both sides agreed to: the lines are their roles'">
                {roleplay.icon} {roleplay.title}
              </span>
            )}
          </div>
          <div className="theater-tools">
            <button type="button" className="theater-icon" onClick={replay.toggle} aria-label={replay.playing ? "Pause" : "Play"} title={replay.playing ? "Pause" : "Play"}>
              {replay.playing ? "⏸" : "▶"}
            </button>
            <button type="button" className="theater-icon" onClick={replay.restart} aria-label="Restart" title="Restart">
              ↻
            </button>
            <button type="button" className="theater-icon" onClick={replay.skip} aria-label="Skip to the end" title="Skip to the end">
              ⏭
            </button>
            <button
              type="button"
              className={`theater-icon theater-icon-wide${convo ? " on" : ""}`}
              onClick={() => setConvo((v) => !v)}
              aria-pressed={convo}
              aria-label="The conversation"
              title="The conversation"
            >
              📜
            </button>
            <button type="button" className="secondary small" onClick={onExit}>
              Exit
            </button>
          </div>
        </header>

        {replay.done && (
          <div className="theater-verdict">
            <p className="ending">{endingLabel}</p>
            <p className="muted">
              That&apos;s how it ended.{" "}
              <button type="button" className="linklike" onClick={replay.restart}>
                Watch again
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
