import Avatar from "@/app/Avatar";
import { english, msg, type T } from "@/lib/i18n/translate";
import type { FilmConfessional } from "@/lib/date-film-shared";
import type { CharacterRef } from "@/lib/game";
import type { SeeAgain } from "@/lib/inner-life";
import { showSetBackground } from "@/lib/show-sets";
import ConfessionalClip from "./ConfessionalClip";

const SEE_AGAIN_SAYS: Record<SeeAgain, string> = { yes: msg("Yes"), maybe: msg("Maybe"), no: msg("No") };

/**
 * The diary cam (lib/game.ts EpisodeJson.diary): what each of them told the camera after the date, once it has aired.
 * Folded when the theater can play the date, like the recap, so scrolling past it doesn't tell you how it went; open
 * when there's nothing to watch. A line that was filmed (lib/date-film.ts) is said to camera: their confessional still
 * stands where their face would, and plays when it's pressed.
 */
export default function DiaryCam({
  diary,
  characters,
  folded,
  choices = [],
  thoughts = [],
  clips = [],
  t = english,
}: {
  diary: { character_id: string; line: string }[];
  characters: CharacterRef[];
  folded: boolean;
  /** Living dates (lib/choices.ts): each side's private answer to "see them again?", with its reason when it may be shown. */
  choices?: { character_id: string; see_again: SeeAgain; reason: string | null }[];
  /** Living dates: each character's private thoughts through the date, in order (the ones that may be shown). */
  thoughts?: { character_id: string; thoughts: string[] }[];
  /** The lines that were filmed (lib/date-film.ts), each the words it says. */
  clips?: FilmConfessional[];
  t?: T;
}) {
  // One entry per character: what it told the camera, and what it answered when asked privately.
  const ids = [...new Set([...diary.map((d) => d.character_id), ...choices.map((c) => c.character_id), ...thoughts.filter((x) => x.thoughts.length).map((x) => x.character_id)])];
  return (
    <details className="card diary-cam" open={!folded}>
      <summary>
        <span aria-hidden="true">📹</span> {t("Diary cam: what they said after")}
      </summary>
      {/* On the confessional set, the camera rolling (pass 2 of the visual pop audit; lib/show-sets.ts). */}
      <ul className="diary-cam-list on-set diary-cam-set" style={{ backgroundImage: showSetBackground("confessional", 0.6) }}>
        {ids.map((id) => {
          const c = characters.find((x) => x.id === id);
          if (!c) return null;
          const d = diary.find((x) => x.character_id === id);
          const choice = choices.find((x) => x.character_id === id);
          const thought = thoughts.find((x) => x.character_id === id)?.thoughts ?? [];
          // Only beside the line it says: a clip of a line the page isn't showing would be a voice with no words.
          const clip = d ? clips.find((x) => x.character_id === id) : undefined;
          return (
            <li key={id} className={clip ? "diary-cam-filmed" : undefined}>
              {clip ? <ConfessionalClip src={clip.src} poster={clip.poster} name={c.name} seconds={clip.seconds} /> : <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={44} />}
              <blockquote>
                {d && <p>“{d.line}”</p>}
                {choice && (
                  <p className="diary-choice">
                    <span className="diary-choice-q">{t("See them again?")}</span> <strong>{t(SEE_AGAIN_SAYS[choice.see_again])}</strong>
                    {choice.reason ? <> · “{choice.reason}”</> : null}
                  </p>
                )}
                <footer className="muted small">{t("{name}, to camera", { name: c.name })}</footer>
                {thought.length > 0 && (
                  <details className="diary-thoughts">
                    <summary>
                      <span aria-hidden="true">💭</span> {t("What {name} was thinking ({n})", { name: c.name.split(/\s+/)[0], n: thought.length })}
                    </summary>
                    <ol>
                      {thought.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </blockquote>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
