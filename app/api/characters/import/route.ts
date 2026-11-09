import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { IMPORT_FREE_TEXT_MAX, SOURCE_KEYS, type SourceFields } from "@/lib/import-character";
import { IMPORT_READ_LIMITS, overLimit, visitorKey } from "@/lib/limits";
import { getModel } from "@/lib/model";
import { CHARACTER_REJECTION_MESSAGES, checkFields } from "@/lib/safety";

const Body = z.object({ text: z.string().trim().min(1, "Paste your character first.").max(IMPORT_FREE_TEXT_MAX) });

const PROMPT =
  "You read a character description someone wrote for a chat app and copy its facts into labelled fields. Reply with ONLY a " +
  "JSON object with these string keys: name, tagline (one short line), description (who they are, 1-3 sentences, in the " +
  "text's own words), personality (3 short comma-separated traits), age (a number), gender, appearance, occupation, likes " +
  "(comma-separated), dislikes (comma-separated), wants (what they want in a partner or in life), speech (how they talk), " +
  "greeting (a line they'd say hello with, only if the text has one). Use only what the text says: an empty string for " +
  "anything it doesn't. Never invent, never add anything, never write sexual content.";

/**
 * "Bring your character" (/import): free text with no labels, read into labelled fields by the show's FREE model only
 * (getModel with allowPaid false: never the frontier model, whatever FRONTIER_DEFAULT says). Labelled fields and
 * character cards are read in the browser (lib/import-character.ts) and never come here. The answer is only fields: the
 * page maps and screens them like any other source, and the builder's save checks everything again.
 *
 * Limited per connection and per session (lib/limits.ts IMPORT_READ_LIMITS): the free tier's quota is the live show's.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const { text } = parseBody(Body, await readJson(req), "invalid_import");
  // Refused before any model reads it.
  const screened = checkFields({ text });
  if (!screened.ok && screened.reason === "minor") return json({ error: "refused", reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor }, 422, sess);

  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (visitor !== null && (await overLimit(db, "import_read", visitor, IMPORT_READ_LIMITS))) || (await overLimit(db, "import_read_user", sess.userId, IMPORT_READ_LIMITS));
  if (limited) return json({ error: "too_many_imports", message: "That's a lot of imports in a short time. Paste it with labels (Name:, Description:, Greeting:) to skip this step, or try again later." }, 429, sess);

  let raw: string;
  try {
    raw = await getModel("low", false).complete(
      [
        { role: "system", content: PROMPT },
        { role: "user", content: text },
      ],
      { temperature: 0, maxTokens: 900 },
    );
  } catch {
    return json({ error: "model_unavailable", message: "The show's model couldn't read it just now." }, 503, sess);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return json({ error: "model_unavailable", message: "The show's model couldn't read it just now." }, 503, sess);
  }
  const fields: SourceFields = {};
  if (parsed && typeof parsed === "object") {
    for (const k of SOURCE_KEYS) {
      const v = (parsed as Record<string, unknown>)[k];
      const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
      if (s) fields[k] = s.slice(0, 2000);
    }
  }
  return json({ fields }, 200, sess);
});
