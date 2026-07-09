import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"] });

// Loaded app-wide (so the variable is always available) but only *applied*
// via the `font-term` utility, which is scoped to the Terminal CLI redesign
// pages — this is a pilot on Dashboard first, so nothing outside it should
// visually change yet. See globals.css for the --font-term mapping.
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "SRE AI OS",
  description: "Personal AI Operating System for SREs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} ${jetbrainsMono.variable} min-h-screen bg-[#09090b] text-zinc-100`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
