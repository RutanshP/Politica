import Link from "next/link";

const LINKS = [
  { href: "/search", label: "Search" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/profile", label: "Profile" },
];

export function Footer() {
  return (
    <footer className="mt-10 flex flex-col gap-3 border-t border-[var(--line)] pt-5 text-xs text-[var(--faint)] md:flex-row md:items-center md:justify-between">
      <p className="max-w-2xl leading-relaxed">
        Politica connects legislation, politicians, committees, money, issues, and news into one
        navigable workspace.
      </p>
      <div className="flex flex-wrap gap-4">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="font-medium text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </footer>
  );
}
