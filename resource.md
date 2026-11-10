# Botchelor resources

Every dashboard, console and listing used for this project. Links only, no secrets. Keys live in the keychain (`~/ai-stack/bin/secrets`).

## The product
- [botchelor.com](https://botchelor.com)
- [MCP endpoint](https://botchelor.com/api/mcp)
- [Health check](https://botchelor.com/api/health)

## Code and planning
- [GitHub repo](https://github.com/smithdavedesign/botchelor)
- [GitHub issues](https://github.com/smithdavedesign/botchelor/issues)
- [Architecture artifact](https://claude.ai/artifact/SdinhSGDxFhgMbWZsSPPso#architecture)
- [Claude artifact](https://claude.ai/artifact/MFTc4qQjoq6pgcUmobdzff#6231cb94-2ed0.m6h8v093ex1.64)
- [ChatGPT conversation](https://chatgpt.com/c/6aef4958-7aa4-83e8-bfe0-30f75fa5caa8)
- [Gemini conversation](https://gemini.google.com/app/0fd57a97e8ef3f62)
- [Tab Manager](https://tabmanager.io/)

## Hosting, infrastructure and media
- [Vercel deployments](https://vercel.com/david-smiths-projects-fe129786/botchelor/deployments)
- [DigitalOcean API tokens](https://cloud.digitalocean.com/account/api/tokens?i=bcb315)
- [Bunny dashboard (billing)](https://dash.bunny.net/auth/login?returnUrl=%2Faccount%2Fbilling)
- [Bunny login](https://dash.bunny.net/auth/login)
- [Cloudflare API tokens](https://dash.cloudflare.com/157f90dfa6ce729a7575aaedc25d8fc8/api-tokens)
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

## Email and payments
- support@botchelor.com: forwards to 1426davejobs@gmail.com ([Cloudflare Email Routing](https://dash.cloudflare.com/157f90dfa6ce729a7575aaedc25d8fc8/botchelor.com/email/routing/routes)); the site's `CONTACT_EMAIL` on both DigitalOcean apps
- [Resend](https://resend.com/login)
- [Stripe dashboard (payments)](https://dashboard.stripe.com/login?redirect=%2Facct_1UR4AVAFlr4wKG3U%2Fpayments)

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
- [Official MCP Registry entry](https://registry.modelcontextprotocol.io/v0/servers?search=botchelor) (`io.github.smithdavedesign/botchelor`, latest 2.26.0; source `registry/server.json`)
- [mcp.so listing](https://mcp.so/servers/botchelor) (Verified, Featured)
- [mcp.so submission edit](https://mcp.so/sign-in?callbackUrl=%2Fsettings%2Fsubmissions%2F85c79afa-5392-4467-8290-822e70267cbc%2Fedit)
- [Glama connector page](https://glama.ai/mcp/connectors/com.botchelor/botcherlor)
- [Glama connector settings](https://glama.ai/sign-up?returnPath=%2Fsettings%2Fmcp%2Fconnectors%2Ftniwdw6x2r)
- [mcptry listing](https://mcptry.com/servers/io.github.smithdavedesign/botchelor)
- [mcpservers.org listing](https://mcpservers.org/servers/botchelor-com-agents) (approved 2026-11-09)
- [MCP Rush listing](https://mcprush.com/to/botchelor-mcp?ref=badge) (`botchelor-mcp`; claim file `public/.well-known/mcprush.com-claim.txt`, keep until they email their decision)

Submitted 2026-11-08, waiting for review (each emails 1426davejobs@gmail.com when live):
- [MCP Market](https://mcpmarket.com/search?q=botchelor): free queue, resubmitted 2026-11-09 with the public repo (about 4 to 6 weeks; email goes to support@botchelor.com). The paid route is now $29, listed within 24 hours.
- [LobeHub](https://lobehub.com/mcp/botchelor-mcp): `botchelor-mcp@2.26.0`, published 2026-11-09 from the public repo with the `lhm` CLI (validation is automatic once the repo is enriched). The older `botchelor` listing is stuck on `not_validated`, because it's tied to this private repo and its identifier can't be moved. To update: `lhm plugin init --url https://botchelor.com/api/mcp`, set `identifier` to `botchelor-mcp`, then `lhm plugin update`.
- [awesome-remote-mcp-servers PR #4221](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/4221): Gaming section, waiting for a maintainer to merge

Not submitted: PulseMCP blocks automated browsers but imports the official registry; Smithery stopped taking submissions on 2026-10-31 (now curated by Arcade).

## Posts that stayed up
The full log, removals included, is `~/idea-factory/ideas/botchelor/launch-log.json`. Reddit account: [u/Outside_Sir_9341](https://www.reddit.com/user/Outside_Sir_9341/submitted/).
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
