# Share-card fonts

Fonts for the link-preview cards that `next/og` draws (`lib/og-type.ts`). The site's own pages get their fonts from
`next/font` (`app/fonts.ts`), which serves WOFF2. Satori, the card renderer, reads only TTF/OTF, so these copies live
here.

- `Fraunces-SoftBlack.ttf` (800, SOFT 100, WONK 1) and `Fraunces-SoftSemiBoldItalic.ttf` (600 italic, SOFT 100, WONK 1):
  the title-card cut of the display face.
- `Inter-Medium.ttf` (500) and `Inter-ExtraBold.ttf` (800): the body face.

Both families are under the SIL Open Font License 1.1 (`OFL.txt`). They were downloaded from Google Fonts on 2026-11-27.
