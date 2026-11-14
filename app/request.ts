/** Client-side JSON calls to the app's own API, with the error body turned into one readable line. */

type ErrorBody = {
  error?: string;
  message?: string;
  field?: string;
  issues?: { field: string; message: string }[];
  character_name?: string;
  partner_name?: string;
};

export function describeError(data: ErrorBody): string {
  // The API's own words are for agents (they name its tools and the date's id); a person gets the plain version, and the
  // page that shows it links the date (`watch_path`). 2026-11-14 feedback: "a new user will think it broke".
  if (data.error === "date_in_progress" && data.character_name && data.partner_name) {
    return `${data.character_name} is still on a date with ${data.partner_name}, so nothing was booked or spent. Watch that one first, then send them out again.`;
  }
  if (data.error === "content_rejected") return `${data.message ?? "That was rejected."} (Check: ${data.field}.)`;
  if (data.issues?.length) return data.issues.map((i) => `${i.field}: ${i.message}`).join(" ");
  return data.message ?? "Something went wrong. Try again.";
}

/** A refusal's "Watch it" link: a date still being filmed (date_in_progress) names its page. */
export function watchLinkOf(data: Record<string, unknown>): { href: string; label: string } | undefined {
  return data.error === "date_in_progress" && typeof data.watch_path === "string" && data.watch_path.startsWith("/episodes/")
    ? { href: data.watch_path, label: "Watch it" }
    : undefined;
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
