import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detectLanguage, isNotEnglish } from "@/lib/language";
import { languageWindows, proseArguments, recordLanguage } from "@/lib/language-seen";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// David, 2026-10-31: "know if there's demand [for other languages] instead of guessing".
describe("detectLanguage", () => {
  const cases: [string, string][] = [
    ["en", "I run a small bakery and I'm looking for someone who likes long walks and bad puns."],
    ["es", "Tengo una panadería pequeña y busco a alguien que disfrute de los paseos largos y los chistes malos."],
    ["fr", "Je tiens une petite boulangerie et je cherche quelqu'un qui aime les longues promenades."],
    ["de", "Ich habe eine kleine Bäckerei und suche jemanden, der lange Spaziergänge mag."],
    ["pt", "Eu tenho uma padaria pequena e procuro alguém que goste de caminhadas longas, não de pressa."],
    ["it", "Ho una piccola panetteria e cerco qualcuno che ami le lunghe passeggiate e le battute."],
    ["nl", "Ik heb een kleine bakkerij en ik zoek iemand die van lange wandelingen houdt."],
    ["pl", "Mam małą piekarnię i szukam kogoś, kto lubi długie spacery i złe żarty."],
    ["tr", "Küçük bir fırınım var ve uzun yürüyüşleri seven birini arıyorum, çok teşekkür ederim."],
    ["id", "Saya punya toko roti kecil dan saya mencari seseorang yang suka jalan-jalan panjang."],
    ["vi", "Tôi có một tiệm bánh nhỏ và tôi đang tìm một người thích đi dạo."],
    ["ru", "У меня маленькая пекарня, и я ищу человека, который любит долгие прогулки."],
    ["uk", "У мене маленька пекарня, і я шукаю людину, яка любить довгі прогулянки."],
    ["ja", "小さなパン屋をやっていて、長い散歩が好きな人を探しています。"],
    ["zh", "我开了一家小面包店，正在寻找喜欢长时间散步的人。"],
    ["ko", "저는 작은 빵집을 운영하고 있고 긴 산책을 좋아하는 사람을 찾고 있어요."],
    ["ar", "لدي مخبز صغير وأبحث عن شخص يحب المشي لمسافات طويلة."],
    ["el", "Έχω ένα μικρό αρτοποιείο και ψάχνω κάποιον που αγαπά τις μεγάλες βόλτες."],
  ];
  it.each(cases)("names %s", (lang, text) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it("says nothing for text too short or a link", () => {
    expect(detectLanguage("ok")).toBeNull();
    expect(detectLanguage("jaja")).toBeNull();
    expect(detectLanguage("https://botchelor.com/characters/abc-def-ghi")).toBeNull();
    expect(detectLanguage(null)).toBeNull();
  });

  it("isNotEnglish is false for English and for unknown", () => {
    expect(isNotEnglish("Hello there, how was your day at the lighthouse?")).toBe(false);
    expect(isNotEnglish("ok")).toBe(false);
    expect(isNotEnglish("Hola, ¿cómo estuvo tu día en el faro? Yo estoy muy bien.")).toBe(true);
  });
});

describe("proseArguments", () => {
  it("keeps prose and drops ids, names, links and one-word values", () => {
    const got = proseArguments({
      agent_id: "agent 123 abc",
      character_id: "c1",
      name: "Odile Ferrant",
      text: "Hola, ¿qué tal tu día?",
      pronouns: "she/her",
      extras: { prompts: [{ prompt: "My ideal Sunday", answer: "Pan recién hecho y un paseo" }], link: "https://x.y z" },
      traits: ["curiosa", "muy terca"],
    });
    expect(got).toEqual(["Hola, ¿qué tal tu día?", "My ideal Sunday", "Pan recién hecho y un paseo", "muy terca"]);
  });
});

describe("language_seen", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const rpc = (method: string, params: Record<string, unknown>, ctx: McpContext) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
  async function connect(name: string, userAgent = `${name}/1.0`): Promise<McpContext> {
    const ctx: McpContext = { userAgent };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name } }, ctx);
    return { sessionId: ctx.issuedSessionId, userAgent };
  }

  it("counts an agent's language over MCP and a person's on /create, and never keeps the words", async () => {
    const agent = await connect("spanish-agent");
    const bio = "Panadera de madrugada que colecciona mapas viejos y odia la prisa.";
    await rpc("tools/call", { name: "create_character", arguments: validCharacter({ name: "Lucía Ferrer", bio, traits: ["curiosa", "terca", "cálida"], want: "Alguien que lea un mapa al revés", dealbreaker: "La gente que odia las sorpresas" }) }, agent);
    const cookie = newUserCookie();
    const res = await api.createCharacter(validCharacter({ name: "Jun Mori" }), cookie);
    expect(res.status).toBe(201);

    const rows = (await t.db.query<{ surface: string; lang: string; n: number }>(`select surface, lang, n from language_seen order by surface`)).rows;
    expect(rows.find((r) => r.surface === "mcp")?.lang).toBe("es");
    // The person's sheet is counted once as theirs; the agent's create isn't counted again as a web create.
    expect(rows.filter((r) => r.surface === "web_create")).toEqual([{ surface: "web_create", lang: "en", n: 1 }]);
    expect(JSON.stringify((await t.db.query(`select * from language_seen`)).rows)).not.toContain("Panadera");

    const seen = await languageWindows(t.db, { includeOurs: true });
    const week = seen.windows.find((w) => w.days === 7)!;
    expect(week.rows.find((r) => r.lang === "es")).toMatchObject({ name: "Spanish", agents: 1, people: 0 });
    expect(week.rows.find((r) => r.lang === "en")).toMatchObject({ name: "English", people: 1 });
  });

  it("adds up a person's texts per day and leaves our own traffic out", async () => {
    await recordLanguage(t.db, "person-1", "web_text", ["Dile que la cena fue preciosa y que quiero repetir."]);
    await recordLanguage(t.db, "person-1", "web_text", ["Que le pregunte por su perro, por favor."]);
    await recordLanguage(t.db, "person-1", "web_text", ["   "]); // nothing to read: not counted
    await recordLanguage(t.db, "person-1", "web_text", ["ok"]);
    const rows = (await t.db.query<{ lang: string; n: number }>(`select lang, n from language_seen order by lang`)).rows;
    expect(rows).toEqual([
      { lang: "es", n: 2 },
      { lang: "und", n: 1 },
    ]);

    const ours = await connect("live-board-check", "botchelor-live-check/1.0 (Claude)");
    await rpc("tools/call", { name: "my_status", arguments: { note: "Ceci est une vérification de notre part, merci." } }, ours);
    const seen = await languageWindows(t.db);
    expect(seen.windows[0].rows.map((r) => r.lang)).toEqual(["es", "und"]);
    expect((await languageWindows(t.db, { includeOurs: true })).windows[0].rows.map((r) => r.lang)).toContain("fr");
  });
});
