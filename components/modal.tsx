"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/button";

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
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 transition",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
      aria-hidden={!open}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-2xl rounded-[var(--r-lg)] border border-[var(--line-2)] bg-[var(--panel)] shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="ml-auto" bordered>
            <X />
          </IconButton>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
