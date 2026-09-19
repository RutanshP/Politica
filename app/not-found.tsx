import { Compass } from "lucide-react";
import Link from "next/link";

import { SearchBar } from "@/components/search-bar";

const PLACES = [
  { href: "/bills", label: "Bills" },
  { href: "/politicians", label: "Politicians" },
  { href: "/committees", label: "Committees" },
  { href: "/money/graph", label: "Money network" },
];

/**
 * Rendered for unknown URLs and for any notFound() -- a member, bill or committee id that is not
 * on file. Without this file Next served its default white 404 inside the dark shell.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--line-2)] bg-[var(--panel)] text-[var(--muted)]">
        <Compass className="h-5 w-5" />
      </span>
      <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
        Nothing here
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">
        That page, member, bill or committee is not on file. It may have been renamed, or it is
        outside the current Congress.
      </p>
      <div className="mt-6 w-full">
        <SearchBar />
      </div>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {PLACES.map((place) => (
          <Link
            key={place.href}
            href={place.href}
            className="rounded-full border border-[var(--line)] px-3.5 py-1.5 text-[13px] text-[var(--muted)] transition hover:border-[var(--line-2)] hover:text-[var(--ink)]"
          >
            {place.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
