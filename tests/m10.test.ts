import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteMe } from "@/app/api/me/route";
import { GET as exportMe } from "@/app/api/me/export/route";
import { DELETED_OWNER, deleteAccount, exportAccount } from "@/lib/account";
import { generationPaused } from "@/lib/compute";
import { track } from "@/lib/analytics";
import { safeEqual } from "@/lib/http";
import {
  api,
  HOUSE_PARTNER_ID,
  jsonRequest,
  named,
  newUserCookie,
  setupEpisode,
  startTestDb,
  userIdOf,
  validCharacter,
  BASE_URL,
} from "./helpers";

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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("account export and deletion (PRD §6.1)", () => {
  it("exports the user's own profile, characters and souls", async () => {
    const cookie = await named(newUserCookie(), "Wren");
    const char = await (await api.createCharacter(validCharacter(), cookie)).json();
    await api.putSoul(char.id, { values: "honesty and maps" }, cookie);
    const exp = await exportAccount(t.db, userIdOf(cookie));
    expect(exp.profile?.name).toBe("Wren");
    expect(exp.characters).toHaveLength(1);
    expect(exp.souls).toHaveLength(1);
  });

  it("hard-deletes a plain character but anonymizes one already in a shared episode", async () => {
    const { creator, character } = await setupEpisode("friends"); // `character` is in the episode
    const uid = userIdOf(creator);
    await named(creator, "Wren");
    await api.putSoul(character.id, { values: "honesty" }, creator);
    const plain = await (await api.createCharacter(validCharacter({ name: "Nubbin Twee" }), creator)).json();

    const result = await deleteAccount(t.db, uid);
    expect(result.characters_deleted).toBe(1); // the plain one, never in an episode
    expect(result.characters_anonymized).toBe(1); // the one the episode references

    expect(await t.count("profiles", `user_id = '${uid}'`)).toBe(0);
    expect(await t.count("souls", `character_id = '${character.id}'`)).toBe(0);
    expect(await t.count("characters", `id = '${plain.id}'`)).toBe(0);
    // The fictional sheet stays in the shared episode, but detached from the user.
    expect(await t.count("characters", `id = '${character.id}' and owner_id = '${DELETED_OWNER}'`)).toBe(1);
  });

  it("DELETE /api/me needs {confirm:true}, then the export comes back empty", async () => {
    const cookie = await named(newUserCookie(), "Wren");
    await api.createCharacter(validCharacter(), cookie);
    const noConfirm = await deleteMe(jsonRequest("/api/me", {}, { cookie, method: "DELETE" }));
    expect(noConfirm.status).toBe(422);
    const ok = await deleteMe(jsonRequest("/api/me", { confirm: true }, { cookie, method: "DELETE" }));
    expect(ok.status).toBe(200);
    const exported = await (await exportMe(new Request(`${BASE_URL}/api/me/export`, { headers: { cookie } }))).json();
    expect(exported.characters).toHaveLength(0);
    expect(exported.profile).toBeNull();
  });

  it("export and delete need an account (404 with no cookie)", async () => {
    expect((await exportMe(new Request(`${BASE_URL}/api/me/export`))).status).toBe(404);
    expect((await deleteMe(jsonRequest("/api/me", { confirm: true }, { method: "DELETE" }))).status).toBe(404);
  });
});

describe("M10 compute kill switch", () => {
  it("reads BOTCHELOR_PAUSE from the environment", () => {
    expect(generationPaused({})).toBe(false);
    expect(generationPaused({ BOTCHELOR_PAUSE: "1" })).toBe(true);
    expect(generationPaused({ BOTCHELOR_PAUSE: "true" })).toBe(true);
    expect(generationPaused({ BOTCHELOR_PAUSE: "off" })).toBe(false);
  });

  it("pauses live episode creation with a 503 and reserves no date", async () => {
    const cookie = newUserCookie();
    const char = await (await api.createCharacter(validCharacter(), cookie)).json();
    vi.stubEnv("BOTCHELOR_PAUSE", "1");
    const res = await api.createEpisode({ character_id: char.id, partner_id: HOUSE_PARTNER_ID }, cookie);
    expect(res.status).toBe(503);
    // The pause is checked before the allowance, so no free date was spent.
    expect(await t.count("free_episode_usage", `user_id = '${userIdOf(cookie)}'`)).toBe(0);
  });
});

describe("M10 analytics + constant-time compare", () => {
  it("track emits one structured JSON line with the event and no thrown error", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    track("prediction_submitted", { episode_id: "e1" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ log: "analytics", event: "prediction_submitted", episode_id: "e1" });
  });

  it("safeEqual is a correct constant-time-style compare", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
