import type { ReactNode } from "react";
import "@/themes/active/customer.css";
import PortalLayoutClient from "./PortalLayoutClient";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <PortalLayoutClient>{children}</PortalLayoutClient>;
}
