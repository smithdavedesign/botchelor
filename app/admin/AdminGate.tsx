"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import AdminClaim from "./AdminClaim";

/** Where this browser used to keep the admin password (localStorage): cleared on sight, nothing reads it now. */
const OLD_STORAGE_KEY = "bz_frontier";

type Area = { href: string; label: string };

/**
 * /admin's door. An admin page is for a signed-in admin account (lib/admins.ts): `admin` is the server's answer
 * (./signed-in-admin.ts), so a signed-out visit asks no admin API anything (each ask was a 403 in the console), and an
 * admin is never asked for a second password (2026-11-22 audit). The admin APIs take the same account
 * (lib/admin-auth.ts); scripts send the admin key in a header instead. A browser no longer keeps that key: a signed-in
 * account that isn't an admin yet can still be made one with it, typed once (./AdminClaim.tsx).
 */
export default function AdminGate({ areas, admin, children }: { areas: Area[]; admin: boolean; children: ReactNode }) {
  useEffect(() => {
    try {
      localStorage.removeItem(OLD_STORAGE_KEY);
    } catch {
      /* private mode: nothing was kept */
    }
  }, []);

  if (admin) return <>{children}</>;
  return (
    <>
      <section className="card admin-signin">
        <h2>Admins only</h2>
        <p>
          These pages are for an admin account. <Link href="/account">Sign in to it</Link>, then come back.
        </p>
      </section>
      <AdminClaim />
      <p className="muted small admin-areas">
        Admin areas:{" "}
        {areas.map((a, i) => (
          <span key={a.href}>
            {i > 0 && " · "}
            <Link href={a.href}>{a.label}</Link>
          </span>
        ))}
      </p>
    </>
  );
}
