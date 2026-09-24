import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import SiteTitle from "@/components/SiteTitle";
import PublicSiteConfig from "@/components/PublicSiteConfig";
import LicenseMasterStatusNotice from "@/components/LicenseMasterStatusNotice";
import "./globals.css";
import "./store.css";
import "./public-config.css";
import "@/themes/auth.css";
import "@/themes/auth-fixes.css";
import "./home.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OrbitFS",
  description: "OrbitFS is a modular system for files, profiles, workspaces, connected context and document workflows.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" data-admin-theme="v3" data-customer-theme="V3C" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
    <body className="min-h-full flex flex-col">
      <PublicSiteConfig />
      <SiteTitle />
      <LicenseMasterStatusNotice />
      <style>{`
        /* The homepage star/nebula layers were behind the .orbitHome background because
           home.css gives the pseudo-elements negative z-index values. Keep those visual
           layers inside the OrbitFS stacking context and keep all actual content above them. */
        .orbitHome::before,
        .orbitHome::after {
          z-index: 0 !important;
        }
        .orbitHome > header,
        .orbitHome > section,
        .orbitHome > footer {
          position: relative;
          z-index: 2;
        }
      `}</style>
      {children}
    </body>
  </html>;
}
