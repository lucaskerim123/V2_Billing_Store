import type {ReactNode} from "react";
import LicenseProvisioningWatcher from "./LicenseProvisioningWatcher";

export default function OrdersLayout({children}:{children:ReactNode}){
  return <>{children}<LicenseProvisioningWatcher/></>;
}
