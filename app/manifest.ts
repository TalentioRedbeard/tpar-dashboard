// PWA manifest. Lets a tech "Add to Home Screen" on their phone and get
// an installable icon that opens the dashboard in standalone mode.
//
// Icons are generated dynamically by app/icon.tsx, app/apple-icon.tsx,
// app/icon1.tsx (192), and app/icon2.tsx (512). No PNG assets to maintain.
// Maskable purpose is set on the 512 — its safe zone is ~60% center.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TPAR-DB",
    short_name: "TPAR",
    description: "Tulsa Plumbing And Remodeling — unified operations dashboard",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1e40af",         // brand-700; matches launch splash
    theme_color: "#1e40af",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon",        sizes: "32x32",   type: "image/png", purpose: "any" },
      { src: "/icon1",       sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon2",       sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon2",       sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon",  sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
