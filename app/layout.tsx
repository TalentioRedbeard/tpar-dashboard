import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSessionUser } from "../lib/supabase-server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TPAR-DB",
  description: "TPAR-DB internal dashboard",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Probe session — null on /login or /auth/* (no cookie yet, or middleware
  // redirected). Header is only rendered when a session exists.
  const user = await getSessionUser().catch(() => null);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {user && (
          <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3">
              <a href="/" className="text-sm font-semibold tracking-tight text-neutral-900">TPAR-DB</a>
              <div className="flex items-center gap-4 text-sm text-neutral-600">
                <span>{user.email}</span>
                <form action="/auth/signout" method="POST">
                  <button type="submit" className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </header>
        )}
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
