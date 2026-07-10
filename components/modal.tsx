"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 transition",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="w-full max-w-2xl rounded-[32px] border border-white/60 bg-[var(--panel-strong)] p-6 shadow-[0_30px_80px_rgba(15,23,42,0.24)]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--line)] bg-white p-2 text-[var(--muted)]"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
