import type { ReactNode } from "react";
import "@/themes/active/admin.css";
import "@/themes/admin-shell.css";
import ThemeRuntime from "@/components/ThemeRuntime";
import AdminLayoutClient from "./AdminLayoutClient";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>
    <ThemeRuntime surface="admin" />
    <AdminLayoutClient>{children}</AdminLayoutClient>
  </>;
}
