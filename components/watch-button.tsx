"use client";

import { Star } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/button";
import { toggleWatch, useIsWatched, type WatchedItem } from "@/lib/watchlist-store";

type WatchTarget = Omit<WatchedItem, "addedAt">;

/**
 * When `item` is supplied the button persists to the browser watchlist; without it the button
 * is decorative local state. The optional form exists so call sites that haven't been given a
 * concrete entity yet still compile -- prefer always passing `item`.
 */
export function WatchButton({
  item,
  defaultWatched = false,
  size = "md",
  iconOnly,
}: {
  item?: WatchTarget;
  defaultWatched?: boolean;
  size?: "sm" | "md";
  iconOnly?: boolean;
}) {
  const [localWatched, setLocalWatched] = useState(defaultWatched);
  const stored = useIsWatched(item?.id ?? "");
  const watched = item ? stored.watched : localWatched;

  function onClick() {
    if (item) {
      toggleWatch(item);
      return;
    }
    setLocalWatched((value) => !value);
  }

  const label = watched ? "Watching" : "Watch";

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={watched}
        aria-label={label}
        title={label}
        className={cn(
          "grid h-7 w-7 flex-none place-items-center rounded-md transition hover:bg-[var(--panel-2)]",
          watched ? "text-[var(--warning)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
        )}
      >
        <Star className={cn("h-3.5 w-3.5", watched && "fill-current")} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={watched}
      className={buttonClass(
        "ghost",
        size,
        watched &&
          "border-[rgba(251,191,36,0.35)] bg-[var(--warning-soft)] text-[var(--warning)] [&>svg]:text-[var(--warning)] hover:bg-[var(--warning-soft)]",
      )}
    >
      <Star className={cn(watched && "fill-current")} />
      {label}
    </button>
  );
}
