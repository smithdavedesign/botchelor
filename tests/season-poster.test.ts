// The season's poster (app/seasons/season-poster.tsx): the December page's link preview and the launch's files. The
// stage behind, the lead holding a rose (else their portrait), the suitors, or before the 1st casting's top; three sizes.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPoster } from "@/app/seasons/[slug]/poster.png/route";
import { POSTER_FORMATS, seasonPoster } from "@/app/seasons/season-poster";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLeadOverride } from "@/lib/season-cast";
import { setSeasonFormat } from "@/lib/season-format-store";
import { loadSeasonPoster } from "@/lib/season-page";
import { seasonFormat } from "@/lib/season-format";
import { startTestDb } from "./helpers";

vi.mock("server-only", () => ({}));

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
  vi.useRealTimers();
});

const SEASON = "2026-12-01";
const LEAD = HOUSE_CHARACTERS[0].id;
const NOV28 = new Date(Date.UTC(2026, 10, 28, 12));
const DEC5 = new Date(Date.UTC(2026, 11, 5, 12));

async function person(id: string, name: string) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, false, $3, 30, 'A suitor with a story.', '["bold","warm","odd"]'::jsonb, 'love', 'rudeness', 'public', true)`,
    [id, `owner-${id}`, name],
  );
}

/** December as The Botchelor with the house lead, and three people auditioning (Cy with the most votes). */
async function december() {
  await setSeasonFormat(t.db, SEASON, "botchelor");
  await setLeadOverride(t.db, SEASON, LEAD);
  for (const [id, name] of [
    ["p-ana", "Ana Vale"],
    ["p-bo", "Bo Reyes"],
    ["p-cy", "Cy Moss"],
  ] as const) {
    await person(id, name);
    await t.db.query(`insert into cast_auditions (season_id, character_id, owner_id, status) values ($1, $2, $3, 'open')`, [SEASON, id, `owner-${id}`]);
  }
  for (const voter of [crypto.randomUUID(), crypto.randomUUID()]) await t.db.query(`insert into audition_votes (season_id, voter_id, character_id) values ($1, $2, 'p-cy')`, [SEASON, voter]);
}

/** Where a poster goes when POSTER_OUT is set, to look at by eye. */
function keep(name: string, bytes: Buffer) {
  const dir = process.env.POSTER_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.png`, bytes);
}

describe("the season's poster", () => {
  it("in preseason shows the lead and casting's top, most votes first", async () => {
    await december();
    const d = await loadSeasonPoster(t.db, SEASON, "preseason", seasonFormat("botchelor"), NOV28);
    expect(d.lead?.id).toBe(LEAD);
    expect(d.facesAre).toBe("auditions");
    expect(d.faces.map((f) => f.id)).toEqual(["p-cy", "p-ana", "p-bo"]);
  });

  it("in season shows the stored suitors, and leaves out one who left", async () => {
    await december();
    for (const [i, id] of ["p-ana", "p-bo", "p-cy"].entries())
      await t.db.query(`insert into season_casts (season_id, character_id, slot, source, withdrawn_at) values ($1, $2, $3, 'suitor', $4)`, [SEASON, id, i + 1, id === "p-bo" ? new Date() : null]);
    const d = await loadSeasonPoster(t.db, SEASON, "season", seasonFormat("botchelor"), DEC5);
    expect(d.facesAre).toBe("suitors");
    expect(d.faces.map((f) => f.id)).toEqual(["p-ana", "p-cy"]);
    expect(d.arc?.night).toBe(5);
  });

  it("draws a PNG in each of its three sizes", async () => {
    await december();
    vi.useFakeTimers({ now: NOV28, toFake: ["Date"] });
    for (const format of ["og", "ph", "story"] as const) {
      const res = await seasonPoster(t.db, SEASON, format, NOV28);
      expect(res.headers.get("content-type")).toBe("image/png");
      const bytes = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect({ width: meta.width, height: meta.height }).toEqual(POSTER_FORMATS[format]);
      keep(`december-${format}`, bytes);
    }
  });

  it("is served at /seasons/<slug>/poster.png, and turns away a slug that isn't a season", async () => {
    await december();
    const ok = await getPoster(new Request("https://botchelor.test/seasons/december-2026/poster.png?format=ph"), { params: Promise.resolve({ slug: "december-2026" }) });
    expect(ok.status).toBe(200);
    expect((await sharp(Buffer.from(await ok.arrayBuffer())).metadata()).width).toBe(POSTER_FORMATS.ph.width);
    const no = await getPoster(new Request("https://botchelor.test/seasons/nope/poster.png"), { params: Promise.resolve({ slug: "nope" }) });
    expect(no.status).toBe(404);
  });
});
