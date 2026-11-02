import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, newUserCookie, startTestDb } from "./helpers";

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

describe("display names on the best callers board (POST /api/profile)", () => {
  it("is one person's each, trimmed and case-blind, and yours to keep or re-case", async () => {
    const [ana, other] = [newUserCookie(), newUserCookie()];
    expect((await api.setProfile({ name: "Quiz Fox", attest: true }, ana)).status).toBe(200);
    const taken = await api.setProfile({ name: "  quiz fox ", attest: true }, other);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: "name_taken", field: "name", message: expect.stringMatching(/already goes by/) });
    expect((await api.setProfile({ name: "QUIZ FOX", attest: true }, ana)).status).toBe(200);
    expect((await api.setProfile({ name: "Quiz Fox Two", attest: true }, other)).status).toBe(200);
  });

  it("still goes through the content filter and the 18+ attestation", async () => {
    const user = newUserCookie();
    expect((await api.setProfile({ name: "Taylor Swift", attest: true }, user)).status).toBe(422);
    expect((await api.setProfile({ name: "Fine Name", attest: false }, user)).status).toBe(422);
  });
});
