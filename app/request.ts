/** Client-side JSON calls to the app's own API, with the error body turned into one readable line. */

type ErrorBody = {
  error?: string;
  message?: string;
  field?: string;
  issues?: { field: string; message: string }[];
};

export function describeError(data: ErrorBody): string {
  if (data.error === "content_rejected") return `${data.message ?? "That was rejected."} (Check: ${data.field}.)`;
  if (data.issues?.length) return data.issues.map((i) => `${i.field}: ${i.message}`).join(" ");
  return data.message ?? "Something went wrong. Try again.";
}

export type ApiResult = { ok: boolean; status: number; data: Record<string, unknown>; message: string };

/**
 * `timeoutMs`: give up after this long (the call then rejects with a TimeoutError), so a long job's button never spins
 * past the server's own limit (2026-10-25: a Studio shoot "spinning forever").
 */
export async function requestJson(url: string, body: unknown = {}, method: "POST" | "DELETE" | "PATCH" | "PUT" = "POST", opts: { timeoutMs?: number } = {}): Promise<ApiResult> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data, message: describeError(data as ErrorBody) };
}
