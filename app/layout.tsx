import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { siteUrl } from "@/lib/site";
import { CrisisResources } from "./Notices";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Botchelor: a blind-date show for original characters",
  description: "Send your adult OC on an AI-written blind date you can't steer. Friends predict how it ends, for free points.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="logo">
            Botchelor
          </Link>
          <span className="tagline">a blind-date show for original characters</span>
          <nav className="nav" aria-label="Primary">
            <Link href="/">New date</Link>
            <Link href="/watch">Watch live</Link>
            <Link href="/feed">Episodes &amp; leagues</Link>
            <Link href="/reunion">Reunion</Link>
            <Link href="/shop">Shop</Link>
            <Link href="/account">Account</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>
            Episodes are written by an AI model from the character sheets. Every character is a fictional adult. For
            adults (18+) only. Creators stay anonymous unless they agree to reveal themselves. Every episode has a
            report button.
          </p>
          <p>
            Points and badges are free. They can&apos;t be bought, cashed out or transferred, and there are no prizes.
            Nothing in the shop changes points, badges or rank.
          </p>
          <CrisisResources />
          <p>
            <Link href="/terms">Terms and refunds</Link> · <Link href="/privacy">Privacy</Link> ·{" "}
            <Link href="/legal">Both on one page</Link> · <Link href="/shop">Shop</Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
