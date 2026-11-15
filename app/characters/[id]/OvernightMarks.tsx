import Link from "next/link";
import { getDb } from "@/lib/db";
import { shortName } from "@/lib/names";
import { overnightMarks } from "@/lib/overnight";
import { overnightDatesOn } from "@/lib/overnight-shared";

/**
 * A character's overnight dates that aired and ended in leaving together (lib/overnight.ts overnightMarks), in its Dates
 * card: from the public record for a visitor, and its owner's unlisted ones too. Nothing when there are none, or with
 * OVERNIGHT_DATES=0.
 */
export default async function OvernightMarks({ characterId, viewerId }: { characterId: string; viewerId: string | null }) {
  if (!overnightDatesOn()) return null;
  const marks = await overnightMarks(await getDb(), { character: characterId }, viewerId, 3).catch(() => []);
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
