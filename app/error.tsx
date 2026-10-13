"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Rendered inside the app shell when a page throws -- most often a Supabase read that timed out.
 * Without it Next served its bare default error screen with no way back into the site.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--line-2)] bg-[var(--panel)] text-[var(--warning)]">
        <TriangleAlert className="h-5 w-5" />
      </span>
      <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
        This page could not load
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">
        The data behind it did not come back in time. Trying again usually works.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-[var(--r-sm)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[var(--accent-hover)]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-[var(--r-sm)] border border-[var(--line)] px-4 py-2 text-[13px] text-[var(--muted)] transition hover:border-[var(--line-2)] hover:text-[var(--ink)]"
        >
          Go home
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-6 text-[11px] text-[var(--faint)]">Reference {error.digest}</p>
      ) : null}
    </div>
  );
}
