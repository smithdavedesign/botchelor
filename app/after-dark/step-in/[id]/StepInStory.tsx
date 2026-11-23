"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { StepInSceneView } from "@/lib/adult/step-in-shared";
import type { StepInStory } from "@/lib/adult/step-in-story";
import { okJson } from "@/lib/ok-json";

/** How long after a reply lands the story is read for it: reading the reply comes first. */
const READ_AFTER_MS = 900;
/** "Keep going", remembered for the scene on this device so the offer isn't made again under every reply. */
const KEEP_GOING_KEY = "bz_step_in_keep_going";

/**
 * A roleplay's story on the scene's page (lib/adult/step-in-story.ts): once a reply has landed and nothing else is
 * going on, the story is read for it (POST …/story: one small call, at most once a reply), and the view takes what
 * comes back. A reading that fails changes nothing; the next reply asks again.
 */
export function useStoryReading(view: StepInSceneView, setView: Dispatch<SetStateAction<StepInSceneView>>, idle: boolean): void {
  const newest = view.messages.filter((m) => m.role === "character").at(-1)?.id ?? null;
  const due = idle && view.story?.due ? newest : null;
  const asked = useRef<string | null>(null);
  const sceneId = view.id;
  useEffect(() => {
    if (!due || asked.current === due) return;
    const stop = new AbortController();
    const t = setTimeout(() => {
      asked.current = due;
      void fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(sceneId)}/story`, { method: "POST", signal: stop.signal })
        .then(okJson)
        .then((d: { story?: StepInStory | null } | null) => {
          const story = d?.story;
          if (story) setView((v) => (v.id === sceneId ? { ...v, story } : v));
        })
        .catch(() => {});
    }, READ_AFTER_MS);
    return () => {
      clearTimeout(t);
      stop.abort();
    };
  }, [due, sceneId, setView]);
}

/**
 * Under the roleplay's name: what the viewer's side of it wants ("You want …": the card's own words, told to them), and
 * how far the story has got as dots, one a beat. The beats themselves are never shown: they'd give the story away.
 */
export function StoryLine({ story }: { story: StepInStory | null }) {
  if (!story) return null;
  const said = story.complete ? "The story has played its last beat" : `${story.done} of ${story.beats} of the story's beats played`;
  return (
    <p className="muted small ad-si-story" data-step-in-story={story.complete ? "complete" : "playing"} data-step-in-story-done={story.done}>
      <span className="ad-si-story-goal">{story.goal}</span>
      <span className="ad-si-story-beats" role="img" aria-label={said} title={said}>
        {Array.from({ length: story.beats }, (_, i) => (
          <span key={i} className={i < story.done ? "on" : undefined} />
        ))}
      </span>
    </p>
  );
}

/** How long a dot that has just been filled is marked as new. */
const FRESH_MS = 5000;

/**
 * The story where the viewer is reading: its dots again, at the end of the row under the newest reply. The header,
 * with the goal, is a screen or more up by the third reply, and a beat is ticked a moment after a reply lands: without
 * this the story moved on out of sight, and the first a viewer knew of it was the ending. A dot that has just been
 * filled is marked for a few seconds (the words beside it never change, so nothing in the row moves); pressing it
 * says what they're playing for again, and how far it's got, in words.
 */
export function StoryHere({ story }: { story: StepInStory | null }) {
  const done = story?.done ?? 0;
  const [open, setOpen] = useState(false);
  // The beats this row has already shown filled: one more than that is news for a few seconds.
  const [seen, setSeen] = useState(done);
  useEffect(() => {
    if (done <= seen) return;
    const t = setTimeout(() => setSeen(done), FRESH_MS);
    return () => clearTimeout(t);
  }, [done, seen]);
  if (!story) return null;
  const fresh = done > seen;
  const said = story.complete ? "The story has played its last beat" : `${story.done} of ${story.beats} of the story's beats played`;
  return (
    <>
      <button type="button" className="link-button ad-si-story-here" aria-expanded={open} onClick={() => setOpen((was) => !was)} data-step-in-story-here={fresh ? "fresh" : "still"} data-step-in-story-done={story.done}>
        <span>The story</span>
        <span className="ad-si-story-beats" role="img" aria-label={said}>
          {Array.from({ length: story.beats }, (_, i) => (
            <span key={i} className={i < story.done ? (i >= seen ? "on new" : "on") : undefined} />
          ))}
        </span>
      </button>
      {/* Said aloud to a screen reader when a beat is ticked: the dots filling is otherwise silent. */}
      <span className="sr-only" role="status">
        {fresh ? said : ""}
      </span>
      {open && (
        <span className="muted small ad-si-story-said" data-step-in-story-said>
          {story.goal} {said}.
        </span>
      )}
    </>
  );
}

/**
 * The ending, offered once every beat has played: one last reply from the character that lands the story, then the
 * scene ends and is filed. Or keep going, for as long as they like: it's an offer, never a stop, and once it's turned
 * down it isn't made again in this scene on this device (the ⋯ menu still has it).
 */
export function StoryEnding({ story, sceneId, name, busy, onClose }: { story: StepInStory | null; sceneId: string; name: string; busy: boolean; onClose: () => void }) {
  const [later, setLater] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`${KEEP_GOING_KEY}:${sceneId}`) === "1") setLater(true);
    } catch {
      /* storage blocked (a private window): the offer is simply made again */
    }
  }, [sceneId]);
  if (!story?.complete || later) return null;
  return (
    <div className="card ad-si-ending" role="status" data-step-in-ending>
      <p>
        <strong>The story has played its last beat.</strong> {name} can bring it to a close with one last line, or you can keep going for as long as you like.
      </p>
      <p className="ad-si-ending-go">
        <button type="button" className="button small" disabled={busy} onClick={onClose} data-step-in-close>
          Bring it to a close
        </button>
        <button
          type="button"
          className="button-ghost small"
          onClick={() => {
            setLater(true);
            try {
              sessionStorage.setItem(`${KEEP_GOING_KEY}:${sceneId}`, "1");
            } catch {
              /* not remembered */
            }
          }}
          data-step-in-keep-going
        >
          Keep going
        </button>
      </p>
    </div>
  );
}

/** On a scene that has ended with its story played out: that it was, and the way to the next one. */
export function StoryPlayed({ story, title }: { story: StepInStory | null; title: string | null }) {
  if (!story?.complete || !title) return null;
  return (
    <p className="ad-si-played" data-step-in-played>
      <strong>Played to the end: {title}.</strong> <Link href="/after-dark/step-in">Another roleplay</Link>
    </p>
  );
}
