import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import SiteTitle from "@/components/SiteTitle";
import PublicSiteConfig from "@/components/PublicSiteConfig";
import LicenseMasterStatusNotice from "@/components/LicenseMasterStatusNotice";
import themeDefaults from "@/themes/active/defaults.json";
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
  return <html
    lang="en"
    data-admin-theme="v3"
    data-admin-theme-id={themeDefaults.admin}
    data-customer-theme="V3C"
    data-customer-theme-id={themeDefaults.customer}
    className={[geistSans.variable,geistMono.variable,"h-full antialiased"].join(" ")}
  >
    <body className="min-h-full flex flex-col">
      <PublicSiteConfig />
      <SiteTitle />
      <LicenseMasterStatusNotice />
      <style>{".orbitHome::before,.orbitHome::after{z-index:0!important}.orbitHome>header,.orbitHome>section,.orbitHome>footer{position:relative;z-index:2}"}</style>
      {children}
    </body>
  </html>;
}
