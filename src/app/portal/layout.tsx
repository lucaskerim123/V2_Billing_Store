import type { ReactNode } from "react";
import "@/themes/active/customer.css";
import ThemeRuntime from "@/components/ThemeRuntime";
import PortalLayoutClient from "./PortalLayoutClient";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <>
    <ThemeRuntime surface="customer" />
    <PortalLayoutClient>{children}</PortalLayoutClient>
  </>;
}
