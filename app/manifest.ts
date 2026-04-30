// PWA manifest. Lets Danny "Add to Home Screen" on his phone and get an
// installable icon that opens the dashboard in standalone mode.
//
// Icons are generated dynamically by app/icon.tsx and app/apple-icon.tsx
// (Next.js App Router file conventions). No PNG assets to manage.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TPAR-DB",
    short_name: "TPAR",
    description: "Tulsa Plumbing And Remodeling — unified operations dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#171717",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon",        sizes: "32x32",   type: "image/png" },
      { src: "/apple-icon",  sizes: "180x180", type: "image/png" },
    ],
  };
}
