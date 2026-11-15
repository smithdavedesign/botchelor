import { PATCH as editCharacter } from "@/app/api/characters/[id]/route";
import { track } from "@/lib/analytics";
import { withAnswer } from "@/lib/character-question-fields";
import { loadQuestion, markAnswered, thankFor } from "@/lib/character-questions";
import { crisisCheck, crisisField } from "@/lib/crisis";
import type { Db } from "@/lib/db";
import type { session } from "@/lib/http";

type Sess = ReturnType<typeof session>;
/** What the thread route answers with: the body, with the fresh thread, allowance and extras added. */
type Settle = (body: Record<string, unknown>, status: number) => Promise<Response>;

/** The same person's request, aimed at the edit route in-process: their cookies and address go with it. */
function asEdit(req: Request, characterId: string, body: unknown): Request {
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(new URL(`/api/characters/${characterId}`, req.url), { method: "PATCH", headers, body: JSON.stringify(body) });
}

/**
 * The answer box under a question a character asked about its own sheet (lib/character-questions.ts; POST
 * /api/companion/:id `{ action: "offer", offer: "answer", message_id, text }`). Owner-only. The answer is put on the
 * sheet by the edit route itself (PATCH /api/characters/:id, run in-process as this person), so it meets exactly the
 * checks an edit of that field meets: the field's limits, the PG sheet check in any language, the fan-cast lock. A
 * refusal comes back with that route's own words and the box stays open; a saved answer closes it and the character says
 * thanks with a written line (never a model call). Free: no reply is taken.
 */
export async function takeAnswer(req: Request, db: Db, sess: Sess, threadId: string, messageId: string, text: string | undefined, settle: Settle): Promise<Response> {
  const q = await loadQuestion(db, { userId: sess.userId, threadId, messageId });
  if (!q.ok) return settle({ error: q.error, message: q.message }, q.status);
  const answer = (text ?? "").replace(/\s+/g, " ").trim();
  if (!answer) return settle({ error: "empty_answer", message: "Type an answer first." }, 400);
  // Their own words: self-harm intent gets the resources, and nothing is written to a sheet (lib/crisis.ts).
  const crisis = crisisCheck("companion", answer);
  if (crisis) return settle({ error: "not_saved", message: "That wasn't saved to their sheet.", ...crisisField(crisis) }, 422);

  const extras = withAnswer(q.sheet, q.field, answer);
  if (!extras) {
    // The owner filled that part of the sheet themselves since the question was asked: nothing to add, the box goes.
    await markAnswered(db, messageId);
    return settle({ error: "already_on_sheet", message: "That's already on their sheet." }, 409);
  }
  const res = await editCharacter(asEdit(req, q.characterId, { extras }), { params: Promise.resolve({ id: q.characterId }) });
  if (!res.ok) {
    const data = ((await res.json().catch(() => ({}))) ?? {}) as { error?: unknown; message?: unknown; issues?: { message?: unknown }[] };
    // The edit route's own words: a field's limit comes as its first issue, a content refusal as its message.
    const message = typeof data.issues?.[0]?.message === "string" ? data.issues[0].message : typeof data.message === "string" ? data.message : "That didn't save. Try again in a moment.";
    track("character_answer", { field: q.field, ok: false });
    return settle({ error: typeof data.error === "string" ? data.error : "answer_refused", message, field: q.field }, res.status >= 400 ? res.status : 500);
  }
  await markAnswered(db, messageId);
  const said = await thankFor(db, { userId: sess.userId, characterId: q.characterId, messageId, field: q.field, answer });
  track("character_answer", { field: q.field, ok: true });
  return settle({ answered: q.field, said }, 200);
}
