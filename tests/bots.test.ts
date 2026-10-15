import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectBot } from "@/lib/bots";
import { middleware } from "@/middleware";

afterEach(() => vi.restoreAllMocks());

const UA = {
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  cubotPhone: "Mozilla/5.0 (Linux; Android 10; CUBOT P20 Build/QP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  claudebot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  claudeUser: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  perplexity: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  ahrefs: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  httpx: "python-httpx/0.27.0",
  curl: "curl/8.7.1",
};

describe("detectBot", () => {
  it("names search engines, AI crawlers, AI assistants and link unfurlers", () => {
    expect(detectBot(UA.googlebot)).toEqual({ name: "Googlebot", kind: "search" });
    expect(detectBot(UA.gptbot)).toEqual({ name: "GPTBot", kind: "ai" });
    expect(detectBot(UA.claudebot)).toEqual({ name: "ClaudeBot", kind: "ai" });
    expect(detectBot(UA.claudeUser)).toEqual({ name: "Claude-User", kind: "agent" });
    expect(detectBot(UA.perplexity)).toEqual({ name: "PerplexityBot", kind: "ai" });
    expect(detectBot(UA.facebook)).toEqual({ name: "Facebook", kind: "social" });
  });

  it("catches self-described bots and the HTTP libraries agents run on", () => {
    expect(detectBot(UA.ahrefs)?.kind).toBe("other");
    expect(detectBot(UA.httpx)).toEqual({ name: "python-httpx", kind: "other" });
    expect(detectBot(UA.curl)).toEqual({ name: "curl", kind: "other" });
  });

  it("treats a signed browser agent (Signature-Agent) as an agent, whatever its user agent", () => {
    expect(detectBot(UA.chromeMac, '"https://chatgpt.com"')).toEqual({ name: "chatgpt.com", kind: "agent" });
  });

  it("leaves people alone, including a phone model that happens to contain 'bot'", () => {
    for (const ua of [UA.chromeMac, UA.safariIphone, UA.firefox, UA.cubotPhone, "", null, undefined]) expect(detectBot(ua)).toBeNull();
  });
});

const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost:3000${path}`, { headers });
const isPassThrough = (res: Response) => res.headers.get("x-middleware-next") === "1" && !res.headers.get("location");

describe("the 18+ gate lets bots through and still gates people", () => {
  it("sends a person without the adult cookie to the gate, remembering where they were going", () => {
    const res = middleware(request("/feed?x=1", { "user-agent": UA.chromeMac }));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/gate");
    expect(location.searchParams.get("from")).toBe("/feed?x=1");
  });

  it("lets a person who confirmed through", () => {
    expect(isPassThrough(middleware(request("/feed", { "user-agent": UA.chromeMac, cookie: "bz_adult=1" })))).toBe(true);
  });

  it("lets search engines and AI agents read every page, and logs each visit as a bot_visit", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const ua of [UA.googlebot, UA.gptbot, UA.claudeUser, UA.httpx]) {
      expect(isPassThrough(middleware(request("/characters/house-rafe", { "user-agent": ua })))).toBe(true);
    }
    const events = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(events.filter((e) => e.event === "bot_visit")).toHaveLength(4);
    expect(events[0]).toMatchObject({ event: "bot_visit", bot: "Googlebot", kind: "search", path: "/characters/house-rafe" });
  });

  it("never gates the gate itself", () => {
    expect(isPassThrough(middleware(request("/gate", { "user-agent": UA.chromeMac })))).toBe(true);
  });
});
