import type { Metadata } from "next";

import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Footer } from "@/components/footer";
import { getSyncFreshness } from "@/lib/data/sync-status";

export const metadata: Metadata = {
  title: "Politica",
  description:
    "Politica is a responsive civic intelligence MVP for exploring bills, politicians, votes, committees, money, and issue signals.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Cached + tag-invalidated, so this does not opt routes out of static rendering.
  const sync = await getSyncFreshness().catch(() => undefined);

  return (
    <html lang="en" className="h-full bg-[var(--canvas)]">
      <body className="min-h-full bg-[var(--canvas)] font-sans text-[var(--ink)]">
        <AppShell sync={sync}>
          <>
            {children}
            <Footer />
          </>
        </AppShell>
      </body>
    </html>
  );
}
