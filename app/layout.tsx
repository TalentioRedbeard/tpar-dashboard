import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSessionUser } from "../lib/supabase-server";
import { getCurrentTech } from "../lib/current-tech";
import { getUnreadCounts } from "./notes/board-actions";
import { getCurrentState } from "./time/actions";
import { Nav } from "../components/Nav";
import { RegisterServiceWorker } from "../components/RegisterServiceWorker";
import { InstallPrompt } from "../components/InstallPrompt";
import { ImpersonationBanner } from "../components/ImpersonationBanner";
import { GlobalRecorder } from "../components/GlobalRecorder";
import { AmbientRecorder } from "../components/AmbientRecorder";
import { DraggableFloat } from "../components/DraggableFloat";
import { isOwner } from "../lib/admin";

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
  // me / counts / clock all internally resolve getCurrentTech(), which is now
  // React-cache() memoized — so these run concurrently and share ONE auth +
  // tech_directory resolution for the whole request.
  const [me, counts, clock] = user
    ? await Promise.all([
        getCurrentTech().catch(() => null),
        getUnreadCounts().catch(() => ({ inbox: 0, board: 0 })),
        getCurrentState().catch(() => null),
      ])
    : [null, { inbox: 0, board: 0 }, null];
  const isTech = !!me?.tech && me?.dashboardRole === "tech";
  const isAdmin = !!me?.isAdmin;
  const isManager = !!me?.isManager;
  // Admins/managers who have a tech_directory row (e.g., Danny, Kelsey) should
  // see the My day link so they can intentionally visit /me — but they don't
  // get redirected there. /me stays a deliberate destination.
  const hasTechRow = !!me?.tech;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-neutral-900">
        {user && (
          <Nav
            userEmail={user.email}
            isTech={isTech}
            isAdmin={isAdmin}
            isManager={isManager}
            hasTechRow={hasTechRow}
            unreadInbox={counts.inbox}
            unreadBoard={counts.board}
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
        {user ? (
          <>
            {/* Quick-Record button — hidden per-user via Settings (hide_quick_recorder).
                Both recorders are DRAGGABLE (grip top-left) so they never sit over page
                action buttons or the "Exit view-as" banner; position is per-device. */}
            {!me?.tech?.hide_quick_recorder && (
              <DraggableFloat storageKey="tpar-rec-quick" defaultTop={64} z={60}>
                <GlobalRecorder
                  isOwner={isOwner(user.email)}
                  clockedInJobId={clock?.state === "clocked-in" ? clock.hcp_job_id : null}
                />
              </DraggableFloat>
            )}
            {/* AmbientRecorder renders only for the owner — wrap only then, else the
                draggable grip would float with no content behind it. */}
            {isOwner(user.email) && (
              <DraggableFloat storageKey="tpar-rec-ambient" defaultTop={112} z={55}>
                <AmbientRecorder isOwner />
              </DraggableFloat>
            )}
          </>
        ) : null}
      </body>
    </html>
  );
}
