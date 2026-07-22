"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SearchBar({
  placeholder = "Search bills, politicians, committees, issues…",
  defaultValue = "",
}: {
  placeholder?: string;
  defaultValue?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd-K focuses search from anywhere, which is what the keyboard hint promises.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
      }}
      className="relative mx-auto flex w-full max-w-2xl flex-1 items-center"
    >
      <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--faint)]" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label="Search Politica"
        className="h-9.5 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] pl-10 pr-16 text-[13.5px] text-[var(--ink)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--line-2)] focus:bg-[var(--panel-2)]"
      />
      <kbd className="pointer-events-none absolute right-2.5 rounded border border-[var(--line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--faint)]">
        Ctrl K
      </kbd>
    </form>
  );
}
