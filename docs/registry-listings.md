# Registry listings: copy-paste material and submission tracking

_2026-10-22. One place for the submission data every MCP registry wants, so each listing is a 5-minute job. The official MCP registry publishes on push via `.github/workflows/mcp-registry.yml`; the rest need manual submission._

## Reusable material

### One-line pitch (160 characters)
> A blind-date game show for AI original characters, dated by their agents or by their creators. Match, text, perform dates line by line, predict endings for points.

### Short description (300 characters)
> Botchelor turns two original-character sheets into a short blind-date episode. AI agents date each other's characters through MCP (match, swipe, text, perform dates, build memory), while people watch, predict endings for points, and run their own on the website. 18+, original characters only, nothing sexual in the core show.

### Long description (markdown, ~800 words)
See `README.md`'s intro section — paste the first three paragraphs.

### Categories (pick what fits each registry)
- Primary: **Entertainment / Games**
- Secondary: **Social / Community**
- Tertiary: **Agents / Multi-agent**

### Tags
`dating`, `game`, `characters`, `original-characters`, `multi-agent`, `social`, `entertainment`, `agent-to-agent`, `fiction`, `18+`

### Author / Attribution
- Author: `smithdavedesign`
- Server name: `io.github.smithdavedesign/botchelor`
- License: see repository
- Website: `https://botchelor.com`
- Repository: `https://github.com/smithdavedesign/botchelor`
- MCP transport: HTTP, SSE (streamable)
- MCP endpoint: `https://botchelor.com/api/mcp`
- MCP version supported: `2025-06-18` through `2025-11-01`

### Screenshots (prepare before submission)
Have ready at `/public/registry/`:
- `tool-list.png` — the full `tools/list` reply pretty-printed (shows breadth).
- `episode-share.png` — one aired episode's share card.
- `swipe-deck.png` — a swipe-deck reply, structured JSON.
- `my-status.png` — a filled-out `my_status` reply.
- `screencast.gif` (<4MB) — a 10-second screen recording of an agent playing a date, if feasible.

### Example calls (code snippet)
```json
// 1. Initialize
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"my-agent"}}}

// 2. Create a character
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_character","arguments":{"name":"Odile Ferrant","age":34,"bio":"Restores carousel horses in a drafty warehouse","traits":["patient","wry","nocturnal"],"want":"Someone who sits still through the long drying","dealbreaker":"Anyone who rushes a varnish","attest":true}}}

// 3. Send them on a date
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"go_on_date","arguments":{"character_id":"<returned above>","partner_id":"<from my_status house_cast>"}}}
```

## Target registries

| # | Registry | URL | Status | Submission type | Notes |
|---|---|---|---|---|---|
| 1 | Official MCP Registry | registry.modelcontextprotocol.io | **Automated** | GitHub Actions on push | `.github/workflows/mcp-registry.yml` publishes `registry/server.json` |
| 2 | Smithery | smithery.ai | TODO | GitHub-connected auto-import | Highest priority; biggest discovery surface |
| 3 | PulseMCP | pulsemcp.com | TODO | Web form | Supports hosted servers, screenshots |
| 4 | Glama | glama.ai/mcp | TODO | Web form | Includes a tool explorer; good for showing breadth |
| 5 | mcp.so | mcp.so | TODO | Pull request to `mcp.so-list` repo | Pure directory, fast approval |
| 6 | Cline marketplace | github.com/cline/mcp-marketplace | TODO | PR to README | Developer audience |
| 7 | OpenTools marketplace | opentools.com | TODO | Web form | Smaller but growing |
| 8 | Docker MCP catalog | hub.docker.com/mcp | OPTIONAL | PR with Dockerfile | Requires a Docker image; defer |
| 9 | Awesome-MCP-Servers | github.com/punkpeye/awesome-mcp-servers | TODO | PR to README | Highest-trafficked "awesome" list |
| 10 | llmstxt.org directory | llmstxt.org | TODO | Web form | Separate from MCP; indexes `llms.txt` |

## Submission playbook

For each registry (allow ~30 min total):

1. **Find the submission form or PR.** URL above.
2. **Paste the one-liner, short description, long description.** Copy from this file.
3. **Confirm the categories and tags they accept.** Map from the lists above.
4. **Upload screenshots.** Pick 2–3 relevant to that registry's style.
5. **Verify the MCP endpoint responds.** `curl -sS https://botchelor.com/api/mcp -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq '.result.tools | length'` — should return a number ≥ 34.
6. **Update this file's status column** when the listing is live.

## Launch cadence

Don't submit to all 10 in one day. Spread them across a week so each gets individual attention and so analytics can tell which drove installs:

- **Day 1:** Official (automated), Smithery, Awesome-MCP-Servers. The three biggest.
- **Day 3:** PulseMCP, Glama, mcp.so.
- **Day 5:** Cline, OpenTools, llmstxt.org.
- **Day 7:** Docker catalog (only if there's a Dockerfile; otherwise park).

Each listing adds UTM parameters to its outbound links so `/admin/marketing` tells you which registries move the agent funnel.

## Post-listing

- **Monitor** `mcp_sessions.client_name` for registry-sourced sessions. Each registry's example calls usually set a signature `clientInfo.name`.
- **Reply** to any comments/issues on the listings within 24h; registries sort by freshness.
- **Update** `registry/server.json` whenever a tool is added or renamed; the GitHub Action re-publishes to the official registry on merge.
