import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as requestIp } from "@/app/api/admin/request-ip/route";
import { POST as vote } from "@/app/api/casting/route";
import { clientIp, clientIpSource, isCloudflareIp, visitorAddress, visitorKey } from "@/lib/limits";
import { BASE_URL, startTestDb } from "./helpers";

// 2026-11-22 audit: the limits keyed on the first x-forwarded-for entry, which the caller writes, so a made-up one
// opened a fresh bucket. They key on the address the platform's edge sets now.

const h = (o: Record<string, string>) => new Headers(o);
/** A vote for a character that doesn't exist (it only ever earns a 404), sent with these headers. */
const ballot = (headers: Record<string, string>) =>
  vote(new Request(`${BASE_URL}/api/casting`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ character_id: "made-up" }) }));
const CF = "172.70.1.2"; // one of Cloudflare's: the apex's hop from our zone

describe("clientIp", () => {
  it("takes the edge's address over anything the caller wrote", () => {
    const forged = { "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "cf-connecting-ip": "3.3.3.3" };
    expect(clientIp(h({ ...forged, "do-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIpSource(h({ ...forged, "do-connecting-ip": "203.0.113.7" }))).toBe("do-connecting-ip");
  });

  it("past a Cloudflare hop (the apex, a Worker), Cloudflare's own header", () => {
    expect(isCloudflareIp(CF)).toBe(true);
    expect(isCloudflareIp("2606:4700::1")).toBe(true);
    expect(isCloudflareIp("203.0.113.7")).toBe(false);
    expect(clientIp(h({ "do-connecting-ip": CF, "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.4");
    expect(clientIpSource(h({ "do-connecting-ip": CF, "cf-connecting-ip": "198.51.100.4" }))).toBe("cf-connecting-ip");
    // A Cloudflare hop with nothing behind it is still an address, the hop's.
    expect(clientIp(h({ "do-connecting-ip": CF }))).toBe(CF);
  });

  it("reads one address from an edge header: the last of a list, without a port or brackets; junk is no address", () => {
    expect(clientIp(h({ "do-connecting-ip": "1.1.1.1, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "do-connecting-ip": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "do-connecting-ip": "203.0.113.7:8080" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "do-connecting-ip": "not-an-address", "cf-connecting-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("with no edge at all (a local server, the tests), x-forwarded-for's first entry, else x-real-ip, else none", () => {
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }))).toBe("198.51.100.9");
    expect(clientIp(h({ "x-real-ip": "198.51.100.10" }))).toBe("198.51.100.10");
    expect(clientIp(h({}))).toBeNull();
    expect(clientIpSource(h({}))).toBeNull();
  });
});

describe("visitorKey", () => {
  it("stays the same whatever the caller adds to the forwarding headers", () => {
    const edge = { "do-connecting-ip": "203.0.113.7" };
    const key = visitorKey(h(edge));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    const forgeries: Record<string, string>[] = [{ "x-forwarded-for": "9.9.9.9" }, { "x-forwarded-for": "x, 1.2.3.4" }, { "x-real-ip": "8.8.8.8" }, { "cf-connecting-ip": "7.7.7.7" }];
    for (const forged of forgeries) {
      expect(visitorKey(h({ ...forged, ...edge }))).toBe(key);
    }
  });

  it("keys an IPv6 address by its /64, and an IPv4-mapped one as IPv4", () => {
    expect(visitorAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorAddress("2001:0db8:00aa:0001:ffff:1:2:3")).toBe("2001:db8:aa:1::/64");
    expect(visitorAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(visitorAddress("203.0.113.7")).toBe("203.0.113.7");
    const at = (ip: string) => visitorKey(h({ "do-connecting-ip": ip }));
    expect(at("2001:db8:1:2::a")).toBe(at("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(at("2001:db8:1:2::a")).not.toBe(at("2001:db8:1:3::a"));
    expect(at("::ffff:203.0.113.7")).toBe(at("203.0.113.7"));
  });
});

describe("a per-visitor limit behind the edge", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it("holds a visitor who makes up a new x-forwarded-for each time", async () => {
    // The vote limit is 10 an hour per visitor.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await ballot({ "do-connecting-ip": "203.0.113.7", "x-forwarded-for": `10.0.${i}.1` })).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(404));
    expect(statuses[10]).toBe(429);
    // Someone else still votes.
    expect((await ballot({ "do-connecting-ip": "203.0.113.8" })).status).toBe(404);
  });
});

describe("the admin check of what the edge sends", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is admins only, and reports the address the limits key on and where it came from", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "edge-check-key");
    const headers = { "do-connecting-ip": CF, "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" };
    expect((await requestIp(new Request(`${BASE_URL}/api/admin/request-ip`, { headers }))).status).toBe(403);
    const res = await requestIp(new Request(`${BASE_URL}/api/admin/request-ip`, { headers: { ...headers, "x-frontier-key": "edge-check-key" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ client_ip: "198.51.100.4", source: "cf-connecting-ip", do_connecting_ip_is_cloudflare: true });
    expect(body.headers["x-forwarded-for"]).toBe("1.1.1.1");
  });
});
