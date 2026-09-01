"use client";

import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronsLeft,
  CircleUserRound,
  FileText,
  Landmark,
  Menu,
  Newspaper,
  Scale,
  Star,
  Users,
  Vote,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { SearchBar } from "@/components/search-bar";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SyncFreshness } from "@/lib/data/sync-status";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Match only this exact path, rather than any path beneath it. */
  exact?: boolean;
  /** A shortcut into a tab of another page -- never takes the active highlight. */
  shortcut?: boolean;
  dot?: boolean;
};

const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Landmark, exact: true },
  { href: "/bills", label: "Bills", icon: FileText },
  { href: "/politicians", label: "Politicians", icon: CircleUserRound },
  { href: "/committees", label: "Committees", icon: Users },
  { href: "/elections", label: "Elections", icon: Vote },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/issues", label: "Issues", icon: Scale },
  { href: "/news", label: "News", icon: Newspaper },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

/*
 * Alerts / Saved searches are tabs on /watchlist, reached by query string. Active state here is
 * pathname-only on purpose: reading useSearchParams from the root layout would force a Suspense
 * boundary around the whole shell. So the shortcuts link in but never light up -- Watchlist owns
 * the highlight for that route.
 */
const SECONDARY_NAV: NavItem[] = [
  { href: "/watchlist", label: "Watchlist", icon: Star, exact: true },
  { href: "/watchlist?tab=alerts", label: "Alerts", icon: Bell, shortcut: true, dot: true },
  { href: "/profile", label: "Profile", icon: CircleUserRound, exact: true },
];

const SYNC_TONE = {
  ok: "bg-[var(--success)] shadow-[0_0_0_3px_var(--success-soft)]",
  stale: "bg-[var(--warning)] shadow-[0_0_0_3px_var(--warning-soft)]",
  unknown: "bg-[var(--faint)]",
} as const;

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-[var(--r-sm)] px-2.5 py-2.5 text-[13.5px] transition",
        collapsed && "justify-center px-0",
        active
          ? "bg-[var(--accent-soft)] text-[#c7ccff]"
          : "text-[var(--muted)] hover:bg-white/4 hover:text-[var(--ink)]",
      )}
    >
      <Icon className={cn("h-4.5 w-4.5 flex-none", active && "text-[var(--accent-2)]")} />
      {collapsed ? null : (
        <>
          <span className="truncate">{item.label}</span>
          {item.dot ? (
            <span className="ml-auto h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent-2)]" />
          ) : null}
        </>
      )}
    </Link>
  );
}

export function AppShell({
  children,
  sync,
}: {
  children: React.ReactNode;
  sync?: SyncFreshness;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  function isActive(item: NavItem) {
    if (item.shortcut) return false;
    return item.exact ? pathname === item.href : pathname.startsWith(item.href);
  }

  const close = () => setOpen(false);

  return (
    <div
      className={cn(
        "min-h-screen lg:grid",
        collapsed ? "lg:grid-cols-[68px_minmax(0,1fr)]" : "lg:grid-cols-[240px_minmax(0,1fr)]",
      )}
    >
      {/* Mobile scrim */}
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={close}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-[var(--line)] bg-[var(--sidebar)] px-3 pb-3 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          collapsed && "lg:w-17 lg:px-2",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div
          className={cn(
            "flex h-16 flex-none items-center gap-2.5 px-2",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <Link href="/" onClick={close} className="flex items-center gap-2.5">
            <Landmark className="h-6.5 w-6.5 flex-none text-[var(--ink)]" />
            {collapsed ? null : (
              <span className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                Politica
              </span>
            )}
          </Link>
          <IconButton
            label="Close navigation"
            onClick={close}
            className="ml-auto lg:hidden"
          >
            <X />
          </IconButton>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto pt-1.5">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(item)}
              collapsed={collapsed}
              onNavigate={close}
            />
          ))}
          <div className="my-2.5 h-px bg-[var(--line)]" />
          {SECONDARY_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(item)}
              collapsed={collapsed}
              onNavigate={close}
            />
          ))}
        </nav>

        <div className="flex flex-none flex-col gap-2.5">
          {sync && !collapsed ? (
            <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-white/2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn("h-1.5 w-1.5 flex-none rounded-full", SYNC_TONE[sync.tone])}
                />
                <span className="text-xs text-[var(--ink)]">{sync.label}</span>
              </div>
              {sync.detail ? (
                <p className="mt-0.5 pl-3.5 text-[11px] text-[var(--faint)]">{sync.detail}</p>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className={cn(
              "hidden items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-2 text-xs text-[var(--faint)] transition hover:bg-white/4 hover:text-[var(--ink)] lg:flex",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            <ChevronsLeft className={cn("h-4 w-4 flex-none transition", collapsed && "rotate-180")} />
            {collapsed ? null : "Collapse"}
          </button>

          <Link
            href="/profile"
            onClick={close}
            className={cn(
              "flex items-center gap-2.5 rounded-[var(--r-md)] p-2 transition hover:bg-white/4",
              collapsed && "lg:justify-center lg:p-1.5",
            )}
          >
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[linear-gradient(150deg,#a78bfa,#6d28d9)] text-xs font-semibold text-white">
              AL
            </span>
            {collapsed ? null : (
              <>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-[var(--ink)]">
                    Alex
                  </span>
                  <span className="block text-[11px] text-[var(--faint)]">Free account</span>
                </span>
                <ChevronDown className="ml-auto h-4 w-4 flex-none text-[var(--faint)]" />
              </>
            )}
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col lg:col-start-2">
        <header className="sticky top-0 z-30 flex h-16 flex-none items-center gap-3 border-b border-[var(--line)] bg-[rgba(10,14,23,0.86)] px-4 backdrop-blur-md sm:px-6">
          <IconButton label="Open navigation" onClick={() => setOpen(true)} className="lg:hidden">
            <Menu />
          </IconButton>

          <SearchBar />

          <Link
            href="/watchlist?tab=alerts"
            aria-label="Alerts"
            className="relative grid h-9 w-9 flex-none place-items-center rounded-[var(--r-sm)] text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--ink)]"
          >
            <Bell className="h-4.5 w-4.5" />
          </Link>
          <Link
            href="/watchlist"
            className="hidden h-9 items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--line)] px-3.5 text-[13px] font-medium text-[var(--ink)] transition hover:border-[var(--line-2)] hover:bg-[var(--panel-2)] sm:inline-flex"
          >
            <Star className="h-3.5 w-3.5 text-[var(--muted)]" />
            Watchlist
          </Link>
          <Link
            href="/profile"
            aria-label="Profile"
            className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[linear-gradient(150deg,#a78bfa,#6d28d9)] text-xs font-semibold text-white"
          >
            AL
          </Link>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
