"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * Prefers browser history over a fixed href so filters/pagination on the page navigated from
 * (e.g. /bills?status=Failed&page=2) survive the round trip. Falls back to `fallbackHref` when
 * there's no history to go back to (direct link, new tab, shared URL).
 */
export function BackLink({ fallbackHref, label }: { fallbackHref: string; label: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="mb-3.5 inline-flex items-center gap-1.5 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
