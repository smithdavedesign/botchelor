import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** false drops the device (full screen: the reader's own screen is the phone). */
  chrome?: boolean;
  /** A shorter phone, for a teaser. */
  short?: boolean;
};

/**
 * A smartphone around a screen (a couple's texts, a character's relationship board): the bezel, the island, a status
 * bar and the home bar. The device is decoration, hidden from screen readers; the screen is ordinary content. Pure
 * (no hooks, no client directive), so it renders in both server and client components.
 */
export default function PhoneFrame({ children, chrome = true, short = false }: Props) {
  return (
    <div className={`phone${chrome ? "" : " phone-bare"}${short ? " phone-short" : ""}`}>
      <div className="phone-screen">
        {chrome && (
          <div className="phone-status" aria-hidden="true">
            <span className="phone-time">9:41</span>
            <span className="phone-island" />
            <span className="phone-icons">
              <svg viewBox="0 0 18 12" width="17" height="11">
                <rect x="0" y="8" width="3" height="4" rx="1" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                <rect x="10" y="3" width="3" height="9" rx="1" />
                <rect x="15" y="0" width="3" height="12" rx="1" />
              </svg>
              <svg viewBox="0 0 16 12" width="15" height="11">
                <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4C5.2.4 2.5 1.5.5 3.4l1.2 1.3A8.9 8.9 0 0 1 8 2.2Z" />
                <path d="M8 5.6c1.5 0 2.8.5 3.9 1.5l1.2-1.3A7.5 7.5 0 0 0 8 3.8c-1.9 0-3.7.7-5.1 2l1.2 1.3c1.1-1 2.4-1.5 3.9-1.5Z" />
                <path d="M8 9c.7 0 1.3.3 1.7.7L8 11.6 6.3 9.7c.4-.4 1-.7 1.7-.7Z" />
              </svg>
              <svg viewBox="0 0 27 12" width="25" height="11">
                <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.45" />
                <rect x="2.5" y="2.5" width="16" height="7" rx="1.5" />
                <rect x="24" y="4" width="2" height="4" rx="1" opacity="0.45" />
              </svg>
            </span>
          </div>
        )}
        {children}
        {chrome && <span className="phone-home" aria-hidden="true" />}
      </div>
    </div>
  );
}
