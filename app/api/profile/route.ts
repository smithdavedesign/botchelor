import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { assertSafeName, nameText, PROFILE_NAME_MAX, profileNameTaken } from "@/lib/people";

const ProfileInput = z.object({
  name: nameText(PROFILE_NAME_MAX),
  attest: z.literal(true, "Confirm you are 18 or older."),
});

/**
 * Sets the display name shown on league boards, the best-callers board (lib/streaks.ts) and, after a mutual reveal, on
 * episodes. Setting it records the user's 18+ self-attestation.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(ProfileInput, await readJson(req), "invalid_profile");
  assertSafeName(input.name);

  const db = await getDb();
  // Display names are one person's each (they show on the public best-callers board, lib/streaks.ts), compared trimmed and
  // case-blind, like characters' names (lib/name-check.ts). Your own name is yours to keep or re-case.
  if (await profileNameTaken(db, input.name, sess.userId)) {
    return json(
      { error: "name_taken", field: "name", message: `Someone already goes by ${input.name}. Try adding a word or a number.` },
      409,
      sess,
    );
  }
  await db.query(
    `insert into profiles (user_id, name) values ($1, $2)
     on conflict (user_id) do update set name = excluded.name, updated_at = now()`,
    [sess.userId, input.name],
  );
  return json({ name: input.name }, 200, sess);
});
