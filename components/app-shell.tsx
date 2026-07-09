"use client";

import {
  BarChart3,
  Bell,
  BookText,
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  CircleUserRound,
  Compass,
  Landmark,
  Menu,
  Newspaper,
  Scale,
  Search,
  Star,
  Vote,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home", icon: Compass, exact: true },
  { href: "/bills", label: "Bills", icon: BookText },
  { href: "/politicians", label: "Politicians", icon: CircleUserRound, exact: true },
  { href: "/committees/senate-finance", label: "Committees", icon: Building2 },
  { href: "/elections", label: "Elections", icon: Vote },
  { href: "/money/network", label: "Money", icon: Wallet },
  { href: "/issues/technology", label: "Issues", icon: Scale },
  { href: "/news", label: "News", icon: Newspaper },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/politicians/elizabeth-warren", label: "Profile", icon: CircleUserRound, exact: true },
  { href: "/more", label: "More", icon: ChevronRight },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[272px] border-r border-white/10 bg-[linear-gradient(180deg,_rgba(8,15,31,0.98)_0%,_rgba(15,23,42,0.98)_55%,_rgba(14,30,60,0.98)_100%)] p-5 text-[var(--sidebar-ink)] shadow-[0_20px_60px_rgba(15,23,42,0.28)] transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-2 text-white">
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-sm font-bold tracking-[0.18em] text-white">
                POLITICA
              </p>
              <p className="text-xs text-slate-400">Civic intelligence</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full border border-white/10 p-2 text-slate-300 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-8 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition",
                  active
                    ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    : "text-slate-300 hover:bg-white/6 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/6 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Sync roadmap
          </p>
          <div className="mt-4 space-y-3 text-sm text-slate-200">
            <div className="rounded-2xl bg-black/15 p-3">
              Bills and votes every 6 hours
            </div>
            <div className="rounded-2xl bg-black/15 p-3">
              Finance and committees daily
            </div>
            <div className="rounded-2xl bg-black/15 p-3">
              Search and analytics weekly
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:col-start-2">
        <header className="sticky top-0 z-30 border-b border-white/40 bg-white/65 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-700 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                defaultValue=""
                placeholder="Search bills, politicians, committees, issues..."
                className="w-full rounded-full border border-slate-200/80 bg-white px-11 py-3 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400"
              />
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white p-3 text-slate-600"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white p-3 text-slate-600"
              aria-label="Workspace"
            >
              <BriefcaseBusiness className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
