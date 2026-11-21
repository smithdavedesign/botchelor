"use client";

import PageError from "@/app/PageError";

/** An After Dark page that fails to render: as everywhere else (app/error.tsx), with the way back to After Dark's home. */
export default function AfterDarkError({ retry }: { error: unknown; retry: () => void }) {
  return <PageError title="This page didn't load" retry={retry} home={{ href: "/after-dark", label: "Back to After Dark" }} />;
}
