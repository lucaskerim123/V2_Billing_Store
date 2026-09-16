import AdminSettingsEditor from "@/components/AdminSettingsEditor";

export default function Page(){
  return <AdminSettingsEditor
    category="store"
    title="Storefront settings"
    description="Customer-facing Store copy used by the catalogue, product sections and checkout presentation."
  />;
}
