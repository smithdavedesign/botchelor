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

const serve = (id: string) => getAsset(new Request(`http://localhost:3000/api/assets/${id}`), { params: Promise.resolve({ id }) });

async function approved(url: string): Promise<string> {
  const id = await recordAsset(t.db, { character_id: "house-nell", kind: "portrait", source_type: "generated", source_model: "test-1", prompt: "p", prompt_version: "v3", seed: 1, url });
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
});
