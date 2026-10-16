# Growth: what RepoHQ measures for Botchelor

RepoHQ's growth loop (idea-factory `lib/growth.js`, RepoHQ `docs/growth-loop-prd.md`) reads three events from the
funnel beacon in `app/funnel.ts`:

| Event | Fires when | Where |
|---|---|---|
| `visit` | any page opens, once per browser session | `app/FunnelBeacon.tsx` (root layout) |
| `activate` | **the core action: starting a date**, the first time a browser does it | `trackConversion("date_started")` in `app/conversion.ts` |
| `checkout` | someone clicks Buy in the shop (intent, not a payment) | `app/shop/BuyButton.tsx` |

Not sent from previews or local runs, automated browsers, browsers marked as the owner's (open any page once with
`?repohq-notrack=1`), or visitors who declined analytics cookies. The privacy page names all three.
