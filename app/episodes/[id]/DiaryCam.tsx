import Avatar from "@/app/Avatar";
import type { CharacterRef } from "@/lib/game";
import type { SeeAgain } from "@/lib/inner-life";

const SEE_AGAIN_SAYS: Record<SeeAgain, string> = { yes: "Yes", maybe: "Maybe", no: "No" };

/**
 * The diary cam (lib/game.ts EpisodeJson.diary): what each of them told the camera after the date, once it has aired.
 * Folded when the theater can play the date, like the recap, so scrolling past it doesn't tell you how it went; open
 * when there's nothing to watch.
 */
export default function DiaryCam({
  diary,
  characters,
  folded,
  choices = [],
}: {
  diary: { character_id: string; line: string }[];
  characters: CharacterRef[];
  folded: boolean;
  /** Living dates (lib/choices.ts): each side's private answer to "see them again?", with its reason when it may be shown. */
  choices?: { character_id: string; see_again: SeeAgain; reason: string | null }[];
}) {
  // One entry per character: what it told the camera, and what it answered when asked privately.
  const ids = [...new Set([...diary.map((d) => d.character_id), ...choices.map((c) => c.character_id)])];
  return (
    <details className="card diary-cam" open={!folded}>
      <summary>
        <span aria-hidden="true">📹</span> Diary cam: what they said after
      </summary>
      <ul className="diary-cam-list">
        {ids.map((id) => {
          const c = characters.find((x) => x.id === id);
          if (!c) return null;
          const d = diary.find((x) => x.character_id === id);
          const choice = choices.find((x) => x.character_id === id);
          return (
            <li key={id}>
              <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={44} />
              <blockquote>
                {d && <p>“{d.line}”</p>}
                {choice && (
                  <p className="diary-choice">
                    <span className="diary-choice-q">See them again?</span> <strong>{SEE_AGAIN_SAYS[choice.see_again]}</strong>
                    {choice.reason ? <> · “{choice.reason}”</> : null}
                  </p>
                )}
                <footer className="muted small">{c.name}, to camera</footer>
              </blockquote>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
