/**
 * The tool reference (/agents/tools, lib/mcp/reference.ts) and the changelog (/agents/changelog, lib/mcp/changelog.ts):
 * both render the server's own data, so neither can fall behind it. The reference shows every tool the server serves,
 * with a description and every argument described; who a tool acts as (the one thing the definitions don't carry)
 * is held to the handlers; the changelog's newest entry is the version the server reports.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import McpChangelogPage, { metadata as changelogMeta } from "@/app/agents/changelog/page";
import { toolSummary } from "@/app/agents/summary";
import ToolReferencePage, { metadata as toolsMeta } from "@/app/agents/tools/page";
import { AGENT_TOOL_GROUPS, llmsText } from "@/lib/agents";
import { CORE_TOOL_ORDER, MCP_SERVER_INFO, MCP_TOOLS, PUBLIC_MCP_TOOLS } from "@/lib/mcp";
import { LATEST_RELEASE, MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { HOUSE_TOOL_NAMES } from "@/lib/mcp/house";
import { OC_TOOL_NAMES } from "@/lib/mcp/oc-tools";
import { argType, BY_NAME_GROUP, TOOL_IDENTITY, toolReference } from "@/lib/mcp/reference";
import { PUBLIC_PATHS } from "@/lib/site";
import { middleware } from "@/middleware";
import { BASE_URL } from "./helpers";

const ROOT = join(__dirname, "..");
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const semver = (v: string) => v.split(".").map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the tool reference's data", () => {
  const groups = toolReference();
  const tools = groups.flatMap((g) => g.tools);

  it("holds every tool the server serves, once, in the server's groups", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    // The groups are /agents' and /llms.txt's, in their order; what no list shows comes last.
    const titles = groups.map((g) => g.title);
    expect(titles.filter((x) => x !== BY_NAME_GROUP)).toEqual(AGENT_TOOL_GROUPS.map((g) => g.title));
    expect(titles[titles.length - 1]).toBe(BY_NAME_GROUP);
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
    for (const g of groups) expect(g.id, g.title).toMatch(/^[a-z0-9-]+$/);
    const byName = groups.find((g) => g.title === BY_NAME_GROUP)!;
    expect(byName.tools.map((t) => t.name).sort()).toEqual(MCP_TOOLS.filter((t) => !PUBLIC_MCP_TOOLS.includes(t)).map((t) => t.name).sort());
  });

  it("has something to show for every tool: a title, a description, a one-line purpose, and a described type for every argument", () => {
    for (const t of tools) {
      expect(t.title.trim(), `${t.name} title`).not.toBe("");
      expect(t.description.trim().length, `${t.name} description`).toBeGreaterThan(20);
      expect(toolSummary(t.description, 24).trim().length, `${t.name} summary`).toBeGreaterThan(8);
      for (const a of t.args) {
        expect(a.description.trim(), `${t.name}.${a.name} description`).not.toBe("");
        expect(a.type, `${t.name}.${a.name} type`).not.toBe("");
      }
    }
  });

  it("reads core, listed, read-only and required from the objects tools/list serves", () => {
    const core = new Set<string>(CORE_TOOL_ORDER);
    const listed = new Set(PUBLIC_MCP_TOOLS.map((t) => t.name as string));
    for (const t of tools) {
      const def = MCP_TOOLS.find((x) => x.name === t.name)!;
      const schema = def.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(t.core, t.name).toBe(core.has(t.name));
      expect(t.listed, t.name).toBe(listed.has(t.name));
      expect(t.readOnly, t.name).toBe(def.annotations.readOnlyHint === true);
      expect(t.effect === "reads", t.name).toBe(t.readOnly);
      expect(t.description).toBe(def.description);
      expect(t.args.map((a) => a.name).sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
      expect(t.args.filter((a) => a.required).map((a) => a.name).sort()).toEqual([...(schema.required ?? [])].sort());
      // Required arguments lead.
      const firstOptional = t.args.findIndex((a) => !a.required);
      if (firstOptional >= 0) expect(t.args.slice(firstOptional).every((a) => !a.required), t.name).toBe(true);
    }
    expect(tools.filter((t) => t.core)).toHaveLength(CORE_TOOL_ORDER.length);
  });

  it("names an argument's type from its schema", () => {
    expect(argType({ type: "string" })).toBe("string");
    expect(argType({ type: "string", enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(argType({ type: "array", items: { type: "string" } })).toBe("string[]");
    expect(argType({ type: ["string", "object"] })).toBe("string or object");
    expect(argType({})).toBe("any");
  });

  it("says who a tool acts as, and the handlers agree", () => {
    const src = readFileSync(join(ROOT, "lib/mcp/dispatcher.ts"), "utf8");
    const names = MCP_TOOLS.map((t) => t.name as string);
    const block = (name: string): string => {
      const at = src.indexOf(`\n    case "${name}":`);
      expect(at, `${name} has a handler`).toBeGreaterThan(0);
      // A case that falls through to the next (`case "a":` then `case "b": {`) is read with the block it shares.
      let from = at;
      for (;;) {
        const next = [src.indexOf(`\n    case "`, from + 5), src.indexOf("\n  }\n}", from)].filter((x) => x > 0);
        const end = Math.min(...next);
        const body = src.slice(from, end);
        if (body.trim().split("\n").length > 1 || end === src.indexOf("\n  }\n}", from)) return src.slice(at, end);
        from = end;
      }
    };
    // Tools whose handler is a shared reader that takes an identity only to add the caller's own view.
    const SHARED_READERS = new Set(["get_episode", "wait_for_episode", "list_watch_parties"]);
    // create_character makes the identity inside the handler it wraps, so its own block shows neither sign.
    const MINTS_INSIDE = new Set(["create_character"]);
    for (const name of names) {
      const who = TOOL_IDENTITY[name as keyof typeof TOOL_IDENTITY];
      expect(who, `${name} is in TOOL_IDENTITY`).toBeTruthy();
      if (SHARED_READERS.has(name) || MINTS_INSIDE.has(name)) continue;
      const body = block(name);
      const needs = body.includes("NEEDS_IDENTITY") || /resolveIdentity\(args, session, true\)/.test(body);
      // check_originality asks for an identity only with a saved character's id; a sheet is checked for anyone.
      if (name === "check_originality") continue;
      expect({ name, acts_as: needs ? "agent" : "anyone" }).toEqual({ name, acts_as: who });
    }
    // A tool that acts as your agent takes agent_id.
    for (const t of tools.filter((x) => x.identity === "agent")) expect(t.args.map((a) => a.name), t.name).toContain("agent_id");
    expect(Object.keys(TOOL_IDENTITY).sort()).toEqual([...names].sort());
  });

  it("leaves the house tools out while MCP_HOUSE=0", () => {
    const off = toolReference({ MCP_HOUSE: "0" }).flatMap((g) => g.tools.map((t) => t.name));
    for (const name of HOUSE_TOOL_NAMES) expect(off).not.toContain(name);
    expect(off).toHaveLength(MCP_TOOLS.length - HOUSE_TOOL_NAMES.length);
  });
});

describe("/agents/tools", () => {
  const html = renderToStaticMarkup(createElement(ToolReferencePage)).replace(/<!-- -->/g, "");

  it("shows every tool with its anchor, its chips, its arguments and which are required", () => {
    for (const g of toolReference()) {
      expect(html, g.title).toContain(`<section id="${g.id}"`);
      expect(html).toContain(`href="#${g.id}"`);
      for (const t of g.tools) {
        const at = html.indexOf(`<section id="${t.name}" class="tool-ref"`);
        expect(at, t.name).toBeGreaterThan(0);
        const end = html.indexOf('<section id="', at + 10);
        const card = html.slice(at, end < 0 ? undefined : end);
        expect(card).toContain(`<a href="#${t.name}"><code>${t.name}</code></a>`);
        expect(card.includes('<span class="agents-core">core</span>'), `${t.name} core chip`).toBe(t.core);
        expect(card.includes("only reads"), `${t.name} reads chip`).toBe(t.readOnly);
        expect(card.includes("needs your agent_id"), `${t.name} identity chip`).toBe(t.identity === "agent");
        expect(card.includes("no identity needed"), `${t.name} anyone chip`).toBe(t.identity === "anyone");
        for (const a of t.args) expect(card, `${t.name}.${a.name}`).toContain(`<code>${a.name}</code>`);
        expect((card.match(/class="tool-ref-required"/g) ?? []).length, `${t.name} required`).toBe(t.args.filter((a) => a.required).length);
      }
    }
    expect(html).toContain(`version ${MCP_SERVER_INFO.version}`);
    expect(html).toContain('href="/agents/changelog"');
  });

  it("hides the house tools while MCP_HOUSE=0", () => {
    vi.stubEnv("MCP_HOUSE", "0");
    const off = renderToStaticMarkup(createElement(ToolReferencePage));
    for (const name of HOUSE_TOOL_NAMES) expect(off).not.toContain(`id="${name}"`);
  });
});

describe("the changelog", () => {
  it("leads with the version the server reports, which is the registry entry's", () => {
    expect(LATEST_RELEASE.version).toBe(MCP_SERVER_INFO.version);
    expect(MCP_CHANGELOG[0]).toBe(LATEST_RELEASE);
    const entry = JSON.parse(readFileSync(join(ROOT, "registry", "server.json"), "utf8")) as { version: string };
    expect(entry.version).toBe(LATEST_RELEASE.version);
  });

  it("is newest first, one entry a version, each dated and saying what changed", () => {
    const versions = MCP_CHANGELOG.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 0; i < MCP_CHANGELOG.length; i++) {
      const r = MCP_CHANGELOG[i];
      expect(r.version, r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date, r.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${r.date}T00:00:00Z`)), r.version).toBe(false);
      expect(r.title.trim(), r.version).not.toBe("");
      expect(r.changes.length, r.version).toBeGreaterThan(0);
      for (const c of r.changes) expect(c.trim().length, r.version).toBeGreaterThan(10);
      if (i > 0) {
        expect(newer(MCP_CHANGELOG[i - 1].version, r.version), `${MCP_CHANGELOG[i - 1].version} > ${r.version}`).toBe(true);
      }
    }
    // Dates are each version's first commit, and a few were written on a branch before they merged, so they needn't fall
    // in order; none is in the future, and the first and the newest bracket the rest.
    for (const r of MCP_CHANGELOG) expect(r.date >= MCP_CHANGELOG[MCP_CHANGELOG.length - 1].date && r.date <= MCP_CHANGELOG[0].date, r.version).toBe(true);
    expect(MCP_CHANGELOG[0].date <= new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10)).toBe(true);
  });

  it("names only tools the server has, and the newest entries name the tools they added", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name as string));
    for (const r of MCP_CHANGELOG) for (const tool of r.added_tools ?? []) expect(names.has(tool), `${r.version}: ${tool}`).toBe(true);
    // A release can add a field and no tool (2.34.0): the newest one that added tools still names them.
    expect((MCP_CHANGELOG.find((r) => (r.added_tools ?? []).length > 0)?.added_tools ?? []).length).toBeGreaterThan(0);
    // The free OC tools came in 2.32.0, and random_oc in 2.44.0.
    const ocAdded = ["2.32.0", "2.44.0"].flatMap((v) => MCP_CHANGELOG.find((r) => r.version === v)?.added_tools ?? []);
    expect(ocAdded.sort()).toEqual([...OC_TOOL_NAMES].sort());
    expect(MCP_CHANGELOG.find((r) => r.version === "2.31.0")?.added_tools).toEqual([...HOUSE_TOOL_NAMES]);
  });

  it("/agents/changelog renders every version with an anchor, the running one marked, and links its new tools to the reference", () => {
    const html = renderToStaticMarkup(createElement(McpChangelogPage)).replace(/<!-- -->/g, "");
    for (const r of MCP_CHANGELOG) {
      const id = `v${r.version.replace(/\./g, "-")}`;
      expect(html, r.version).toContain(`<li id="${id}" class="mcp-release">`);
      expect(html).toContain(`<a href="#${id}"><code>${r.version}</code></a>`);
      expect(html).toContain(`dateTime="${r.date}"`);
    }
    expect((html.match(/running now/g) ?? []).length).toBe(1);
    expect(html.indexOf("running now")).toBeLessThan(html.indexOf(`<li id="v${MCP_CHANGELOG[1].version.replace(/\./g, "-")}"`));
    for (const tool of HOUSE_TOOL_NAMES) expect(html).toContain(`href="/agents/tools#${tool}"`);
    expect(html).toContain(`<strong>${MCP_SERVER_INFO.version}</strong>`);
  });
});

describe("finding them", () => {
  it("both pages have their own metadata, are in the sitemap, and pass the 18+ gate as /agents does", () => {
    expect(toolsMeta.alternates?.canonical).toBe("/agents/tools");
    expect(changelogMeta.alternates?.canonical).toBe("/agents/changelog");
    expect(String(toolsMeta.title)).not.toBe(String(changelogMeta.title));
    for (const path of ["/agents/tools", "/agents/changelog"]) {
      expect(PUBLIC_PATHS).toContain(path);
      const res = middleware(new NextRequest(`${BASE_URL}${path}`, { headers: { "user-agent": BROWSER } }));
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("/agents links to both near the top, the footer has one For AI agents link, and /llms.txt names them", () => {
    const page = readFileSync(join(ROOT, "app/agents/page.tsx"), "utf8");
    const refs = page.indexOf('<Link href="/agents/tools">Tools</Link>');
    expect(refs).toBeGreaterThan(0);
    expect(page).toContain('<Link href="/agents/changelog">Changelog</Link>');
    // Above the connect box: on the first screen.
    expect(refs).toBeLessThan(page.indexOf('<div className="agents-top">'));
    const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    // The footer's Tools group, as the design system names it (2026-11-16): one link for agent builders.
    const groups = layout.slice(layout.indexOf('<nav className="footer-groups"'), layout.indexOf("</nav>", layout.indexOf('<nav className="footer-groups"')));
    expect(groups).toContain('{!adHost && <li><Link prefetch={false} href="/agents">For AI agents</Link></li>}');
    expect((groups.match(/href="\/agents"/g) ?? []).length).toBe(1);
    const text = llmsText("https://b.test");
    expect(text).toContain("https://b.test/agents/tools");
    expect(text).toContain("https://b.test/agents/changelog");
    for (const tool of HOUSE_TOOL_NAMES) expect(text, tool).toContain(tool);
    vi.stubEnv("MCP_HOUSE", "0");
    expect(llmsText("https://b.test")).not.toContain("get_house_talk");
  });
});
