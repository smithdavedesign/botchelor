/**
 * No originality grade for people (David, 2026-11-20: "It's hard to get people to generate a character so let's not grade
 * the originality … skip the grading on someone's first character, with Create at the top, and show the tips after their
 * first date", then "keep the grading as a metadata thing for our system"):
 *  - nobody is shown a score: the panel is what to change, never a number or a bar;
 *  - a first character's builder shows no panel and no stock-phrase nudge, and its review opens on Create;
 *  - the tips come on the character's page, for its owner, once it has been on a date;
 *  - the score is ours: characters.originality_score, written after every save (the web or an agent) and every edit.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordOriginality } from "@/lib/originality-concept";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("what people see", () => {
  it("the panel never shows a score: no number out of 100, no bar, no score-coloured tone", () => {
    const panel = source("app/create/OriginalityPanel.tsx");
    expect(panel).not.toMatch(/report\.score/);
    expect(panel).not.toContain("/100");
    expect(panel).not.toContain("originality-bar");
    expect(panel).not.toMatch(/role="meter"/);
    expect(source("app/globals.css")).not.toMatch(/\.originality-(score|bar|low|mid|high)\b/);
  });

  it("a first character: no stock-phrase nudge, no panel on review, and Create with its promise at the top", () => {
    const wizard = source("app/create/CreateWizard.tsx");
    expect(wizard).toContain("const firstCliche = firstCharacter ? undefined : findCliches(");
    expect(wizard).toContain("const createOnTop = firstCharacter && !edit;");
    // The panel only when Create isn't on top (a second character on, or an edit).
    expect(wizard).toMatch(/\{!createOnTop && \(\s*<OriginalityPanel/);
    // Create at the top of the review: the promise (the one #wizard-attest) and the button, before the read-back.
    const review = wizard.slice(wizard.indexOf('{edit ? tr("Review") : tr("Review & create")}'));
    const top = review.slice(0, review.indexOf("</div>"));
    expect(top).toContain("{createOnTop && (");
    expect(top).toContain('id="wizard-attest"');
    expect(top).toContain('data-track="create-top"');
    expect(review.indexOf('data-track="create-top"')).toBeLessThan(review.indexOf('tr("Add depth?")'));
    // The bar's promise steps aside for it, so there's one checkbox with that id.
    expect(wizard).toContain("{step === last && !createOnTop && (");
    expect(wizard.match(/id="wizard-attest"/g)).toHaveLength(2);
  });

  it("the tips come on the character's page, for its owner, once it has been on a date, and say nothing when nothing needs changing", () => {
    const page = source("app/characters/[id]/page.tsx");
    expect(page).toMatch(/\{isOwner && !c\.house && record\.dates > 0 && \(\s*<OriginalityPanel/);
    expect(page).toMatch(/<OriginalityPanel[\s\S]*?characterId=\{c\.id\}[\s\S]*?quiet/);
    expect(source("app/create/OriginalityPanel.tsx")).toContain("if (quiet && report.tips.length === 0 && report.similar.length === 0) return null;");
  });
});

describe("the score is ours (characters.originality_score)", () => {
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

  const scoreOf = async (id: string) =>
    (await t.db.query<{ originality_score: number | null; originality_at: Date | null }>(`select originality_score, originality_at from characters where id = $1`, [id])).rows[0];

  it("is written when a character is made, and again when its sheet is edited", async () => {
    const cookie = newUserCookie();
    const res = await api.createCharacter(validCharacter(), cookie);
    expect(res.status).toBe(201);
    const body = await res.json();
    const { id } = body;
    // The reply to the person carries no score.
    expect(JSON.stringify(body)).not.toContain("originality");
    const made = await scoreOf(id);
    expect(made.originality_score).toBeGreaterThanOrEqual(0);
    expect(made.originality_score).toBeLessThanOrEqual(100);
    expect(made.originality_at).toBeTruthy();

    await t.db.query(`update characters set originality_score = null, originality_at = null where id = $1`, [id]);
    const edited = await api.editCharacter(id, { bio: "A night-ferry captain who keeps a logbook of every passenger's last words before they land." }, cookie);
    expect(edited.status).toBe(200);
    expect((await scoreOf(id)).originality_score).not.toBeNull();
  });

  it("recordOriginality scores a saved character, and leaves the house cast alone", async () => {
    const cookie = newUserCookie();
    const { id } = await (await api.createCharacter(validCharacter({ name: "Odile Farrow" }), cookie)).json();
    const score = await recordOriginality(t.db, id);
    expect(score).toEqual((await scoreOf(id)).originality_score);
    expect(await recordOriginality(t.db, "no-such-character")).toBeNull();
  });
});
