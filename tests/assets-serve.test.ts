import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getAsset } from "@/app/api/assets/[id]/route";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { startTestDb } from "./helpers";

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

const serve = (id: string, query = "") => getAsset(new Request(`http://localhost:3000/api/assets/${id}${query}`), { params: Promise.resolve({ id }) });

async function approved(url: string, seed = 1): Promise<string> {
  const id = await recordAsset(t.db, { character_id: "house-nell", kind: "portrait", source_type: "generated", source_model: "test-1", prompt: "p", prompt_version: "v3", seed, url });
  await reviewAsset(t.db, id, "approved");
  return id;
}

describe("serving an approved asset", () => {
  it("a house portrait recorded by its path in public/cast is a redirect to that file (it used to 404 on every house card)", async () => {
    const res = await serve(await approved("/cast/house-nell-v3.webp"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/cast/house-nell-v3.webp");
  });

  it("never redirects anywhere else", async () => {
    for (const url of ["https://evil.example/x.png", "//evil.example/x.png", "/cast/../secrets.png", "/api/me", "/cast/x.svg"]) {
      expect((await serve(await approved(url))).status, url).toBe(404);
    }
  });

  it("a generated portrait stored as a data URL is still served as bytes", async () => {
    const png = "data:image/png;base64," + Buffer.from("not really a png").toString("base64");
    const res = await serve(await approved(png));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("a generator's 64-bit seed doesn't break serving (it was read back as a 32-bit int: 'integer out of range' on prod)", async () => {
    const png = "data:image/png;base64," + Buffer.from("not really a png").toString("base64");
    const res = await serve(await approved(png, 4_294_967_296_123));
    expect(res.status).toBe(200);
  });

  it("?w= sends a small WebP copy for an avatar, and a picture sharp can't read still comes back whole", async () => {
    const { default: sharp } = await import("sharp");
    const big = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#c36" } }).png().toBuffer();
    const id = await approved("data:image/png;base64," + big.toString("base64"));
    const small = await serve(id, "?w=96");
    expect(small.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await small.arrayBuffer())).metadata();
    expect(meta.width).toBe(128); // the next allowed width up from 96
    expect(small.headers.get("cache-control")).toContain("immutable");
    const odd = await serve(await approved("data:image/png;base64," + Buffer.from("not really a png").toString("base64"), 2), "?w=96");
    expect(odd.status).toBe(200);
    expect(odd.headers.get("content-type")).toBe("image/png");
    expect((await serve(id, "?w=nope")).headers.get("content-type")).toBe("image/png");
  });
});
