import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SafetyPage from "@/app/safety/page";
import { CRISIS_RESOURCES } from "@/lib/crisis";

/** /safety (2026-11-13 live review): where to get help comes before the protocol, as a card of buttons. */
describe("the safety page", () => {
  const html = renderToStaticMarkup(SafetyPage());

  it("puts the help card right under the title, before the protocol, with every line as a link", () => {
    const help = html.indexOf('id="help"');
    const ai = html.indexOf('id="ai"');
    const protocol = html.indexOf('id="self-harm"');
    expect(help).toBeGreaterThan(-1);
    expect(help).toBeLessThan(ai);
    expect(ai).toBeLessThan(protocol);
    for (const line of CRISIS_RESOURCES.lines) {
      expect(html).toContain(`href="${line.href}"`);
      expect(html).toContain(line.region.replace("&", "&amp;"));
    }
    // One help section, not the old list at the foot as well.
    expect(html.match(/Where to get help/g)?.length).toBe(2); // the card's title and the foot's jump link
    expect(html).toContain('href="#help"');
  });

  it("keeps the disclosure and the protocol", () => {
    expect(html).toContain("You&#x27;re talking with AI");
    expect(html).toContain("Self-harm protocol");
    expect(html).toContain("call your local emergency number");
  });
});
