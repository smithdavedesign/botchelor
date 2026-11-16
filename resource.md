# Botchelor resources

Every dashboard, console and listing used for this project. Links only, no secrets. Keys live in the keychain (`~/ai-stack/bin/secrets`).

## The product
- [botchelor.com](https://botchelor.com)
- [MCP endpoint](https://botchelor.com/api/mcp)
- [Health check](https://botchelor.com/api/health)
- [What it costs](https://botchelor.com/costs): the public cost ledger (lib/public-costs.ts, docs/costs.md)
- [Marketing, in the open](https://botchelor.com/marketing): every channel and post, how each did and what it brought (lib/public-marketing.ts, docs/marketing.md)
- [For agents](https://botchelor.com/agents): the MCP server's front page, tool reference and changelog
- Admin (admin account only): [/admin/analytics](https://botchelor.com/admin/analytics) (engagement, sources, funnel) and [/admin/spend](https://botchelor.com/admin/spend) (money in and out)

## Code and planning
- [GitHub repo](https://github.com/smithdavedesign/botchelor)
- [GitHub issues](https://github.com/smithdavedesign/botchelor/issues)
- [Architecture artifact](https://claude.ai/artifact/SdinhSGDxFhgMbWZsSPPso#architecture)
- [Claude artifact](https://claude.ai/artifact/MFTc4qQjoq6pgcUmobdzff#6231cb94-2ed0.m6h8v093ex1.64)
- [ChatGPT conversation](https://chatgpt.com/c/6aef4958-7aa4-83e8-bfe0-30f75fa5caa8)
- [Gemini conversation](https://gemini.google.com/app/0fd57a97e8ef3f62)
- [Tab Manager](https://tabmanager.io/)

## Hosting, infrastructure and media
- [DigitalOcean apps](https://cloud.digitalocean.com/apps): the show and After Dark run here since 2026-10-30, plus the scheduled jobs
- [Neon console](https://console.neon.tech/): the Postgres database
- [Runpod console](https://www.console.runpod.io/): the GPU endpoint for live video calls (Ditto); auto-pay tops up $25 below $15
- [Vercel deployments](https://vercel.com/david-smiths-projects-fe129786/botchelor/deployments): the old host, before the move to DigitalOcean
- [DigitalOcean API tokens](https://cloud.digitalocean.com/account/api/tokens?i=bcb315)
- [Bunny dashboard (billing)](https://dash.bunny.net/auth/login?returnUrl=%2Faccount%2Fbilling)
- [Bunny login](https://dash.bunny.net/auth/login)
- [Cloudflare API tokens](https://dash.cloudflare.com/)
- [Tailscale machines](https://login.tailscale.com/login?next_url=https%3A%2F%2Fconsole.tailscale.com%2Fadmin%2Fmachines)
- [Deploy portal](https://portal.deploy.com/organization/1648386094/dashboard)

## Domain
- [Wix sign-in (domains: manage.wix.com/account/domains)](https://users.wix.com/signin?redirectTo=https%3A%2F%2Fmanage.wix.com%2Faccount%2Fdomains)

## AI providers
- [Venice API settings](https://venice.ai/settings/api)
- [fal.ai usage and billing](https://fal.ai/dashboard/usage-billing)
- [OpenRouter keys](https://openrouter.ai/workspaces/default/keys)
- [Replicate billing](https://replicate.com/signin?next=/account/billing)
- [OpenAI API keys](https://platform.openai.com/api-keys)
- [Google AI Studio API keys](https://aistudio.google.com/api-keys)
- [Google AI Studio billing](https://aistudio.google.com/billing?billing=011B5F-2D20A4-B63801)
- [Hive moderation](https://thehive.ai/): image safety checks for portraits and After Dark pictures
- [Didit](https://didit.me/): age checks, only where the law asks for one
- [Simli](https://app.simli.com/): talking faces for calls (free plan)
- Kokoro voices on Venice: the voices in the daily clips (same Venice key)

## Email and payments
- support@botchelor.com: forwards to the owner's Gmail ([Cloudflare Email Routing](https://dash.cloudflare.com/)); the site's `CONTACT_EMAIL` on both DigitalOcean apps
- [Resend](https://resend.com/login)
- [Stripe dashboard (payments)](https://dashboard.stripe.com/login?redirect=%2Facct_1UR4AVAFlr4wKG3U%2Fpayments)

## Social accounts
Posted to by the marketing loop (`~/idea-factory/bin/idea-market.js`, calendar `ideas/botchelor/marketing.json`); the full log is public at [/marketing](https://botchelor.com/marketing).
- [Reddit u/Outside_Sir_9341](https://www.reddit.com/user/Outside_Sir_9341/submitted/)
- [X @botchelorLLC](https://x.com/botchelorLLC)
- [Bluesky @botchelor.bsky.social](https://bsky.app/profile/botchelor.bsky.social)
- [Threads @botchelor](https://www.threads.com/@botchelor) (since 2026-11-15; signed in through Instagram)
- [Instagram @botchelor](https://www.instagram.com/botchelor/) (Reels)
- [TikTok @botchelorcom](https://www.tiktok.com/@botchelorcom)
- [YouTube @Botchelor](https://www.youtube.com/@Botchelor) (Shorts)
- [Discord server](https://discord.gg/8VDdRF9YU) (the weekly digest posts in #general)
- [Chub @botchelor](https://chub.ai/users/botchelor): five of the show's cast as character cards

## Launch sites and directories
- [Uneed](https://www.uneed.best/tool/botchelor): listed 2026-11-15, free launch slot 2027-06-22 (fast-track $19.99 planned, not paid)
- [DevHunt: Botchelor MCP](https://devhunt.org/tool/botchelor-mcp): listed 2026-11-15, free queue (~2031; basic launch $19 planned, not paid)
- Peerlist: project page saved 2026-11-15; the Launchpad needs the owner's ID verification first
- Product Hunt: launch planned for Tue 2026-12-01 with December's season (`~/idea-factory/ideas/botchelor/PRODUCTHUNT.md`)

## Google, analytics and SEO
- [Google Cloud OAuth clients (project botchelor)](https://console.cloud.google.com/auth/clients?project=botchelor)
- [Google Analytics 4 home](https://analytics.google.com/analytics/web/#/a412238402p559259689/reports/intelligenthome?params=_u..nav%3Dmaui)
- [GA4 Search Console integration](https://analytics.google.com/analytics/web/#/a412238402p559259689/admin/integrations/search-console)
- [Google Search Console](https://search.google.com/search-console?resource_id=https%3A%2F%2Fbotchelor.com%2F)
- [Google Tag Manager workspace](https://tagmanager.google.com/#/container/accounts/6382881237/containers/267324508/workspaces/5)
- [Google Tag Manager versions](https://tagmanager.google.com/#/versions/accounts/6382881237/containers/267324508/versions)
- [Bing Webmaster Tools](https://www.bing.com/webmasters/about?siteUrl=https://botchelor.com/&from=home)

## MCP listings
Checked live 2026-11-08.
- [Public MCP repo smithdavedesign/botchelor-mcp](https://github.com/smithdavedesign/botchelor-mcp): README, server.json and MIT license only (no app code), so that directories that need a public GitHub repo can list us
- [Official MCP Registry entry](https://registry.modelcontextprotocol.io/v0/servers?search=botchelor) (`io.github.smithdavedesign/botchelor`; source `registry/server.json`, kept at the live server's version by `tests/mcp-registry-version.test.ts`, and copied into the public MCP repo)
- [mcp.so listing](https://mcp.so/servers/botchelor) (Verified, Featured)
- [mcp.so submission edit](https://mcp.so/sign-in?callbackUrl=%2Fsettings%2Fsubmissions%2F85c79afa-5392-4467-8290-822e70267cbc%2Fedit)
- [Glama connector page](https://glama.ai/mcp/connectors/com.botchelor/botcherlor) (renamed "Botchelor" 2026-11-14 with a new description and icon on its Admin tab; the address keeps the old "botcherlor" spelling)
- [Glama connector settings](https://glama.ai/sign-up?returnPath=%2Fsettings%2Fmcp%2Fconnectors%2Ftniwdw6x2r)
- [mcptry listing](https://mcptry.com/servers/io.github.smithdavedesign/botchelor)
- [mcpservers.org listing](https://mcpservers.org/servers/botchelor-com-agents) (approved 2026-11-09)
- [MCP Rush listing](https://mcprush.com/to/botchelor-mcp?ref=badge) (`botchelor-mcp`; claim file `public/.well-known/mcprush.com-claim.txt`, keep until they email their decision)

Submitted 2026-11-08, waiting for review (each emails the owner's Gmail when live):
- [MCP Market](https://mcpmarket.com/search?q=botchelor): free queue, resubmitted 2026-11-09 with the public repo (about 4 to 6 weeks; email goes to support@botchelor.com). The paid route is now $29, listed within 24 hours.
- [LobeHub](https://lobehub.com/mcp/botchelor-mcp): `botchelor-mcp@2.29.0`, **published** 2026-11-14 (it validated once the duplicate was unpublished). The older `botchelor` listing is unpublished (undo: `lhm plugin republish botchelor`). To update: `lhm plugin init --url https://botchelor.com/api/mcp` in a folder with a package.json that has a description, set `identifier` to `botchelor-mcp` and `name` to `Botchelor`, then `lhm plugin update`.
- [M8ven listing](https://m8ven.ai/mcp/smithdavedesign/botchelor-mcp): Verified Publisher since 2026-11-14 (claim email support@botchelor.com). The badge with its ownership token lives in the botchelor-mcp README; leave it there. Grade C "Emerging", because the front repo has no code. Optional: the m8ven-verify GitHub App (Live Monitored), not installed.
- [awesome-remote-mcp-servers PR #4221](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/4221): Gaming section, waiting for a maintainer to merge

Not submitted: PulseMCP blocks automated browsers but imports the official registry; Smithery stopped taking submissions on 2026-10-31 (now curated by Arcade).

## Posts that stayed up
Every post, removals included, with scores and what it brought: [botchelor.com/marketing](https://botchelor.com/marketing). The source logs are `~/idea-factory/ideas/botchelor/launch-log.json` and `marketing-queue.json`. Highlights:
- 2026-10-20 [r/mcp: a dating simulation for bots](https://www.reddit.com/r/mcp/comments/1xadyv8/botchelor_a_dating_simulation_for_bots/) and [our comment there](https://www.reddit.com/r/mcp/comments/1xadyv8/comment/19riaazpfzmbl/?context=1)
- 2026-10-24 [r/SillyTavernAI](https://www.reddit.com/r/SillyTavernAI/comments/1xeebiw/created_a_blinddate_show_for_your_oc_where_you/) (best so far: 6 points, 11 comments)
- 2026-10-24 [Show HN](https://news.ycombinator.com/item?id=50223284)
- 2026-10-29 [r/ChatbotRefugees October promotions megathread comment](https://www.reddit.com/r/ChatbotRefugees/comments/1wwersg/monthly_platform_alternatives_promotions/19ru6n912xu5e/)
- 2026-10-30 [r/AI_Agents weekly project thread comment](https://www.reddit.com/r/AI_Agents/comments/1xhs3rj/weekly_thread_project_display/19rw0jhu3y0g1/)
- 2026-10-31 r/SideProject (on the account's submitted page)
- 2026-11-01 [r/ChatbotRefugees Promotion Sunday](https://www.reddit.com/r/ChatbotRefugees/comments/1xlcswv/im_the_dev_your_oc_goes_on_a_blind_date_you_cant/)
- 2026-11-03 [r/aichapp](https://www.reddit.com/r/aichapp/comments/1xmfexa/im_the_dev_your_oc_goes_on_a_blind_date_you_cant/)
- 2026-11-08 [r/mcp: agents can audition for the monthly cast](https://www.reddit.com/r/mcp/comments/1xr89t5/botchelor_update_agents_can_now_audition_their/)
- 2026-11-09 [r/JanitorAI_Refuges: blind-date show plus 1-on-1 chat](https://www.reddit.com/r/JanitorAI_Refuges/comments/1xs0xkz/im_the_dev_a_blinddate_show_for_your_oc_plus_1on1/) (self ads once every 7 days)
- 2026-11-11 [TikTok: first daily clip](https://www.tiktok.com/@botchelorcom/video/7706986449412951326); from then on one clip a day on TikTok, [YouTube Shorts](https://www.youtube.com/@Botchelor/shorts) and [Instagram Reels](https://www.instagram.com/botchelor/reels/)
- 2026-11-13 [r/modelcontextprotocol: a remote MCP server with a 3-tool default list](https://www.reddit.com/r/modelcontextprotocol/comments/1xvcbqg/i_built_a_remote_mcp_server_where_the_default/)
- 2026-11-15 [Threads: first post](https://www.threads.com/@botchelor/post/DfxgWZjGTGa)
- Daily since 2026-11-10: [Bluesky](https://bsky.app/profile/botchelor.bsky.social) and [X](https://x.com/botchelorLLC)
