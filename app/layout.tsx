import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSessionUser } from "../lib/supabase-server";
import { getCurrentTech } from "../lib/current-tech";
import { Nav } from "../components/Nav";
import { RegisterServiceWorker } from "../components/RegisterServiceWorker";
import { InstallPrompt } from "../components/InstallPrompt";
import { ImpersonationBanner } from "../components/ImpersonationBanner";

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
  themeColor: "#1e40af",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: true as const,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Probe session — null on /login or /auth/* (no cookie yet, or middleware
  // redirected). Nav is only rendered when a session exists.
  const user = await getSessionUser().catch(() => null);
  const me = user ? await getCurrentTech().catch(() => null) : null;
  const isTech = !!me?.tech && me?.dashboardRole === "tech";
  const isAdmin = !!me?.isAdmin;
  const isManager = !!me?.isManager;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {user && (
          <Nav
            userEmail={user.email}
            isTech={isTech}
            isAdmin={isAdmin}
            isManager={isManager}
          />
        )}
        {me?.isImpersonating && me.tech ? (
          <ImpersonationBanner
            techShortName={me.tech.tech_short_name}
            realEmail={me.realEmail}
          />
        ) : null}
        <div className="flex-1">{children}</div>
        <RegisterServiceWorker />
        {user && <InstallPrompt />}
      </body>
    </html>
  );
}
