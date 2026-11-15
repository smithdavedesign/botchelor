import { BRIDGE_COPY } from "@/lib/adult/bridge";

/**
 * The After Dark bridge on the creator's verdict card (lib/adult/bridge.ts says who sees it: their own character's
 * date ended in a second date, they've said they're 18 or older, After Dark is allowed where they are, and it's still
 * invite only). One quiet line under the card's own actions, never a button: the card's next step stays "Hear from".
 * The link is the invite request that already exists, carrying source=verdict; the owner approves every one. The click
 * is counted by its data-track name (app/engagement.ts), like every other control.
 */
export default function AfterDarkBridge({ href }: { href: string }) {
  return (
    <p className="muted small verdict-after-dark" data-ad-bridge>
      {BRIDGE_COPY.lead} {BRIDGE_COPY.invite}{" "}
      <a href={href} data-track="ad-bridge">
        {BRIDGE_COPY.link}
      </a>
      .
    </p>
  );
}
