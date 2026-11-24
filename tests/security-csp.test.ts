import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cspReport } from "@/app/api/csp-report/route";
import { SIGNAL_URL } from "@/app/funnel";
import { DEEPGRAM_API } from "@/lib/companion-live";
import { MAX_LINES, reportLines, resetReportsForTests, violationsIn } from "@/lib/csp-report";
import { CSP_REPORT_PATH, NONCE_HEADER, newNonce, reportOnlyPolicy, SECURITY_HEADERS } from "@/lib/security-headers";
import { proxy as middleware } from "@/proxy";
import { BASE_URL } from "./helpers";

// The security headers' second step (2026-11-22): a strict policy, Report-Only, built on a nonce each page load gets in
// the proxy, and a route that logs what it would have blocked.
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const page = (url: string, headers: Record<string, string> = {}) => middleware(new NextRequest(url, { headers: { "user-agent": CHROME, ...headers } }));
const directive = (policy: string, name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the Report-Only policy (lib/security-headers.ts)", () => {
  const env = {
    SITE_URL: "https://botchelor.com",
    AFTER_DARK_ORIGIN: "https://ad.botchelor.com",
    MEDIA_BUNNY_CDN_HOST: "media.botchelor.com",
    MEDIA_S3_ENDPOINT: "https://br-x.storage.c-2.us-east-1.aws.neon.tech/",
  };

  it("lets scripts run by this load's nonce only, and asks for reports only when told", () => {
    const policy = reportOnlyPolicy("abc123", {}, env);
    expect(directive(policy, "script-src")).toBe("script-src 'nonce-abc123' 'strict-dynamic' 'self' https: 'unsafe-inline'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("report-uri");
    expect(reportOnlyPolicy("abc123", { report: true }, env)).toMatch(new RegExp(`; report-uri ${CSP_REPORT_PATH}$`));
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "worker-src 'self' blob:"]) expect(policy.split("; ")).toContain(d);
  });

  it("allows media from both stores and both hosts, and what the pages call: the Google tag, the funnel, the live calls", () => {
    const policy = reportOnlyPolicy("n", {}, env);
    for (const kind of ["img-src", "media-src", "connect-src"]) {
      for (const origin of ["https://media.botchelor.com", "https://br-x.storage.c-2.us-east-1.aws.neon.tech", "https://botchelor.com", "https://ad.botchelor.com"]) {
        expect(directive(policy, kind).split(" ")).toContain(origin);
      }
    }
    const connect = directive(policy, "connect-src").split(" ");
    expect(connect).toContain(new URL(SIGNAL_URL).origin);
    expect(connect).toContain(DEEPGRAM_API.replace(/^https:/, "wss:"));
    for (const google of ["https://*.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com"]) expect(connect).toContain(google);
    expect(directive(policy, "img-src").split(" ")).toContain("https://launchnest.io");
    expect(directive(policy, "img-src").split(" ")).toContain("https://toolradar.com");
  });

  it("leaves out a store that isn't set, and anything that isn't https", () => {
    const policy = reportOnlyPolicy("n", {}, { SITE_URL: "http://localhost:3000" });
    expect(directive(policy, "media-src")).toBe("media-src 'self' data: blob:");
  });

  it("makes a new nonce every time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });

  it("turns off only browser features Chrome knows (it logs an error for any other), keeping the microphone the site's", () => {
    const value = SECURITY_HEADERS.find((h) => h.key === "Permissions-Policy")!.value;
    const known = new Set(["camera", "microphone", "geolocation", "payment", "usb", "serial", "hid", "bluetooth", "midi", "magnetometer", "gyroscope", "accelerometer", "display-capture", "browsing-topics"]);
    const rules = value.split(", ").map((r) => r.split("="));
    for (const [feature] of rules) expect(known.has(feature)).toBe(true);
    expect(Object.fromEntries(rules).microphone).toBe("(self)");
    expect(Object.fromEntries(rules).camera).toBe("()");
  });
});

