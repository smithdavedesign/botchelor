import Link from "next/link";
import Avatar from "./Avatar";
import type { CastChat as Chat } from "@/lib/cast-chat";

/**
 * Leaked from the cast group chat (lib/cast-chat.ts): yesterday's messages among this season's cast, as a phone
 * thread — faces first, first names, the lines. Only ever about what has aired. /watch shows it in full.
 */
export default function CastChat({ chat }: { chat: Chat }) {
  return (
    <section id="cast-chat" className="watch-section cast-chat" aria-labelledby="cast-chat-head" data-track-area="cast-chat">
      <p className="watch-tonight-kicker">Leaked from the cast group chat</p>
      <h2 id="cast-chat-head">{chat.code ? `The morning after ${chat.code.replace("S", "Season ").replace(" · ", ", ")}` : "The morning after"}</h2>
      <ol className="cast-chat-thread">
        {chat.lines.map((l, i) => (
          <li key={i} className="cast-chat-line">
            <Link href={`/characters/${l.character_id}`} className="cast-chat-face" data-track="cast-chat" data-track-where="face" aria-label={l.name}>
              <Avatar seed={l.character_id} name={l.name} hue={l.hue} house size={36} portraitSrc={l.portrait} decorative />
            </Link>
            <div className="cast-chat-bubble">
              <span className="cast-chat-name">{l.name}</span>
              <span>{l.text}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="muted small">
        The producers deny everything.{" "}
        <Link href="/watch#latest" data-track="cast-chat" data-track-where="latest">
          Watch what they&apos;re talking about →
        </Link>
      </p>
    </section>
  );
}
