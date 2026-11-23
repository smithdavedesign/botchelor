import Link from "next/link";
import type { AlternativeNote as Note } from "@/lib/alternative-apps";

/**
 * A dated note under a page's hero, above the list (lib/alternative-apps.ts characterAiNote): another app's own words
 * about itself, quoted, with quiet links to the pages that say them, never followed. Its `paste` words link the page's
 * own import door as plain text, so the hero keeps the one loud button. The page decides whether it shows (noteFor), and
 * whether it links the guide to saving your characters and chats first (`guideHref`, CAI_GUIDE).
 */
export default function AlternativeNote({ note, importHref, guideHref }: { note: Note; importHref: string; guideHref?: string }) {
  const last = note.body.length - 1;
  return (
    <section className="card alt-note" aria-labelledby="alt-note-title">
      <h2 id="alt-note-title">{note.heading}</h2>
      {note.body.map((words, i) => (
        <p key={words}>{i === last && note.paste ? <Paste words={words} paste={note.paste} href={importHref} /> : words}</p>
      ))}
      {/* The guide to saving them (lib/cai-guide.ts), while CAI_GUIDE is on: a quiet link, the hero keeps the loud one. */}
      {guideHref && (
        <p className="small">
          <Link href={guideHref}>How to save your characters and chats first</Link>
        </p>
      )}
      <p className="muted small">
        {note.links.map((l, i) => (
          <span key={l.href}>
            {i > 0 && " · "}
            <a href={l.href} rel="nofollow noopener" target="_blank">
              {l.text}
            </a>
          </span>
        ))}
      </p>
    </section>
  );
}

/** The paragraph with its `paste` words as a link, the words themselves unchanged; without them, as it is. */
function Paste({ words, paste, href }: { words: string; paste: string; href: string }) {
  const at = words.indexOf(paste);
  if (at < 0) return <>{words}</>;
  return (
    <>
      {words.slice(0, at)}
      <Link href={href}>{paste}</Link>
      {words.slice(at + paste.length)}
    </>
  );
}
