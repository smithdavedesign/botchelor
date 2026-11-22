/**
 * What a browser reports when a page breaks the Report-Only policy (lib/security-headers.ts reportOnlyPolicy), cut to a
 * line a person can read in the run log: which rule, what it would have blocked (an origin or a keyword like "inline",
 * never a whole address: links carry tokens), and on which page (its path, no query). Both formats browsers send are
 * read: the older report-uri one ({"csp-report": {...}}) and the Reporting API's ([{type: "csp-violation", body}]).
 * What a browser extension did is dropped: it isn't the site's. Each kind is logged once a window, and at most
 * MAX_LINES kinds a window, so a page that breaks the policy on every load can't flood the log.
 */
export type Violation = { directive: string; blocked: string; page: string; source: string | null };

export const WINDOW_MS = 10 * 60 * 1000;
export const MAX_LINES = 40;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser|edge)-extension:/i;

/** An address cut to its origin, a keyword (inline, eval, data, blob…) kept as it is; anything else becomes "other". */
function where(raw: string | null): string | null {
  if (!raw) return null;
  if (/^[a-z-]+$/i.test(raw)) return raw.toLowerCase().slice(0, 40);
  try {
    const u = new URL(raw);
    if (u.protocol === "data:" || u.protocol === "blob:") return u.protocol.slice(0, -1);
    return u.origin === "null" ? u.protocol.slice(0, -1) : u.origin.slice(0, 100);
  } catch {
    return "other";
  }
}

/** A page's host and path, no query, cut short. */
function pageOf(raw: string | null): string {
  if (!raw) return "?";
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`.slice(0, 120);
  } catch {
    return "?";
  }
}

function one(r: Obj, keys: { directive: string[]; blocked: string; page: string; source: string }): Violation | null {
  const blockedRaw = str(r[keys.blocked]);
  const sourceRaw = str(r[keys.source]);
  if ((blockedRaw && EXTENSION.test(blockedRaw)) || (sourceRaw && EXTENSION.test(sourceRaw))) return null;
  const directive = keys.directive.map((k) => str(r[k])).find((d) => d !== null)?.split(/\s/)[0] ?? null;
  if (!directive || !/^[a-z-]{2,40}$/.test(directive)) return null;
  return { directive, blocked: where(blockedRaw) ?? "?", page: pageOf(str(r[keys.page])), source: where(sourceRaw) };
}

/** The violations in a report body (either format), or none when it isn't one. */
export function violationsIn(text: string): Violation[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (isObj(raw) && isObj(raw["csp-report"])) {
    const v = one(raw["csp-report"], { directive: ["effective-directive", "violated-directive"], blocked: "blocked-uri", page: "document-uri", source: "source-file" });
    return v ? [v] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 50)
    .filter((r): r is Obj => isObj(r) && r.type === "csp-violation" && isObj(r.body))
    .map((r) => one(r.body as Obj, { directive: ["effectiveDirective", "violatedDirective"], blocked: "blockedURL", page: "documentURL", source: "sourceFile" }))
    .filter((v): v is Violation => v !== null);
}

let windowStart = 0;
const seen = new Map<string, number>();

/** The log lines for these violations: each kind once a window, at most MAX_LINES kinds a window. */
export function reportLines(violations: Violation[], now = Date.now()): string[] {
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    seen.clear();
  }
  const lines: string[] = [];
  for (const v of violations) {
    const key = `${v.directive} ${v.blocked} ${v.page}`;
    const n = seen.get(key);
    if (n !== undefined) {
      seen.set(key, n + 1);
      continue;
    }
    if (seen.size >= MAX_LINES) continue;
    seen.set(key, 1);
    lines.push(`[csp] report-only: ${v.directive} would block ${v.blocked} on ${v.page}${v.source ? ` (from ${v.source})` : ""}`);
  }
  return lines;
}

export function resetReportsForTests(): void {
  windowStart = 0;
  seen.clear();
}
