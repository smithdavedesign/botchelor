import { describeError, type ApiResult } from "@/app/request";
import { KEPT_ANSWER, KEPT_ANSWER_HEADER, keptAnswerOf } from "@/lib/adult/write-watch";

/**
 * requestJson (app/request.ts) for a write in the theater, whose work can outlast the 100 seconds of silence the
 * host's edge allows (docs/hosting.md). It asks the scene's route to keep the answer alive (KEPT_ANSWER_HEADER:
 * app/api/admin/after-dark/route.ts answers as a stream that sends a newline now and then and ends with the real
 * status and JSON inside it) and reads that back as any answer: `ok` and `status` are the route's own, not the
 * stream's 200.
 *
 * The whole body is read before anything is decided, so a stream cut off part-way rejects, and the caller takes the
 * answer as lost (lib/adult/write-watch.ts answerLost) and follows the write on the scene instead. An answer that
 * isn't a kept one is read the plain way: a proxy's own error page, or a server from before this (a page and a server
 * a deploy apart).
 */
export async function requestKept(url: string, body: unknown = {}): Promise<ApiResult> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", [KEPT_ANSWER_HEADER]: KEPT_ANSWER }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const kept = keptAnswerOf(parsed);
  if (kept) return { ok: kept.status >= 200 && kept.status < 300, status: kept.status, data: kept.body, message: describeError(kept.body) };
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!res.ok) return { ok: false, status: res.status, data: data ?? {}, message: describeError(data ?? {}) };
  // A 200 with no JSON in it is a stream that ended early: nothing can be read from it.
  if (!data) throw new Error("the kept answer ended early");
  // The stream's own failure (lib/http.ts jsonWhenDone: the work threw), which it can only say in its body.
  if (data.error === "internal_error") return { ok: false, status: 500, data, message: describeError(data) };
  return { ok: true, status: res.status, data, message: describeError(data) };
}
