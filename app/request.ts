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

export async function requestJson(url: string, body: unknown = {}, method: "POST" | "DELETE" | "PATCH" | "PUT" = "POST"): Promise<ApiResult> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data, message: describeError(data as ErrorBody) };
}