describe("each page load gets its own nonce (proxy.ts)", () => {
  it("puts the nonce on the request for Next and the layout, and the same policy on the response", () => {
    vi.stubEnv("SITE_URL", "https://botchelor.com");
    const res = page("https://botchelor.com/watch", { cookie: "bz_adult=1" });
    expect(res.headers.get("x-middleware-next")).toBe("1");
    const nonce = res.headers.get(`x-middleware-request-${NONCE_HEADER}`)!;
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    const policy = res.headers.get("content-security-policy-report-only")!;
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get("x-middleware-request-content-security-policy-report-only")).toContain(`'nonce-${nonce}'`);
    expect(page("https://botchelor.com/watch", { cookie: "bz_adult=1" }).headers.get(`x-middleware-request-${NONCE_HEADER}`)).not.toBe(nonce);
  });

  it("drops a policy the request brought with it, so Next can't read a nonce from it", () => {
    const res = page("https://botchelor.com/", { "content-security-policy": "script-src 'nonce-theirs'" });
    const kept = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(kept).not.toContain("content-security-policy");
    expect(kept).toContain("content-security-policy-report-only");
  });

  it("asks one load in four for reports", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(page("https://botchelor.com/").headers.get("content-security-policy-report-only")).toContain(`report-uri ${CSP_REPORT_PATH}`);
    vi.spyOn(Math, "random").mockReturnValue(0.6);
    expect(page("https://botchelor.com/").headers.get("content-security-policy-report-only")).not.toContain("report-uri");
  });

  it("puts nothing on a redirect", () => {
    const res = page("https://botchelor.com/matches");
    expect(res.status).toBe(307);
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });
});

describe("the reports (lib/csp-report.ts, app/api/csp-report)", () => {
  beforeEach(() => resetReportsForTests());

  const older = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      "csp-report": {
        "document-uri": "https://botchelor.com/characters/nell?token=secret",
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?k=1",
        "source-file": "https://botchelor.com/_next/static/chunks/a.js",
        ...over,
      },
    });

  it("reads both formats, keeps origins and paths only, and drops what an extension did", () => {
    expect(violationsIn(older())).toEqual([{ directive: "script-src-elem", blocked: "https://evil.example", page: "botchelor.com/characters/nell", source: "https://botchelor.com" }]);
    expect(violationsIn(older({ "blocked-uri": "inline" }))[0].blocked).toBe("inline");
    expect(violationsIn(older({ "source-file": "chrome-extension://abc/content.js" }))).toEqual([]);
    const reporting = JSON.stringify([
      { type: "csp-violation", body: { documentURL: "https://ad.botchelor.com/after-dark", effectiveDirective: "img-src", blockedURL: "data:image/png;base64,AAAA" } },
      { type: "deprecation", body: { id: "x" } },
    ]);
    expect(violationsIn(reporting)).toEqual([{ directive: "img-src", blocked: "data", page: "ad.botchelor.com/after-dark", source: null }]);
    expect(violationsIn("not json")).toEqual([]);
    expect(violationsIn(JSON.stringify({ "csp-report": { "effective-directive": "<script>" } }))).toEqual([]);
  });

  it("logs each kind once a window, and at most MAX_LINES kinds", () => {
    const v = violationsIn(older());
    expect(reportLines(v, 1_000)).toEqual(["[csp] report-only: script-src-elem would block https://evil.example on botchelor.com/characters/nell (from https://botchelor.com)"]);
    expect(reportLines(v, 2_000)).toEqual([]);
    const many = Array.from({ length: MAX_LINES + 10 }, (_, i) => ({ ...v[0], page: `botchelor.com/p${i}` }));
    expect(reportLines(many, 3_000)).toHaveLength(MAX_LINES - 1);
    expect(reportLines(v, 3_000 + 11 * 60 * 1000)).toHaveLength(1);
  });

  it("answers 204 and logs the line; refuses a body that's too big", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const post = (body: string, headers: Record<string, string> = {}) =>
      cspReport(new Request(`${BASE_URL}/api/csp-report`, { method: "POST", body, headers: { "content-type": "application/csp-report", ...headers } }));
    const res = await post(older());
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[csp] report-only: script-src-elem"));
    expect((await post("{}")).status).toBe(204);
    expect((await post("x".repeat(20_000), { "content-length": "20000" })).status).toBe(413);
    // One that doesn't say how big it is is read only to the cap, and dropped.
    expect((await post("x".repeat(20_000))).status).toBe(204);
  });
});
