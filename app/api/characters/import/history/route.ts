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
import { getFrontierModel, getModel, ModelError, type Model } from "@/lib/model";

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

/**
 * Who reads a history (the owner's call, 2026-11-15): the show's PAID model, and nothing when there is none. A history
 * is someone's private chat log, and a free tier's terms may let its provider use what it is sent; the paid model's do
 * not. So there is no quiet fall back to the free model: without a paid model the reading fails the way an outage
 * does, and the character comes in without its history. IMPORT_HISTORY_MODEL=free puts it back on the free model
 * (a local setup with no paid key, the visual harness).
 */
export function historyReader(env: Record<string, string | undefined> = process.env): Model | null {
  if (env.IMPORT_HISTORY_MODEL === "free") return getModel("low", false);
  return getFrontierModel();
}

/**
 * Why a reading failed, for the log: the kind, the provider's status and how long the answer was. Never a word of the
 * paste or of the answer (the page promises the paste is not logged), and never the provider's own message, which can
 * quote what it was sent. Without this a failed reading left no trace at all (the first live one, 2026-11-16).
 */
function logFailure(fail: "no_reader" | "threw" | "unreadable" | "timeout", extra: { status?: number; chars?: number } = {}): void {
  console.log(JSON.stringify({ log: "import_history", fail, ...extra, at: new Date().toISOString() }));
}

/** The model's answer, "timeout" after HISTORY_TIMEOUT_MS (its own timeout and retries can run to a minute), or null when it failed. */
async function ask(name: string, text: string): Promise<string | "timeout" | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), HISTORY_TIMEOUT_MS);
  });
  try {
    const reader = historyReader();
    if (!reader) {
      logFailure("no_reader");
      return null;
    }
    // No sampling settings: the paid model is called the way the show's other calls on it are (some models refuse a
    // temperature), and the prompt, not the temperature, is what keeps it to copying. Room for eight lines and their JSON.
    const call = reader.complete(
      [
        { role: "system", content: historyPrompt(name) },
        { role: "user", content: text },
      ],
      { maxTokens: 1000 },
    );
    // A call that fails after we stopped waiting must not become an unhandled rejection.
    call.catch(() => {});
    const answer = await Promise.race([call, late]);
    if (answer === "timeout") logFailure("timeout");
    return answer;
  } catch (err) {
    logFailure("threw", err instanceof ModelError && err.status ? { status: err.status } : {});
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
 * The text is read once, here, by the show's paid model (historyReader), and nothing of it is kept: no table, no log line, no analytics
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
  if (raw !== null && !read) logFailure("unreadable", { chars: raw.length });
  if (!read) return refuse(503, "model");
  return json({ items: read.items, dropped: read.dropped }, 200, sess);
});
