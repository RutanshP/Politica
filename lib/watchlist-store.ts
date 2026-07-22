"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { EntityType } from "@/types/civic";

/**
 * Browser-local watchlist. There is no account backend yet, so the watchlist lives in
 * localStorage and every Watch button in the app writes to it.
 *
 * The full display record is stored, not just an id, so the watchlist page can render pins
 * without refetching each entity -- important because the entities span four different tables.
 */
export interface WatchedItem {
  id: string;
  type: EntityType;
  label: string;
  subtitle?: string;
  href: string;
  /** ISO timestamp, used to order pins most-recently-added first. */
  addedAt: string;
}

const STORAGE_KEY = "politica:watchlist:v1";
const CHANGE_EVENT = "politica:watchlist-change";

/**
 * Stable empty reference. useSyncExternalStore compares snapshots by identity, so returning a
 * fresh [] on the server (or before hydration) would loop forever.
 */
const EMPTY: WatchedItem[] = [];

let cache: WatchedItem[] | null = null;

function parse(raw: string | null): WatchedItem[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(
      (item): item is WatchedItem =>
        !!item
        && typeof item === "object"
        && typeof (item as WatchedItem).id === "string"
        && typeof (item as WatchedItem).href === "string"
        && typeof (item as WatchedItem).label === "string",
    );
  } catch {
    // A corrupt or hand-edited value shouldn't break every page that renders a Watch button.
    return EMPTY;
  }
}

export function readWatchlist(): WatchedItem[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  cache = parse(window.localStorage.getItem(STORAGE_KEY));
  return cache;
}

function write(items: WatchedItem[]) {
  cache = items;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private-mode quota failures shouldn't throw out of a click handler; the in-memory cache
    // still reflects the change for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cache = null; // another tab wrote; re-read on next snapshot
    onChange();
  }
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function toggleWatch(item: Omit<WatchedItem, "addedAt">) {
  const items = readWatchlist();
  const existing = items.some((entry) => entry.id === item.id);
  write(
    existing
      ? items.filter((entry) => entry.id !== item.id)
      : [{ ...item, addedAt: new Date().toISOString() }, ...items],
  );
  return !existing;
}

export function removeWatch(id: string) {
  write(readWatchlist().filter((entry) => entry.id !== id));
}

export function clearWatchlist() {
  write([]);
}

/** Never fires; the snapshot pair alone is what distinguishes server from client. */
function neverSubscribe() {
  return () => {};
}

/**
 * Returns the stored watchlist plus a `ready` flag. `ready` is false during the server render and
 * the first client render, so components can avoid flashing an empty state before localStorage
 * has been read.
 *
 * This is React's documented client-only-render pattern. A mount effect that calls setState would
 * do the same job but trips react-hooks' cascading-render rule.
 */
export function useWatchlist() {
  const items = useSyncExternalStore(subscribe, readWatchlist, () => EMPTY);
  const ready = useSyncExternalStore(
    neverSubscribe,
    () => true,
    () => false,
  );

  const isWatched = useCallback((id: string) => items.some((entry) => entry.id === id), [items]);

  return { items, isWatched, ready, toggle: toggleWatch, remove: removeWatch };
}

export function useIsWatched(id: string) {
  const { isWatched, ready } = useWatchlist();
  return { watched: ready && isWatched(id), ready };
}
