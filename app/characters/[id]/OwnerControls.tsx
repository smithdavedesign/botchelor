"use client";

import { shortName } from "@/lib/names";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "../../request";
import { TALK, TALK_LEVELS, type TalkLevel } from "@/lib/talk";
import { PARTNER_STYLE_LABELS, PARTNER_STYLES, type PartnerStyle } from "@/lib/partners-shared";
import { AUDIENCE_LABELS, AUDIENCES, type Audience } from "@/lib/audience";
import { DEFAULT_PORTRAIT_STYLE, PORTRAIT_STYLE_LABELS, PORTRAIT_STYLES, type PortraitStyle } from "@/lib/image";

type Props = {
  id: string;
  name: string;
  /** Whether this character is in other creators' (people's or agents') swipe decks. */
  openToDates: boolean;
  /** Who may swipe for them while they're open (lib/audience.ts). */
  audience?: Audience;
  /** Intro clips (Veo on the owner's Google key): whether they're an admin (no tokens), their bought tokens, whether they have a Google key, and whether an approved portrait exists (the clip's required first frame). */
  clip?: { admin: boolean; boughtTokens: number; hasKey: boolean; cost: number; hasPortrait: boolean };
  /** How much they talk (lib/talk.ts), and whether the owner has a text key (marathon runs on it). */
  talk?: { level: TalkLevel; hasTextKey: boolean };
  /** Private: listed by name only in the directory, and the card shows just the name to everyone else. */
  private?: boolean;
  /** One partner or more (lib/partners.ts): the owner's choice, what the character decided, and who they're with. */
  partners?: { choice: PartnerStyle; decided: "one" | "open" | null; taken: boolean; partners: { id: string; name: string }[] };
};

type Message = { text: string; error?: boolean; link?: { href: string; label: string } };

/**
 * Owner-only controls on a character's card: the full editor (every field, /characters/[id]/edit), the
 * open-to-dates switch, Pro portrait generation on the owner's own key, a 4-second intro clip (Veo on their own
 * Google key, behind the bought-token paywall unless they're an admin; lib/video.ts), and delete.
 */
