import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { cleanRef, COMMUNITY_MAX, EMAIL_MAX, joinWaitlist, REF_MAX } from "@/lib/waitlist";

const WaitlistInput = z.object({
  email: z
    .string("Enter your email address.")
    .trim()
    .toLowerCase()
    .max(EMAIL_MAX, `At most ${EMAIL_MAX} characters.`)
    .pipe(z.email("Enter a valid email address.")),
  attest: z.literal(true, "Confirm you are 18 or older."),
  community: z.string().trim().max(COMMUNITY_MAX, `At most ${COMMUNITY_MAX} characters.`).optional(),
  ref: z
    .string()
    .trim()
    .max(REF_MAX)
    .regex(/^[A-Za-z0-9_-]*$/, "Letters, digits, - and _ only.")
    .optional(),
});

/**
 * The waitlist (After Dark's, for now). Always 201 {ok: true}, new or repeat, so nobody can use it to
 * check whether an email is on the list. No session cookie: signing up doesn't need one.
 */
export const POST = handle(async (req) => {
  const input = parseBody(WaitlistInput, await readJson(req), "invalid_signup");
  await joinWaitlist(await getDb(), {
    email: input.email,
    community: input.community || null,
    ref: cleanRef(input.ref),
  });
  return json({ ok: true }, 201);
});
