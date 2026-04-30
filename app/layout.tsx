import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSessionUser } from "../lib/supabase-server";
import { Nav } from "../components/Nav";

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
  description: "TPAR-DB unified app — customers, jobs, estimates, comms, dispatch, reports",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "TPAR" },
};

export const viewport = {
  themeColor: "#171717",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Probe session — null on /login or /auth/* (no cookie yet, or middleware
  // redirected). Nav is only rendered when a session exists.
  const user = await getSessionUser().catch(() => null);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {user && <Nav userEmail={user.email} />}
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