export default function OwnerControls(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [openToDates, setOpenToDates] = useState(props.openToDates);

  async function toggleOpenToDates() {
    const next = !openToDates;
    setOpenToDates(next);
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, { open_to_dates: next }, "PATCH").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.refresh();
    else setOpenToDates(!next);
  }

  const [isPrivate, setIsPrivate] = useState(props.private ?? false);

  async function togglePrivate() {
    const next = !isPrivate;
    setIsPrivate(next);
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, { visibility: next ? "private" : "public" }, "PATCH").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.refresh();
    else setIsPrivate(!next);
  }

  const [audience, setAudience] = useState<Audience>(props.audience ?? "everyone");

  async function changeAudience(next: Audience) {
    const prev = audience;
    setAudience(next);
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, { open_audience: next }, "PATCH").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.refresh();
    else setAudience(prev);
  }

  const [talk, setTalk] = useState<TalkLevel>(props.talk?.level ?? "standard");

  async function changeTalk(next: TalkLevel) {
    const prev = talk;
    setTalk(next);
    setBusy(true);
    const res = await requestJson(`/api/characters/${props.id}`, { talk: next }, "PATCH").catch(() => ({ ok: false, message: "Network error." }));
    setBusy(false);
    if (res.ok) {
      setMessage(null);
      router.refresh();
    } else {
      setTalk(prev);
      setMessage({ text: res.message ?? "Couldn't save that.", error: true, link: next === "marathon" ? { href: "/account", label: "Add a text key" } : undefined });
    }
  }

  const [partnerStyle, setPartnerStyle] = useState<PartnerStyle>(props.partners?.choice ?? "decide");

  async function changePartnerStyle(next: PartnerStyle) {
    const prev = partnerStyle;
    setPartnerStyle(next);
    setBusy(true);
    const res = await requestJson(`/api/characters/${props.id}`, { partner_style: next }, "PATCH").catch(() => ({ ok: false, message: "Network error." }));
    setBusy(false);
    if (res.ok) {
      setMessage(null);
      router.refresh();
    } else {
      setPartnerStyle(prev);
      setMessage({ text: res.message ?? "Couldn't save that.", error: true });
    }
  }

  const [style, setStyle] = useState<PortraitStyle>(DEFAULT_PORTRAIT_STYLE);

  async function generatePortrait() {
    setBusy(true);
    setMessage({ text: `Generating a ${PORTRAIT_STYLE_LABELS[style].toLowerCase()} portrait on your key…` });
    const { ok, status, message } = await requestJson(`/api/characters/${props.id}/portrait`, { style }, "POST").catch(() => ({ ok: false, status: 0, message: "Network error." }));
    setBusy(false);
    if (ok) {
      setMessage({ text: "Portrait updated. Regenerate until it looks right, then make the clip from it." });
      router.refresh();
    } else if (status === 400) {
      setMessage({ text: "Add an OpenAI image key on your account first.", error: true });
    } else {
      setMessage({ text: message, error: true });
    }
  }

  async function generateClip() {
    if (props.clip && !props.clip.hasPortrait) {
      setMessage({ text: "Approve a portrait first — the clip's first frame starts from it.", error: true });
      return;
    }
    setBusy(true);
    setMessage({ text: "Starting a clip on your Google key (Veo takes a minute or two)…" });
    const start = await requestJson(`/api/characters/${props.id}/clip`, { style }, "POST").catch(() => ({ ok: false, status: 0, message: "Network error.", data: {} as Record<string, unknown> }));
    if (!start.ok) {
      setBusy(false);
      if (start.status === 402) setMessage({ text: start.message ?? "A clip costs bought tokens.", error: true, link: { href: "/shop", label: "Get tokens" } });
      else if (start.status === 409) setMessage({ text: start.message ?? "Approve a portrait first.", error: true });
      else if (start.status === 400) setMessage({ text: start.message ?? "Add a Google key first.", error: true, link: { href: "/account", label: "Add a Google key" } });
      else setMessage({ text: start.message ?? "Google couldn't start the clip.", error: true });
      return;
    }
    // Poll until Google finishes (bounded), then show it. A render can take a couple of minutes.
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      const res = await fetch(`/api/characters/${props.id}/clip`).then((r) => r.json()).catch(() => ({ status: "rendering" }));
      if (res.status === "ready") {
        setBusy(false);
        setMessage(null);
        router.refresh();
        return;
      }
      if (res.status === "failed") {
        setBusy(false);
        setMessage({ text: `${res.message ?? "Google couldn't make this clip."}${res.refunded ? " Your token was refunded." : ""}`, error: true });
        return;
      }
    }
    setBusy(false);
    setMessage({ text: "Still rendering — refresh the page in a minute to see your clip." });
  }

  async function remove() {
    if (!confirm(`Delete ${props.name}? This can't be undone. If they've already aired in an episode, that episode stays but is no longer yours.`)) return;
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, {}, "DELETE").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.push("/account");
  }

  return (
    <section className="card owner-controls" aria-label={`Your character: ${props.name}`} aria-busy={busy}>
      <div className="owner-head">
        <p className="muted">This is your character.</p>
        <Link className="button" href={`/characters/${props.id}/edit`}>
          ✏️ Edit {shortName(props.name)}
        </Link>
      </div>
      <p className="muted small">
        Change anything — name, sheet, voice, look, details, private soul. What they&apos;ve learned from their dates stays.
      </p>
      <p className="muted small">
        {openToDates
          ? audience === "people"
            ? "💌 In the swipe deck for characters made by people."
            : audience === "agents"
              ? "💌 In the swipe deck for characters made by AI agents."
              : "💌 In the swipe deck: other creators (people and AI agents) can swipe for them. A first date takes a match."
          : "Not in the swipe deck for now."}{" "}
        <button type="button" className="link-button" onClick={toggleOpenToDates} disabled={busy} aria-pressed={openToDates}>
          {openToDates ? "Close to dates" : "Open to dates"}
        </button>
      </p>
      <p className="muted small">
        {isPrivate
          ? "🔒 Private: the directory lists them by name only, and their card shows just their name to everyone else."
          : "Public: anyone can open their card from the directory."}{" "}
        <button type="button" className="link-button" onClick={togglePrivate} disabled={busy} aria-pressed={isPrivate}>
          {isPrivate ? "Make public" : "Make private"}
        </button>
      </p>
      {openToDates && (
        <div className="owner-talk">
          <label htmlFor={`audience-${props.id}`}>Who can swipe for them</label>
          <select id={`audience-${props.id}`} value={audience} disabled={busy} onChange={(e) => void changeAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
      )}
      {props.partners && (
        <div className="owner-talk">
          <label htmlFor={`partners-${props.id}`}>One partner or more</label>
          <select id={`partners-${props.id}`} value={partnerStyle} disabled={busy} onChange={(e) => void changePartnerStyle(e.target.value as PartnerStyle)}>
            {PARTNER_STYLES.map((s) => (
              <option key={s} value={s}>
                {s === "decide" ? `Let ${shortName(props.name)} decide` : PARTNER_STYLE_LABELS[s]}
              </option>
            ))}
          </select>
          <p className="muted small">
            {partnerStyle === "decide" && props.partners.decided
              ? `${shortName(props.name)} decided: ${props.partners.decided === "open" ? "more than one" : "one partner"}. `
              : partnerStyle === "decide"
                ? `${shortName(props.name)} settles it from their own temperament the first time they're dating someone. `
                : ""}
            {props.partners.taken && props.partners.partners[0]
              ? `With ${props.partners.partners[0].name} now, so closed to new dates until it cools off.`
              : "One partner: once they're dating someone, they close to new dates and only see them. More than one: they keep dating."}
          </p>
        </div>
      )}
      {props.talk && (
        <div className="owner-talk">
          <label htmlFor={`talk-${props.id}`}>How much {shortName(props.name)} talks</label>
          <select id={`talk-${props.id}`} value={talk} disabled={busy} onChange={(e) => void changeTalk(e.target.value as TalkLevel)}>
            {TALK_LEVELS.map((l) => (
              <option key={l} value={l} disabled={l === "marathon" && !props.talk!.hasTextKey}>
                {TALK[l].label}: {TALK[l].hint}
                {l === "marathon" && !props.talk!.hasTextKey ? " (add a key first)" : ""}
              </option>
            ))}
          </select>
          <p className="muted small">
            The date and the texts after. A date runs at the longer of the two characters&apos; settings, never shorter than
            standard, and it never changes how it ends. Marathon needs both sides on their creators&apos; own keys; otherwise
            it plays Long.{!props.talk.hasTextKey && <> <Link href="/account">Add your own key</Link> to unlock it.</>}
          </p>
        </div>
      )}
      <div className="owner-actions">
        <span className="pro-tag">✨ Pro</span>
        <div className="owner-style">
          <label htmlFor={`style-${props.id}`}>Portrait &amp; clip style</label>
          <select id={`style-${props.id}`} value={style} disabled={busy} onChange={(e) => setStyle(e.target.value as PortraitStyle)}>
            {PORTRAIT_STYLES.map((s) => (
              <option key={s} value={s}>
                {PORTRAIT_STYLE_LABELS[s]}
              </option>
            ))}
          </select>
          <p className="muted small">
            The portrait generates in this style, and the clip starts from the portrait and stays on it. Pick anime for an
            anime character and Veo won&apos;t drift to a generic look.
          </p>
        </div>
        <ul className="owner-action-list">
          <li>
            <button type="button" className="link-button" onClick={generatePortrait} disabled={busy}>
              {props.clip?.hasPortrait ? "Regenerate the portrait" : "Generate a portrait"}
            </button>{" "}
            <span className="owner-hint">(on your own key — regenerate until it looks right)</span>
          </li>
          {props.clip && (
            <li>
              <button type="button" className="link-button" onClick={generateClip} disabled={busy || !props.clip.hasPortrait}>
                Make a 4-second clip from the portrait
              </button>{" "}
              <span className="owner-hint">
                {props.clip.admin
                  ? "(admin: no tokens; ~$0.20 on your Google key)"
                  : `(${props.clip.cost} bought token${props.clip.cost === 1 ? "" : "s"} + ~$0.20 on your Google key; you have ${props.clip.boughtTokens})`}
                {!props.clip.hasPortrait && <> · approve a portrait first</>}
                {!props.clip.hasKey && (
                  <>
                    {" "}
                    · <Link href="/account">add a Google key</Link>
                  </>
                )}
              </span>
            </li>
          )}
        </ul>
      </div>
      <div className="owner-danger">
        <button type="button" className="link-button danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>
      <p className={message?.error ? "owner-message error" : "owner-message muted small"} role="status" aria-live="polite">
        {message?.text}
        {message?.link && (
          <>
            {" "}
            <Link href={message.link.href}>{message.link.label}</Link>
          </>
        )}
      </p>
    </section>
  );
}
