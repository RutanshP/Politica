import type { Metadata } from "next";

import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Politica",
  description:
    "Politica is a responsive civic intelligence MVP for exploring bills, politicians, votes, committees, money, and issue signals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-[var(--canvas)]">
      <body className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_28%),linear-gradient(180deg,_#f6f8fc_0%,_#eff3f9_100%)] font-sans text-[var(--ink)]">
        <AppShell>
          <>
            {children}
            <Footer />
          </>
        </AppShell>
      </body>
    </html>
  );
}
