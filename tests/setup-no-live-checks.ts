import { afterEach, beforeEach } from "vitest";
import { setAdminCheckerDefaultForTests, setModerationFetchForTests } from "@/lib/adult/moderation";
import { setBriefModelForTests } from "@/lib/adult/picture-brief";
import { setGiftsOnAirForTests } from "@/lib/gift-catalog";

// No test calls a picture checker's alternative for real (lib/adult/moderation.ts: Venice's vision model, Sightengine,
// an endpoint): each starts with them stubbed to refuse, never a network call; a test's own setModerationFetchForTests
// replaces it. And an admin's own pictures go to the mode (Hive) unless a test sets admin_checker itself: production's
// default sends them to the alternatives (DEFAULT_ADMIN_CHECKER), tests/after-dark-moderation.test.ts covers that.
// A scene picture's brief (lib/adult/picture-brief.ts) is off too: a test's own setBriefModelForTests scripts one.
// And airing a date brings no gift (lib/gift-catalog.ts: dealt by the date's random id, it would move a trust score
// or text an owner in one run and not the next): a test calls giftAfterAir itself.
beforeEach(() => {
  setGiftsOnAirForTests(false);
  setBriefModelForTests(null);
  setModerationFetchForTests(async () => {
    throw new Error("a test called a checker for real: stub it with setModerationFetchForTests");
  });
  setAdminCheckerDefaultForTests("same");
});

// And no test reaches a host outside this machine: a real call is slow and sometimes times out, and with a test's
// placeholder key it would be refused anyway. A call to any other http(s) host throws as if offline and fails the test
// that made it, naming the address and the code that called it: stub that module's fetch (its set…FetchForTests).
const realFetch = globalThis.fetch;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
let reached: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  let url: URL | null = null;
  try {
    url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    // Not an absolute address: the real fetch says why.
  }
  if (url && /^https?:$/.test(url.protocol) && !LOCAL.has(url.hostname)) {
    const from = new Error().stack?.split("\n").find((line) => /\/(lib|app)\//.test(line))?.trim();
    reached.push(`${url.origin}${url.pathname}${from ? ` (${from})` : ""}`);
    throw new TypeError(`fetch failed: tests don't reach ${url.host}`);
  }
  return realFetch(input, init);
}) as typeof fetch;
afterEach(() => {
  const calls = reached;
  reached = [];
  if (calls.length) throw new Error(`the test reached outside this machine; stub the module's fetch instead:\n${calls.join("\n")}`);
});
