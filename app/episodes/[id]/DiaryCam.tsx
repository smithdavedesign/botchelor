import Avatar from "@/app/Avatar";
import type { CharacterRef } from "@/lib/game";

/**
 * The diary cam (lib/game.ts EpisodeJson.diary): what each of them told the camera after the date, once it has aired.
 * Folded when the theater can play the date, like the recap, so scrolling past it doesn't tell you how it went; open
 * when there's nothing to watch.
 */
export default function DiaryCam({ diary, characters, folded }: { diary: { character_id: string; line: string }[]; characters: CharacterRef[]; folded: boolean }) {
  return (
    <details className="card diary-cam" open={!folded}>
      <summary>
        <span aria-hidden="true">📹</span> Diary cam: what they said after
      </summary>
      <ul className="diary-cam-list">
        {diary.map((d) => {
          const c = characters.find((x) => x.id === d.character_id);
          if (!c) return null;
          return (
            <li key={d.character_id}>
              <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={44} />
              <blockquote>
                <p>“{d.line}”</p>
                <footer className="muted small">{c.name}, to camera</footer>
              </blockquote>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
