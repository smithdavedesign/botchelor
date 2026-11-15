/**
 * The daily clip recorder (scripts/clips/daily-clip.mjs) and the visual audit (scripts/visual.mjs) drive the theater by its
 * markup: the "Watch in theater" button, `.theater`, the chat rows, and `.theater-verdict .ending` as the last frame. The
 * early verdict (PR3) put the verdict card on the filming stage too; this keeps every selector those scripts click or wait
 * for present in the components, so a rename shows up here and not as an empty clip at 06:00.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const clip = read("scripts/clips/daily-clip.mjs");
const visual = read("scripts/visual.mjs");
const theater = read("app/episodes/[id]/EpisodeTheater.tsx");
const card = read("app/episodes/[id]/VerdictCard.tsx");
const stage = read("app/episodes/[id]/GeneratingPoller.tsx");
const thread = read("app/ChatThread.tsx");

/** Every `.locator("...")` the script uses. */
const locators = (src: string) => [...src.matchAll(/locator\("([^"]+)"\)/g)].map((m) => m[1]);
/** Every button the script clicks by name. */
const buttons = (src: string) => [...src.matchAll(/getByRole\("button", \{ name: "([^"]+)" \}\)/g)].map((m) => m[1]);

describe("the clip recorder's selectors", () => {
  it("still clicks and waits on markup the theater renders", () => {
    expect(buttons(clip)).toContain("Watch in theater");
    expect(theater).toContain("Watch in theater");
    const used = locators(clip);
    expect(used).toEqual(expect.arrayContaining([".theater", ".theater-verdict"]));
    expect(theater).toContain('className="theater theater-clean"');
    // The ending card the clip records up to, in the theater and on the filming stage alike.
    expect(card).toContain('className="theater-verdict verdict-card"');
    expect(card).toContain('className="ending"');
    expect(theater).toContain('className="theater-verdict"');
    expect(stage).toContain('className="theater-verdict"');
    // The line marks: one chat row per line, typing rows left out.
    expect(clip).toContain(".theater .chat-row:not(.chat-typing-row)");
    expect(thread).toMatch(/chat-row/);
    expect(thread).toMatch(/chat-typing-row/);
  });

  it("the visual audit's verdict walk still has its button and its ending", () => {
    expect(visual).toContain('name: "Skip to the end"');
    expect(theater).toContain('aria-label="Skip to the end"');
    expect(visual).toContain(".theater-verdict .ending");
  });
});

describe("the filming stage (GeneratingPoller.tsx)", () => {
  it("shows the same verdict card, a Skip to the ending once the ending stands, and keeps the failed-date fallback", () => {
    expect(stage).toContain("<VerdictCard");
    // "Hear from" is greyed only while the ending isn't final (lib/after-date-text.ts takes a generating date with ending_final).
    expect(stage).toContain("pending={!ready && final === null}");
    expect(stage).toContain("Skip to the ending");
    // Only an ending the job marked final counts; the booked one can still move.
    expect(stage).toContain("data.ending_final && data.ending");
    expect(stage).toContain("That date didn&apos;t work out");
    // The ending is counted once, with `live`, and the theater is told so.
    expect(stage).toMatch(/queueEvent\("date_watched", \{ via: "stage", live: 1/);
    expect(stage).toContain("markDateWatchedLive(episodeId)");
    expect(theater).toContain("dateWatchedLive(episodeId)");
    // Exit folds the stage rather than leaving ?play=1 (a Link to the bare episode would drop it).
    expect(stage).not.toMatch(/<Link href=\{`\/episodes\/\$\{episodeId\}`\}/);
    expect(stage).toContain("Back to the stage");
  });
});
