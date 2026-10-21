# Mobile audit, 2026-10-21

**Two Playwright passes:**
- **The live site, read-only:** iPhone 14, iPhone SE (3rd gen), Pixel 7 and a 360×740 Android in Chromium, plus an iPhone Safari pass in WebKit. Analytics were blocked.
- **Signed-in flows on a local stub-model app:** iPhone 14 in Chromium.

The scripts and screenshots were kept in the session scratchpad.

**Overall:** nothing blocks a phone user. No page scrolls sideways at 360–412px, no text is under 12px, inputs are 16px (no iOS zoom), and there are no hydration errors.

## Fixed in this PR

| Finding | Fix |
|---|---|
| Theater and watch-room top bar cut the pair to "Juniper Vale × Ra…" | On a phone (≤600px) the icons and Exit take the top row, and the names get the full width below, two lines at most (`.theater-hud`) |
| Theater icons 35px and Exit 56×35; pink Exit hard to read over the photo | 44px targets on touch screens; Exit is white on a dark chip |
| Episode page: "Watch in theater" ~2,650px down, under a written recap that spoils the ending | The theater button comes first, under the title |
| Recap acts repeat their label ("FIRST IMPRESSIONS / act 1: First impressions. …") | The leading "act N: <that act's label>." is dropped when it repeats the heading (`withoutActLabel`) |
| Home: "Make your character" below the first screen (the box score came first) | On a phone the headline and button come first, then the box score |
| Avatars: 1024px PNGs of ~1.4 MB each drawn at 38–96px, 40 on /watch, none lazy | `/api/assets/<id>?w=` returns a WebP at 64/128/256/384px (sharp, CDN-cached for a year; on any failure it sends the original). `Avatar` asks for about twice its drawn size and lazy-loads. |
| `/account` layout shift 0.61 (a 25px "Loading…" became ~1,000px) | The loading state holds 70vh |
| Notifications: the button sat mid-sentence | The explanation, then the button on its own line |
| `/create` step rail: step 7 off-screen at ≤390px, dots 32px | The current step scrolls into view; dots are 44px on touch |
| Looks builder age strip: the character's age (e.g. 34) sat off-screen with 18–22 showing, and a tap silently changed the Identity age | The current age scrolls into view, and a line says it's the age from their identity |
| Live theater before the first line: two waiting messages stacked | Only the "Filming the date…" card shows |
| "usually takes a few seconds" on one screen, "within a minute" on the other | Both say under a minute |
| Thread: the "Only X and Y can text here" note looked like a text box | Plain centered note |
| Thread header: ⓘ 18×29, back 32×32, Book date 36 tall | 44px on touch |
| Swipe card stops mid-line with no hint it scrolls | A fade at its foot |
| Match popup: "Marisol and Marisol are texting now"; the buttons don't line up | Full names when first names match; buttons aligned, both 44px |
| Shop: no price before sign-in | The price shows above "Sign in to buy" |
| Originality: "Reads a lot like Ira Fenn, Ira Fenn … There's already a Ira Fenn" | One mention per name; "There's already someone called …" |
| Phone menu: no backdrop, the page scrolls behind it | A dim backdrop (tap to close) and the page holds still |
| Header: menu button and token pill 38px | 44px on touch; checkbox labels, FAQ rows and the gate's "No, take me away" too |
| Hometown placeholder cut off ("…one traf") | Shorter example |
| `scripts/loop/arena.mjs` seeded into another server when its own failed to start (EADDRINUSE) | Refuses an occupied port, and stops if its own `next start` exits or never answers |

## Flagged for David (not changed)

- **Character pages have no "date this character" near the top.** The only call to action is ~5,000px down. Placing one is a product call: who can ask a house character out, and from where.
- **`/watch` is ~17,000px with no pagination**, and its first screen is all explanation. It needs a decision on what leads: live now, newest, or best.
- **The written recap still spoils the ending** for anyone who scrolls past the theater button. A "show the recap" toggle is easy if you want one.
- **Menu "Cast" goes to `/characters` ("Every character")**, while `/cast` is a different page ("The cast"). Rename one or merge them.
- **A public contestant is named "David Smith"** (relationships and date record on `/characters/house-juniper`). If that's your test character, rename it.
- **Watch room pre-show:** a room in its first 30s showed an empty stage with no countdown (seen once).
- **Notifications:** "…want to go on a date. Book it" stays after the date is booked.
- **After-create picker:** ~6,800px, every house character with its own button.
- **Looks summary** leaves out age, body and outfit picks. The After Dark tab's dots wrap (11 dots for "Step 1 of 10").
- **The 988 helpline links show twice** on the episode page (footer and page). Kept, since they're a safety element.
- **`GET /api/sets/24%20hour%20diner` returns 404** (a missing backdrop; the fallback shows).
- **On the gate, Safari cancels footer-link prefetches** (3 console errors).

## The loop-run collision

The signed-in pass started its local arena on port 4420 while the nightly loop's arena was already there, on the paid date model. Its server failed with EADDRINUSE, and the old `arena.mjs` didn't notice: it seeded into, and the audit browsed, the loop's server.
- **Cost:** about 9–11 paid date generations (~10–20¢).
- **Scope:** only the loop's throwaway database. No production.
- **Effect:** that run (`~/.botchelor-loop/runs/2026-10-20-2347`) saw a doubled world, so its ratings shouldn't be trusted.
- **Fix:** the arena's port guard above.

Not tested on a real device. The local pass covered iPhone 14 only.
