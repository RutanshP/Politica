import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-10 rounded-[32px] border border-white/60 bg-[var(--panel)] px-6 py-5 text-sm text-[var(--muted)] shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p>
          Politica connects legislation, politicians, committees, money, issues, and news into one navigable political intelligence workspace.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/search" className="font-semibold text-[var(--accent)]">
            Search
          </Link>
          <Link href="/watchlist" className="font-semibold text-[var(--accent)]">
            Watchlist
          </Link>
          <Link href="/profile" className="font-semibold text-[var(--accent)]">
            Profile
          </Link>
        </div>
      </div>
    </footer>
  );
}
