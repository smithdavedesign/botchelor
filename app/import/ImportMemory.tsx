import Link from "next/link";
import type { ImportMemoryNote } from "./held-history";

/**
 * After Create, for a character that came through "Bring their history" (lib/import-history.ts): what became of the
 * lines about the two of them. Written: how many the character now remembers, and the page where each one is theirs to
 * edit. Not yet (a guest past their free conversations, companions not open to them): that the lines wait in this
 * browser, why, and where they turn up. Shown above the builder's "Who should they meet?".
 */
export default function ImportMemory({ note, name }: { note: ImportMemoryNote; name: string }) {
  const first = name.trim().split(/\s+/)[0] || "They";
  if (note.kind === "held") {
    return (
      <p className="notice import-memory" role="status" data-track-area="import-memory">
        <strong>{note.count === 1 ? "The line about the two of you isn't" : `The ${note.count} lines about the two of you aren't`} in {first}&apos;s memory yet.</strong>{" "}
        {note.message} Once you&apos;ve texted {first}, they&apos;re waiting on <em>What {first} knows about you</em>, one press to add.
      </p>
    );
  }
  if (!note.kept) {
    return note.dropped ? (
      <p className="notice import-memory" role="status">
        The {note.dropped === 1 ? "line" : "lines"} about the two of you couldn&apos;t go into {first}&apos;s memory: a companion keeps nothing past PG, and no notes on anyone&apos;s health.
      </p>
    ) : null;
  }
  return (
    <p className="notice import-memory" role="status" data-track-area="import-memory">
      <strong>
        {first} remembers {note.kept === 1 ? "one thing" : `${note.kept} things`} about the two of you.
      </strong>{" "}
      {note.href ? (
        <>
          <Link href={note.href} data-track="import-memory-open">
            See what {first} knows
          </Link>
          : each one is yours to edit or forget, and only you two see them.
        </>
      ) : (
        "Each one is yours to edit or forget, and only you two see them."
      )}
      {note.dropped > 0 && ` ${note.dropped === 1 ? "One line" : `${note.dropped} lines`} couldn't be kept.`}
    </p>
  );
}
