import { z } from "zod";
import { getDb } from "@/lib/db";
import { NAME_MAX } from "@/lib/field-limits";
import { ApiError, handle, json, parseBody, session } from "@/lib/http";
import {
  historyFailureLine,
  historyPrompt,
  HISTORY_BODY_MAX_BYTES,
  HISTORY_MIN,
  HISTORY_READ_MAX,
  HISTORY_TIMEOUT_MS,
  importMemoriesOn,
  itemsFromReply,
  type HistoryFailure,
} from "@/lib/import-history";
import { IMPORT_HISTORY_ALL_LIMITS, IMPORT_HISTORY_IP_LIMITS, IMPORT_HISTORY_LIMITS, overLimit, visitorKey } from "@/lib/limits";
import { getModel } from "@/lib/model";

const Body = z.object({
  text: z.string().trim().min(HISTORY_MIN, "Paste a little more of their history first.").max(HISTORY_READ_MAX),
  name: z.string().trim().max(NAME_MAX).optional(),
});

/**
 * The body, read up to this route's own size (lib/http.ts readJson stops at 10 KB, and a history is up to
 * HISTORY_READ_MAX characters). JSON only, like every route. A parse error says nothing of what was sent: V8's message
 * quotes the text, and this text is never to reach a log.
 */
async function readHistoryBody(req: Request): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) {
    throw new ApiError(415, { error: "unsupported_media_type", message: "Send JSON with Content-Type: application/json." });
  }
  if (Number(req.headers.get("content-length") ?? 0) > HISTORY_BODY_MAX_BYTES) throw new ApiError(413, { error: "body_too_large" });
  const body = await req.text();
  if (new TextEncoder().encode(body).length > HISTORY_BODY_MAX_BYTES) throw new ApiError(413, { error: "body_too_large" });
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError(400, { error: "invalid_json" });
  }
}

/** The model's answer, "timeout" after HISTORY_TIMEOUT_MS (its own timeout and retries can run to a minute), or null when it failed. */
async function ask(name: string, text: string): Promise<string | "timeout" | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), HISTORY_TIMEOUT_MS);
  });
  try {
    // The show's FREE model only (allowPaid false), as /import's reader and one-sentence create: never the frontier model.
    const call = getModel("low", false).complete(
      [
        { role: "system", content: historyPrompt(name) },
        { role: "user", content: text },
      ],
      { temperature: 0, maxTokens: 700 },
    );
    // A call that fails after we stopped waiting must not become an unhandled rejection.
    call.catch(() => {});
    return await Promise.race([call, late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Bring their history" (/import's second box, lib/import-history.ts): `{ text, name? }` in, `{ items, dropped }` out:
 * at most eight one-sentence lines, each typed by where it would go (the character's facts, the companion memory, the
 * voice) and already past that place's check; `dropped` is how many the reader offered that weren't (a count).
 *
 * The text is read once, here, by the show's free model, and nothing of it is kept: no table, no log line, no analytics
 * prop (the page's events carry counts). The page has already cut it to HISTORY_READ_MAX. Nothing is saved by this route
 * at all: the person edits the list, and what they keep rides the character's own save and the memory write.
 *
 * Every refusal carries `reason` and the sentence the page shows; none of them stops the import itself. 404 when
 * IMPORT_MEMORIES=0, 429 past the caps (lib/limits.ts: per visitor, per address, across everyone), 503 when the model is
 * down, slow or unreadable, 200 with no items when it found nothing to keep.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const refuse = (status: number, reason: HistoryFailure) => json({ error: reason, reason, message: historyFailureLine(reason) }, status, sess);
  if (!importMemoriesOn()) return refuse(404, "off");
  const { text, name = "" } = parseBody(Body, await readHistoryBody(req), "invalid_history");

  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (await overLimit(db, "import_history_user", sess.userId, IMPORT_HISTORY_LIMITS)) ||
    (visitor !== null && (await overLimit(db, "import_history", visitor, IMPORT_HISTORY_IP_LIMITS))) ||
    (await overLimit(db, "import_history_all", "all", IMPORT_HISTORY_ALL_LIMITS));
  if (limited) return refuse(429, "limited");

  const raw = await ask(name, text);
  if (raw === "timeout") return refuse(503, "timeout");
  const read = raw === null ? null : itemsFromReply(raw);
  if (!read) return refuse(503, "model");
  return json({ items: read.items, dropped: read.dropped }, 200, sess);
});
