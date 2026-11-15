import Link from "next/link";
import { getDb } from "@/lib/db";
import { shortName } from "@/lib/names";
import { overnightMarks, type OvernightMark } from "@/lib/overnight";
import { overnightDatesOn } from "@/lib/overnight-shared";

/**
 * A character's overnight dates that aired and ended in leaving together (lib/overnight.ts overnightMarks), in its Dates
 * card: from the public record for a visitor, and its owner's unlisted ones too. Nothing when there are none, or with
 * OVERNIGHT_DATES=0.
 *
 * The character page loads the marks with the rest of its reads (`loadOvernightMarks`) and hands them to the list: an
 * async component in the middle of the page was one more round trip after everything else, and a page that awaits
 * nothing of its own while rendering is one the tests can render to a string.
 */
export async function loadOvernightMarks(characterId: string, viewerId: string | null): Promise<OvernightMark[]> {
  if (!overnightDatesOn()) return [];
  return overnightMarks(await getDb(), { character: characterId }, viewerId, 3).catch(() => []);
}

export function OvernightMarksList({ characterId, marks }: { characterId: string; marks: OvernightMark[] }) {
  if (!marks.length) return null;
  return (
    <>
      {marks.map((m) => {
        const other = m.lo === characterId ? m.names[1] : m.names[0];
        return (
          <p key={m.episode_id} className="muted overnight-mark" data-overnight-mark>
            🌙 An overnight date with <Link href={`/couples/${m.lo}/${m.hi}#overnight`}>{shortName(other)}</Link>
            {m.place ? ` at ${m.place}` : ""}: they left together. <Link href={`/episodes/${m.episode_id}`}>Watch it</Link>
          </p>
        );
      })}
    </>
  );
}

/** The same, loading its own marks: for a place that has no reads of its own to put them beside. */
export default async function OvernightMarks({ characterId, viewerId }: { characterId: string; viewerId: string | null }) {
  const marks = await loadOvernightMarks(characterId, viewerId);
  return marks.length ? <OvernightMarksList characterId={characterId} marks={marks} /> : null;
}
