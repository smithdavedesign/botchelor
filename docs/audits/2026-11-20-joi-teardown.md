# joi.com teardown

Research date: 2026-11-20. David liked how joi.com's chat stands a transparent picture of the character on the right,
which becomes the background on a tablet and a phone, and asked for the same on After Dark's companion chat (Step
in), plus a teardown of the whole site: what joi does well, and whether its Characters page and Gallery belong in After
Dark.

Looked at signed out, in a headless browser, at 1440, 1100, 820 and 390 px wide: Explore (`/characters`, which is
also the home page), a chat (`/chats/<id>`), a character profile (`/profile/<id>`), Gallery (`/generate/images`) and
Create AI (`/generate/character`). Layout, mechanics and copy only. No account was made, nothing was bought, and
no screenshots are kept here (the site is explicit).

## What shipped from this teardown

| # | Suggestion | Status |
| --- | --- | --- |
| 1 | The character standing beside the chat | Built: Step in's scene (#TBD). A cutout once the Cloudflare zone makes them; until then the portrait with its edges faded. |
| 2 | An After Dark Characters page and a page per character | Being built (separate PR). |
| 3–8 | Below | Not built. |

## The short version

1. **The chat's character is a real cutout, not a CSS trick.** Each character has a background-removed PNG (RGBA,
   988×1436, from Cloudflare Images), drawn with `object-fit: contain` on the bottom edge of a `position: fixed` box.
   On a wide screen the box is the right 40% (at most 525px below 1440px); on a phone it's the whole screen, under
   the chat, with a 70% black veil over it. One element, three breakpoints: the "becomes the background" effect is
   that box losing its width limit.
2. **Every surface leads with a face.** The home page is the catalog. There is no landing page. Cards, chat, profile
   and gallery are all pictures of characters first and words second.
3. **One click from a face to a conversation, and the first message is a picture.** The character opens with a photo
   of themselves and a hook line, so the chat starts as a scene.
4. **Each character is set up like a creator.** A profile has a cover, stats (likes, pictures, videos, fans), a bio,
   a Subscribe button for that character alone, and a gallery in three tabs: their own Posts, Community (pictures
   other people made of them) and Private (locked).
5. **Selling happens inside the moment.** "Make video" sits on every picture in a chat, a row of paid gifts sits over
   the message box, "Upgrade to send media" sits in the composer. There's also a permanent "50% off" badge and a
   "6 free generations" toast.
6. **Don't copy:** real people's likenesses sold as "Official AI Twins", explicit acts written into the catalog's
   bios, one-click "I'm over 18", a cookie banner that says partners may sell your data, and dozens of thin SEO
   pages. Botchelor's rules, processors and privacy stance are the opposite on each, and that's worth saying.

## The chat, piece by piece (what we copied)

| | Desktop (≥1440) | Laptop / tablet (768–1439) | Phone (<768) |
| --- | --- | --- | --- |
| Columns | Chats list 300px · thread · 320px for the figure | Chats list 275–300px · thread | Thread only, full screen |
| The figure | Fixed, top 64px (under the header), right 0, bottom 0, max-width 40% | Same box, max-width 525px, so it sits behind the thread's right side | Fixed, the whole screen, under everything |
| Over the figure | Nothing: the thread's bubbles never reach it | The bubbles (`rgba(33,33,33,.6)`, no blur) | The chat container's `rgba(15,15,15,.7)` |
| The image | `object-fit: contain; object-position: bottom center`, a 0.3 s fade-in | Same | Same |

Other details in the chat: the character's first message is a photo with "Make video" on it and a heart to save it;
photos open in a lightbox; a pencil edits a message; a search box over the chats list; a sliders button for the chat's
settings; on a phone the chat slides in with a view transition and tracks the iOS keyboard (`--ios-visible-height`).

**How Botchelor does it** (`app/stage/CharacterFigure.tsx`, `lib/cutout.ts`, `app/ux/after-dark.css` "Step in"):
- **The cutout is Cloudflare's**, as joi's is. botchelor.com is behind our own Cloudflare zone. Its image
  transformations take `segment=foreground`, which runs BiRefNet at Cloudflare's edge, and it counts as an ordinary
  transformation. The free plan allows 5,000 unique transformations a month (one per portrait, however often it's
  shown) and never bills: past the limit a new one fails, and the figure falls back to the portrait. Only a PG
  portrait goes in, only the zone's own pictures can be transformed, and `metadata=keep` keeps the AI-generated mark.
- **The zone setting is off.** Cloudflare → Images → Transformations → botchelor.com → Enable (or the API's
  `transformations_config` set to `on`, same-zone images only). The server asks once whether cutouts work (one 16px
  cutout of a house portrait) and keeps the answer for an hour, or ten minutes when it's a no. So switching the
  zone on shows cutouts within ten minutes, with no deploy. `CUTOUTS=0` turns them off whatever the zone says.
- **Until then, the portrait as it is,** faded out at every edge: a face in a pool of light, not a framed photo.
- **Wide screen** (≥1100px): the figure at the right edge, 34% of the width (20 to 34rem), the prose column moved
  over to make room. **Tablet** (701–1099px): the figure stands behind the column's right side. **Phone**: the figure
  fills the screen behind the scene, under a veil of the night, and the prose card is thinned so it shows through.
- The figure stands on the window's bottom edge however far the scene is scrolled (joi's is `position: fixed`; ours is
  a sticky view inside a layer cut to the scene's edges, so it never covers the footer).
