"use client";

import { useState } from "react";

import { cn, initials } from "@/lib/utils";
import { partyTone } from "@/components/ui/tones";

/**
 * Federal member photos come from the unitedstates.io congress-images dataset, which is keyed on
 * bioguide ID -- and `Politician.id` *is* the bioguide ID for federal members (see
 * lib/normalizers/politicians.ts). So no schema column and no sync change is needed; we just
 * have to recognise a bioguide-shaped id and fall back for everything else.
 */
const BIOGUIDE_ID = /^[A-Z]\d{6}$/;

function photoUrl(id?: string | null) {
  if (!id || !BIOGUIDE_ID.test(id)) return undefined;
  return `https://unitedstates.github.io/images/congress/225x275/${id}.jpg`;
}

const PARTY_GRADIENT = {
  "party-d": "bg-[linear-gradient(150deg,#3b82f6,#1e40af)]",
  "party-r": "bg-[linear-gradient(150deg,#ef4444,#991b1b)]",
  "party-i": "bg-[linear-gradient(150deg,#a78bfa,#6d28d9)]",
  slate: "bg-[linear-gradient(150deg,#475569,#1e293b)]",
} as const;

const SIZES = {
  xs: "h-7 w-7 text-[10.5px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
  xl: "h-18 w-18 rounded-[var(--r-lg)] text-[22px]",
} as const;

export function Avatar({
  name,
  id,
  party,
  size = "md",
  className,
}: {
  name: string;
  /** Politician id; a bioguide-shaped value resolves to a real headshot. */
  id?: string | null;
  party?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = photoUrl(id);
  const tone = partyTone(party);
  const gradient = PARTY_GRADIENT[tone as keyof typeof PARTY_GRADIENT] ?? PARTY_GRADIENT.slate;

  const shell = cn(
    "grid flex-none place-items-center overflow-hidden rounded-full font-semibold tracking-[-0.01em] text-white",
    SIZES[size],
    className,
  );

  if (!src || failed) {
    return (
      <span className={cn(shell, gradient)} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }

  return (
    <span className={cn(shell, gradient)}>
      {/*
        Deliberately not next/image: these are tiny, external, and need an onError fallback for
        the many members with no photo in the dataset. Routing them through the optimizer buys
        nothing and adds a remote fetch that can fail closed.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
