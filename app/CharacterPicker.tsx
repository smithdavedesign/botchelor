"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import Avatar from "@/app/Avatar";
import { CHARACTER_EVENT, PICKER_OPEN_EVENT, pickedHref, rememberCharacterInBrowser, rememberedFromCookieString } from "@/lib/current-character";
import type { PickerCharacter } from "@/lib/my-characters";
import { shortName } from "@/lib/names";

/** "Dex", "Dex and Sam", "Dex, Sam and Ro". */
const andList = (names: string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What a face says about itself, read out and shown on hover: who a taken one is dating, and what's new. */
export function aboutCharacter(c: PickerCharacter): string {
  const first = shortName(c.name);
  return [c.taken.length ? `${first}: taken (dating ${andList(c.taken.map(shortName))})` : first, c.news ? `${c.news} new` : ""].filter(Boolean).join(", ");
}

/** With news first, the rest as they were (newest first): what to look at next leads the grid. */
export const pickerOrder = (characters: readonly PickerCharacter[]): PickerCharacter[] => [...characters].sort((x, y) => Number(y.news > 0) - Number(x.news > 0));

/**
 * The character you're working with, in the header (David, 2026-11-18: "a small icon ... with who's currently browsing
 * and they can click to switch their character there"; lib/current-character.ts). Their face and short name; a dot when
 * another of theirs has news. It opens a grid of every one of theirs (what's new on each, a taken one dimmed and tagged
 * 💍), the way to the one picked and to making another. Picking one remembers it and takes the page with it: a page
 * whose address names a character opens on the new one (lib/current-character.ts pickedHref), any other is read again,
 * so the cards' "Send {mine}" and the Studio follow.
 *
 * `bar` is the same picker in the swipe deck's slim bar, where a phone has no site header. A heading's name opens
 * whichever picker is showing (app/SwitchCharacter.tsx). The face follows the page: a page about one character says
 * so (app/RememberCharacter.tsx), and the cookie is read once the page is up (the layout can't see the address).
 */
export default function CharacterPicker({ characters, initial, variant = "nav" }: { characters: PickerCharacter[]; initial: string | null; variant?: "nav" | "bar" }) {
  const router = useRouter();
  const pathname = usePathname();
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState(initial);
  const [open, setOpen] = useState(false);

  // Follow the page: whatever a page or a pick says, and what this browser remembers once the page is up.
  useEffect(() => {
    const follow = (e: Event) => setPicked((e as CustomEvent<string>).detail);
    window.addEventListener(CHARACTER_EVENT, follow);
    const remembered = rememberedFromCookieString(document.cookie);
    if (remembered) setPicked(remembered);
    return () => window.removeEventListener(CHARACTER_EVENT, follow);
  }, []);
  // A heading's name asks for the picker: the one that's showing opens (the deck's bar on a phone, else the header's).
  useEffect(() => {
    const ask = () => {
      if (!root.current?.getClientRects().length) return;
      setOpen(true);
      button.current?.focus();
    };
    window.addEventListener(PICKER_OPEN_EVENT, ask);
    return () => window.removeEventListener(PICKER_OPEN_EVENT, ask);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  // Escape, or a tap anywhere else, closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!characters.length) return null;
  const me = characters.find((c) => c.id === picked) ?? characters[0];
  const first = shortName(me.name);
  const elsewhere = characters.filter((c) => c.id !== me.id && c.news > 0);
  const several = characters.length > 1;

  const choose = (id: string) => {
    setOpen(false);
    if (id === me.id) return;
    setPicked(id);
    rememberCharacterInBrowser(id);
    const next = pickedHref(`${window.location.pathname}${window.location.search}${window.location.hash}`, id);
    if (next) router.push(next);
    else router.refresh();
  };

  return (
    <div ref={root} className={`char-picker char-picker--${variant}`} data-open={open}>
      <button
        ref={button}
        type="button"
        className="char-picker-button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Your character: ${first}.${elsewhere.length ? ` ${elsewhere.length === 1 ? `${shortName(elsewhere[0].name)} has` : `${elsewhere.length} others have`} news.` : ""} ${several ? "Switch" : "Open"}`}
        title={several ? `${first}: switch character` : first}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar seed={me.id} name={me.name} hue={me.hue} portraitSrc={me.portrait} size={variant === "bar" ? 24 : 28} decorative round />
        <span className="char-picker-name">{first}</span>
        {elsewhere.length > 0 && <span className="char-picker-dot" aria-hidden="true" />}
        <span className="char-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      <div id={menuId} className="char-picker-menu" role="dialog" aria-label="Your characters" hidden={!open}>
        <p className="char-picker-head">
          <span className="muted">Playing as</span> <strong>{first}</strong>
          {me.taken.length > 0 && <span className="badge taken-tag">💍 Taken</span>}
          <Link href={`/characters/${encodeURIComponent(me.id)}`} className="char-picker-page">
            {first}&apos;s page
          </Link>
        </p>
        {several && (
          <ul className="char-picker-grid">
            {pickerOrder(characters).map((c) => {
              const label = aboutCharacter(c);
              const current = c.id === me.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`char-picker-tile${c.taken.length ? " is-taken" : ""}`}
                    aria-current={current ? "true" : undefined}
                    aria-label={current ? `${label} (playing as)` : label}
                    title={label}
                    onClick={() => choose(c.id)}
                  >
                    <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={44} decorative round />
                    <span className="char-picker-tile-name">{shortName(c.name)}</span>
                    {c.taken.length > 0 && (
                      <span className="badge taken-tag" aria-hidden="true">
                        💍 Taken
                      </span>
                    )}
                    {c.news > 0 && (
                      <span className="nav-count" aria-hidden="true">
                        {c.news > 99 ? "99+" : c.news}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="char-picker-foot">
          {several && <Link href="/characters?tab=yours">All of yours</Link>}
          <Link href="/create">+ Make another character</Link>
        </p>
      </div>
    </div>
  );
}