- The place's backdrop stays behind it all, so the character stands *in* the place. joi has no setting at all.
- The ⋯ menu has "Hide <name>'s picture" (kept in this browser). Discreet mode doesn't blur it: it's the show's own
  PG portrait (`.avatar`), which discreet mode already leaves alone.

## Page by page

### Explore (the home page)

- A carousel on top sells their own produced shorts ("New short · Fully Loaded · Watch now"). This is the same idea as
  After Dark's Episodes, given the most valuable spot on the site.
- Filters in one row: search, gender (Girls / Guys / Trans), age bands, creator (Joi Originals / Official AI Twins /
  community), then tag chips (Anime, LGBT+, Fantasy, Dominant, Kinky, …).
- Cards: a 3:4 photo with an archetype line on top ("Kinky Sweetheart", "Straight & Curious"), likes and message
  counts on the photo (31.5K ♡ 24.4M 💬), name and age, two lines of a first-person bio, the creator, and a separate
  profile button. The card itself opens the chat. Hovering plays a short video, loaded only on hover.
- The first tile is "Create your own AI Girlfriend", in the grid where a character would be.
- Phone: two columns, the chips wrap, and a floating bottom tab bar (Explore · Gallery · Create AI · Chats · More).

### A character's profile

- A cover picture, the avatar over its edge, name and age, then stats: likes, pictures, videos, fans.
- The bio in a box, cut off with "show more".
- **Subscribe**, for this character alone ("fans"), on top of the site's Premium.
- The gallery: **Posts** (the character's own feed, captions in their voice, comments), **Community** (91 pictures
  other people made of her) and **Private**. Posts are blurred with a Subscribe button over them.

### Gallery (the generator next to the feed)

- Left: Image or Video; a base character (browse 500+); a description box with "Surprise me"; styles and poses (55,
  as pictures); how many (2/4/8/12); the shape; an add-on ("Boost clarity +5", paid in their currency); Private; the
  button with what's left ("Create 2 images · 6 free images left").
- Right: the Community feed (views, likes, by @handle, video lengths, "Make video" on each) and My media.
- Below: a long SEO article and a grid of keyword links ("AI porn video generator", "Rule 34 AI generator", …).

### Create AI

Realistic or anime, then tiles (ethnicity, body, …) or a free prompt, then a review with a regenerate button.

### Money

Premium for 1, 3 or 12 months; "Neurons" in 500 / 2k / 10k packs for extras; a Subscribe per character; gifts in the
chat; "Make video" everywhere; free generations as the hook.

### Built with

Hashed atomic CSS classes, Cloudflare Images with signed URLs and named variants (`quad400`, `quad1440`), Cloudflare
Stream for video, view transitions for the phone chat, the Outfit font, consentmanager for cookies.

## What they do well, and what After Dark has

| joi | After Dark today | Gap |
| --- | --- | --- |
| The catalog is the home page | The hub: hero, Continue, Episodes, Your latest, Showcase; a searchable pair picker | Small: our hub is about nights, not people |
| A page per character, creator-style | None (the show's Characters has profiles; After Dark doesn't) | **Big**: the IA review of 2026-11-18 noted it too |
| Community tab per character | The Showcase, but not by character | Medium: falls out of a character page |
| The character beside the chat | Step in: prose over a faded backdrop, nobody visible | Closed by this teardown (#1) |
| First message is a picture | Step in has no pictures in v1 | Medium: Step in's v2 |
| "Make video" on every picture | Animate exists on night pictures (#1813) | Small: put it on more pictures |
| Gifts in the chat | None | Skip for now (below) |
| Social proof on every card | Few counts shown | Small |
| Phone tab bar | The show's phone tab bar is skipped on After Dark's host | Small |
| Hover plays a loop | Living portraits exist, but are kept out of After Dark's listings | Small |

## Recommendations, in order

1. **The figure in Step in.** Built (#TBD). Switch the zone's transformations on to get real cutouts.
2. **After Dark Characters + a page per character.** Yes, this belongs in After Dark. It's the one structural thing
   joi has that After Dark lacks, and it's being built now. The grid lists exactly who the viewer can have a night
   with. Each page has the character's nights and their public pictures (joi's "Community"), and the ways in that
   already exist: start a night with them, Step in where it's open, the favourite star.
3. **Gallery: tie it to characters, not a new page.** After Dark's Gallery (Yours | Showcase) already is joi's
   Community | My media. What joi adds is the generator beside the feed and a feed per character. Do the second
   through the character pages. For the first, a "Make one like this" on Showcase tiles that opens the Studio set
   up from it.
4. **Make Step in's first reply a picture**, once Step in opens and its v2 adds pictures (a beat picture of the
   character at the place, the way theater nights already draw them).
5. **"Make video" on any After Dark picture** that can be animated, not only a night's.
6. **The phone tab bar on After Dark's host** (Scenes · Characters · Studio · Gallery · You).
7. **Counts on cards** (nights, pictures, favourites), where they're real and not tiny.
8. **Living portraits as the hover state** on the Characters grid, if they're allowed back into After Dark listings
   (#1814 kept them out on purpose).

Not recommended:
- **Gifts:** a microtransaction per emoji is a new paid surface for the processors, and steering already works.
- **A Subscribe per character:** a second subscription model before the first one has revenue.
- **"Official AI Twins"** (real creators' likenesses): against Botchelor's no-real-people rule and what the
  processors were told.
- **The always-on discount badge, the "free generations" toasts and the thin SEO pages.**

## What couldn't be checked

Anything behind sign-up: the chats list with real history, gifts' prices and what they do, the sliders panel,
Premium's prices, Neurons' prices, and how Subscribe per character is billed.
