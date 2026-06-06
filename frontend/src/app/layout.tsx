import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from 'next/link';

const inter = Inter({ subsets: ["latin"] });

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
      <body className={`${inter.className} flex min-h-screen bg-[#09090b] text-zinc-100`}>
        <aside className="w-56 bg-zinc-950 border-r border-zinc-800 p-5 flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto flex-shrink-0">
          <div className="font-extrabold text-lg mb-6 text-emerald-400 tracking-tight flex items-center gap-2">
            <span className="text-2xl">⚡</span> SRE AI OS
          </div>
          {[
            { href: '/', label: 'Dashboard', emoji: '🏠' },
            { href: '/knowledge', label: 'Knowledge Graph', emoji: '🕸️' },
            { href: '/learning', label: 'Learning Path', emoji: '🎓' },
            { href: '/settings', label: 'Settings', emoji: '⚙️' },
          ].map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-zinc-800 hover:text-emerald-400 transition-all text-zinc-400 text-sm font-medium"
            >
              <span className="text-base">{item.emoji}</span> {item.label}
            </Link>
          ))}
        </aside>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
