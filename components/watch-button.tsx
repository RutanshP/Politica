"use client";

import { Star } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function WatchButton({
  defaultWatched = false,
}: {
  defaultWatched?: boolean;
}) {
  const [watched, setWatched] = useState(defaultWatched);

  return (
    <button
      type="button"
      onClick={() => setWatched((value) => !value)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition",
        watched
          ? "border-amber-300 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-white text-slate-700",
      )}
    >
      <Star className={cn("h-4 w-4", watched && "fill-current")} />
      {watched ? "Watching" : "Watch"}
    </button>
  );
}
